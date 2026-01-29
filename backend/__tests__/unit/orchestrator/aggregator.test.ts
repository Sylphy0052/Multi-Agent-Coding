import { describe, it, expect, beforeEach } from "vitest";
import { Aggregator } from "../../../src/orchestrator/aggregator.js";
import { createInMemoryStore } from "../helpers/in-memory-store.js";
import { createReport } from "../../../src/domain/report.js";
import type { IStateStore } from "../../../src/store/interface.js";

describe("Aggregator", () => {
  let store: IStateStore;
  let aggregator: Aggregator;

  beforeEach(async () => {
    store = createInMemoryStore();
    await store.initialize();
    aggregator = new Aggregator(store);
  });

  it("should aggregate reports for a phase", async () => {
    const report1 = createReport({
      task_id: "task-1",
      job_id: "job-1",
      phase: "spec",
      summary: "First task completed",
      findings: [{ claim: "API design is solid", evidence: "review", confidence: 0.9 }],
      risks: ["Performance risk"],
      contradictions: [],
      next_actions: ["Implement API"],
      artifact_updates: [],
    });

    const report2 = createReport({
      task_id: "task-2",
      job_id: "job-1",
      phase: "spec",
      summary: "Second task completed",
      findings: [{ claim: "Schema validated", evidence: "tests", confidence: 0.8 }],
      risks: ["Security risk"],
      contradictions: [],
      next_actions: ["Write tests"],
      artifact_updates: [],
    });

    await store.createReport(report1);
    await store.createReport(report2);

    const result = await aggregator.aggregate("job-1", "spec");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.reportCount).toBe(2);
      expect(result.value.allFindings).toHaveLength(2);
      expect(result.value.allRisks).toContain("Performance risk");
      expect(result.value.allRisks).toContain("Security risk");
      expect(result.value.nextActions).toContain("Implement API");
      expect(result.value.nextActions).toContain("Write tests");
    }
  });

  it("should return error when no reports found", async () => {
    const result = await aggregator.aggregate("job-1", "spec");
    expect(result.isErr()).toBe(true);
  });

  it("should detect contradictions from individual reports", async () => {
    const report = createReport({
      task_id: "task-1",
      job_id: "job-1",
      phase: "spec",
      summary: "Done",
      findings: [],
      risks: [],
      contradictions: ["Conflicting requirements found"],
      next_actions: [],
      artifact_updates: [],
    });
    await store.createReport(report);

    const result = await aggregator.aggregate("job-1", "spec");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.contradictions).toContain("Conflicting requirements found");
    }
  });

  it("should only aggregate reports for the specified phase", async () => {
    const specReport = createReport({
      task_id: "task-1",
      job_id: "job-1",
      phase: "spec",
      summary: "Spec report",
      findings: [],
      risks: [],
      contradictions: [],
      next_actions: [],
      artifact_updates: [],
    });

    const implReport = createReport({
      task_id: "task-2",
      job_id: "job-1",
      phase: "impl",
      summary: "Impl report",
      findings: [],
      risks: [],
      contradictions: [],
      next_actions: [],
      artifact_updates: [],
    });

    await store.createReport(specReport);
    await store.createReport(implReport);

    const result = await aggregator.aggregate("job-1", "spec");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.reportCount).toBe(1);
      expect(result.value.phase).toBe("spec");
    }
  });
});
