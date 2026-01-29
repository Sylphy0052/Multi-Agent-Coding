import type { Phase } from "@multi-agent/shared";
import type { PersonaProfile, LoadedPersonaSet } from "./loader.js";

// ─── Types ──────────────────────────────────────────────

export interface TaskContext {
  phase: Phase;
  objective: string;
  inputs: string[];
  constraints: string[];
  acceptance_criteria: string[];
  repo_root: string;
}

export interface SummaryContext {
  phase: Phase;
  changes: string[];
  artifact_paths: string[];
}

// ─── Prompt Builders ────────────────────────────────────

/**
 * Build a system prompt for AI-chan (orchestrator) to decompose tasks.
 */
export function buildAiChanPlanningPrompt(
  personas: LoadedPersonaSet,
  userPrompt: string,
  phase: Phase,
  parallelism: number,
): string {
  const profile = personas.ai_chan;
  return [
    `# Role: ${profile.display_name ?? profile.role}`,
    profile.description,
    "",
    "## Tone & Style",
    profile.tone_style,
    "",
    "## Distribution Policy",
    (profile as Record<string, unknown>).distribution_policy as string ?? "",
    "",
    "## Task",
    `Decompose the following user request into ${parallelism} parallel tasks for the **${phase}** phase.`,
    "",
    "### User Request",
    userPrompt,
    "",
    "### Output Format",
    "Return a JSON array of task objects, each with:",
    '- "objective": string (clear, specific task description)',
    '- "inputs": string[] (references or context needed)',
    '- "constraints": string[] (limitations or rules)',
    '- "acceptance_criteria": string[] (how to verify completion)',
    "",
    `Generate exactly ${parallelism} tasks.`,
  ].join("\n");
}

/**
 * Build a prompt for a Kobito worker to execute a task.
 */
export function buildKobitoTaskPrompt(
  personas: LoadedPersonaSet,
  context: TaskContext,
): string {
  const profile = personas.kobito;
  return [
    `# Role: ${profile.display_name_prefix ?? profile.role}`,
    profile.description,
    "",
    "## Guidelines",
    (profile as Record<string, unknown>).work_guidelines as string ?? "",
    "",
    "## Phase",
    context.phase,
    "",
    "## Objective",
    context.objective,
    "",
    ...(context.inputs.length > 0
      ? ["## Inputs", ...context.inputs.map((i) => `- ${i}`), ""]
      : []),
    ...(context.constraints.length > 0
      ? ["## Constraints", ...context.constraints.map((c) => `- ${c}`), ""]
      : []),
    ...(context.acceptance_criteria.length > 0
      ? [
          "## Acceptance Criteria",
          ...context.acceptance_criteria.map((a) => `- ${a}`),
          "",
        ]
      : []),
    "## Working Directory",
    context.repo_root,
    "",
    "## Report Format",
    (profile as Record<string, unknown>).report_format as string ?? "",
  ].join("\n");
}

/**
 * Build a prompt for UI-chan to summarize phase results for user approval.
 */
export function buildUiChanSummaryPrompt(
  personas: LoadedPersonaSet,
  context: SummaryContext,
  aiChanReport: string,
): string {
  const profile = personas.ui_chan;
  const template = (profile as Record<string, unknown>).summary_template as string ?? "";
  return [
    `# Role: ${profile.display_name ?? profile.role}`,
    profile.description,
    "",
    "## Tone & Style",
    profile.tone_style,
    "",
    "## Task",
    `Summarize the following AI-chan report for user approval of the **${context.phase}** phase.`,
    "",
    "## AI-chan Report",
    aiChanReport,
    "",
    "## Changed Artifacts",
    ...context.artifact_paths.map((p) => `- ${p}`),
    "",
    "## Output Template",
    template,
  ].join("\n");
}
