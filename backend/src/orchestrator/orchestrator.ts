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

// ─── Config ─────────────────────────────────────────────

export interface OrchestratorConfig {
  scheduler: SchedulerConfig;
  planner: PlannerConfig;
  retry: Partial<RetryConfig>;
  git: GitOpsConfig;
  tmpDir: string;
  pollIntervalMs: number;
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

  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly config: OrchestratorConfig,
    private readonly store: IStateStore,
    private readonly eventBus: EventBus,
    private readonly personas: LoadedPersonaSet,
  ) {
    this.scheduler = new Scheduler(config.scheduler, store, eventBus);
    this.planner = new Planner(config.planner, store);
    this.aggregator = new Aggregator(store);
    this.qualityGate = new QualityGate(store);
    this.retryManager = new RetryManager(config.retry, store, eventBus);
    this.gitOps = new GitOps(config.git);
    this.taskRunner = config.taskRunner
      ? new TaskRunner(config.taskRunner, store, eventBus, personas)
      : null;
  }

  // ─── Lifecycle ──────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    // Run recovery before starting the poll loop
    this.recover()
      .catch((e) => console.error("Recovery error:", e))
      .finally(() => this.poll());
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
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ─── Main Loop ─────────────────────────────────────

  private poll(): void {
    if (!this.running) return;

    this.tick()
      .catch((e) => {
        console.error("Orchestrator tick error:", e);
      })
      .finally(() => {
        if (this.running) {
          this.pollTimer = setTimeout(
            () => this.poll(),
            this.config.pollIntervalMs,
          );
        }
      });
  }

  /**
   * Single orchestration tick: process all pending work.
   */
  async tick(): Promise<void> {
    await this.scheduler.dequeueNext();

    await this.processJobsInState("RECEIVED");
    await this.processJobsInState("PLANNING");
    await this.processJobsInState("DISPATCHED");
    await this.processJobsInState("RUNNING");
    await this.processJobsInState("AGGREGATING");
    await this.processJobsInState("APPROVED");
    await this.processJobsInState("WAITING_RETRY");
  }

  // ─── Job Processing ────────────────────────────────

  private async processJobsInState(status: Job["status"]): Promise<void> {
    const result = await this.store.listJobs({ status });
    if (result.isErr()) return;

    for (const job of result.value) {
      try {
        switch (status) {
          case "RECEIVED":
            await this.handleReceived(job);
            break;
          case "PLANNING":
            await this.handlePlanning(job);
            break;
          case "DISPATCHED":
            await this.handleDispatched(job);
            break;
          case "RUNNING":
            await this.handleRunning(job);
            break;
          case "AGGREGATING":
            await this.handleAggregating(job);
            break;
          case "APPROVED":
            await this.handleApproved(job);
            break;
          case "WAITING_RETRY":
            await this.handleWaitingRetry(job);
            break;
        }
      } catch (e) {
        console.error(
          `Error processing job ${job.job_id} in state ${status}:`,
          e,
        );
      }
    }
  }

  // ─── RECEIVED ──────────────────────────────────────

  private async handleReceived(job: Job): Promise<void> {
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

    const templates = this.planner.generateDefaultTemplates(
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
   * Poll for task completion. When all done, transition to AGGREGATING.
   */
  async handleRunning(job: Job): Promise<Result<void, Error>> {
    if (!this.taskRunner) {
      // No TaskRunner: skip to AGGREGATING
      await this.transitionJobStatus(job, "RUNNING", "AGGREGATING");
      return ok(undefined);
    }

    const allDoneResult = await this.taskRunner.pollTasks(job);
    if (allDoneResult.isErr()) return err(allDoneResult.error);

    if (allDoneResult.value) {
      await this.taskRunner.cleanup(job.job_id);
      await this.transitionJobStatus(job, "RUNNING", "AGGREGATING");
    }

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
    const delay = this.retryManager.getBackoffDelay(
      Math.max(0, job.retry_count - 1),
    );
    const retryAfter = new Date(
      new Date(job.updated_at).getTime() + delay * 1000,
    );

    if (new Date() < retryAfter) return;

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
