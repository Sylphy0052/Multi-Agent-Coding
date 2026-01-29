import { describe, it, expect, beforeEach } from "vitest";
import { QualityGate } from "../../../src/orchestrator/quality-gate.js";
import { createInMemoryStore } from "../helpers/in-memory-store.js";
import { createTask } from "../../../src/domain/task.js";
import { createReport } from "../../../src/domain/report.js";
import type { IStateStore } from "../../../src/store/interface.js";

describe("QualityGate", () => {
  let store: IStateStore;
  let gate: QualityGate;

  beforeEach(async () => {
    store = createInMemoryStore();
    await store.initialize();
    gate = new QualityGate(store);
  });

  it("should pass when all tasks are complete with reports", async () => {
    const task = createTask({
      job_id: "job-1",
      assignee: "kobito-1",
      phase: "spec",
      objective: "Write spec",
    });
    await store.createTask({ ...task, status: "COMPLETED" });

    const report = createReport({
      task_id: task.task_id,
      job_id: "job-1",
      phase: "spec",
      summary: "Done",
      findings: [],
      risks: [],
      contradictions: [],
      next_actions: [],
      artifact_updates: [],
    });
    await store.createReport(report);

    const result = await gate.check("job-1", "spec");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.passed).toBe(true);
      expect(result.value.issues).toHaveLength(0);
    }
  });

  it("should fail when tasks are still running", async () => {
    const task = createTask({
      job_id: "job-1",
      assignee: "kobito-1",
      phase: "spec",
      objective: "Write spec",
    });
    await store.createTask({ ...task, status: "RUNNING" });

    const result = await gate.check("job-1", "spec");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.passed).toBe(false);
      expect(result.value.issues.some((i) => i.includes("still in progress"))).toBe(true);
    }
  });

  it("should fail when tasks failed", async () => {
    const task = createTask({
      job_id: "job-1",
      assignee: "kobito-1",
      phase: "spec",
      objective: "Write spec",
    });
    await store.createTask({ ...task, status: "FAILED" });

    const result = await gate.check("job-1", "spec");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.passed).toBe(false);
      expect(result.value.issues.some((i) => i.includes("failed"))).toBe(true);
    }
  });

  it("should fail when reports are missing", async () => {
    const task = createTask({
      job_id: "job-1",
      assignee: "kobito-1",
      phase: "spec",
      objective: "Write spec",
    });
    await store.createTask({ ...task, status: "COMPLETED" });
    // No report created

    const result = await gate.check("job-1", "spec");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.passed).toBe(false);
      expect(result.value.issues.some((i) => i.includes("Missing reports"))).toBe(true);
    }
  });
});
