/**
 * Core domain types for the Multi-Agent Coding Orchestration System.
 * Mirrors spec.md sections 4.1-4.4.
 */

// ─── Phase ──────────────────────────────────────────────

export type Phase = "spec" | "impl" | "test";

export const PHASES: readonly Phase[] = ["spec", "impl", "test"] as const;

// ─── Job ────────────────────────────────────────────────

export type JobStatus =
  | "RECEIVED"
  | "PLANNING"
  | "DISPATCHED"
  | "RUNNING"
  | "AGGREGATING"
  | "WAITING_APPROVAL"
  | "APPROVED"
  | "COMMITTING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED"
  | "QUEUED"
  | "WAITING_RETRY";

export interface JobArtifacts {
  spec_md_path: string;
  impl_md_path: string;
  test_md_path: string;
  summary_md_path: string;
}

export interface JobGit {
  main_branch: string;
  develop_branch: string;
  job_branch: string;
  merge_policy: "merge_commit";
  last_commit_hash: string | null;
  last_merge_hash: string | null;
}

export interface Job {
  job_id: string;
  created_at: string;
  updated_at: string;
  status: JobStatus;
  user_prompt: string;
  mode: "spec_impl_test";
  parallelism: number;
  persona_set_id: string;
  repo_root: string;
  current_phase: Phase | null;
  artifacts: JobArtifacts;
  git: JobGit;
  constraints: string[];
  retry_count: number;
  last_error: string | null;
  error_class: "TRANSIENT" | "PERMANENT" | null;
}

// ─── Task ───────────────────────────────────────────────

export type TaskStatus =
  | "PENDING"
  | "ASSIGNED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED";

export interface Task {
  task_id: string;
  job_id: string;
  assignee: string;
  phase: Phase;
  objective: string;
  inputs: string[];
  constraints: string[];
  acceptance_criteria: string[];
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

// ─── Report ─────────────────────────────────────────────

export interface Finding {
  claim: string;
  evidence: string;
  confidence: number;
}

export interface ArtifactUpdate {
  path: string;
  change_summary: string;
}

export interface SkillCandidate {
  found: boolean;
  description: string;
  reason: string;
}

export interface Report {
  task_id: string;
  job_id: string;
  phase: Phase;
  summary: string;
  findings: Finding[];
  risks: string[];
  contradictions: string[];
  next_actions: string[];
  artifact_updates: ArtifactUpdate[];
  skill_candidate: SkillCandidate | null;
  created_at: string;
}

// ─── Trace ──────────────────────────────────────────────

export type TraceActor =
  | "web"
  | "ui-chan"
  | "ai-chan"
  | "system"
  | "git"
  | `kobito-${number}`;

export type TraceEventType =
  | "RECEIVED"
  | "DELEGATED"
  | "DISPATCHED"
  | "STARTED"
  | "REPORTED"
  | "AGGREGATED"
  | "COMMITTED"
  | "COMPLETED"
  | "FAILED"
  | "APPROVED"
  | "REJECTED"
  | "QUEUED"
  | "RETRY";

export interface TraceRefs {
  task_id?: string;
  artifact_path?: string;
  tmux_session?: string;
  pane?: string;
  commit_hash?: string;
}

export interface TraceEntry {
  timestamp: string;
  job_id: string;
  actor: TraceActor;
  event_type: TraceEventType;
  payload_summary: string;
  refs: TraceRefs;
}

// ─── API Input/Output ───────────────────────────────────

export interface CreateJobInput {
  repo_root: string;
  prompt: string;
  mode?: "spec_impl_test";
  parallelism?: number;
  persona_set_id?: string;
  constraints?: string[];
}

export interface JobSummary {
  job_id: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  current_phase: Phase | null;
  user_prompt: string;
}

export interface PhaseApproval {
  job_id: string;
  phase: Phase;
  approved_at: string;
  diff_summary: string;
}

export interface PhaseRejection {
  job_id: string;
  phase: Phase;
  rejected_at: string;
  reason: string;
}
