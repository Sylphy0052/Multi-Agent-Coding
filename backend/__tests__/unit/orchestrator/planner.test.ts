import { describe, it, expect, beforeEach } from "vitest";
import { Planner } from "../../../src/orchestrator/planner.js";
import { createInMemoryStore } from "../helpers/in-memory-store.js";
import type { IStateStore } from "../../../src/store/interface.js";

describe("Planner", () => {
  let store: IStateStore;
  let planner: Planner;

  beforeEach(async () => {
    store = createInMemoryStore();
    await store.initialize();
    planner = new Planner(
      { model: "sonnet", skipPermissions: false },
      store,
    );
  });

  describe("parsePlanResponse", () => {
    it("should parse a valid JSON array", () => {
      const raw = JSON.stringify([
        {
          objective: "Write spec",
          inputs: ["user prompt"],
          constraints: ["none"],
          acceptance_criteria: ["spec produced"],
        },
      ]);

      const result = planner.parsePlanResponse(raw);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].objective).toBe("Write spec");
      }
    });

    it("should extract JSON from markdown code block", () => {
      const raw = `Here is the plan:
\`\`\`json
[{"objective": "Task 1", "inputs": [], "constraints": [], "acceptance_criteria": []}]
\`\`\``;

      const result = planner.parsePlanResponse(raw);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].objective).toBe("Task 1");
      }
    });

    it("should handle missing optional fields", () => {
      const raw = JSON.stringify([{ objective: "Do something" }]);

      const result = planner.parsePlanResponse(raw);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value[0].inputs).toEqual([]);
        expect(result.value[0].constraints).toEqual([]);
        expect(result.value[0].acceptance_criteria).toEqual([]);
      }
    });

    it("should return error for invalid JSON", () => {
      const result = planner.parsePlanResponse("not json at all");
      expect(result.isErr()).toBe(true);
    });
  });

  describe("generateDefaultTemplates", () => {
    it("should generate the requested number of templates", () => {
      const templates = planner.generateDefaultTemplates("Build API", "spec", 3);
      expect(templates).toHaveLength(3);
      expect(templates[0].objective).toContain("spec phase task 1");
      expect(templates[2].objective).toContain("spec phase task 3");
    });

    it("should include phase in constraints", () => {
      const templates = planner.generateDefaultTemplates("Do work", "impl", 1);
      expect(templates[0].constraints).toContain("Phase: impl");
    });
  });

  describe("createTasks", () => {
    it("should create tasks and persist them", async () => {
      const templates = planner.generateDefaultTemplates("test", "spec", 2);
      const result = await planner.createTasks("job-1", "spec", templates);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0].phase).toBe("spec");
        expect(result.value[0].assignee).toBe("kobito-1");
        expect(result.value[1].assignee).toBe("kobito-2");
      }

      // Verify they're in the store
      const stored = await store.listTasksByJob("job-1");
      expect(stored.isOk()).toBe(true);
      if (stored.isOk()) {
        expect(stored.value).toHaveLength(2);
      }
    });
  });
});
