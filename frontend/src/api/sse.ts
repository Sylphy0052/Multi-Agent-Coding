export interface SSEEvent {
  type: string;
  job_id: string;
  timestamp: string;
  [key: string]: unknown;
}

export type SSEHandler = (event: SSEEvent) => void;

/**
 * Create an SSE connection to the events endpoint.
 */
export function connectSSE(
  jobId: string | undefined,
  onEvent: SSEHandler,
  onError?: (error: Event) => void,
): () => void {
  const username = localStorage.getItem("auth_username") ?? "admin";
  const password = localStorage.getItem("auth_password") ?? "changeme";

  const params = new URLSearchParams();
  if (jobId) params.set("job_id", jobId);
  params.set("auth", btoa(`${username}:${password}`));

  const url = `/api/events?${params.toString()}`;
  const source = new EventSource(url);

  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as SSEEvent;
      onEvent(data);
    } catch {
      // Ignore malformed events
    }
  };

  source.onerror = (event) => {
    onError?.(event);
  };

  // Return cleanup function
  return () => {
    source.close();
  };
}
