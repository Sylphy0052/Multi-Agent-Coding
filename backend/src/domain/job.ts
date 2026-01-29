import { ok, err, Result } from "neverthrow";
import { nanoid } from "nanoid";
import type {
  Job,
  JobStatus,
  CreateJobInput,
  Phase,
} from "@multi-agent/shared";
import {
  JOB_TRANSITIONS,
  ARTIFACT_PATH_TEMPLATE,
} from "@multi-agent/shared";

// ─── Errors ─────────────────────────────────────────────

export class TransitionError extends Error {
  constructor(
    public readonly from: JobStatus,
    public readonly to: JobStatus,
  ) {
    super(`Invalid transition: ${from} -> ${to}`);
    this.name = "TransitionError";
  }
}

// ─── State Machine ──────────────────────────────────────

export function isValidTransition(from: JobStatus, to: JobStatus): boolean {
  const allowed = JOB_TRANSITIONS[from];
  return allowed.includes(to);
}

export function validTransitions(from: JobStatus): readonly JobStatus[] {
  return JOB_TRANSITIONS[from];
}

export function transitionJob(
  job: Job,
  to: JobStatus,
): Result<Job, TransitionError> {
  if (!isValidTransition(job.status, to)) {
    return err(new TransitionError(job.status, to));
  }
  return ok({
    ...job,
    status: to,
    updated_at: new Date().toISOString(),
  });
}

// ─── Factory ────────────────────────────────────────────

function buildArtifactPath(template: string, jobId: string): string {
  return template.replace("{job_id}", jobId);
}

export function createJob(input: CreateJobInput): Job {
  const jobId = nanoid(12);
  const now = new Date().toISOString();

  return {
    job_id: jobId,
    created_at: now,
    updated_at: now,
    status: "RECEIVED",
    user_prompt: input.prompt,
    mode: input.mode ?? "spec_impl_test",
    parallelism: input.parallelism ?? 2,
    persona_set_id: input.persona_set_id ?? "default",
    repo_root: input.repo_root,
    constraints: input.constraints ?? [],
    current_phase: null,
    artifacts: {
      spec_md_path: buildArtifactPath(ARTIFACT_PATH_TEMPLATE.spec, jobId),
      impl_md_path: buildArtifactPath(ARTIFACT_PATH_TEMPLATE.impl, jobId),
      test_md_path: buildArtifactPath(ARTIFACT_PATH_TEMPLATE.test, jobId),
      summary_md_path: buildArtifactPath(
        ARTIFACT_PATH_TEMPLATE.summary,
        jobId,
      ),
    },
    git: {
      main_branch: "main",
      develop_branch: "develop",
      job_branch: `jobs/${jobId}`,
      merge_policy: "merge_commit",
      last_commit_hash: null,
      last_merge_hash: null,
    },
    retry_count: 0,
    last_error: null,
    error_class: null,
  };
}

// ─── Helpers ────────────────────────────────────────────

export function setJobPhase(job: Job, phase: Phase): Job {
  return {
    ...job,
    current_phase: phase,
    updated_at: new Date().toISOString(),
  };
}

export function setJobError(
  job: Job,
  error: string,
  errorClass: "TRANSIENT" | "PERMANENT",
): Job {
  return {
    ...job,
    last_error: error,
    error_class: errorClass,
    retry_count: errorClass === "TRANSIENT" ? job.retry_count + 1 : job.retry_count,
    updated_at: new Date().toISOString(),
  };
}

export function isTerminal(status: JobStatus): boolean {
  return JOB_TRANSITIONS[status].length === 0;
}
