import type { JobStatus, TaskStatus, Phase } from "./types.js";

/**
 * Valid state transitions for Job status.
 * Key = current state, Value = set of allowed next states.
 */
export const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  RECEIVED: ["PLANNING", "QUEUED", "CANCELED"],
  QUEUED: ["PLANNING", "CANCELED"],
  PLANNING: ["DISPATCHED", "FAILED", "CANCELED", "WAITING_RETRY"],
  DISPATCHED: ["RUNNING", "FAILED", "CANCELED", "WAITING_RETRY"],
  RUNNING: ["AGGREGATING", "FAILED", "CANCELED", "WAITING_RETRY"],
  AGGREGATING: ["WAITING_APPROVAL", "FAILED", "CANCELED", "WAITING_RETRY"],
  WAITING_APPROVAL: ["APPROVED", "PLANNING", "FAILED", "CANCELED"],
  APPROVED: ["COMMITTING", "FAILED", "CANCELED"],
  COMMITTING: ["COMPLETED", "WAITING_APPROVAL", "FAILED", "WAITING_RETRY"],
  COMPLETED: [],
  FAILED: [],
  CANCELED: [],
  WAITING_RETRY: ["PLANNING", "RUNNING", "COMMITTING", "FAILED"],
} as const;

/** Terminal states that cannot transition further. */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  "COMPLETED",
  "FAILED",
  "CANCELED",
] as const;

/** States that count toward max_jobs running capacity. */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = [
  "PLANNING",
  "DISPATCHED",
  "RUNNING",
  "AGGREGATING",
  "WAITING_APPROVAL",
  "APPROVED",
  "COMMITTING",
  "WAITING_RETRY",
] as const;

/**
 * Valid state transitions for Task status.
 */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  PENDING: ["ASSIGNED", "CANCELED"],
  ASSIGNED: ["RUNNING", "CANCELED"],
  RUNNING: ["COMPLETED", "FAILED", "CANCELED"],
  COMPLETED: [],
  FAILED: [],
  CANCELED: [],
} as const;

/** Ordered phases for the spec -> impl -> test pipeline. */
export const PHASE_ORDER: readonly Phase[] = ["spec", "impl", "test"] as const;

/** Default artifact paths template (job_id will be interpolated). */
export const ARTIFACT_PATH_TEMPLATE = {
  spec: "docs/jobs/{job_id}/spec.md",
  impl: "docs/jobs/{job_id}/impl.md",
  test: "docs/jobs/{job_id}/test.md",
  summary: "docs/jobs/{job_id}/summary.md",
} as const;

/** Retry configuration defaults. */
export const RETRY_DEFAULTS = {
  maxRetries: 10,
  backoffSequence: [10, 30, 60, 120, 240, 480, 600],
  backoffCap: 600,
} as const;
