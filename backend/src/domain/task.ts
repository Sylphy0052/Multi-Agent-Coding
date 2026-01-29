import { ok, err, Result } from "neverthrow";
import { nanoid } from "nanoid";
import type { Task, TaskStatus, Phase } from "@multi-agent/shared";
import { TASK_TRANSITIONS } from "@multi-agent/shared";

// ─── Errors ─────────────────────────────────────────────

export class TaskTransitionError extends Error {
  constructor(
    public readonly from: TaskStatus,
    public readonly to: TaskStatus,
  ) {
    super(`Invalid task transition: ${from} -> ${to}`);
    this.name = "TaskTransitionError";
  }
}

// ─── State Machine ──────────────────────────────────────

export function isValidTaskTransition(
  from: TaskStatus,
  to: TaskStatus,
): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function transitionTask(
  task: Task,
  to: TaskStatus,
): Result<Task, TaskTransitionError> {
  if (!isValidTaskTransition(task.status, to)) {
    return err(new TaskTransitionError(task.status, to));
  }
  return ok({
    ...task,
    status: to,
    updated_at: new Date().toISOString(),
  });
}

// ─── Factory ────────────────────────────────────────────

export interface CreateTaskInput {
  job_id: string;
  assignee: string;
  phase: Phase;
  objective: string;
  inputs?: string[];
  constraints?: string[];
  acceptance_criteria?: string[];
}

export function createTask(input: CreateTaskInput): Task {
  const now = new Date().toISOString();
  return {
    task_id: nanoid(12),
    job_id: input.job_id,
    assignee: input.assignee,
    phase: input.phase,
    objective: input.objective,
    inputs: input.inputs ?? [],
    constraints: input.constraints ?? [],
    acceptance_criteria: input.acceptance_criteria ?? [],
    status: "PENDING",
    created_at: now,
    updated_at: now,
  };
}
