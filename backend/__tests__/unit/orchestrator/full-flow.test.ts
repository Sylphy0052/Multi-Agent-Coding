import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Orchestrator } from "../../../src/orchestrator/orchestrator.js";
import { EventBus } from "../../../src/events/bus.js";
import { createJob } from "../../../src/domain/job.js";
import { createTask } from "../../../src/domain/task.js";
import { createReport } from "../../../src/domain/report.js";
import { createInMemoryStore } from "../helpers/in-memory-store.js";
import type { IStateStore } from "../../../src/store/interface.js";
import type { LoadedPersonaSet } from "../../../src/personas/loader.js";
import type { Job, Phase } from "@multi-agent/shared";

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

function createOrchestrator(
  store: IStateStore,
  eventBus: EventBus,
): Orchestrator {
  return new Orchestrator(
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
}

/**
 * Helper: prepare a job at AGGREGATING state with completed tasks and reports.
 */
async function setupJobAtAggregating(
  store: IStateStore,
  phase: Phase = "spec",
  taskCount = 2,
): Promise<Job> {
  const job = {
    ...createJob({
      repo_root: "/tmp/repo",
      prompt: "Build a REST API",
      parallelism: taskCount,
    }),
    status: "AGGREGATING" as const,
    current_phase: phase,
  };
  await store.createJob(job);

  // Create completed tasks with reports
  for (let i = 0; i < taskCount; i++) {
    const task = createTask({
      job_id: job.job_id,
      assignee: `kobito-${i + 1}`,
      phase,
      objective: `Task ${i + 1}: implement feature`,
    });
    const completedTask = { ...task, status: "COMPLETED" as const };
    await store.createTask(completedTask);

    const report = createReport({
      task_id: task.task_id,
      job_id: job.job_id,
      phase,
      summary: `Completed task ${i + 1}`,
      findings: [
        { claim: "Feature works", evidence: "Tests pass", confidence: 0.9 },
      ],
    });
    await store.createReport(report);
  }

  return job;
}

describe("Orchestrator Full Flow", () => {
  let store: IStateStore;
  let eventBus: EventBus;
  let orchestrator: Orchestrator;

  beforeEach(async () => {
    store = createInMemoryStore();
    await store.initialize();
    eventBus = new EventBus();
    orchestrator = createOrchestrator(store, eventBus);
  });

  afterEach(() => {
    orchestrator.stop();
  });

  // ─── handleDispatched ──────────────────────────────────

  describe("handleDispatched", () => {
    it("should transition DISPATCHED -> RUNNING when no TaskRunner", async () => {
      const job = {
        ...createJob({
          repo_root: "/tmp/repo",
          prompt: "test",
        }),
        status: "DISPATCHED" as const,
        current_phase: "spec" as Phase,
      };
      await store.createJob(job);

      const result = await orchestrator.handleDispatched(job);
      expect(result.isOk()).toBe(true);

      const updated = await store.getJob(job.job_id);
      expect(updated.isOk()).toBe(true);
      if (updated.isOk()) {
        expect(updated.value.status).toBe("RUNNING");
      }
    });

    it("should emit job:status_changed event", async () => {
      const job = {
        ...createJob({
          repo_root: "/tmp/repo",
          prompt: "test",
        }),
        status: "DISPATCHED" as const,
        current_phase: "spec" as Phase,
      };
      await store.createJob(job);

      const events: unknown[] = [];
      eventBus.on("*", (e) => events.push(e));

      await orchestrator.handleDispatched(job);

      const statusEvent = events.find(
        (e) =>
          (e as { type: string }).type === "job:status_changed" &&
          (e as { to: string }).to === "RUNNING",
      );
      expect(statusEvent).toBeDefined();
    });
  });

  // ─── handleRunning ─────────────────────────────────────

  describe("handleRunning", () => {
    it("should transition RUNNING -> AGGREGATING when no TaskRunner", async () => {
      const job = {
        ...createJob({
          repo_root: "/tmp/repo",
          prompt: "test",
        }),
        status: "RUNNING" as const,
        current_phase: "spec" as Phase,
      };
      await store.createJob(job);

      const result = await orchestrator.handleRunning(job);
      expect(result.isOk()).toBe(true);

      const updated = await store.getJob(job.job_id);
      expect(updated.isOk()).toBe(true);
      if (updated.isOk()) {
        expect(updated.value.status).toBe("AGGREGATING");
      }
    });
  });

  // ─── handleAggregating ─────────────────────────────────

  describe("handleAggregating", () => {
    it("should transition AGGREGATING -> WAITING_APPROVAL when quality gate passes", async () => {
      const job = await setupJobAtAggregating(store);

      const result = await orchestrator.handleAggregating(job);
      expect(result.isOk()).toBe(true);

      const updated = await store.getJob(job.job_id);
      expect(updated.isOk()).toBe(true);
      if (updated.isOk()) {
        expect(updated.value.status).toBe("WAITING_APPROVAL");
      }
    });

    it("should emit phase:awaiting_approval event", async () => {
      const job = await setupJobAtAggregating(store);

      const events: unknown[] = [];
      eventBus.on("*", (e) => events.push(e));

      await orchestrator.handleAggregating(job);

      const approvalEvent = events.find(
        (e) => (e as { type: string }).type === "phase:awaiting_approval",
      );
      expect(approvalEvent).toBeDefined();
    });

    it("should create trace entry with aggregation summary", async () => {
      const job = await setupJobAtAggregating(store);

      await orchestrator.handleAggregating(job);

      const traces = await store.getTraces(job.job_id);
      expect(traces.isOk()).toBe(true);
      if (traces.isOk()) {
        const aggTrace = traces.value.find(
          (t) => t.event_type === "AGGREGATED",
        );
        expect(aggTrace).toBeDefined();
        expect(aggTrace!.payload_summary).toContain("Aggregated 2 reports");
      }
    });

    it("should retry when quality gate fails (tasks still pending)", async () => {
      const job = {
        ...createJob({
          repo_root: "/tmp/repo",
          prompt: "test",
          parallelism: 2,
        }),
        status: "AGGREGATING" as const,
        current_phase: "spec" as Phase,
      };
      await store.createJob(job);

      // Create PENDING tasks (not completed) - quality gate will fail
      for (let i = 0; i < 2; i++) {
        const task = createTask({
          job_id: job.job_id,
          assignee: `kobito-${i + 1}`,
          phase: "spec",
          objective: `Task ${i + 1}`,
        });
        await store.createTask(task);
      }

      await orchestrator.handleAggregating(job);

      const updated = await store.getJob(job.job_id);
      expect(updated.isOk()).toBe(true);
      if (updated.isOk()) {
        expect(updated.value.status).toBe("WAITING_RETRY");
        expect(updated.value.retry_count).toBe(1);
      }
    });
  });

  // ─── Full pipeline (spec phase) ───────────────────────

  describe("full pipeline (spec phase)", () => {
    it("should process from PLANNING through WAITING_APPROVAL with completed tasks", async () => {
      // Start with a PLANNING job
      const job = {
        ...createJob({
          repo_root: "/tmp/repo",
          prompt: "Build a REST API",
          parallelism: 2,
        }),
        status: "PLANNING" as const,
      };
      await store.createJob(job);

      // Step 1: handlePlanning creates tasks and transitions to DISPATCHED
      const planResult = await orchestrator.handlePlanning(job);
      expect(planResult.isOk()).toBe(true);

      const afterPlan = await store.getJob(job.job_id);
      expect(afterPlan.isOk()).toBe(true);
      expect(afterPlan._unsafeUnwrap().status).toBe("DISPATCHED");
      expect(afterPlan._unsafeUnwrap().current_phase).toBe("spec");

      // Verify tasks were created
      const tasks = await store.listTasksByJob(job.job_id);
      expect(tasks.isOk()).toBe(true);
      expect(tasks._unsafeUnwrap().length).toBe(2);

      // Step 2: handleDispatched (no TaskRunner) -> RUNNING
      const dispatchedJob = afterPlan._unsafeUnwrap();
      const dispResult = await orchestrator.handleDispatched(dispatchedJob);
      expect(dispResult.isOk()).toBe(true);

      const afterDispatch = await store.getJob(job.job_id);
      expect(afterDispatch._unsafeUnwrap().status).toBe("RUNNING");

      // Step 3: handleRunning (no TaskRunner) -> AGGREGATING
      const runningJob = afterDispatch._unsafeUnwrap();
      const runResult = await orchestrator.handleRunning(runningJob);
      expect(runResult.isOk()).toBe(true);

      const afterRunning = await store.getJob(job.job_id);
      expect(afterRunning._unsafeUnwrap().status).toBe("AGGREGATING");

      // Step 4: Manually complete tasks and add reports (simulating TaskRunner)
      const createdTasks = tasks._unsafeUnwrap();
      for (const task of createdTasks) {
        await store.updateTask(task.task_id, job.job_id, {
          status: "COMPLETED",
          updated_at: new Date().toISOString(),
        });
        const report = createReport({
          task_id: task.task_id,
          job_id: job.job_id,
          phase: "spec",
          summary: `Completed: ${task.objective}`,
        });
        await store.createReport(report);
      }

      // Step 5: handleAggregating -> WAITING_APPROVAL
      const aggregatingJob = afterRunning._unsafeUnwrap();
      const aggResult = await orchestrator.handleAggregating(aggregatingJob);
      expect(aggResult.isOk()).toBe(true);

      const afterAgg = await store.getJob(job.job_id);
      expect(afterAgg._unsafeUnwrap().status).toBe("WAITING_APPROVAL");
    });
  });

  // ─── Event emission tracking ──────────────────────────

  describe("event tracking", () => {
    it("should emit correct sequence of status_changed events through flow", async () => {
      const events: { type: string; from?: string; to?: string }[] = [];
      eventBus.on("*", (e) => {
        const ev = e as { type: string; from?: string; to?: string };
        if (ev.type === "job:status_changed") {
          events.push(ev);
        }
      });

      const job = {
        ...createJob({
          repo_root: "/tmp/repo",
          prompt: "test",
        }),
        status: "DISPATCHED" as const,
        current_phase: "spec" as Phase,
      };
      await store.createJob(job);

      // DISPATCHED -> RUNNING
      await orchestrator.handleDispatched(job);

      // RUNNING -> AGGREGATING
      const runningJob = (await store.getJob(job.job_id))._unsafeUnwrap();
      await orchestrator.handleRunning(runningJob);

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ from: "DISPATCHED", to: "RUNNING" });
      expect(events[1]).toMatchObject({ from: "RUNNING", to: "AGGREGATING" });
    });
  });
});
