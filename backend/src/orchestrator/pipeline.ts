import type { Phase } from "@multi-agent/shared";
import type { LoadedPersonaSet } from "../personas/loader.js";

export interface TaskTemplate {
  role: "researcher" | "kobito" | "auditor";
  objective: string;
  inputs: string[];
  constraints: string[];
  acceptance_criteria: string[];
  assignee: string;
}

/**
 * PipelineManager defines the task execution order for each phase,
 * including optional sub-role tasks (Researcher before spec, Auditor at each gate).
 */
export class PipelineManager {
  constructor(private readonly personas: LoadedPersonaSet) {}

  /**
   * Generate task templates for a phase, including sub-role tasks.
   *
   * spec:  [researcher] -> [kobito x N] -> [auditor]
   * impl:  [kobito x N] -> [auditor]
   * test:  [kobito x N] -> [auditor]
   */
  generatePhaseTasks(
    userPrompt: string,
    phase: Phase,
    parallelism: number,
  ): TaskTemplate[] {
    const templates: TaskTemplate[] = [];

    // Researcher runs before spec phase only
    if (phase === "spec" && this.personas.researcher) {
      templates.push({
        role: "researcher",
        objective: `Investigate the codebase and provide implementation analysis for: ${userPrompt}`,
        inputs: [userPrompt],
        constraints: ["Do not make code changes", "Present at least 2 options"],
        acceptance_criteria: [
          "Current architecture analysis provided",
          "At least 2 implementation options compared",
          "Recommendation with rationale given",
          "Impact scope (files/modules) listed",
        ],
        assignee: "researcher",
      });
    }

    // Kobito workers
    for (let i = 1; i <= parallelism; i++) {
      templates.push({
        role: "kobito",
        objective: `${phase} task ${i}/${parallelism}: ${userPrompt}`,
        inputs: [userPrompt],
        constraints: [],
        acceptance_criteria: [],
        assignee: `kobito-${i}`,
      });
    }

    // Auditor runs at every phase gate
    if (this.personas.auditor) {
      templates.push({
        role: "auditor",
        objective: `Quality gate review for ${phase} phase: verify all outputs meet criteria`,
        inputs: [userPrompt, `Phase: ${phase}`],
        constraints: [
          "Must output PASS or FAIL verdict",
          "FAIL must include specific fix instructions",
        ],
        acceptance_criteria: [
          "Gate verdict (PASS/FAIL) provided",
          "All checklist items evaluated",
          "Fix instructions given for any failures",
        ],
        assignee: "auditor",
      });
    }

    return templates;
  }

  /**
   * Check if the personas support sub-roles.
   */
  hasResearcher(): boolean {
    return !!this.personas.researcher;
  }

  hasAuditor(): boolean {
    return !!this.personas.auditor;
  }
}
