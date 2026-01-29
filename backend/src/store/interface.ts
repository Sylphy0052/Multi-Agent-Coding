import type { Result } from "neverthrow";
import type {
  Job,
  Task,
  Report,
  TraceEntry,
  JobStatus,
} from "@multi-agent/shared";

// ─── Error Types ────────────────────────────────────────

export class StoreError extends Error {
  constructor(
    message: string,
    public readonly code: StoreErrorCode,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

export type StoreErrorCode =
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "IO_ERROR"
  | "VALIDATION_ERROR";

// ─── Filter Types ───────────────────────────────────────

export interface JobFilter {
  status?: JobStatus | JobStatus[];
  limit?: number;
  offset?: number;
}

// ─── Store Interface ────────────────────────────────────

export interface IStateStore {
  // Job operations
  createJob(job: Job): Promise<Result<Job, StoreError>>;
  getJob(jobId: string): Promise<Result<Job, StoreError>>;
  updateJob(
    jobId: string,
    updates: Partial<Job>,
  ): Promise<Result<Job, StoreError>>;
  listJobs(filter?: JobFilter): Promise<Result<Job[], StoreError>>;

  // Task operations
  createTask(task: Task): Promise<Result<Task, StoreError>>;
  getTask(taskId: string, jobId: string): Promise<Result<Task, StoreError>>;
  updateTask(
    taskId: string,
    jobId: string,
    updates: Partial<Task>,
  ): Promise<Result<Task, StoreError>>;
  listTasksByJob(jobId: string): Promise<Result<Task[], StoreError>>;

  // Report operations
  createReport(report: Report): Promise<Result<Report, StoreError>>;
  getReport(
    taskId: string,
    jobId: string,
  ): Promise<Result<Report, StoreError>>;
  listReportsByJob(jobId: string): Promise<Result<Report[], StoreError>>;

  // Trace operations (append-only)
  appendTrace(entry: TraceEntry): Promise<Result<void, StoreError>>;
  getTraces(jobId: string): Promise<Result<TraceEntry[], StoreError>>;

  // Lifecycle
  initialize(): Promise<Result<void, StoreError>>;
}
