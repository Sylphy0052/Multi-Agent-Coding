import type { FastifyInstance } from "fastify";
import {
  PhaseSchema,
  RejectPhaseInputSchema,
} from "@multi-agent/shared";
import type { Phase } from "@multi-agent/shared";
import type { IStateStore } from "../store/interface.js";
import { EventBus } from "../events/bus.js";
import { transitionJob } from "../domain/job.js";
import { createTraceEntry } from "../domain/trace.js";

export interface PhasesRouteDeps {
  store: IStateStore;
  eventBus: EventBus;
}

export async function registerPhasesRoutes(
  app: FastifyInstance,
  deps: PhasesRouteDeps,
): Promise<void> {
  const { store, eventBus } = deps;

  // POST /api/jobs/:id/phases/:phase/approve
  app.post(
    "/api/jobs/:id/phases/:phase/approve",
    async (request, reply) => {
      const { id, phase } = request.params as { id: string; phase: string };

      const phaseResult = PhaseSchema.safeParse(phase);
      if (!phaseResult.success) {
        return reply.status(400).send({
          error: `Invalid phase: ${phase}. Must be spec, impl, or test.`,
        });
      }
      const validPhase: Phase = phaseResult.data;

      const jobResult = await store.getJob(id);
      if (jobResult.isErr()) {
        if (jobResult.error.code === "NOT_FOUND") {
          return reply.status(404).send({ error: "Job not found" });
        }
        return reply.status(500).send({ error: jobResult.error.message });
      }

      const job = jobResult.value;

      if (job.status !== "WAITING_APPROVAL") {
        return reply.status(409).send({
          error: `Job is in ${job.status} state, expected WAITING_APPROVAL`,
        });
      }

      if (job.current_phase !== validPhase) {
        return reply.status(409).send({
          error: `Job is in ${job.current_phase} phase, expected ${validPhase}`,
        });
      }

      const transResult = transitionJob(job, "APPROVED");
      if (transResult.isErr()) {
        return reply.status(409).send({ error: transResult.error.message });
      }

      const updateResult = await store.updateJob(id, {
        status: "APPROVED",
        updated_at: transResult.value.updated_at,
      });
      if (updateResult.isErr()) {
        return reply.status(500).send({ error: updateResult.error.message });
      }

      await store.appendTrace(
        createTraceEntry(
          id,
          "web",
          "APPROVED",
          `Phase ${validPhase} approved by user`,
        ),
      );

      eventBus.emit({
        type: "phase:approved",
        job_id: id,
        phase: validPhase,
        timestamp: new Date().toISOString(),
      });

      return reply.send(updateResult.value);
    },
  );

  // POST /api/jobs/:id/phases/:phase/reject
  app.post(
    "/api/jobs/:id/phases/:phase/reject",
    async (request, reply) => {
      const { id, phase } = request.params as { id: string; phase: string };

      const phaseResult = PhaseSchema.safeParse(phase);
      if (!phaseResult.success) {
        return reply.status(400).send({
          error: `Invalid phase: ${phase}. Must be spec, impl, or test.`,
        });
      }
      const validPhase: Phase = phaseResult.data;

      const bodyResult = RejectPhaseInputSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: "Validation failed",
          details: bodyResult.error.issues,
        });
      }

      const jobResult = await store.getJob(id);
      if (jobResult.isErr()) {
        if (jobResult.error.code === "NOT_FOUND") {
          return reply.status(404).send({ error: "Job not found" });
        }
        return reply.status(500).send({ error: jobResult.error.message });
      }

      const job = jobResult.value;

      if (job.status !== "WAITING_APPROVAL") {
        return reply.status(409).send({
          error: `Job is in ${job.status} state, expected WAITING_APPROVAL`,
        });
      }

      // Rejection transitions back to PLANNING for rework
      const transResult = transitionJob(job, "PLANNING");
      if (transResult.isErr()) {
        return reply.status(409).send({ error: transResult.error.message });
      }

      const updateResult = await store.updateJob(id, {
        status: "PLANNING",
        updated_at: transResult.value.updated_at,
      });
      if (updateResult.isErr()) {
        return reply.status(500).send({ error: updateResult.error.message });
      }

      await store.appendTrace(
        createTraceEntry(
          id,
          "web",
          "REJECTED",
          `Phase ${validPhase} rejected: ${bodyResult.data.reason}`,
        ),
      );

      eventBus.emit({
        type: "phase:rejected",
        job_id: id,
        phase: validPhase,
        reason: bodyResult.data.reason,
        timestamp: new Date().toISOString(),
      });

      return reply.send(updateResult.value);
    },
  );
}
