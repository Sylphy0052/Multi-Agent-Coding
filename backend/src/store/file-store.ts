import { ok, err, Result } from "neverthrow";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { nanoid } from "nanoid";
import type { Job, Task, Report, TraceEntry } from "@multi-agent/shared";
import type { IStateStore, JobFilter } from "./interface.js";
import { StoreError } from "./interface.js";

// ─── File Store Implementation ──────────────────────────

export class FileStore implements IStateStore {
  constructor(private readonly baseDir: string) {}

  // ── Lifecycle ───────────────────────────────────────

  async initialize(): Promise<Result<void, StoreError>> {
    try {
      await fs.mkdir(path.join(this.baseDir, "jobs"), { recursive: true });
      return ok(undefined);
    } catch (e) {
      return err(
        new StoreError(
          `Failed to initialize store: ${String(e)}`,
          "IO_ERROR",
        ),
      );
    }
  }

  // ── Job Operations ──────────────────────────────────

  async createJob(job: Job): Promise<Result<Job, StoreError>> {
    const jobDir = this.jobDir(job.job_id);
    try {
      await fs.mkdir(jobDir, { recursive: true });
      await fs.mkdir(path.join(jobDir, "tasks"), { recursive: true });
      await fs.mkdir(path.join(jobDir, "reports"), { recursive: true });
      await this.atomicWrite(
        path.join(jobDir, "job.json"),
        JSON.stringify(job, null, 2),
      );
      return ok(job);
    } catch (e) {
      if (this.isExistsError(e)) {
        return err(
          new StoreError(
            `Job ${job.job_id} already exists`,
            "ALREADY_EXISTS",
          ),
        );
      }
      return err(
        new StoreError(`Failed to create job: ${String(e)}`, "IO_ERROR"),
      );
    }
  }

  async getJob(jobId: string): Promise<Result<Job, StoreError>> {
    return this.readJson<Job>(path.join(this.jobDir(jobId), "job.json"));
  }

  async updateJob(
    jobId: string,
    updates: Partial<Job>,
  ): Promise<Result<Job, StoreError>> {
    const existing = await this.getJob(jobId);
    if (existing.isErr()) return existing;

    const updated = { ...existing.value, ...updates };
    const writeResult = await this.writeJson(
      path.join(this.jobDir(jobId), "job.json"),
      updated,
    );
    if (writeResult.isErr()) return err(writeResult.error);

    return ok(updated);
  }

  async listJobs(filter?: JobFilter): Promise<Result<Job[], StoreError>> {
    try {
      const jobsDir = path.join(this.baseDir, "jobs");
      let entries: string[];
      try {
        entries = await fs.readdir(jobsDir);
      } catch {
        return ok([]);
      }

      const jobs: Job[] = [];
      for (const entry of entries) {
        const jobFile = path.join(jobsDir, entry, "job.json");
        const result = await this.readJson<Job>(jobFile);
        if (result.isOk()) {
          jobs.push(result.value);
        }
      }

      let filtered = jobs;
      if (filter?.status) {
        const statuses = Array.isArray(filter.status)
          ? filter.status
          : [filter.status];
        filtered = filtered.filter((j) => statuses.includes(j.status));
      }

      filtered.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

      if (filter?.offset) {
        filtered = filtered.slice(filter.offset);
      }
      if (filter?.limit) {
        filtered = filtered.slice(0, filter.limit);
      }

      return ok(filtered);
    } catch (e) {
      return err(
        new StoreError(`Failed to list jobs: ${String(e)}`, "IO_ERROR"),
      );
    }
  }

  // ── Task Operations ─────────────────────────────────

  async createTask(task: Task): Promise<Result<Task, StoreError>> {
    const taskFile = path.join(
      this.jobDir(task.job_id),
      "tasks",
      `${task.task_id}.json`,
    );
    const result = await this.writeJson(taskFile, task);
    if (result.isErr()) return err(result.error);
    return ok(task);
  }

  async getTask(
    taskId: string,
    jobId: string,
  ): Promise<Result<Task, StoreError>> {
    return this.readJson<Task>(
      path.join(this.jobDir(jobId), "tasks", `${taskId}.json`),
    );
  }

  async updateTask(
    taskId: string,
    jobId: string,
    updates: Partial<Task>,
  ): Promise<Result<Task, StoreError>> {
    const existing = await this.getTask(taskId, jobId);
    if (existing.isErr()) return existing;

    const updated = { ...existing.value, ...updates };
    const result = await this.writeJson(
      path.join(this.jobDir(jobId), "tasks", `${taskId}.json`),
      updated,
    );
    if (result.isErr()) return err(result.error);
    return ok(updated);
  }

