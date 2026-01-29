import type { FastifyInstance } from "fastify";
import { CreateJobInputSchema } from "@multi-agent/shared";
import type { JobStatus } from "@multi-agent/shared";
import type { IStateStore, JobFilter } from "../store/interface.js";
import { EventBus } from "../events/bus.js";
import { createJob, transitionJob } from "../domain/job.js";
import { createTraceEntry } from "../domain/trace.js";

export interface JobsRouteDeps {
  store: IStateStore;
  eventBus: EventBus;
}

export async function registerJobsRoutes(
  app: FastifyInstance,
  deps: JobsRouteDeps,
): Promise<void> {
  const { store, eventBus } = deps;

  // POST /api/jobs - Create a new job
  app.post("/api/jobs", async (request, reply) => {
    const parseResult = CreateJobInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parseResult.error.issues,
      });
    }

    const job = createJob(parseResult.data);
    const storeResult = await store.createJob(job);
    if (storeResult.isErr()) {
      return reply.status(500).send({ error: storeResult.error.message });
    }

    // Append initial trace
    await store.appendTrace(
      createTraceEntry(
        job.job_id,
        "web",
        "RECEIVED",
        `Job created: ${job.user_prompt.slice(0, 100)}`,
      ),
    );

    eventBus.emit({
      type: "job:created",
      job_id: job.job_id,
      timestamp: job.created_at,
    });

    return reply.status(201).send(job);
  });

  // GET /api/jobs - List all jobs
  app.get("/api/jobs", async (request, reply) => {
    const query = request.query as { status?: string; limit?: string; offset?: string };
    const filter: JobFilter = {};

    if (query.status) {
      filter.status = query.status as JobStatus;
    }
    if (query.limit) {
      filter.limit = parseInt(query.limit, 10);
    }
    if (query.offset) {
      filter.offset = parseInt(query.offset, 10);
    }

    const result = await store.listJobs(filter);
    if (result.isErr()) {
      return reply.status(500).send({ error: result.error.message });
    }

    return reply.send(result.value);
  });

  // GET /api/jobs/:id - Get job details
  app.get("/api/jobs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const jobResult = await store.getJob(id);
    if (jobResult.isErr()) {
      if (jobResult.error.code === "NOT_FOUND") {
        return reply.status(404).send({ error: "Job not found" });
      }
      return reply.status(500).send({ error: jobResult.error.message });
    }

    const tasksResult = await store.listTasksByJob(id);
    const tracesResult = await store.getTraces(id);

    return reply.send({
      ...jobResult.value,
      tasks: tasksResult.isOk() ? tasksResult.value : [],
      traces: tracesResult.isOk() ? tracesResult.value : [],
    });
  });

  // GET /api/jobs/:id/dashboard - Full dashboard view (job + tasks + reports + traces)
  app.get("/api/jobs/:id/dashboard", async (request, reply) => {
    const { id } = request.params as { id: string };
    const jobResult = await store.getJob(id);
    if (jobResult.isErr()) {
      if (jobResult.error.code === "NOT_FOUND") {
        return reply.status(404).send({ error: "Job not found" });
      }
      return reply.status(500).send({ error: jobResult.error.message });
    }

    const tasksResult = await store.listTasksByJob(id);
    const reportsResult = await store.listReportsByJob(id);
    const tracesResult = await store.getTraces(id);

    const tasks = tasksResult.isOk() ? tasksResult.value : [];
    const reports = reportsResult.isOk() ? reportsResult.value : [];

    // Aggregate risks and contradictions from all reports
    const allRisks = reports.flatMap((r) => r.risks);
    const allContradictions = reports.flatMap((r) => r.contradictions);
    const allNextActions = reports.flatMap((r) => r.next_actions);

    return reply.send({
      ...jobResult.value,
      tasks,
      reports,
      traces: tracesResult.isOk() ? tracesResult.value : [],
      aggregated: {
        risks: allRisks,
        contradictions: allContradictions,
        next_actions: allNextActions,
      },
    });
  });

  // POST /api/jobs/:id/cancel - Cancel a job
  app.post("/api/jobs/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const jobResult = await store.getJob(id);
    if (jobResult.isErr()) {
      if (jobResult.error.code === "NOT_FOUND") {
        return reply.status(404).send({ error: "Job not found" });
      }
      return reply.status(500).send({ error: jobResult.error.message });
    }

    const transResult = transitionJob(jobResult.value, "CANCELED");
    if (transResult.isErr()) {
      return reply.status(409).send({
        error: `Cannot cancel job in ${jobResult.value.status} state`,
      });
    }

    const updateResult = await store.updateJob(id, {
      status: "CANCELED",
      updated_at: transResult.value.updated_at,
    });
    if (updateResult.isErr()) {
      return reply.status(500).send({ error: updateResult.error.message });
    }

    await store.appendTrace(
      createTraceEntry(id, "web", "FAILED", "Job canceled by user"),
    );

    eventBus.emit({
      type: "job:status_changed",
      job_id: id,
      from: jobResult.value.status,
      to: "CANCELED",
      timestamp: new Date().toISOString(),
    });

    return reply.send(updateResult.value);
  });
}
