import { ok, err, Result } from "neverthrow";
import type { Report, Phase, Finding, ArtifactUpdate } from "@multi-agent/shared";

// ─── Types ──────────────────────────────────────────────

export interface ParsedClaudeOutput {
  summary: string;
  findings: Finding[];
  risks: string[];
  contradictions: string[];
  next_actions: string[];
  artifact_updates: ArtifactUpdate[];
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

// ─── Parser ─────────────────────────────────────────────

/**
 * Parse Claude CLI JSON output into a structured report.
 * Handles both direct JSON output and JSON wrapped in markdown code blocks.
 */
export function parseClaudeOutput(
  raw: string,
): Result<ParsedClaudeOutput, ParseError> {
  if (!raw || raw.trim().length === 0) {
    return err(new ParseError("Empty output"));
  }

  let jsonStr = raw.trim();

  // Try to extract JSON from markdown code block
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // Try to find JSON object in the output
  const jsonStart = jsonStr.indexOf("{");
  const jsonEnd = jsonStr.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    jsonStr = jsonStr.slice(jsonStart, jsonEnd + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    return ok({
      summary: asString(parsed.summary, "No summary provided"),
      findings: asFindings(parsed.findings),
      risks: asStringArray(parsed.risks),
      contradictions: asStringArray(parsed.contradictions),
      next_actions: asStringArray(parsed.next_actions),
      artifact_updates: asArtifactUpdates(parsed.artifact_updates),
    });
  } catch (e) {
    return err(new ParseError(`Failed to parse JSON: ${String(e)}`));
  }
}

/**
 * Convert parsed output to a Report entity.
 */
export function toReport(
  parsed: ParsedClaudeOutput,
  taskId: string,
  jobId: string,
  phase: Phase,
): Report {
  return {
    task_id: taskId,
    job_id: jobId,
    phase,
    summary: parsed.summary,
    findings: parsed.findings,
    risks: parsed.risks,
    contradictions: parsed.contradictions,
    next_actions: parsed.next_actions,
    artifact_updates: parsed.artifact_updates,
    created_at: new Date().toISOString(),
  };
}

// ─── Helpers ────────────────────────────────────────────

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function asFindings(value: unknown): Finding[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (v): v is Record<string, unknown> =>
        typeof v === "object" && v !== null,
    )
    .map((v) => ({
      claim: asString(v.claim, ""),
      evidence: asString(v.evidence, ""),
      confidence: typeof v.confidence === "number" ? v.confidence : 0.5,
    }));
}

function asArtifactUpdates(value: unknown): ArtifactUpdate[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (v): v is Record<string, unknown> =>
        typeof v === "object" && v !== null,
    )
    .map((v) => ({
      path: asString(v.path, ""),
      change_summary: asString(v.change_summary, ""),
    }));
}
