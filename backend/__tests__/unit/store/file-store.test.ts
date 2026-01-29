import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { FileStore } from "../../../src/store/file-store.js";
import { createJob } from "../../../src/domain/job.js";
import { createTask } from "../../../src/domain/task.js";
import { createReport } from "../../../src/domain/report.js";
import { createTraceEntry } from "../../../src/domain/trace.js";

describe("FileStore", () => {
  let store: FileStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "filestore-test-"));
    store = new FileStore(tmpDir);
    await store.initialize();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Job Operations ────────────────────────────────

  describe("Job CRUD", () => {
    it("should create and retrieve a job", async () => {
      const job = createJob({
        repo_root: "/tmp/repo",
        prompt: "Test prompt",
      });

      const createResult = await store.createJob(job);
      expect(createResult.isOk()).toBe(true);

      const getResult = await store.getJob(job.job_id);
      expect(getResult.isOk()).toBe(true);
      if (getResult.isOk()) {
        expect(getResult.value.job_id).toBe(job.job_id);
        expect(getResult.value.user_prompt).toBe("Test prompt");
      }
    });

    it("should update a job", async () => {
      const job = createJob({
        repo_root: "/tmp/repo",
        prompt: "Test",
      });
      await store.createJob(job);

      const updateResult = await store.updateJob(job.job_id, {
        status: "PLANNING",
      });
      expect(updateResult.isOk()).toBe(true);
      if (updateResult.isOk()) {
        expect(updateResult.value.status).toBe("PLANNING");
      }

      const getResult = await store.getJob(job.job_id);
      expect(getResult.isOk()).toBe(true);
      if (getResult.isOk()) {
        expect(getResult.value.status).toBe("PLANNING");
      }
    });

    it("should list jobs sorted by created_at descending", async () => {
      const job1 = createJob({
        repo_root: "/tmp/repo1",
        prompt: "First",
      });
      const job2 = createJob({
        repo_root: "/tmp/repo2",
        prompt: "Second",
      });

      await store.createJob(job1);
      await store.createJob(job2);

      const listResult = await store.listJobs();
      expect(listResult.isOk()).toBe(true);
      if (listResult.isOk()) {
        expect(listResult.value).toHaveLength(2);
      }
    });

    it("should filter jobs by status", async () => {
      const job1 = createJob({
        repo_root: "/tmp/repo1",
        prompt: "First",
      });
      const job2 = createJob({
        repo_root: "/tmp/repo2",
        prompt: "Second",
      });

      await store.createJob(job1);
      await store.createJob(job2);
      await store.updateJob(job1.job_id, { status: "PLANNING" });

      const listResult = await store.listJobs({ status: "PLANNING" });
      expect(listResult.isOk()).toBe(true);
      if (listResult.isOk()) {
        expect(listResult.value).toHaveLength(1);
        expect(listResult.value[0].status).toBe("PLANNING");
      }
    });

    it("should return NOT_FOUND for missing job", async () => {
      const result = await store.getJob("nonexistent");
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });

    it("should support limit and offset", async () => {
      for (let i = 0; i < 5; i++) {
        await store.createJob(
          createJob({
            repo_root: `/tmp/repo${i}`,
            prompt: `Prompt ${i}`,
          }),
        );
      }

      const result = await store.listJobs({ limit: 2, offset: 1 });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
      }
    });
  });

  // ── Task Operations ───────────────────────────────

  describe("Task CRUD", () => {
    it("should create and retrieve a task", async () => {
      const job = createJob({
        repo_root: "/tmp/repo",
        prompt: "Test",
      });
      await store.createJob(job);

      const task = createTask({
        job_id: job.job_id,
        assignee: "kobito-1",
        phase: "spec",
        objective: "Analyze",
      });

      const createResult = await store.createTask(task);
      expect(createResult.isOk()).toBe(true);

      const getResult = await store.getTask(task.task_id, job.job_id);
      expect(getResult.isOk()).toBe(true);
      if (getResult.isOk()) {
        expect(getResult.value.task_id).toBe(task.task_id);
        expect(getResult.value.objective).toBe("Analyze");
      }
    });

    it("should update a task", async () => {
      const job = createJob({
        repo_root: "/tmp/repo",
        prompt: "Test",
      });
      await store.createJob(job);

      const task = createTask({
        job_id: job.job_id,
        assignee: "kobito-1",
        phase: "spec",
        objective: "Analyze",
      });
      await store.createTask(task);

      const updateResult = await store.updateTask(
        task.task_id,
        job.job_id,
        { status: "ASSIGNED" },
      );
      expect(updateResult.isOk()).toBe(true);
      if (updateResult.isOk()) {
        expect(updateResult.value.status).toBe("ASSIGNED");
      }
    });

    it("should list tasks by job", async () => {
      const job = createJob({
        repo_root: "/tmp/repo",
        prompt: "Test",
      });
      await store.createJob(job);

      await store.createTask(
        createTask({
          job_id: job.job_id,
          assignee: "kobito-1",
          phase: "spec",
          objective: "Task 1",
        }),
      );
      await store.createTask(
        createTask({
          job_id: job.job_id,
          assignee: "kobito-2",
          phase: "spec",
          objective: "Task 2",
        }),
      );

      const listResult = await store.listTasksByJob(job.job_id);
      expect(listResult.isOk()).toBe(true);
      if (listResult.isOk()) {
        expect(listResult.value).toHaveLength(2);
      }
    });
  });

  // ── Report Operations ─────────────────────────────

  describe("Report CRUD", () => {
    it("should create and retrieve a report", async () => {
      const job = createJob({
        repo_root: "/tmp/repo",
        prompt: "Test",
      });
      await store.createJob(job);

      const report = createReport({
        task_id: "task-001",
        job_id: job.job_id,
        phase: "spec",
        summary: "Analysis complete",
      });

      const createResult = await store.createReport(report);
      expect(createResult.isOk()).toBe(true);

      const getResult = await store.getReport("task-001", job.job_id);
      expect(getResult.isOk()).toBe(true);
      if (getResult.isOk()) {
        expect(getResult.value.summary).toBe("Analysis complete");
      }
    });

    it("should list reports by job", async () => {
      const job = createJob({
        repo_root: "/tmp/repo",
        prompt: "Test",
      });
      await store.createJob(job);

      await store.createReport(
        createReport({
          task_id: "task-001",
          job_id: job.job_id,
          phase: "spec",
          summary: "Report 1",
        }),
      );
      await store.createReport(
        createReport({
          task_id: "task-002",
          job_id: job.job_id,
          phase: "spec",
          summary: "Report 2",
        }),
      );

      const listResult = await store.listReportsByJob(job.job_id);
      expect(listResult.isOk()).toBe(true);
      if (listResult.isOk()) {
        expect(listResult.value).toHaveLength(2);
      }
    });
  });

  // ── Trace Operations ──────────────────────────────

  describe("Trace Operations", () => {
    it("should append and retrieve trace entries", async () => {
      const job = createJob({
        repo_root: "/tmp/repo",
        prompt: "Test",
      });
      await store.createJob(job);

      const entry1 = createTraceEntry(
        job.job_id,
        "system",
        "RECEIVED",
        "Job received from web",
      );
      const entry2 = createTraceEntry(
        job.job_id,
        "ai-chan",
        "DELEGATED",
        "Task delegated to kobito-1",
      );

      await store.appendTrace(entry1);
      await store.appendTrace(entry2);

      const getResult = await store.getTraces(job.job_id);
      expect(getResult.isOk()).toBe(true);
      if (getResult.isOk()) {
        expect(getResult.value).toHaveLength(2);
        expect(getResult.value[0].event_type).toBe("RECEIVED");
        expect(getResult.value[1].event_type).toBe("DELEGATED");
      }
    });

    it("should return empty array for job with no traces", async () => {
      const result = await store.getTraces("nonexistent-job");
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });
  });

  // ── Initialize ────────────────────────────────────

  describe("initialize", () => {
    it("should create the jobs directory", async () => {
      const newDir = path.join(tmpDir, "new-state");
      const newStore = new FileStore(newDir);
      const result = await newStore.initialize();
      expect(result.isOk()).toBe(true);

      const stat = await fs.stat(path.join(newDir, "jobs"));
      expect(stat.isDirectory()).toBe(true);
    });
  });
});
