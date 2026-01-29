import { ok, err, Result } from "neverthrow";
import type {
  Job,
  Task,
  Report,
  TraceEntry,
  JobStatus,
} from "@multi-agent/shared";
import type {
  IStateStore,
  JobFilter,
  StoreError,
} from "../../../src/store/interface.js";
import { StoreError as StoreErrorClass } from "../../../src/store/interface.js";

/**
 * In-memory implementation of IStateStore for testing.
 */
export function createInMemoryStore(): IStateStore {
  const jobs = new Map<string, Job>();
  const tasks = new Map<string, Task>();
  const reports = new Map<string, Report>();
  const traces = new Map<string, TraceEntry[]>();

  return {
    async initialize(): Promise<Result<void, StoreError>> {
      return ok(undefined);
    },

    async createJob(job: Job): Promise<Result<Job, StoreError>> {
      if (jobs.has(job.job_id)) {
        return err(
          new StoreErrorClass(
            `Job ${job.job_id} already exists`,
            "ALREADY_EXISTS",
          ),
        );
      }
      jobs.set(job.job_id, { ...job });
      return ok({ ...job });
    },

    async getJob(jobId: string): Promise<Result<Job, StoreError>> {
      const job = jobs.get(jobId);
      if (!job) {
        return err(
          new StoreErrorClass(`Job ${jobId} not found`, "NOT_FOUND"),
        );
      }
      return ok({ ...job });
    },

    async updateJob(
      jobId: string,
      updates: Partial<Job>,
    ): Promise<Result<Job, StoreError>> {
      const existing = jobs.get(jobId);
      if (!existing) {
        return err(
          new StoreErrorClass(`Job ${jobId} not found`, "NOT_FOUND"),
        );
      }
      const updated = { ...existing, ...updates };
      jobs.set(jobId, updated);
      return ok({ ...updated });
    },

    async listJobs(
      filter?: JobFilter,
    ): Promise<Result<Job[], StoreError>> {
      let result = Array.from(jobs.values());

      if (filter?.status) {
        const statuses = Array.isArray(filter.status)
          ? filter.status
          : [filter.status];
        result = result.filter((j) =>
          statuses.includes(j.status),
        );
      }

      // Sort by created_at ascending (FIFO)
      result.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );

      if (filter?.offset) {
        result = result.slice(filter.offset);
      }
      if (filter?.limit) {
        result = result.slice(0, filter.limit);
      }

      return ok(result.map((j) => ({ ...j })));
    },

    async createTask(task: Task): Promise<Result<Task, StoreError>> {
      const key = `${task.job_id}:${task.task_id}`;
      if (tasks.has(key)) {
        return err(
          new StoreErrorClass(
            `Task ${task.task_id} already exists`,
            "ALREADY_EXISTS",
          ),
        );
      }
      tasks.set(key, { ...task });
      return ok({ ...task });
    },

    async getTask(
      taskId: string,
      jobId: string,
    ): Promise<Result<Task, StoreError>> {
      const key = `${jobId}:${taskId}`;
      const task = tasks.get(key);
      if (!task) {
        return err(
          new StoreErrorClass(`Task ${taskId} not found`, "NOT_FOUND"),
        );
      }
      return ok({ ...task });
    },

    async updateTask(
      taskId: string,
      jobId: string,
      updates: Partial<Task>,
    ): Promise<Result<Task, StoreError>> {
      const key = `${jobId}:${taskId}`;
      const existing = tasks.get(key);
      if (!existing) {
        return err(
          new StoreErrorClass(`Task ${taskId} not found`, "NOT_FOUND"),
        );
      }
      const updated = { ...existing, ...updates };
      tasks.set(key, updated);
      return ok({ ...updated });
    },

    async listTasksByJob(
      jobId: string,
    ): Promise<Result<Task[], StoreError>> {
      const result = Array.from(tasks.values()).filter(
        (t) => t.job_id === jobId,
      );
      return ok(result.map((t) => ({ ...t })));
    },

    async createReport(
      report: Report,
    ): Promise<Result<Report, StoreError>> {
      const key = `${report.job_id}:${report.task_id}`;
      reports.set(key, { ...report });
      return ok({ ...report });
    },

    async getReport(
      taskId: string,
      jobId: string,
    ): Promise<Result<Report, StoreError>> {
      const key = `${jobId}:${taskId}`;
      const report = reports.get(key);
      if (!report) {
        return err(
          new StoreErrorClass(`Report ${taskId} not found`, "NOT_FOUND"),
        );
      }
      return ok({ ...report });
    },

    async listReportsByJob(
      jobId: string,
    ): Promise<Result<Report[], StoreError>> {
      const result = Array.from(reports.values()).filter(
        (r) => r.job_id === jobId,
      );
      return ok(result.map((r) => ({ ...r })));
    },

    async appendTrace(
      entry: TraceEntry,
    ): Promise<Result<void, StoreError>> {
      const existing = traces.get(entry.job_id) ?? [];
      existing.push({ ...entry });
      traces.set(entry.job_id, existing);
      return ok(undefined);
    },

    async getTraces(
      jobId: string,
    ): Promise<Result<TraceEntry[], StoreError>> {
      const entries = traces.get(jobId) ?? [];
      return ok(entries.map((e) => ({ ...e })));
    },
  };
}
