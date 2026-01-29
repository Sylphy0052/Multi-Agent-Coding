import { describe, it, expect } from "vitest";
import {
  createTask,
  transitionTask,
  isValidTaskTransition,
} from "../../../src/domain/task.js";
import type { TaskStatus } from "@multi-agent/shared";

describe("Task Domain", () => {
  const input = {
    job_id: "test-job-001",
    assignee: "kobito-1",
    phase: "spec" as const,
    objective: "Analyze requirements",
  };

  describe("createTask", () => {
    it("should create a task with PENDING status", () => {
      const task = createTask(input);
      expect(task.status).toBe("PENDING");
      expect(task.task_id).toBeTruthy();
      expect(task.job_id).toBe("test-job-001");
      expect(task.assignee).toBe("kobito-1");
      expect(task.phase).toBe("spec");
      expect(task.objective).toBe("Analyze requirements");
      expect(task.inputs).toEqual([]);
      expect(task.constraints).toEqual([]);
      expect(task.acceptance_criteria).toEqual([]);
    });

    it("should generate unique task IDs", () => {
      const task1 = createTask(input);
      const task2 = createTask(input);
      expect(task1.task_id).not.toBe(task2.task_id);
    });

    it("should accept optional fields", () => {
      const task = createTask({
        ...input,
        inputs: ["user story 1"],
        constraints: ["must be testable"],
        acceptance_criteria: ["all tests pass"],
      });
      expect(task.inputs).toEqual(["user story 1"]);
      expect(task.constraints).toEqual(["must be testable"]);
      expect(task.acceptance_criteria).toEqual(["all tests pass"]);
    });
  });

  describe("transitionTask", () => {
    it("should follow the happy path: PENDING -> ASSIGNED -> RUNNING -> COMPLETED", () => {
      let task = createTask(input);
      const path: TaskStatus[] = ["ASSIGNED", "RUNNING", "COMPLETED"];

      for (const next of path) {
        const result = transitionTask(task, next);
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          task = result.value;
          expect(task.status).toBe(next);
        }
      }
    });

    it("should reject invalid transition from PENDING to RUNNING", () => {
      const task = createTask(input);
      const result = transitionTask(task, "RUNNING");
      expect(result.isErr()).toBe(true);
    });

    it("should allow CANCELED from any non-terminal state", () => {
      for (const status of ["PENDING", "ASSIGNED", "RUNNING"] as TaskStatus[]) {
        const task = { ...createTask(input), status };
        const result = transitionTask(task, "CANCELED");
        expect(result.isOk()).toBe(true);
      }
    });

    it("should reject transitions from terminal states", () => {
      for (const status of ["COMPLETED", "FAILED", "CANCELED"] as TaskStatus[]) {
        const task = { ...createTask(input), status };
        const result = transitionTask(task, "PENDING");
        expect(result.isErr()).toBe(true);
      }
    });
  });

  describe("isValidTaskTransition", () => {
    it("should return true for valid transitions", () => {
      expect(isValidTaskTransition("PENDING", "ASSIGNED")).toBe(true);
      expect(isValidTaskTransition("RUNNING", "COMPLETED")).toBe(true);
    });

    it("should return false for invalid transitions", () => {
      expect(isValidTaskTransition("PENDING", "COMPLETED")).toBe(false);
      expect(isValidTaskTransition("COMPLETED", "RUNNING")).toBe(false);
    });
  });
});
