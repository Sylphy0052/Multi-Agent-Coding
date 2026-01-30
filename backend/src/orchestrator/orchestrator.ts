import type { Job, Phase } from "@multi-agent/shared";
import { PHASE_ORDER } from "@multi-agent/shared";
import { ok, err, Result } from "neverthrow";
import type { IStateStore } from "../store/interface.js";
import { EventBus } from "../events/bus.js";
import { transitionJob, setJobPhase } from "../domain/job.js";
import { createTraceEntry } from "../domain/trace.js";
import { Scheduler, type SchedulerConfig } from "./scheduler.js";
import { Planner, type PlannerConfig } from "./planner.js";
import { Aggregator } from "./aggregator.js";
import { QualityGate } from "./quality-gate.js";
import { RetryManager, type RetryConfig } from "./retry-manager.js";
import { TaskRunner, type TaskRunnerConfig } from "./task-runner.js";
import type { LoadedPersonaSet } from "../personas/loader.js";
import { GitOps } from "../git/ops.js";
import type { GitOpsConfig } from "../git/ops.js";
import { acquireDevelopLock } from "../git/lock.js";
import type { TaskWatcher } from "../watcher/task-watcher.js";
import { PipelineManager } from "./pipeline.js";
import type { ContextManager } from "../context/context-manager.js";
import type { MemoryProvider } from "../memory/provider.js";
import type { SkillsRegistry } from "../skills/registry.js";
import type {
  BusEvent,
  JobStatusChangedEvent,
  TaskDoneEvent,
  TaskErrorEvent,
  PhaseApprovedEvent,
  PhaseRejectedEvent,
  JobCreatedEvent,
  MemoryUpdatedEvent,
  SkillUpdatedEvent,
} from "../events/types.js";
import type { AssetStore } from "../assets/store.js";

// ─── Config ─────────────────────────────────────────────

export interface OrchestratorExtDeps {
  contextManager?: ContextManager;
  memoryProvider?: MemoryProvider;
  skillsRegistry?: SkillsRegistry;
  assetStore?: AssetStore;
}

export interface OrchestratorConfig {
  scheduler: SchedulerConfig;
  planner: PlannerConfig;
  retry: Partial<RetryConfig>;
  git: GitOpsConfig;
  tmpDir: string;
  /** Optional: TaskRunner config. If omitted, task execution is skipped (test mode). */
  taskRunner?: TaskRunnerConfig;
}

// ─── Orchestrator ───────────────────────────────────────

export class Orchestrator {
  private readonly scheduler: Scheduler;
  private readonly planner: Planner;
  private readonly aggregator: Aggregator;
  private readonly qualityGate: QualityGate;
  private readonly retryManager: RetryManager;
  private readonly gitOps: GitOps;
  private readonly taskRunner: TaskRunner | null;
  private readonly contextManager?: ContextManager;
  private readonly memoryProvider?: MemoryProvider;
  private readonly skillsRegistry?: SkillsRegistry;
  private readonly assetStore?: AssetStore;

  private running = false;

  constructor(
    private readonly config: OrchestratorConfig,
    private readonly store: IStateStore,
    private readonly eventBus: EventBus,
    private readonly personas: LoadedPersonaSet,
    private readonly taskWatcher?: TaskWatcher,
    extDeps?: OrchestratorExtDeps,
  ) {
    this.contextManager = extDeps?.contextManager;
    this.memoryProvider = extDeps?.memoryProvider;
    this.skillsRegistry = extDeps?.skillsRegistry;
    this.assetStore = extDeps?.assetStore;

    const pipelineManager = new PipelineManager(personas);
    this.scheduler = new Scheduler(config.scheduler, store, eventBus);
    this.planner = new Planner(config.planner, store, pipelineManager);
    this.aggregator = new Aggregator(store);
    this.qualityGate = new QualityGate(store);
    this.retryManager = new RetryManager(config.retry, store, eventBus);
    this.gitOps = new GitOps(config.git);
    this.taskRunner = config.taskRunner && taskWatcher
      ? new TaskRunner(config.taskRunner, store, eventBus, personas, taskWatcher, {
          contextManager: this.contextManager,
          memoryProvider: this.memoryProvider,
          skillsRegistry: this.skillsRegistry,
          assetStore: this.assetStore,
        })
      : null;
  }

