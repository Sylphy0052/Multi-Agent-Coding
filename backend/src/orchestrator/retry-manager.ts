import type { Job } from "@multi-agent/shared";
import { RETRY_DEFAULTS } from "@multi-agent/shared";
import { ok, err, Result } from "neverthrow";
import type { IStateStore } from "../store/interface.js";
import { transitionJob, setJobError } from "../domain/job.js";
import { EventBus } from "../events/bus.js";
import { createTraceEntry } from "../domain/trace.js";

// ─── Types ──────────────────────────────────────────────

export type ErrorClass = "TRANSIENT" | "PERMANENT";

export interface RetryConfig {
  maxRetries: number;
  backoffSequence: readonly number[];
  backoffCap: number;
}

export interface RetryDecision {
  shouldRetry: boolean;
  delaySeconds: number;
  errorClass: ErrorClass;
  retryCount: number;
}

// ─── Error Classifier ───────────────────────────────────

const TRANSIENT_PATTERNS = [
  /timeout/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /rate.?limit/i,
  /too many requests/i,
  /503/,
  /502/,
  /lock/i,
  /EAGAIN/i,
  /temporary/i,
  /overloaded/i,
  /still in progress/i,
  /Quality gate failed/i,
];

/**
 * Classify an error as transient (retryable) or permanent.
 */
export function classifyError(error: string): ErrorClass {
  for (const pattern of TRANSIENT_PATTERNS) {
    if (pattern.test(error)) {
      return "TRANSIENT";
    }
  }
  return "PERMANENT";
}

// ─── Retry Manager ──────────────────────────────────────

export class RetryManager {
  private readonly config: RetryConfig;

  constructor(
    config?: Partial<RetryConfig>,
    private readonly store?: IStateStore,
    private readonly eventBus?: EventBus,
  ) {
    this.config = {
      maxRetries: config?.maxRetries ?? RETRY_DEFAULTS.maxRetries,
      backoffSequence:
        config?.backoffSequence ?? RETRY_DEFAULTS.backoffSequence,
      backoffCap: config?.backoffCap ?? RETRY_DEFAULTS.backoffCap,
    };
  }

  /**
   * Decide whether to retry based on the error and current retry count.
   */
  decide(job: Job, error: string): RetryDecision {
    const errorClass = classifyError(error);

    if (errorClass === "PERMANENT") {
      return {
        shouldRetry: false,
        delaySeconds: 0,
        errorClass,
        retryCount: job.retry_count,
      };
    }

    if (job.retry_count >= this.config.maxRetries) {
      return {
        shouldRetry: false,
        delaySeconds: 0,
        errorClass,
        retryCount: job.retry_count,
      };
    }

    const seq = this.config.backoffSequence;
    const index = Math.min(job.retry_count, seq.length - 1);
    const delay = Math.min(seq[index], this.config.backoffCap);

    return {
      shouldRetry: true,
      delaySeconds: delay,
      errorClass,
      retryCount: job.retry_count + 1,
    };
  }

  /**
   * Apply the retry decision to a job: transition to WAITING_RETRY or FAILED.
   */
  async applyRetry(
    job: Job,
    error: string,
  ): Promise<Result<Job, Error>> {
    const decision = this.decide(job, error);
    const updatedJob = setJobError(job, error, decision.errorClass);

    if (!decision.shouldRetry) {
      // Transition to FAILED
      const transResult = transitionJob(updatedJob, "FAILED");
      if (transResult.isErr()) return err(transResult.error);

      if (this.store) {
        const storeResult = await this.store.updateJob(job.job_id, {
          status: "FAILED",
          last_error: error,
          error_class: decision.errorClass,
          retry_count: updatedJob.retry_count,
          updated_at: transResult.value.updated_at,
        });
        if (storeResult.isErr()) return err(storeResult.error);

        await this.store.appendTrace(
          createTraceEntry(
            job.job_id,
            "system",
            "FAILED",
            `Job failed (${decision.errorClass}): ${error.slice(0, 200)}`,
          ),
        );
      }

      this.eventBus?.emit({
        type: "job:failed",
        job_id: job.job_id,
        error,
        timestamp: new Date().toISOString(),
      });

      return ok(transResult.value);
    }

    // Transition to WAITING_RETRY
    const transResult = transitionJob(updatedJob, "WAITING_RETRY");
    if (transResult.isErr()) return err(transResult.error);

    if (this.store) {
      const storeResult = await this.store.updateJob(job.job_id, {
        status: "WAITING_RETRY",
        last_error: error,
        error_class: decision.errorClass,
        retry_count: updatedJob.retry_count,
        updated_at: transResult.value.updated_at,
      });
      if (storeResult.isErr()) return err(storeResult.error);

      await this.store.appendTrace(
        createTraceEntry(
          job.job_id,
          "system",
          "RETRY",
          `Retry ${decision.retryCount}/${this.config.maxRetries} in ${decision.delaySeconds}s: ${error.slice(0, 200)}`,
        ),
      );
    }

    this.eventBus?.emit({
      type: "job:status_changed",
      job_id: job.job_id,
      from: job.status,
      to: "WAITING_RETRY",
      timestamp: new Date().toISOString(),
    });

    return ok(transResult.value);
  }

  /**
   * Get the backoff delay for the current retry count.
   */
  getBackoffDelay(retryCount: number): number {
    const seq = this.config.backoffSequence;
    const index = Math.min(retryCount, seq.length - 1);
    return Math.min(seq[index], this.config.backoffCap);
  }
}
