import { describe, it, expect, beforeEach } from "vitest";
import { Scheduler } from "../../../src/orchestrator/scheduler.js";
import { EventBus } from "../../../src/events/bus.js";
import { createJob } from "../../../src/domain/job.js";
import { createInMemoryStore } from "../helpers/in-memory-store.js";
import type { IStateStore } from "../../../src/store/interface.js";
import type { Job } from "@multi-agent/shared";

describe("Scheduler", () => {
  let store: IStateStore;
  let eventBus: EventBus;
  let scheduler: Scheduler;

  beforeEach(async () => {
    store = createInMemoryStore();
    await store.initialize();
    eventBus = new EventBus();
    scheduler = new Scheduler({ maxJobs: 2 }, store, eventBus);
  });

  function makeJob(): Job {
    return createJob({
      repo_root: "/tmp/repo",
      prompt: "test prompt",
    });
  }

  describe("hasCapacity", () => {
    it("should return true when no jobs are active", async () => {
      expect(await scheduler.hasCapacity()).toBe(true);
    });

    it("should return false when at capacity", async () => {
      // Create 2 active jobs (in PLANNING state)
      const j1 = makeJob();
      const j2 = makeJob();
      await store.createJob({ ...j1, status: "PLANNING" });
      await store.createJob({ ...j2, status: "PLANNING" });

      expect(await scheduler.hasCapacity()).toBe(false);
    });
  });

  describe("scheduleJob", () => {
    it("should promote to PLANNING when capacity available", async () => {
      const job = makeJob();
      await store.createJob(job);

      const result = await scheduler.scheduleJob(job);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.status).toBe("PLANNING");
      }
    });

    it("should queue when at capacity", async () => {
      // Fill capacity
      const j1 = makeJob();
      const j2 = makeJob();
      await store.createJob({ ...j1, status: "PLANNING" });
      await store.createJob({ ...j2, status: "PLANNING" });

      const job = makeJob();
      await store.createJob(job);

      const result = await scheduler.scheduleJob(job);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.status).toBe("QUEUED");
      }
    });
  });

  describe("dequeueNext", () => {
    it("should return null when no queued jobs", async () => {
      const result = await scheduler.dequeueNext();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeNull();
      }
    });

    it("should dequeue the first queued job", async () => {
      const job = makeJob();
      await store.createJob({ ...job, status: "QUEUED" });

      const result = await scheduler.dequeueNext();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).not.toBeNull();
        expect(result.value!.status).toBe("PLANNING");
      }
    });

    it("should not dequeue when at capacity", async () => {
      // Fill capacity
      const j1 = makeJob();
      const j2 = makeJob();
      await store.createJob({ ...j1, status: "PLANNING" });
      await store.createJob({ ...j2, status: "PLANNING" });

      // Queue a job
      const job = makeJob();
      await store.createJob({ ...job, status: "QUEUED" });

      const result = await scheduler.dequeueNext();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeNull();
      }
    });
  });
});
