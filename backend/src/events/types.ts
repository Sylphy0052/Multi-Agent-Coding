import type { JobStatus, Phase, TaskStatus } from "@multi-agent/shared";

export type EventType =
  | "job:created"
  | "job:status_changed"
  | "job:completed"
  | "job:failed"
  | "task:created"
  | "task:status_changed"
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
  | PhaseAwaitingApprovalEvent
  | PhaseApprovedEvent
  | PhaseRejectedEvent
  | TraceAppendedEvent;
