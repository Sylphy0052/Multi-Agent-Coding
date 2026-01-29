import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { connectSSE, type SSEEvent } from "../api/sse";

/**
 * Hook to subscribe to SSE events and auto-refresh query data.
 */
export function useSSE(jobId?: string) {
  const queryClient = useQueryClient();
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const cleanup = connectSSE(
      jobId,
      (event: SSEEvent) => {
        // Invalidate relevant queries based on event type
        if (event.type.startsWith("job:")) {
          void queryClient.invalidateQueries({
            queryKey: ["jobs"],
          });
          void queryClient.invalidateQueries({
            queryKey: ["job", event.job_id],
          });
        }
        if (event.type.startsWith("phase:")) {
          void queryClient.invalidateQueries({
            queryKey: ["job", event.job_id],
          });
        }
        if (event.type.startsWith("task:")) {
          void queryClient.invalidateQueries({
            queryKey: ["job", event.job_id],
          });
        }
      },
      () => {
        // SSE reconnection is handled by the browser automatically
      },
    );

    cleanupRef.current = cleanup;

    return () => {
      cleanup();
    };
  }, [jobId, queryClient]);
}
