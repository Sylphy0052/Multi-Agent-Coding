import { describe, it, expect, afterEach } from "vitest";
import * as path from "node:path";
import { loadConfig } from "../../../src/config/index.js";

const fixturesDir = path.resolve(
  import.meta.dirname,
  "../../../../config",
);

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("ORCHESTRATOR_")) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("should load config from default.yaml", () => {
    const config = loadConfig(path.join(fixturesDir, "default.yaml"));
    expect(config.server.port).toBe(3000);
    expect(config.auth.username).toBe("admin");
    expect(config.orchestrator.max_jobs_hard_limit).toBe(4);
    expect(config.claude.model).toBe("sonnet");
    expect(config.git.merge_policy).toBe("merge_commit");
  });

  it("should apply schema defaults when no file exists", () => {
    const config = loadConfig("/nonexistent/path.yaml");
    expect(config.server.port).toBe(3000);
    expect(config.auth.username).toBe("admin");
    expect(config.retry.max_retries).toBe(10);
  });

  it("should override with environment variables", () => {
    process.env.ORCHESTRATOR_SERVER_PORT = "8080";
    process.env.ORCHESTRATOR_AUTH_USERNAME = "testuser";
    process.env.ORCHESTRATOR_CLAUDE_SKIP_PERMISSIONS = "false";

    const config = loadConfig("/nonexistent/path.yaml");
    expect(config.server.port).toBe(8080);
    expect(config.auth.username).toBe("testuser");
    expect(config.claude.skip_permissions).toBe(false);
  });

  it("should resolve max_jobs to a number when set to auto", () => {
    const config = loadConfig(path.join(fixturesDir, "default.yaml"));
    // auto should resolve to a positive number
    expect(typeof config.orchestrator.max_jobs).toBe("number");
    expect(config.orchestrator.max_jobs).toBeGreaterThanOrEqual(1);
  });

  it("should preserve explicit max_jobs number", () => {
    process.env.ORCHESTRATOR_ORCHESTRATOR_MAX_JOBS = "3";
    const config = loadConfig("/nonexistent/path.yaml");
    expect(config.orchestrator.max_jobs).toBe(3);
  });
});
