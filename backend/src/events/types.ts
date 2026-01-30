import type { JobStatus, Phase, TaskStatus } from "@multi-agent/shared";

export type EventType =
  | "job:created"
  | "job:status_changed"
  | "job:completed"
  | "job:failed"
  | "task:created"
  | "task:status_changed"
  | "task:started"
  | "task:done"
  | "task:error"
  | "asset:uploaded"
  | "asset:analyzed"
  | "memory:updated"
  | "skill:updated"
  | "phase:awaiting_approval"
  | "phase:approved"
  | "phase:rejected"
  | "trace:appended";

export interface BaseEvent {
  type: EventType;
  job_id: string;
  timestamp: string;
}

export interface JobCreatedEvent extends BaseEvent {
  type: "job:created";
}

export interface JobStatusChangedEvent extends BaseEvent {
  type: "job:status_changed";
  from: JobStatus;
  to: JobStatus;
}

export interface JobCompletedEvent extends BaseEvent {
  type: "job:completed";
}

export interface JobFailedEvent extends BaseEvent {
  type: "job:failed";
  error: string;
}

export interface TaskCreatedEvent extends BaseEvent {
  type: "task:created";
  task_id: string;
  assignee: string;
}

export interface TaskStatusChangedEvent extends BaseEvent {
  type: "task:status_changed";
  task_id: string;
  from: TaskStatus;
  to: TaskStatus;
}

export interface TaskStartedEvent extends BaseEvent {
  type: "task:started";
  task_id: string;
  phase: Phase;
  role: string;
}

export interface TaskDoneEvent extends BaseEvent {
  type: "task:done";
  task_id: string;
  phase: Phase;
  role: string;
  artifacts: string[];
}

export interface TaskErrorEvent extends BaseEvent {
  type: "task:error";
  task_id: string;
  error: string;
  stderr_tail?: string;
}

export interface AssetUploadedEvent extends BaseEvent {
  type: "asset:uploaded";
  asset_id: string;
  asset_type: string;
}

export interface AssetAnalyzedEvent extends BaseEvent {
  type: "asset:analyzed";
  asset_id: string;
  ocr_text: string;
  summary: string;
}

export interface MemoryUpdatedEvent extends BaseEvent {
  type: "memory:updated";
  updates: Array<{ type: string; title: string }>;
}

export interface SkillUpdatedEvent extends BaseEvent {
  type: "skill:updated";
  skill_id: string;
  version: string;
}

export interface PhaseAwaitingApprovalEvent extends BaseEvent {
  type: "phase:awaiting_approval";
  phase: Phase;
  diff_summary: string;
}

export interface PhaseApprovedEvent extends BaseEvent {
  type: "phase:approved";
  phase: Phase;
}

export interface PhaseRejectedEvent extends BaseEvent {
  type: "phase:rejected";
  phase: Phase;
  reason: string;
}

export interface TraceAppendedEvent extends BaseEvent {
  type: "trace:appended";
  event_type: string;
  actor: string;
  payload_summary: string;
}

export type BusEvent =
  | JobCreatedEvent
  | JobStatusChangedEvent
  | JobCompletedEvent
  | JobFailedEvent
  | TaskCreatedEvent
  | TaskStatusChangedEvent
  | TaskStartedEvent
  | TaskDoneEvent
  | TaskErrorEvent
  | AssetUploadedEvent
  | AssetAnalyzedEvent
  | MemoryUpdatedEvent
  | SkillUpdatedEvent
  | PhaseAwaitingApprovalEvent
  | PhaseApprovedEvent
  | PhaseRejectedEvent
  | TraceAppendedEvent;
