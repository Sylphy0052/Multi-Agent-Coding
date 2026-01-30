import { z } from "zod";

// ─── Phase & Status Schemas ─────────────────────────────

export const PhaseSchema = z.enum(["spec", "impl", "test"]);

export const JobStatusSchema = z.enum([
  "RECEIVED",
  "PLANNING",
  "DISPATCHED",
  "RUNNING",
  "AGGREGATING",
  "WAITING_APPROVAL",
  "APPROVED",
  "COMMITTING",
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "QUEUED",
  "WAITING_RETRY",
]);

export const TaskStatusSchema = z.enum([
  "PENDING",
  "ASSIGNED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELED",
]);

// ─── API Input Schemas ──────────────────────────────────

export const CreateJobInputSchema = z.object({
  repo_root: z
    .string()
    .min(1, "repo_root is required")
    .refine((p) => p.startsWith("/"), "repo_root must be an absolute path"),
  prompt: z.string().min(1, "prompt is required"),
  mode: z.literal("spec_impl_test").default("spec_impl_test"),
  parallelism: z.number().int().min(1).max(10).default(2),
  persona_set_id: z.string().default("default"),
  constraints: z.array(z.string()).default([]),
});

export const PhaseParamSchema = z.object({
  phase: PhaseSchema,
});

export const RejectPhaseInputSchema = z.object({
  reason: z.string().min(1, "rejection reason is required"),
});

// ─── Job Schema ─────────────────────────────────────────

export const JobArtifactsSchema = z.object({
  spec_md_path: z.string(),
  impl_md_path: z.string(),
  test_md_path: z.string(),
  summary_md_path: z.string(),
});

export const JobGitSchema = z.object({
  main_branch: z.string(),
  develop_branch: z.string(),
  job_branch: z.string(),
  merge_policy: z.literal("merge_commit"),
  last_commit_hash: z.string().nullable(),
  last_merge_hash: z.string().nullable(),
});

export const JobSchema = z.object({
  job_id: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  status: JobStatusSchema,
  user_prompt: z.string(),
  mode: z.literal("spec_impl_test"),
  parallelism: z.number(),
  persona_set_id: z.string(),
  repo_root: z.string(),
  constraints: z.array(z.string()),
  current_phase: PhaseSchema.nullable(),
  artifacts: JobArtifactsSchema,
  git: JobGitSchema,
  retry_count: z.number(),
  last_error: z.string().nullable(),
  error_class: z.enum(["TRANSIENT", "PERMANENT"]).nullable(),
});

// ─── Task Schema ────────────────────────────────────────

export const TaskSchema = z.object({
  task_id: z.string(),
  job_id: z.string(),
  assignee: z.string(),
  phase: PhaseSchema,
  objective: z.string(),
  inputs: z.array(z.string()),
  constraints: z.array(z.string()),
  acceptance_criteria: z.array(z.string()),
  status: TaskStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

// ─── Report Schema ──────────────────────────────────────

export const FindingSchema = z.object({
  claim: z.string(),
  evidence: z.string(),
  confidence: z.number().min(0).max(1),
});

export const ArtifactUpdateSchema = z.object({
  path: z.string(),
  change_summary: z.string(),
});

export const SkillCandidateSchema = z.object({
  found: z.boolean(),
  description: z.string(),
  reason: z.string(),
  when_to_use: z.string().optional(),
  steps: z.array(z.string()).optional(),
  output_contract: z.array(z.string()).optional(),
  pitfalls: z.array(z.string()).optional(),
});

export const GateVerdictSchema = z.enum(["PASS", "FAIL"]);

export const ReportSchema = z.object({
  task_id: z.string(),
  job_id: z.string(),
  phase: PhaseSchema,
  summary: z.string(),
  findings: z.array(FindingSchema),
  risks: z.array(z.string()),
  contradictions: z.array(z.string()),
  next_actions: z.array(z.string()),
  artifact_updates: z.array(ArtifactUpdateSchema),
  skill_candidate: SkillCandidateSchema.nullable(),
  gate_verdict: GateVerdictSchema.optional(),
  memory_updates: z.array(z.lazy(() => MemoryUpdateSchema)).optional(),
  created_at: z.string(),
});

// ─── Memory Schemas ────────────────────────────────────────

export const MemoryTypeSchema = z.enum([
  "decision",
  "convention",
  "known_issue",
  "glossary",
]);

export const MemoryCategorySchema = z.enum(["hard", "soft"]);

export const MemoryUpdateSchema = z.object({
  id: z.string(),
  type: MemoryTypeSchema,
  category: MemoryCategorySchema,
  title: z.string().min(1),
  body: z.string().min(1),
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
  sources: z.array(z.string()),
  keywords: z.array(z.string()),
  proposed_by: z.string(),
  proposed_at: z.string(),
  status: z.enum(["proposed", "audited", "approved", "rejected"]),
  review_due: z.string().optional(),
});

export const ProposeMemoryUpdateSchema = MemoryUpdateSchema.omit({
  id: true,
  status: true,
  proposed_at: true,
});

// ─── Asset Schemas ─────────────────────────────────────────

export const UIFindingSchema = z.object({
  severity: z.enum(["high", "med", "low"]),
  title: z.string(),
  detail: z.string(),
  evidence: z.string(),
});

export const AssetAnalysisSchema = z.object({
  status: z.enum(["pending", "done", "error"]),
  ocr_text: z.string(),
  summary: z.string(),
  ui_findings: z.array(UIFindingSchema),
  analyzed_at: z.string().optional(),
});

export const AssetSchema = z.object({
  asset_id: z.string(),
  job_id: z.string(),
  type: z.literal("screenshot"),
  filename: z.string(),
  mime_type: z.string(),
  uploaded_at: z.string(),
  tags: z.array(z.string()),
  analysis: AssetAnalysisSchema,
});

// ─── Gate Schemas ──────────────────────────────────────────

export const GateResultSchema = z.object({
  phase: PhaseSchema,
  verdict: GateVerdictSchema,
  issues: z.array(z.string()),
  fix_instructions: z.array(z.string()),
  test_requirements: z.array(z.string()),
  memory_update_proposals: z.array(MemoryUpdateSchema),
});

// ─── Trace Schema ───────────────────────────────────────

export const TraceActorSchema = z.union([
  z.enum(["web", "ui-chan", "ai-chan", "system", "git", "researcher", "auditor"]),
  z.string().regex(/^kobito-\d+$/),
]);

export const TraceEventTypeSchema = z.enum([
  "RECEIVED",
  "DELEGATED",
  "DISPATCHED",
  "STARTED",
  "REPORTED",
  "AGGREGATED",
  "COMMITTED",
  "COMPLETED",
  "FAILED",
  "APPROVED",
  "REJECTED",
  "QUEUED",
  "RETRY",
  "GATE_PASS",
  "GATE_FAIL",
  "MEMORY_UPDATED",
  "ASSET_ANALYZED",
]);

export const TraceRefsSchema = z.object({
  task_id: z.string().optional(),
  artifact_path: z.string().optional(),
  tmux_session: z.string().optional(),
  pane: z.string().optional(),
  commit_hash: z.string().optional(),
});

export const TraceEntrySchema = z.object({
  timestamp: z.string(),
  job_id: z.string(),
  actor: TraceActorSchema,
  event_type: TraceEventTypeSchema,
  payload_summary: z.string(),
  refs: TraceRefsSchema,
});
