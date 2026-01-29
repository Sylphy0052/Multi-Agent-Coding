import type { FastifyInstance } from "fastify";
import { EventBus } from "../events/bus.js";
import type { BusEvent } from "../events/types.js";

export interface EventsRouteDeps {
  eventBus: EventBus;
  /** Auth credentials for query-parameter authentication (SSE). */
  auth?: {
    username: string;
    password: string;
  };
}

export async function registerEventsRoutes(
  app: FastifyInstance,
  deps: EventsRouteDeps,
): Promise<void> {
  const { eventBus, auth } = deps;

  // GET /api/events - SSE endpoint for real-time updates
  // Auth is handled via query parameter `auth` (base64-encoded username:password)
  // because EventSource API does not support custom headers.
  app.get("/api/events", async (request, reply) => {
    const query = request.query as {
      job_id?: string;
      auth?: string;
    };

    // Verify auth via query parameter
    if (auth) {
      const authParam = query.auth;
      if (!authParam) {
        reply.raw.writeHead(401, { "Content-Type": "application/json" });
        reply.raw.end(JSON.stringify({ error: "Missing auth parameter" }));
        reply.hijack();
        return;
      }

      try {
        const decoded = Buffer.from(authParam, "base64").toString("utf-8");
        const [username, password] = decoded.split(":");
        if (username !== auth.username || password !== auth.password) {
          reply.raw.writeHead(401, { "Content-Type": "application/json" });
          reply.raw.end(JSON.stringify({ error: "Unauthorized" }));
          reply.hijack();
          return;
        }
      } catch {
        reply.raw.writeHead(401, { "Content-Type": "application/json" });
        reply.raw.end(JSON.stringify({ error: "Invalid auth parameter" }));
        reply.hijack();
        return;
      }
    }

    const jobIdFilter = query.job_id;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const handler = (event: BusEvent) => {
      if (jobIdFilter && event.job_id !== jobIdFilter) {
        return;
      }
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    eventBus.on("*", handler);

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      reply.raw.write(`:heartbeat\n\n`);
    }, 30000);

    request.raw.on("close", () => {
      eventBus.off("*", handler);
      clearInterval(heartbeat);
    });

    // Don't let Fastify close the connection
    reply.hijack();
  });
}
