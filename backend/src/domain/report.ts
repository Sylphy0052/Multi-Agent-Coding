import type { Report, Phase, Finding, ArtifactUpdate } from "@multi-agent/shared";

// ─── Factory ────────────────────────────────────────────

export interface CreateReportInput {
  task_id: string;
  job_id: string;
  phase: Phase;
  summary: string;
  findings?: Finding[];
  risks?: string[];
  contradictions?: string[];
  next_actions?: string[];
  artifact_updates?: ArtifactUpdate[];
}

export function createReport(input: CreateReportInput): Report {
  return {
    task_id: input.task_id,
    job_id: input.job_id,
    phase: input.phase,
    summary: input.summary,
    findings: input.findings ?? [],
    risks: input.risks ?? [],
    contradictions: input.contradictions ?? [],
    next_actions: input.next_actions ?? [],
    artifact_updates: input.artifact_updates ?? [],
    created_at: new Date().toISOString(),
  };
}
