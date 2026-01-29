import type { Job, Task, Phase } from "@multi-agent/shared";
import { ok, err, Result } from "neverthrow";
import type { IStateStore } from "../store/interface.js";
import { EventBus } from "../events/bus.js";
import { transitionTask } from "../domain/task.js";
import { createTraceEntry } from "../domain/trace.js";
import { TmuxController, type TmuxSession, type TmuxPane } from "../tmux/controller.js";
import { ClaudeRunner, type ClaudeTaskConfig } from "../tmux/claude-runner.js";
import { parseClaudeOutput, toReport } from "../tmux/output-parser.js";
import { buildKobitoTaskPrompt } from "../personas/prompt-builder.js";
import type { LoadedPersonaSet } from "../personas/loader.js";

// ─── Types ──────────────────────────────────────────────

export interface TaskRunnerConfig {
  model: string;
  skipPermissions: boolean;
  outputFormat: "text" | "json" | "stream-json";
  timeoutSeconds: number;
  tmpDir: string;
  tmuxSessionPrefix: string;
}

/** Tracks active tmux sessions and pane assignments per job. */
export interface JobSession {
  session: TmuxSession;
  panes: TmuxPane[];
  taskPaneMap: Map<string, TmuxPane>;
}

// ─── Task Runner ────────────────────────────────────────

export class TaskRunner {
  private readonly tmux: TmuxController;
  private readonly claude: ClaudeRunner;
  private readonly activeSessions = new Map<string, JobSession>();

  constructor(
    private readonly config: TaskRunnerConfig,
    private readonly store: IStateStore,
    private readonly eventBus: EventBus,
    private readonly personas: LoadedPersonaSet,
  ) {
    this.tmux = new TmuxController(config.tmuxSessionPrefix);
    this.claude = new ClaudeRunner(this.tmux);
  }

  /**
   * Launch all PENDING tasks for a job: create tmux session and run Claude CLI.
   * Transitions tasks PENDING -> ASSIGNED -> RUNNING.
   */
  async launchTasks(job: Job, tasks: Task[]): Promise<Result<void, Error>> {
    const pendingTasks = tasks.filter((t) => t.status === "PENDING");
    if (pendingTasks.length === 0) return ok(undefined);

    // Create tmux session if not already active
    let jobSession = this.activeSessions.get(job.job_id);
    if (!jobSession) {
      const sessionResult = await this.tmux.createJobSession(
        job.job_id,
        pendingTasks.length,
      );
      if (sessionResult.isErr()) {
        return err(new Error(`Failed to create tmux session: ${sessionResult.error.message}`));
      }

      const { session, panes } = sessionResult.value;
      jobSession = {
        session,
        panes,
        taskPaneMap: new Map(),
      };
      this.activeSessions.set(job.job_id, jobSession);
    }

    // Assign and launch each task
    for (let i = 0; i < pendingTasks.length; i++) {
      const task = pendingTasks[i]!;
      // Pane 0 is ai-chan; kobito panes start at index 1
      const pane = jobSession.panes[i + 1];
      if (!pane) continue;

      jobSession.taskPaneMap.set(task.task_id, pane);

      // Transition PENDING -> ASSIGNED
      const assignResult = transitionTask(task, "ASSIGNED");
      if (assignResult.isErr()) continue;

      await this.store.updateTask(task.task_id, job.job_id, {
        status: "ASSIGNED",
        updated_at: assignResult.value.updated_at,
      });

      // Build prompt
      const prompt = buildKobitoTaskPrompt(this.personas, {
        phase: task.phase,
        objective: task.objective,
        inputs: task.inputs,
        constraints: task.constraints,
        acceptance_criteria: task.acceptance_criteria,
        repo_root: job.repo_root,
      });

      // Launch Claude CLI
      const launchConfig: ClaudeTaskConfig = {
        repoRoot: job.repo_root,
        prompt,
        model: this.config.model,
        skipPermissions: this.config.skipPermissions,
        outputFormat: this.config.outputFormat,
        timeoutSeconds: this.config.timeoutSeconds,
        jobId: job.job_id,
        taskId: task.task_id,
        tmpDir: this.config.tmpDir,
      };

      const launchResult = await this.claude.launch(pane, launchConfig);
      if (launchResult.isErr()) {
        await this.store.updateTask(task.task_id, job.job_id, {
          status: "FAILED",
          updated_at: new Date().toISOString(),
        });
        continue;
      }

      // Transition ASSIGNED -> RUNNING
      await this.store.updateTask(task.task_id, job.job_id, {
        status: "RUNNING",
        updated_at: new Date().toISOString(),
      });

      await this.store.appendTrace(
        createTraceEntry(
          job.job_id,
          task.assignee as `kobito-${number}`,
          "STARTED",
          `Task started: ${task.objective.slice(0, 100)}`,
          { task_id: task.task_id, tmux_session: jobSession.session.sessionName },
        ),
      );

      this.eventBus.emit({
        type: "task:status_changed",
        job_id: job.job_id,
        task_id: task.task_id,
        from: "ASSIGNED",
        to: "RUNNING",
        timestamp: new Date().toISOString(),
      });
    }

    return ok(undefined);
  }

