import type { FastifyInstance } from "fastify";
import { ProposeMemoryUpdateSchema } from "@multi-agent/shared";
import type { EventBus } from "../events/bus.js";
import type { MemoryProvider } from "../memory/provider.js";

export interface MemoryRouteDeps {
  memoryProvider: MemoryProvider;
  eventBus: EventBus;
}

export async function registerMemoryRoutes(
  app: FastifyInstance,
  deps: MemoryRouteDeps,
): Promise<void> {
  const { memoryProvider, eventBus } = deps;

  // GET /api/memory - List all entries
  app.get("/api/memory", async (_request, reply) => {
    try {
      const entries = await memoryProvider.listAllEntries();
      return reply.send(entries);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      return reply.status(500).send({ error: message });
    }
  });

  // GET /api/memory/pending - List pending updates
  app.get("/api/memory/pending", async (_request, reply) => {
    try {
      const pending = await memoryProvider.listPendingUpdates();
      return reply.send(pending);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      return reply.status(500).send({ error: message });
    }
  });

  // POST /api/memory/propose - Propose new update
  app.post("/api/memory/propose", async (request, reply) => {
    const parseResult = ProposeMemoryUpdateSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parseResult.error.issues,
      });
    }

    try {
      const update = await memoryProvider.proposeUpdate(parseResult.data);
      return reply.status(201).send(update);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      return reply.status(500).send({ error: message });
    }
  });

  // POST /api/memory/:id/approve - Approve a pending update
  app.post("/api/memory/:id/approve", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await memoryProvider.approveUpdate(id);

      eventBus.emit({
        type: "memory:updated",
        job_id: "",
        timestamp: new Date().toISOString(),
        updates: [{ type: "approved", title: id }],
      });

      return reply.send({ status: "approved", id });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      if (message.includes("not found")) {
        return reply.status(404).send({ error: message });
      }
      return reply.status(500).send({ error: message });
    }
  });

  // POST /api/memory/:id/reject - Reject a pending update
  app.post("/api/memory/:id/reject", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await memoryProvider.rejectUpdate(id);
      return reply.send({ status: "rejected", id });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      if (message.includes("not found")) {
        return reply.status(404).send({ error: message });
      }
      return reply.status(500).send({ error: message });
    }
  });
}
