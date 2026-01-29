import { describe, it, expect, beforeAll } from "vitest";
import * as path from "node:path";
import { loadPersonaSet } from "../../../src/personas/loader.js";
import type { LoadedPersonaSet } from "../../../src/personas/loader.js";
import {
  buildAiChanPlanningPrompt,
  buildKobitoTaskPrompt,
  buildUiChanSummaryPrompt,
} from "../../../src/personas/prompt-builder.js";

const personasDir = path.resolve(
  import.meta.dirname,
  "../../../../config/personas",
);

describe("PromptBuilder", () => {
  let personas: LoadedPersonaSet;

  beforeAll(() => {
    const result = loadPersonaSet(personasDir, "default");
    if (result.isErr()) throw result.error;
    personas = result.value;
  });

  describe("buildAiChanPlanningPrompt", () => {
    it("should include role and phase", () => {
      const prompt = buildAiChanPlanningPrompt(
        personas,
        "Build a REST API",
        "spec",
        2,
      );
      expect(prompt).toContain("AIちゃん");
      expect(prompt).toContain("spec");
      expect(prompt).toContain("Build a REST API");
      expect(prompt).toContain("2 tasks");
    });

    it("should request JSON array output", () => {
      const prompt = buildAiChanPlanningPrompt(
        personas,
        "Test prompt",
        "impl",
        3,
      );
      expect(prompt).toContain("JSON array");
      expect(prompt).toContain("objective");
    });
  });

  describe("buildKobitoTaskPrompt", () => {
    it("should include objective and phase", () => {
      const prompt = buildKobitoTaskPrompt(personas, {
        phase: "spec",
        objective: "Analyze user requirements",
        inputs: ["user story 1"],
        constraints: ["must be testable"],
        acceptance_criteria: ["all criteria defined"],
        repo_root: "/tmp/repo",
      });
      expect(prompt).toContain("Kobito");
      expect(prompt).toContain("spec");
      expect(prompt).toContain("Analyze user requirements");
      expect(prompt).toContain("user story 1");
      expect(prompt).toContain("must be testable");
      expect(prompt).toContain("all criteria defined");
      expect(prompt).toContain("/tmp/repo");
    });

    it("should omit empty sections", () => {
      const prompt = buildKobitoTaskPrompt(personas, {
        phase: "impl",
        objective: "Generate code",
        inputs: [],
        constraints: [],
        acceptance_criteria: [],
        repo_root: "/tmp/repo",
      });
      expect(prompt).not.toContain("## Inputs");
      expect(prompt).not.toContain("## Constraints");
      expect(prompt).not.toContain("## Acceptance Criteria");
    });
  });

  describe("buildUiChanSummaryPrompt", () => {
    it("should include phase and artifacts", () => {
      const prompt = buildUiChanSummaryPrompt(
        personas,
        {
          phase: "spec",
          changes: ["Added requirements"],
          artifact_paths: ["docs/jobs/j1/spec.md"],
        },
        "AI-chan report content here",
      );
      expect(prompt).toContain("UIちゃん");
      expect(prompt).toContain("spec");
      expect(prompt).toContain("docs/jobs/j1/spec.md");
      expect(prompt).toContain("AI-chan report content here");
    });
  });
});