  /**
   * Poll all RUNNING tasks for a job to check for completion.
   * Collects output, creates reports, and transitions to COMPLETED or FAILED.
   * Returns true if all tasks are done (all in terminal state).
   */
  async pollTasks(job: Job): Promise<Result<boolean, Error>> {
    const tasksResult = await this.store.listTasksByJob(job.job_id);
    if (tasksResult.isErr()) return err(tasksResult.error);

    const phase = job.current_phase;
    if (!phase) return ok(true);

    const phaseTasks = tasksResult.value.filter((t) => t.phase === phase);
    const runningTasks = phaseTasks.filter((t) => t.status === "RUNNING");

    for (const task of runningTasks) {
      const isDone = await this.claude.isTaskDone(
        this.config.tmpDir,
        job.job_id,
        task.task_id,
      );

      if (!isDone) continue;

      // Read and parse output
      const outputResult = await this.claude.readTaskOutput(
        this.config.tmpDir,
        job.job_id,
        task.task_id,
      );

      if (outputResult.isErr()) {
        await this.failTask(job, task, `Failed to read output: ${outputResult.error.message}`);
        continue;
      }

      const parseResult = parseClaudeOutput(outputResult.value);
      if (parseResult.isErr()) {
        // If parsing fails, create a basic report from raw output
        const basicReport = toReport(
          {
            summary: outputResult.value.slice(0, 500),
            findings: [],
            risks: [],
            contradictions: [],
            next_actions: [],
            artifact_updates: [],
          },
          task.task_id,
          job.job_id,
          phase,
        );
        await this.store.createReport(basicReport);
      } else {
        const report = toReport(parseResult.value, task.task_id, job.job_id, phase);
        await this.store.createReport(report);
      }

      // Transition RUNNING -> COMPLETED
      await this.store.updateTask(task.task_id, job.job_id, {
        status: "COMPLETED",
        updated_at: new Date().toISOString(),
      });

      await this.store.appendTrace(
        createTraceEntry(
          job.job_id,
          task.assignee as `kobito-${number}`,
          "REPORTED",
          `Task completed: ${task.objective.slice(0, 100)}`,
          { task_id: task.task_id },
        ),
      );

      this.eventBus.emit({
        type: "task:status_changed",
        job_id: job.job_id,
        task_id: task.task_id,
        from: "RUNNING",
        to: "COMPLETED",
        timestamp: new Date().toISOString(),
      });
    }

    // Check if all phase tasks are done
    const updatedTasks = await this.store.listTasksByJob(job.job_id);
    if (updatedTasks.isErr()) return err(updatedTasks.error);

    const updatedPhaseTasks = updatedTasks.value.filter((t) => t.phase === phase);
    const allDone = updatedPhaseTasks.every(
      (t) => t.status === "COMPLETED" || t.status === "FAILED" || t.status === "CANCELED",
    );

    return ok(allDone);
  }

  /**
   * Clean up tmux session for a job.
   */
  async cleanup(jobId: string): Promise<void> {
    const jobSession = this.activeSessions.get(jobId);
    if (jobSession) {
      await this.tmux.killSession(jobSession.session);
      this.activeSessions.delete(jobId);
    }
  }

  /**
   * Check if a job has an active tmux session.
   */
  hasActiveSession(jobId: string): boolean {
    return this.activeSessions.has(jobId);
  }

  private async failTask(job: Job, task: Task, error: string): Promise<void> {
    await this.store.updateTask(task.task_id, job.job_id, {
      status: "FAILED",
      updated_at: new Date().toISOString(),
    });

    await this.store.appendTrace(
      createTraceEntry(
        job.job_id,
        task.assignee as `kobito-${number}`,
        "FAILED",
        `Task failed: ${error.slice(0, 200)}`,
        { task_id: task.task_id },
      ),
    );

    this.eventBus.emit({
      type: "task:status_changed",
      job_id: job.job_id,
      task_id: task.task_id,
      from: "RUNNING",
      to: "FAILED",
      timestamp: new Date().toISOString(),
    });
  }
}
