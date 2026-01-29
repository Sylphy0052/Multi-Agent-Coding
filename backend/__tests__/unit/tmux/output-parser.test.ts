import { describe, it, expect } from "vitest";
import { parseClaudeOutput, toReport } from "../../../src/tmux/output-parser.js";

describe("OutputParser", () => {
  describe("parseClaudeOutput", () => {
    it("should parse valid JSON output", () => {
      const raw = JSON.stringify({
        summary: "Requirements analyzed",
        findings: [
          { claim: "Need auth", evidence: "User story 1", confidence: 0.9 },
        ],
        risks: ["No edge cases defined"],
        contradictions: [],
        next_actions: ["Define acceptance criteria"],
        artifact_updates: [
          { path: "docs/spec.md", change_summary: "Added requirements" },
        ],
      });

      const result = parseClaudeOutput(raw);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.summary).toBe("Requirements analyzed");
        expect(result.value.findings).toHaveLength(1);
        expect(result.value.findings[0].claim).toBe("Need auth");
        expect(result.value.findings[0].confidence).toBe(0.9);
        expect(result.value.risks).toEqual(["No edge cases defined"]);
        expect(result.value.artifact_updates).toHaveLength(1);
      }
    });

    it("should handle JSON in markdown code block", () => {
      const raw = '```json\n{"summary": "Done", "findings": []}\n```';
      const result = parseClaudeOutput(raw);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.summary).toBe("Done");
      }
    });

    it("should handle JSON embedded in other text", () => {
      const raw = 'Here is the result:\n{"summary": "Completed"}\nEnd.';
      const result = parseClaudeOutput(raw);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.summary).toBe("Completed");
      }
    });

    it("should return error for empty output", () => {
      const result = parseClaudeOutput("");
      expect(result.isErr()).toBe(true);
    });

    it("should return error for invalid JSON", () => {
      const result = parseClaudeOutput("not json at all");
      expect(result.isErr()).toBe(true);
    });

    it("should handle missing optional fields", () => {
      const raw = JSON.stringify({ summary: "Minimal" });
      const result = parseClaudeOutput(raw);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.summary).toBe("Minimal");
        expect(result.value.findings).toEqual([]);
        expect(result.value.risks).toEqual([]);
        expect(result.value.contradictions).toEqual([]);
        expect(result.value.next_actions).toEqual([]);
        expect(result.value.artifact_updates).toEqual([]);
      }
    });

    it("should handle findings with missing confidence", () => {
      const raw = JSON.stringify({
        summary: "Test",
        findings: [{ claim: "Something", evidence: "observed" }],
      });
      const result = parseClaudeOutput(raw);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.findings[0].confidence).toBe(0.5);
      }
    });
  });

  describe("toReport", () => {
    it("should convert parsed output to Report", () => {
      const parsed = {
        summary: "Done",
        findings: [],
        risks: ["Risk 1"],
        contradictions: [],
        next_actions: [],
        artifact_updates: [],
      };
      const report = toReport(parsed, "task-1", "job-1", "spec");
      expect(report.task_id).toBe("task-1");
      expect(report.job_id).toBe("job-1");
      expect(report.phase).toBe("spec");
      expect(report.summary).toBe("Done");
      expect(report.risks).toEqual(["Risk 1"]);
      expect(report.created_at).toBeTruthy();
    });
  });
});
