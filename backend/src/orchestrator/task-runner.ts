import type { Job, Task, Phase } from "@multi-agent/shared";
import { ok, err, Result } from "neverthrow";
import type { IStateStore } from "../store/interface.js";
import { EventBus } from "../events/bus.js";
import { transitionTask } from "../domain/task.js";
import { createTraceEntry } from "../domain/trace.js";
import { TmuxController, type TmuxSession, type TmuxPane } from "../tmux/controller.js";
import { ClaudeRunner, type ClaudeTaskConfig } from "../tmux/claude-runner.js";
import {
  buildKobitoTaskPrompt,
  buildResearcherPrompt,
  buildAuditorPrompt,
  type TaskContext,
} from "../personas/prompt-builder.js";
import type { LoadedPersonaSet } from "../personas/loader.js";
import { TaskWatcher } from "../watcher/task-watcher.js";
import type { ContextManager } from "../context/context-manager.js";
import type { MemoryProvider } from "../memory/provider.js";
import type { SkillsRegistry } from "../skills/registry.js";
import type { AssetStore } from "../assets/store.js";

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

export interface TaskRunnerExtDeps {
  contextManager?: ContextManager;
  memoryProvider?: MemoryProvider;
  skillsRegistry?: SkillsRegistry;
  assetStore?: AssetStore;
}

export class TaskRunner {
  private readonly tmux: TmuxController;
  private readonly claude: ClaudeRunner;
  private readonly activeSessions = new Map<string, JobSession>();
  private readonly contextManager?: ContextManager;
  private readonly memoryProvider?: MemoryProvider;
  private readonly skillsRegistry?: SkillsRegistry;
  private readonly assetStore?: AssetStore;

  constructor(
    private readonly config: TaskRunnerConfig,
    private readonly store: IStateStore,
    private readonly eventBus: EventBus,
    private readonly personas: LoadedPersonaSet,
    private readonly taskWatcher: TaskWatcher,
    extDeps?: TaskRunnerExtDeps,
  ) {
    this.tmux = new TmuxController(config.tmuxSessionPrefix);
    this.claude = new ClaudeRunner(this.tmux);
    this.contextManager = extDeps?.contextManager;
    this.memoryProvider = extDeps?.memoryProvider;
    this.skillsRegistry = extDeps?.skillsRegistry;
    this.assetStore = extDeps?.assetStore;
  }

  /**
   * Launch all PENDING tasks for a job: create tmux session and run Claude CLI.
   * Transitions tasks PENDING -> ASSIGNED -> RUNNING.
   * After launching, starts TaskWatcher for the job.
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

      // Build prompt with context, memory, and skills injection
      const prompt = await this.buildPromptForTask(job, task);

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

    // Start watching for task completion via filesystem events
    await this.taskWatcher.watchJob(job.job_id);

    return ok(undefined);
  }

  /**
   * Clean up tmux session for a job.
   * Stops the TaskWatcher before killing the tmux session.
   */
  async cleanup(jobId: string): Promise<void> {
    await this.taskWatcher.unwatchJob(jobId);

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

  /**
   * Build a prompt for a task, selecting the appropriate role-based builder
   * and injecting context, memory, and skills.
   */
  private async buildPromptForTask(job: Job, task: Task): Promise<string> {
    const taskContext: TaskContext = {
      phase: task.phase,
      objective: task.objective,
      inputs: task.inputs,
      constraints: task.constraints,
      acceptance_criteria: task.acceptance_criteria,
      repo_root: job.repo_root,
    };

    // Gather context.md content
    let contextMd = "";
    if (this.contextManager) {
      try {
        contextMd = await this.contextManager.getContextForPrompt(job.job_id);
      } catch {
        // Non-fatal: proceed without context
      }
    }

    // Gather memory context
    let memoryContext = "";
    if (this.memoryProvider) {
      try {
        memoryContext = await this.memoryProvider.getContext({
          repoSummary: job.repo_root,
          jobGoal: job.user_prompt,
          phase: task.phase,
          keywords: job.user_prompt.split(/\s+/).slice(0, 10),
        });
      } catch {
        // Non-fatal: proceed without memory
      }
    }

    // Gather skills
    let skillsSection = "";
    if (this.skillsRegistry) {
      let hasScreenshots = false;
      if (this.assetStore) {
        try {
          const assets = await this.assetStore.listAssets(job.job_id);
          hasScreenshots = assets.length > 0;
        } catch {
          // Non-fatal: proceed without screenshot info
        }
      }
      const selected = this.skillsRegistry.select({
        phase: task.phase,
        hasScreenshots,
      });
      if (selected.length > 0) {
        skillsSection = selected.map((s) => [
          `### Skill: ${s.title}`,
          `**When to use:** ${s.when_to_use}`,
          `**Steps:** ${s.steps.map((st, i) => `${i + 1}. ${st}`).join("\n")}`,
          `**Output Contract:** ${s.output_contract.join(", ")}`,
          `**Pitfalls:** ${s.pitfalls.join(", ")}`,
        ].join("\n")).join("\n\n");
      }
    }

    // Build the enriched context for injection
    const enrichedContext = [
      contextMd,
      memoryContext ? `\n## Memory Context\n${memoryContext}` : "",
      skillsSection ? `\n## Skills Applied\n${skillsSection}` : "",
    ].filter(Boolean).join("\n");

    // Select prompt builder based on assignee role
    if (task.assignee === "researcher") {
      return buildResearcherPrompt(this.personas, taskContext, enrichedContext);
    }
    if (task.assignee === "auditor") {
      return buildAuditorPrompt(this.personas, taskContext, enrichedContext);
    }

    // Default: Kobito worker prompt with context injection
    const basePrompt = buildKobitoTaskPrompt(this.personas, taskContext);
    if (enrichedContext) {
      return `${basePrompt}\n\n## Job Context\n${enrichedContext}`;
    }
    return basePrompt;
  }
}
