import type { Job, JobStatus } from "@multi-agent/shared";
import { ACTIVE_JOB_STATUSES } from "@multi-agent/shared";
import { ok, err, Result } from "neverthrow";
import type { IStateStore } from "../store/interface.js";
import { transitionJob } from "../domain/job.js";
import { EventBus } from "../events/bus.js";
import { createTraceEntry } from "../domain/trace.js";

// ─── Types ──────────────────────────────────────────────

export interface SchedulerConfig {
  maxJobs: number;
}

// ─── Scheduler ──────────────────────────────────────────

export class Scheduler {
  constructor(
    private readonly config: SchedulerConfig,
    private readonly store: IStateStore,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * Get the number of currently active jobs.
   */
  async getActiveJobCount(): Promise<number> {
    const result = await this.store.listJobs({
      status: ACTIVE_JOB_STATUSES as unknown as JobStatus[],
    });
    if (result.isErr()) return 0;
    return result.value.length;
  }

  /**
   * Check if there is capacity for a new job.
   */
  async hasCapacity(): Promise<boolean> {
    const active = await this.getActiveJobCount();
    return active < this.config.maxJobs;
  }

  /**
   * Try to promote a RECEIVED job to PLANNING if capacity allows.
   * If no capacity, transition to QUEUED.
   */
  async scheduleJob(job: Job): Promise<Result<Job, Error>> {
    const hasSpace = await this.hasCapacity();

    if (hasSpace) {
      return this.promoteJob(job, "PLANNING");
    }

    // No capacity -> queue
    const transResult = transitionJob(job, "QUEUED");
    if (transResult.isErr()) return err(transResult.error);

    const updated = transResult.value;
    const storeResult = await this.store.updateJob(job.job_id, {
      status: updated.status,
      updated_at: updated.updated_at,
    });
    if (storeResult.isErr()) return err(storeResult.error);

    await this.store.appendTrace(
      createTraceEntry(job.job_id, "system", "QUEUED", "Job queued (at capacity)"),
    );

    this.eventBus.emit({
      type: "job:status_changed",
      job_id: job.job_id,
      from: job.status,
      to: "QUEUED",
      timestamp: new Date().toISOString(),
    });

    return ok(storeResult.value);
  }

  /**
   * Dequeue the next QUEUED job and promote it to PLANNING.
   * Called when capacity becomes available.
   */
  async dequeueNext(): Promise<Result<Job | null, Error>> {
    const hasSpace = await this.hasCapacity();
    if (!hasSpace) return ok(null);

    const result = await this.store.listJobs({ status: "QUEUED", limit: 1 });
    if (result.isErr()) return err(result.error);

    const queued = result.value;
    if (queued.length === 0) return ok(null);

    return this.promoteJob(queued[0], "PLANNING");
  }

  private async promoteJob(
    job: Job,
    target: JobStatus,
  ): Promise<Result<Job, Error>> {
    const transResult = transitionJob(job, target);
    if (transResult.isErr()) return err(transResult.error);

    const updated = transResult.value;
    const storeResult = await this.store.updateJob(job.job_id, {
      status: updated.status,
      updated_at: updated.updated_at,
    });
    if (storeResult.isErr()) return err(storeResult.error);

    await this.store.appendTrace(
      createTraceEntry(
        job.job_id,
        "system",
        "DELEGATED",
        `Job promoted to ${target}`,
      ),
    );

    this.eventBus.emit({
      type: "job:status_changed",
      job_id: job.job_id,
      from: job.status,
      to: target,
      timestamp: new Date().toISOString(),
    });

    return ok(storeResult.value);
  }
}
