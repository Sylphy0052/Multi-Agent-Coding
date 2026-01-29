import { describe, it, expect } from "vitest";
import {
  RetryManager,
  classifyError,
} from "../../../src/orchestrator/retry-manager.js";
import { createJob } from "../../../src/domain/job.js";

describe("classifyError", () => {
  it("should classify timeout as TRANSIENT", () => {
    expect(classifyError("Connection timeout")).toBe("TRANSIENT");
  });

  it("should classify ECONNREFUSED as TRANSIENT", () => {
    expect(classifyError("Error: ECONNREFUSED")).toBe("TRANSIENT");
  });

  it("should classify rate limit as TRANSIENT", () => {
    expect(classifyError("Too many requests, rate limit exceeded")).toBe(
      "TRANSIENT",
    );
  });

  it("should classify lock error as TRANSIENT", () => {
    expect(classifyError("Failed to acquire lock")).toBe("TRANSIENT");
  });

  it("should classify unknown errors as PERMANENT", () => {
    expect(classifyError("Syntax error in code")).toBe("PERMANENT");
  });
});

describe("RetryManager", () => {
  const retryManager = new RetryManager({
    maxRetries: 3,
    backoffSequence: [10, 30, 60],
    backoffCap: 60,
  });

  describe("decide", () => {
    it("should retry on transient error", () => {
      const job = createJob({
        repo_root: "/tmp/repo",
        prompt: "test",
      });

      const decision = retryManager.decide(job, "Connection timeout");
      expect(decision.shouldRetry).toBe(true);
      expect(decision.errorClass).toBe("TRANSIENT");
      expect(decision.delaySeconds).toBe(10);
    });

    it("should not retry on permanent error", () => {
      const job = createJob({
        repo_root: "/tmp/repo",
        prompt: "test",
      });

      const decision = retryManager.decide(job, "Syntax error");
      expect(decision.shouldRetry).toBe(false);
      expect(decision.errorClass).toBe("PERMANENT");
    });

    it("should not retry when max retries reached", () => {
      const job = {
        ...createJob({
          repo_root: "/tmp/repo",
          prompt: "test",
        }),
        retry_count: 3,
      };

      const decision = retryManager.decide(job, "Connection timeout");
      expect(decision.shouldRetry).toBe(false);
      expect(decision.errorClass).toBe("TRANSIENT");
    });

    it("should increase backoff with retry count", () => {
      const job = {
        ...createJob({
          repo_root: "/tmp/repo",
          prompt: "test",
        }),
        retry_count: 1,
      };

      const decision = retryManager.decide(job, "ECONNREFUSED");
      expect(decision.shouldRetry).toBe(true);
      expect(decision.delaySeconds).toBe(30);
    });

    it("should cap backoff at backoffCap", () => {
      const decision = retryManager.decide(
        {
          ...createJob({
            repo_root: "/tmp/repo",
            prompt: "test",
          }),
          retry_count: 2,
        },
        "timeout",
      );
      expect(decision.delaySeconds).toBe(60);
    });
  });

  describe("getBackoffDelay", () => {
    it("should return correct delay for each retry count", () => {
      expect(retryManager.getBackoffDelay(0)).toBe(10);
      expect(retryManager.getBackoffDelay(1)).toBe(30);
      expect(retryManager.getBackoffDelay(2)).toBe(60);
      // Beyond sequence length, should use last value capped
      expect(retryManager.getBackoffDelay(5)).toBe(60);
    });
  });
});