  async listTasksByJob(jobId: string): Promise<Result<Task[], StoreError>> {
    try {
      const tasksDir = path.join(this.jobDir(jobId), "tasks");
      let entries: string[];
      try {
        entries = await fs.readdir(tasksDir);
      } catch {
        return ok([]);
      }

      const tasks: Task[] = [];
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const result = await this.readJson<Task>(
          path.join(tasksDir, entry),
        );
        if (result.isOk()) {
          tasks.push(result.value);
        }
      }

      tasks.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );

      return ok(tasks);
    } catch (e) {
      return err(
        new StoreError(`Failed to list tasks: ${String(e)}`, "IO_ERROR"),
      );
    }
  }

  // ── Report Operations ───────────────────────────────

  async createReport(report: Report): Promise<Result<Report, StoreError>> {
    const reportFile = path.join(
      this.jobDir(report.job_id),
      "reports",
      `${report.task_id}.json`,
    );
    const result = await this.writeJson(reportFile, report);
    if (result.isErr()) return err(result.error);
    return ok(report);
  }

  async getReport(
    taskId: string,
    jobId: string,
  ): Promise<Result<Report, StoreError>> {
    return this.readJson<Report>(
      path.join(this.jobDir(jobId), "reports", `${taskId}.json`),
    );
  }

  async listReportsByJob(
    jobId: string,
  ): Promise<Result<Report[], StoreError>> {
    try {
      const reportsDir = path.join(this.jobDir(jobId), "reports");
      let entries: string[];
      try {
        entries = await fs.readdir(reportsDir);
      } catch {
        return ok([]);
      }

      const reports: Report[] = [];
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const result = await this.readJson<Report>(
          path.join(reportsDir, entry),
        );
        if (result.isOk()) {
          reports.push(result.value);
        }
      }

      reports.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );

      return ok(reports);
    } catch (e) {
      return err(
        new StoreError(`Failed to list reports: ${String(e)}`, "IO_ERROR"),
      );
    }
  }

  // ── Trace Operations ────────────────────────────────

  async appendTrace(entry: TraceEntry): Promise<Result<void, StoreError>> {
    const traceFile = path.join(this.jobDir(entry.job_id), "trace.jsonl");
    try {
      await fs.appendFile(traceFile, JSON.stringify(entry) + "\n", "utf-8");
      return ok(undefined);
    } catch (e) {
      return err(
        new StoreError(`Failed to append trace: ${String(e)}`, "IO_ERROR"),
      );
    }
  }

  async getTraces(jobId: string): Promise<Result<TraceEntry[], StoreError>> {
    const traceFile = path.join(this.jobDir(jobId), "trace.jsonl");
    try {
      const content = await fs.readFile(traceFile, "utf-8");
      const entries = content
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as TraceEntry);
      return ok(entries);
    } catch (e) {
      if (this.isNotFoundError(e)) {
        return ok([]);
      }
      return err(
        new StoreError(`Failed to read traces: ${String(e)}`, "IO_ERROR"),
      );
    }
  }

  // ── Private Helpers ─────────────────────────────────

  private jobDir(jobId: string): string {
    return path.join(this.baseDir, "jobs", jobId);
  }

  private async atomicWrite(
    filePath: string,
    content: string,
  ): Promise<void> {
    const tmpPath = `${filePath}.tmp.${nanoid(8)}`;
    await fs.writeFile(tmpPath, content, "utf-8");
    await fs.rename(tmpPath, filePath);
  }

  private async writeJson<T>(
    filePath: string,
    data: T,
  ): Promise<Result<void, StoreError>> {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await this.atomicWrite(filePath, JSON.stringify(data, null, 2));
      return ok(undefined);
    } catch (e) {
      return err(
        new StoreError(`Failed to write ${filePath}: ${String(e)}`, "IO_ERROR"),
      );
    }
  }

  private async readJson<T>(
    filePath: string,
  ): Promise<Result<T, StoreError>> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return ok(JSON.parse(content) as T);
    } catch (e) {
      if (this.isNotFoundError(e)) {
        return err(
          new StoreError(`File not found: ${filePath}`, "NOT_FOUND"),
        );
      }
      return err(
        new StoreError(`Failed to read ${filePath}: ${String(e)}`, "IO_ERROR"),
      );
    }
  }

  private isNotFoundError(e: unknown): boolean {
    return (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "ENOENT"
    );
  }

  private isExistsError(e: unknown): boolean {
    return (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "EEXIST"
    );
  }
}
