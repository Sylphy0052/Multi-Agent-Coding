import { describe, it, expect } from "vitest";
import { ClaudeRunner } from "../../../src/tmux/claude-runner.js";
import { TmuxController } from "../../../src/tmux/controller.js";

describe("ClaudeRunner", () => {
  const tmux = new TmuxController("job");
  const runner = new ClaudeRunner(tmux);

  describe("buildCommand", () => {
    it("should build basic command", () => {
      const cmd = runner.buildCommand({
        repoRoot: "/tmp/repo",
        prompt: "test",
        model: "sonnet",
        skipPermissions: false,
        outputFormat: "json",
        timeoutSeconds: 600,
      });
      expect(cmd).toBe("claude -p --print --output-format json --model sonnet");
    });

    it("should include skip-permissions flag", () => {
      const cmd = runner.buildCommand({
        repoRoot: "/tmp/repo",
        prompt: "test",
        model: "sonnet",
        skipPermissions: true,
        outputFormat: "json",
        timeoutSeconds: 600,
      });
      expect(cmd).toContain("--dangerously-skip-permissions");
    });

    it("should set output format", () => {
      const cmd = runner.buildCommand({
        repoRoot: "/tmp/repo",
        prompt: "test",
        model: "opus",
        skipPermissions: false,
        outputFormat: "text",
        timeoutSeconds: 600,
      });
      expect(cmd).toContain("--output-format text");
      expect(cmd).toContain("--model opus");
    });
  });
});
