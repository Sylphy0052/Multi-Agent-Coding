import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Orchestrator } from "../../../src/orchestrator/orchestrator.js";
import { EventBus } from "../../../src/events/bus.js";
import { createJob } from "../../../src/domain/job.js";
import { createInMemoryStore } from "../helpers/in-memory-store.js";
import type { IStateStore } from "../../../src/store/interface.js";
import type { LoadedPersonaSet } from "../../../src/personas/loader.js";

// Minimal mock personas for testing
const mockPersonas: LoadedPersonaSet = {
  set: { persona_set_id: "default", personas: {} as never },
  ui_chan: {
    role: "ui-chan",
    description: "UI persona",
    tone_style: "friendly",
    display_name: "UIちゃん",
  },
  ai_chan: {
    role: "ai-chan",
    description: "AI orchestrator",
    tone_style: "analytical",
    display_name: "AIちゃん",
  },
  kobito: {
    role: "kobito",
    description: "Worker",
    tone_style: "focused",
    display_name_prefix: "Kobito",
  },
};

describe("Orchestrator", () => {
  let store: IStateStore;
  let eventBus: EventBus;
  let orchestrator: Orchestrator;

  beforeEach(async () => {
    store = createInMemoryStore();
    await store.initialize();
    eventBus = new EventBus();

    orchestrator = new Orchestrator(
      {
        scheduler: { maxJobs: 2 },
        planner: { model: "sonnet", skipPermissions: false },
        retry: { maxRetries: 3 },
        git: {
          repoRoot: "/tmp/test-repo",
          mainBranch: "main",
          developBranch: "develop",
        },
        tmpDir: "/tmp/orchestrator",
        pollIntervalMs: 100,
      },
      store,
      eventBus,
      mockPersonas,
    );
  });

  afterEach(() => {
    orchestrator.stop();
  });

  describe("lifecycle", () => {
    it("should start and stop", () => {
      expect(orchestrator.isRunning).toBe(false);
      orchestrator.start();
      expect(orchestrator.isRunning).toBe(true);
      orchestrator.stop();
      expect(orchestrator.isRunning).toBe(false);
    });

    it("should be idempotent on start", () => {
      orchestrator.start();
      orchestrator.start();
      expect(orchestrator.isRunning).toBe(true);
      orchestrator.stop();
    });
  });

  describe("handlePlanning", () => {
    it("should transition PLANNING job to DISPATCHED with tasks", async () => {
      const job = {
        ...createJob({
          repo_root: "/tmp/repo",
          prompt: "Build a REST API",
          parallelism: 2,
        }),
        status: "PLANNING" as const,
      };
      await store.createJob(job);

      const result = await orchestrator.handlePlanning(job);
      expect(result.isOk()).toBe(true);

      // Verify job transitioned to DISPATCHED
      const updated = await store.getJob(job.job_id);
      expect(updated.isOk()).toBe(true);
      if (updated.isOk()) {
        expect(updated.value.status).toBe("DISPATCHED");
        expect(updated.value.current_phase).toBe("spec");
      }

      // Verify tasks were created
      const tasks = await store.listTasksByJob(job.job_id);
      expect(tasks.isOk()).toBe(true);
      if (tasks.isOk()) {
        expect(tasks.value).toHaveLength(2);
        expect(tasks.value[0].phase).toBe("spec");
      }
    });

    it("should set current_phase to spec for first planning", async () => {
      const job = {
        ...createJob({
          repo_root: "/tmp/repo",
          prompt: "test",
        }),
        status: "PLANNING" as const,
      };
      await store.createJob(job);

      await orchestrator.handlePlanning(job);

      const updated = await store.getJob(job.job_id);
      if (updated.isOk()) {
        expect(updated.value.current_phase).toBe("spec");
      }
    });
  });

  describe("tick", () => {
    it("should process RECEIVED jobs through full cycle in a single tick (no TaskRunner)", async () => {
      const job = createJob({
        repo_root: "/tmp/repo",
        prompt: "test prompt",
      });
      await store.createJob(job);

      await orchestrator.tick();

      // Without TaskRunner, a single tick processes:
      // RECEIVED -> PLANNING -> DISPATCHED -> RUNNING -> AGGREGATING
      // -> Quality gate fails (tasks still PENDING) -> WAITING_RETRY
      const updated = await store.getJob(job.job_id);
      expect(updated.isOk()).toBe(true);
      if (updated.isOk()) {
        expect(updated.value.status).toBe("WAITING_RETRY");
      }
    });

    it("should process PLANNING jobs through full cycle (no TaskRunner)", async () => {
      const job = {
        ...createJob({
          repo_root: "/tmp/repo",
          prompt: "test",
        }),
        status: "PLANNING" as const,
      };
      await store.createJob(job);

      await orchestrator.tick();

      // Without TaskRunner: PLANNING -> DISPATCHED -> RUNNING -> AGGREGATING
      // -> Quality gate fails -> WAITING_RETRY
      const updated = await store.getJob(job.job_id);
      expect(updated.isOk()).toBe(true);
      if (updated.isOk()) {
        expect(updated.value.status).toBe("WAITING_RETRY");
      }
    });
  });

  describe("component accessors", () => {
    it("should provide access to sub-components", () => {
      expect(orchestrator.getScheduler()).toBeDefined();
      expect(orchestrator.getPlanner()).toBeDefined();
      expect(orchestrator.getAggregator()).toBeDefined();
      expect(orchestrator.getQualityGate()).toBeDefined();
      expect(orchestrator.getRetryManager()).toBeDefined();
    });
  });
});