  // ─── Lifecycle ──────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;

    this.recover()
      .catch((e) => console.error("Recovery error:", e))
      .then(() => this.registerEventHandlers());
  }

  /**
   * Recover jobs that were in-flight when the orchestrator stopped.
   * RUNNING/DISPATCHED jobs lose their tmux sessions on restart,
   * so they are transitioned to WAITING_RETRY for re-processing.
   */
  async recover(): Promise<void> {
    const staleStates: Job["status"][] = ["RUNNING", "DISPATCHED"];
    for (const status of staleStates) {
      const result = await this.store.listJobs({ status });
      if (result.isErr()) continue;

      for (const job of result.value) {
        console.log(
          `[recovery] job ${job.job_id} in ${status} -> WAITING_RETRY`,
        );
        await this.transitionJobStatus(job, status, "WAITING_RETRY");
        await this.store.updateJob(job.job_id, {
          last_error: `Recovered from ${status} after orchestrator restart`,
          error_class: "TRANSIENT",
        });
        await this.store.appendTrace(
          createTraceEntry(
            job.job_id,
            "system",
            "RETRY",
            `Orchestrator restart recovery: ${status} -> WAITING_RETRY`,
          ),
        );
      }
    }
  }

  stop(): void {
    this.running = false;
    this.eventBus.removeAllListeners();
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ─── Event Handlers Registration ──────────────────

  private registerEventHandlers(): void {
    // job:created -> schedule the new job
    this.eventBus.on("job:created", (event: BusEvent) => {
      const e = event as JobCreatedEvent;
      this.store.getJob(e.job_id).then((result) => {
        if (result.isErr()) return;
        this.handleReceived(result.value).catch((err) =>
          console.error(`Error handling job:created for ${e.job_id}:`, err),
        );
      });
    });

    // job:status_changed -> dispatch to appropriate handler
    this.eventBus.on("job:status_changed", (event: BusEvent) => {
      const e = event as JobStatusChangedEvent;
      this.store.getJob(e.job_id).then((result) => {
        if (result.isErr()) return;
        const job = result.value;

        this.dispatchByStatus(e.to, job).catch((err) =>
          console.error(`Error dispatching ${e.to} for ${e.job_id}:`, err),
        );
      });
    });

    // task:done -> check if all tasks are done, transition to AGGREGATING
    this.eventBus.on("task:done", (event: BusEvent) => {
      const e = event as TaskDoneEvent;
      this.handleTaskCompletion(e).catch((err) =>
        console.error(`Error handling task:done for ${e.task_id}:`, err),
      );
    });

    // task:error -> same completion check (task may have failed)
    this.eventBus.on("task:error", (event: BusEvent) => {
      const e = event as TaskErrorEvent;
      this.handleTaskCompletion(e).catch((err) =>
        console.error(`Error handling task:error for ${e.task_id}:`, err),
      );
    });

    // phase:approved -> commit and advance
    this.eventBus.on("phase:approved", (event: BusEvent) => {
      const e = event as PhaseApprovedEvent;
      this.store.getJob(e.job_id).then((result) => {
        if (result.isErr()) return;
        this.handleApproved(result.value).catch((err) =>
          console.error(`Error handling phase:approved for ${e.job_id}:`, err),
        );
      });
    });

    // phase:rejected -> go back to PLANNING for re-plan
    this.eventBus.on("phase:rejected", (event: BusEvent) => {
      const e = event as PhaseRejectedEvent;
      this.store.getJob(e.job_id).then((result) => {
        if (result.isErr()) return;
        const job = result.value;
        this.transitionJobStatus(job, job.status, "PLANNING").catch((err) =>
          console.error(`Error handling phase:rejected for ${e.job_id}:`, err),
        );
      });
    });

    // memory:updated -> update context memory section
    if (this.contextManager) {
      this.eventBus.on("memory:updated", (event: BusEvent) => {
        const e = event as MemoryUpdatedEvent;
        if (!e.job_id || !this.contextManager) return;
        const summary = e.updates
          .map((u) => `- [${u.type}] ${u.title}`)
          .join("\n");
        this.contextManager
          .updateSection(
            e.job_id,
            "memory",
            `### Memory Updates\n${summary}`,
            `memory.updated#${e.timestamp}`,
          )
          .catch((err) =>
            console.error(`Error updating context for memory:updated:`, err),
          );
      });

      // skill:updated -> update context skills section
      this.eventBus.on("skill:updated", (event: BusEvent) => {
        const e = event as SkillUpdatedEvent;
        if (!e.job_id || !this.contextManager) return;
        this.contextManager
          .updateSection(
            e.job_id,
            "skills",
            `- Skill updated: ${e.skill_id} (v${e.version})`,
            `skill.updated#${e.skill_id}`,
          )
          .catch((err) =>
            console.error(`Error updating context for skill:updated:`, err),
          );
      });
    }
  }

  private async dispatchByStatus(
    status: Job["status"],
    job: Job,
  ): Promise<void> {
    switch (status) {
      case "PLANNING":
        await this.handlePlanning(job);
        break;
      case "DISPATCHED":
        await this.handleDispatched(job);
        break;
      case "AGGREGATING":
        await this.handleAggregating(job);
        break;
      case "APPROVED":
        await this.handleApproved(job);
        break;
      case "WAITING_RETRY":
        this.scheduleRetry(job);
        break;
    }
  }

  // ─── Task Completion (Event-Driven) ───────────────

  private async handleTaskCompletion(
    event: TaskDoneEvent | TaskErrorEvent,
  ): Promise<void> {
    const jobResult = await this.store.getJob(event.job_id);
    if (jobResult.isErr()) return;
    const job = jobResult.value;

    if (job.status !== "RUNNING") return;
    if (!job.current_phase) return;

    // Check if all tasks for the current phase are done
    const tasksResult = await this.store.listTasksByJob(job.job_id);
    if (tasksResult.isErr()) return;

    const phaseTasks = tasksResult.value.filter(
      (t) => t.phase === job.current_phase,
    );
    const allDone = phaseTasks.every(
      (t) =>
        t.status === "COMPLETED" ||
        t.status === "FAILED" ||
        t.status === "CANCELED",
    );

    if (allDone) {
      if (this.taskRunner) await this.taskRunner.cleanup(job.job_id);
      await this.transitionJobStatus(job, "RUNNING", "AGGREGATING");
    }
  }

  // ─── Retry Scheduling (Timer-Based) ───────────────

  private scheduleRetry(job: Job): void {
    const delay = this.retryManager.getBackoffDelay(
      Math.max(0, job.retry_count - 1),
    );
    const retryAfter = new Date(
      new Date(job.updated_at).getTime() + delay * 1000,
    );
    const waitMs = Math.max(0, retryAfter.getTime() - Date.now());

    setTimeout(() => {
      this.handleWaitingRetry(job).catch((e) =>
        console.error(`Retry error for ${job.job_id}:`, e),
      );
    }, waitMs);
  }

  // ─── RECEIVED ──────────────────────────────────────

  private async handleReceived(job: Job): Promise<void> {
    // Generate initial context.md for the job
    if (this.contextManager) {
      try {
        await this.contextManager.generateInitialContext(job);
      } catch (e) {
        console.error(`[orchestrator] Failed to generate initial context for ${job.job_id}:`, e);
      }
    }

    await this.scheduler.scheduleJob(job);
  }

  // ─── PLANNING ──────────────────────────────────────

  async handlePlanning(job: Job): Promise<Result<void, Error>> {
    const phase = this.getNextPhase(job);
    if (!phase) {
      return err(new Error("No next phase available"));
    }

    const phaseJob = setJobPhase(job, phase);
    await this.store.updateJob(job.job_id, {
      current_phase: phase,
      updated_at: phaseJob.updated_at,
    });

    const templates = this.planner.generatePipelineTasks(
      job.user_prompt,
      phase,
      job.parallelism,
    );

    const tasksResult = await this.planner.createTasks(
      job.job_id,
      phase,
      templates,
    );
    if (tasksResult.isErr()) {
      await this.retryManager.applyRetry(job, tasksResult.error.message);
      return err(tasksResult.error);
    }

    await this.transitionJobStatus(job, "PLANNING", "DISPATCHED");

    await this.store.appendTrace(
      createTraceEntry(
        job.job_id,
        "ai-chan",
        "DISPATCHED",
        `Dispatched ${templates.length} tasks for ${phase} phase`,
      ),
    );

    return ok(undefined);
  }

  // ─── DISPATCHED ────────────────────────────────────

  /**
   * Launch tasks in tmux panes and transition to RUNNING.
   */
  async handleDispatched(job: Job): Promise<Result<void, Error>> {
    if (!this.taskRunner) {
      // No TaskRunner: skip execution, go straight to RUNNING
      await this.transitionJobStatus(job, "DISPATCHED", "RUNNING");
      return ok(undefined);
    }

    const tasksResult = await this.store.listTasksByJob(job.job_id);
    if (tasksResult.isErr()) return err(tasksResult.error);

    const phase = job.current_phase;
    if (!phase) return err(new Error("No current phase"));

    const phaseTasks = tasksResult.value.filter((t) => t.phase === phase);
    const launchResult = await this.taskRunner.launchTasks(job, phaseTasks);
    if (launchResult.isErr()) {
      await this.retryManager.applyRetry(job, launchResult.error.message);
      return err(launchResult.error);
    }

    await this.transitionJobStatus(job, "DISPATCHED", "RUNNING");
    return ok(undefined);
  }

  // ─── RUNNING ───────────────────────────────────────

  /**
   * Transition RUNNING -> AGGREGATING.
   * In event-driven mode, this is called when handleTaskCompletion detects
   * all tasks are done. Without a TaskRunner (test mode), it transitions immediately.
   */
  async handleRunning(job: Job): Promise<Result<void, Error>> {
    if (!this.taskRunner) {
      // No TaskRunner: skip to AGGREGATING
      await this.transitionJobStatus(job, "RUNNING", "AGGREGATING");
      return ok(undefined);
    }

    // In event-driven mode, the transition is handled by handleTaskCompletion.
    // This method is kept for direct invocation in test mode.
    return ok(undefined);
  }

  // ─── AGGREGATING ───────────────────────────────────

  /**
   * Quality gate + report aggregation -> WAITING_APPROVAL.
   */
  async handleAggregating(job: Job): Promise<Result<void, Error>> {
    const phase = job.current_phase;
    if (!phase) return err(new Error("No current phase"));

    // Quality gate
    const gateResult = await this.qualityGate.check(job.job_id, phase);
    if (gateResult.isErr()) return err(gateResult.error);

    const gate = gateResult.value;
    if (!gate.passed) {
      const issuesSummary = gate.issues.join("; ");

      // Record gate failure in trace
      await this.store.appendTrace(
        createTraceEntry(
          job.job_id,
          gate.auditorVerdict ? "auditor" : "system",
          "GATE_FAIL",
          `${phase} gate: ${gate.auditorVerdict ?? "FAIL"} - ${issuesSummary.slice(0, 300)}`,
        ),
      );

      // Max rework limit: 2 gate failures per phase -> FAILED
      const MAX_GATE_RETRIES = 2;
      if (job.retry_count >= MAX_GATE_RETRIES && gate.auditorVerdict === "FAIL") {
        await this.store.updateJob(job.job_id, {
          status: "FAILED",
          last_error: `Gate rework limit (${MAX_GATE_RETRIES}) exceeded for ${phase}: ${issuesSummary}`,
          updated_at: new Date().toISOString(),
        });
        this.eventBus.emit({
          type: "job:failed",
          job_id: job.job_id,
          error: `Gate rework limit exceeded for ${phase}`,
          timestamp: new Date().toISOString(),
        });
        return ok(undefined);
      }

      await this.retryManager.applyRetry(
        { ...job, status: "AGGREGATING" as const },
        `Quality gate failed: ${issuesSummary}`,
      );
      return ok(undefined);
    }

    // Aggregate reports
    const aggResult = await this.aggregator.aggregate(job.job_id, phase);
    if (aggResult.isErr()) {
      await this.retryManager.applyRetry(
        { ...job, status: "AGGREGATING" as const },
        aggResult.error.message,
      );
      return ok(undefined);
    }

    const aggregation = aggResult.value;

    await this.store.appendTrace(
      createTraceEntry(
        job.job_id,
        "ai-chan",
        "AGGREGATED",
        `Aggregated ${aggregation.reportCount} reports for ${phase}. ` +
          `Risks: ${aggregation.allRisks.length}, Contradictions: ${aggregation.contradictions.length}`,
      ),
    );

    await this.transitionJobStatus(job, "AGGREGATING", "WAITING_APPROVAL");

    this.eventBus.emit({
      type: "phase:awaiting_approval",
      job_id: job.job_id,
      phase,
      diff_summary: aggregation.combinedSummary.slice(0, 500),
      timestamp: new Date().toISOString(),
    });

    return ok(undefined);
  }

  // ─── APPROVED ──────────────────────────────────────

  /**
   * Commit artifacts to git, then advance to next phase or complete.
   */
  async handleApproved(job: Job): Promise<Result<void, Error>> {
    await this.transitionJobStatus(job, "APPROVED", "COMMITTING");

    // Acquire develop lock
    const lockResult = await acquireDevelopLock(job.repo_root);
    if (lockResult.isErr()) {
      await this.retryManager.applyRetry(
        { ...job, status: "COMMITTING" },
        lockResult.error.message,
      );
      return ok(undefined);
    }

    const lock = lockResult.value;
    try {
      const jobGit = new GitOps({
        repoRoot: job.repo_root,
        mainBranch: job.git.main_branch,
        developBranch: job.git.develop_branch,
      });

      await jobGit.ensureDevelopBranch();

      const branchExists = await jobGit.branchExists(job.git.job_branch);
      if (branchExists.isOk() && !branchExists.value) {
        await jobGit.createJobBranch(job.git.job_branch);
      }

      const phase = job.current_phase;
      if (phase) {
        const artifactPath = this.getArtifactPath(job, phase);
        const commitResult = await jobGit.commitArtifacts(
          job.git.job_branch,
          `[${job.job_id}] ${phase} phase artifacts`,
          [artifactPath],
        );

        if (commitResult.isOk()) {
          await this.store.updateJob(job.job_id, {
            git: { ...job.git, last_commit_hash: commitResult.value },
          });
        }
      }

      const mergeResult = await jobGit.mergeJobToDevelop(
        job.git.job_branch,
        `Merge ${job.git.job_branch} (${job.current_phase} phase)`,
      );

      if (mergeResult.isOk()) {
        await this.store.updateJob(job.job_id, {
          git: { ...job.git, last_merge_hash: mergeResult.value },
        });
      }

      await this.store.appendTrace(
        createTraceEntry(
          job.job_id,
          "git",
          "COMMITTED",
          `Committed and merged ${job.current_phase} phase to develop`,
          { commit_hash: mergeResult.isOk() ? mergeResult.value : undefined },
        ),
      );
    } catch (e) {
      await lock.release();
      await this.retryManager.applyRetry(
        { ...job, status: "COMMITTING" },
        (e as Error).message,
      );
      return err(e as Error);
    }

    await lock.release();

    // Advance to next phase or complete
    const isLastPhase =
      job.current_phase === PHASE_ORDER[PHASE_ORDER.length - 1];

    if (!isLastPhase) {
      const nextPhase = this.getNextPhase(job);
      await this.store.updateJob(job.job_id, {
        status: "PLANNING",
        current_phase: nextPhase,
        updated_at: new Date().toISOString(),
      });

      this.eventBus.emit({
        type: "job:status_changed",
        job_id: job.job_id,
        from: "COMMITTING",
        to: "PLANNING",
        timestamp: new Date().toISOString(),
      });
    } else {
      await this.store.updateJob(job.job_id, {
        status: "COMPLETED",
        updated_at: new Date().toISOString(),
      });

      await this.store.appendTrace(
        createTraceEntry(
          job.job_id,
          "system",
          "COMPLETED",
          "All phases completed successfully",
        ),
      );

      this.eventBus.emit({
        type: "job:completed",
        job_id: job.job_id,
        timestamp: new Date().toISOString(),
      });
    }

    return ok(undefined);
  }

  // ─── WAITING_RETRY ─────────────────────────────────

  private async handleWaitingRetry(job: Job): Promise<void> {
    const transResult = transitionJob(job, "PLANNING");
    if (transResult.isErr()) return;

    await this.store.updateJob(job.job_id, {
      status: "PLANNING",
      updated_at: transResult.value.updated_at,
    });

    await this.store.appendTrace(
      createTraceEntry(
        job.job_id,
        "system",
        "RETRY",
        `Retry ${job.retry_count}: resuming from WAITING_RETRY`,
      ),
    );

    this.eventBus.emit({
      type: "job:status_changed",
      job_id: job.job_id,
      from: "WAITING_RETRY",
      to: "PLANNING",
      timestamp: new Date().toISOString(),
    });
  }

  // ─── Helpers ────────────────────────────────────────

  private getNextPhase(job: Job): Phase | null {
    if (!job.current_phase) return PHASE_ORDER[0];
    const idx = PHASE_ORDER.indexOf(job.current_phase);
    if (idx === -1) return PHASE_ORDER[0];
    if (idx >= PHASE_ORDER.length - 1) return null;
    return PHASE_ORDER[idx + 1];
  }

  private getArtifactPath(job: Job, phase: Phase): string {
    switch (phase) {
      case "spec":
        return job.artifacts.spec_md_path;
      case "impl":
        return job.artifacts.impl_md_path;
      case "test":
        return job.artifacts.test_md_path;
    }
  }

  private async transitionJobStatus(
    job: Job,
    from: Job["status"],
    to: Job["status"],
  ): Promise<void> {
    const transResult = transitionJob({ ...job, status: from }, to);
    if (transResult.isErr()) return;

    await this.store.updateJob(job.job_id, {
      status: to,
      updated_at: transResult.value.updated_at,
    });

    this.eventBus.emit({
      type: "job:status_changed",
      job_id: job.job_id,
      from,
      to,
      timestamp: new Date().toISOString(),
    });
  }

  // ─── Public accessors for testing ──────────────────

  getScheduler(): Scheduler { return this.scheduler; }
  getPlanner(): Planner { return this.planner; }
  getAggregator(): Aggregator { return this.aggregator; }
  getQualityGate(): QualityGate { return this.qualityGate; }
  getRetryManager(): RetryManager { return this.retryManager; }
  getTaskRunner(): TaskRunner | null { return this.taskRunner; }
}
