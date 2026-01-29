import { describe, it, expect } from "vitest";
import {
  createJob,
  transitionJob,
  isValidTransition,
  validTransitions,
  setJobPhase,
  setJobError,
  isTerminal,
} from "../../../src/domain/job.js";
import type { JobStatus } from "@multi-agent/shared";

describe("Job Domain", () => {
  const input = {
    repo_root: "/tmp/test-repo",
    prompt: "Build a TODO app",
    parallelism: 2,
  };

  describe("createJob", () => {
    it("should create a job with RECEIVED status", () => {
      const job = createJob(input);
      expect(job.status).toBe("RECEIVED");
      expect(job.job_id).toBeTruthy();
      expect(job.repo_root).toBe("/tmp/test-repo");
      expect(job.user_prompt).toBe("Build a TODO app");
      expect(job.parallelism).toBe(2);
      expect(job.mode).toBe("spec_impl_test");
      expect(job.persona_set_id).toBe("default");
      expect(job.current_phase).toBeNull();
      expect(job.retry_count).toBe(0);
      expect(job.last_error).toBeNull();
      expect(job.error_class).toBeNull();
    });

    it("should generate unique job IDs", () => {
      const job1 = createJob(input);
      const job2 = createJob(input);
      expect(job1.job_id).not.toBe(job2.job_id);
    });

    it("should set artifact paths based on job_id", () => {
      const job = createJob(input);
      expect(job.artifacts.spec_md_path).toBe(
        `docs/jobs/${job.job_id}/spec.md`,
      );
      expect(job.artifacts.impl_md_path).toBe(
        `docs/jobs/${job.job_id}/impl.md`,
      );
      expect(job.artifacts.test_md_path).toBe(
        `docs/jobs/${job.job_id}/test.md`,
      );
      expect(job.artifacts.summary_md_path).toBe(
        `docs/jobs/${job.job_id}/summary.md`,
      );
    });

    it("should set git branches based on job_id", () => {
      const job = createJob(input);
      expect(job.git.main_branch).toBe("main");
      expect(job.git.develop_branch).toBe("develop");
      expect(job.git.job_branch).toBe(`jobs/${job.job_id}`);
      expect(job.git.merge_policy).toBe("merge_commit");
    });
  });

  describe("transitionJob", () => {
    it("should transition from RECEIVED to PLANNING", () => {
      const job = createJob(input);
      const result = transitionJob(job, "PLANNING");
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.status).toBe("PLANNING");
      }
    });

    it("should transition from RECEIVED to QUEUED", () => {
      const job = createJob(input);
      const result = transitionJob(job, "QUEUED");
      expect(result.isOk()).toBe(true);
    });

    it("should transition from RECEIVED to CANCELED", () => {
      const job = createJob(input);
      const result = transitionJob(job, "CANCELED");
      expect(result.isOk()).toBe(true);
    });

    it("should reject invalid transition from RECEIVED to COMPLETED", () => {
      const job = createJob(input);
      const result = transitionJob(job, "COMPLETED");
      expect(result.isErr()).toBe(true);
    });

    it("should reject invalid transition from COMPLETED (terminal)", () => {
      const job = { ...createJob(input), status: "COMPLETED" as JobStatus };
      const result = transitionJob(job, "PLANNING");
      expect(result.isErr()).toBe(true);
    });

    it("should follow the main happy path", () => {
      let job = createJob(input);
      const happyPath: JobStatus[] = [
        "PLANNING",
        "DISPATCHED",
        "RUNNING",
        "AGGREGATING",
        "WAITING_APPROVAL",
        "APPROVED",
        "COMMITTING",
        "COMPLETED",
      ];

      for (const nextStatus of happyPath) {
        const result = transitionJob(job, nextStatus);
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          job = result.value;
          expect(job.status).toBe(nextStatus);
        }
      }
    });

    it("should allow WAITING_RETRY from RUNNING", () => {
      const job = { ...createJob(input), status: "RUNNING" as JobStatus };
      const result = transitionJob(job, "WAITING_RETRY");
      expect(result.isOk()).toBe(true);
    });

    it("should allow recovery from WAITING_RETRY", () => {
      const job = {
        ...createJob(input),
        status: "WAITING_RETRY" as JobStatus,
      };
      for (const target of ["PLANNING", "RUNNING", "COMMITTING", "FAILED"] as JobStatus[]) {
        const result = transitionJob(job, target);
        expect(result.isOk()).toBe(true);
      }
    });

    it("should allow rejection from WAITING_APPROVAL back to PLANNING", () => {
      const job = {
        ...createJob(input),
        status: "WAITING_APPROVAL" as JobStatus,
      };
      const result = transitionJob(job, "PLANNING");
      expect(result.isOk()).toBe(true);
    });

    it("should set updated_at as a valid ISO timestamp on transition", () => {
      const job = createJob(input);
      const result = transitionJob(job, "PLANNING");
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.updated_at).toBeTruthy();
        expect(new Date(result.value.updated_at).toISOString()).toBe(
          result.value.updated_at,
        );
      }
    });
  });

  describe("isValidTransition", () => {
    it("should return true for valid transitions", () => {
      expect(isValidTransition("RECEIVED", "PLANNING")).toBe(true);
      expect(isValidTransition("RUNNING", "AGGREGATING")).toBe(true);
    });

    it("should return false for invalid transitions", () => {
      expect(isValidTransition("RECEIVED", "COMPLETED")).toBe(false);
      expect(isValidTransition("COMPLETED", "PLANNING")).toBe(false);
    });
  });

  describe("validTransitions", () => {
    it("should return allowed transitions for a state", () => {
      const transitions = validTransitions("RECEIVED");
      expect(transitions).toContain("PLANNING");
      expect(transitions).toContain("QUEUED");
      expect(transitions).toContain("CANCELED");
      expect(transitions).not.toContain("COMPLETED");
    });

    it("should return empty array for terminal states", () => {
      expect(validTransitions("COMPLETED")).toHaveLength(0);
      expect(validTransitions("FAILED")).toHaveLength(0);
      expect(validTransitions("CANCELED")).toHaveLength(0);
    });
  });

  describe("setJobPhase", () => {
    it("should update the current phase", () => {
      const job = createJob(input);
      const updated = setJobPhase(job, "spec");
      expect(updated.current_phase).toBe("spec");
      expect(updated.updated_at).toBeTruthy();
      expect(new Date(updated.updated_at).toISOString()).toBe(
        updated.updated_at,
      );
    });
  });

  describe("setJobError", () => {
    it("should set transient error and increment retry_count", () => {
      const job = createJob(input);
      const updated = setJobError(job, "Network timeout", "TRANSIENT");
      expect(updated.last_error).toBe("Network timeout");
      expect(updated.error_class).toBe("TRANSIENT");
      expect(updated.retry_count).toBe(1);
    });

    it("should set permanent error without incrementing retry_count", () => {
      const job = createJob(input);
      const updated = setJobError(job, "Auth failed", "PERMANENT");
      expect(updated.last_error).toBe("Auth failed");
      expect(updated.error_class).toBe("PERMANENT");
      expect(updated.retry_count).toBe(0);
    });
  });

  describe("isTerminal", () => {
    it("should return true for terminal states", () => {
      expect(isTerminal("COMPLETED")).toBe(true);
      expect(isTerminal("FAILED")).toBe(true);
      expect(isTerminal("CANCELED")).toBe(true);
    });

    it("should return false for non-terminal states", () => {
      expect(isTerminal("RECEIVED")).toBe(false);
      expect(isTerminal("RUNNING")).toBe(false);
      expect(isTerminal("WAITING_APPROVAL")).toBe(false);
    });
  });
});
