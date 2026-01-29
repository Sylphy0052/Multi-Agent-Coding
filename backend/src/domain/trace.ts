import type {
  TraceEntry,
  TraceActor,
  TraceEventType,
  TraceRefs,
} from "@multi-agent/shared";

// ─── Factory ────────────────────────────────────────────

export function createTraceEntry(
  jobId: string,
  actor: TraceActor,
  eventType: TraceEventType,
  payloadSummary: string,
  refs?: TraceRefs,
): TraceEntry {
  return {
    timestamp: new Date().toISOString(),
    job_id: jobId,
    actor,
    event_type: eventType,
    payload_summary: payloadSummary,
    refs: refs ?? {},
  };
}
