import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { FileStore } from "../../src/store/file-store.js";
import { EventBus } from "../../src/events/bus.js";
import type { Job } from "@multi-agent/shared";

describe("API Integration Tests", () => {
  let app: FastifyInstance;
  let tmpDir: string;
  let eventBus: EventBus;
  const authHeader =
    "Basic " + Buffer.from("admin:changeme").toString("base64");

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-test-"));
    const store = new FileStore(tmpDir);
    await store.initialize();
    eventBus = new EventBus();

    app = await buildApp(
      { auth: { username: "admin", password: "changeme" } },
      { store, eventBus },
    );
  });

  afterAll(async () => {
    await app.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Auth ────────────────────────────────────────────

  describe("Authentication", () => {
    it("should reject requests without auth", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/jobs",
      });
      expect(response.statusCode).toBe(401);
    });

    it("should reject requests with wrong credentials", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/jobs",
        headers: {
          authorization:
            "Basic " + Buffer.from("wrong:creds").toString("base64"),
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it("should accept requests with correct credentials", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/jobs",
        headers: { authorization: authHeader },
      });
      expect(response.statusCode).toBe(200);
    });
  });

  // ── Health ──────────────────────────────────────────

  describe("GET /api/health", () => {
    it("should return health status (requires auth)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/health",
        headers: { authorization: authHeader },
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ status: "ok" });
    });
  });

  // ── POST /api/jobs ──────────────────────────────────

  describe("POST /api/jobs", () => {
    it("should create a job and return 201", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/jobs",
        headers: { authorization: authHeader },
        payload: {
          repo_root: "/tmp/test-repo",
          prompt: "Build a TODO app",
          parallelism: 2,
        },
      });
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.job_id).toBeTruthy();
      expect(body.status).toBe("RECEIVED");
      expect(body.user_prompt).toBe("Build a TODO app");
      expect(body.parallelism).toBe(2);
      expect(body.artifacts.spec_md_path).toContain(body.job_id);
    });

    it("should reject missing repo_root", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/jobs",
        headers: { authorization: authHeader },
        payload: { prompt: "Build something" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("should reject non-absolute repo_root", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/jobs",
        headers: { authorization: authHeader },
        payload: { repo_root: "relative/path", prompt: "Build something" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("should reject empty prompt", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/jobs",
        headers: { authorization: authHeader },
        payload: { repo_root: "/tmp/repo", prompt: "" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("should apply defaults for optional fields", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/jobs",
        headers: { authorization: authHeader },
        payload: {
          repo_root: "/tmp/test-repo",
          prompt: "Build something",
        },
      });
      const body = JSON.parse(response.body);
      expect(body.parallelism).toBe(2);
      expect(body.mode).toBe("spec_impl_test");
      expect(body.persona_set_id).toBe("default");
    });
  });

  // ── GET /api/jobs ───────────────────────────────────

  describe("GET /api/jobs", () => {
    it("should list created jobs", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/jobs",
        headers: { authorization: authHeader },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
    });
  });

  // ── GET /api/jobs/:id ───────────────────────────────

  describe("GET /api/jobs/:id", () => {
    it("should return job details with tasks and traces", async () => {
      // Create a job first
      const createResponse = await app.inject({
        method: "POST",
        url: "/api/jobs",
        headers: { authorization: authHeader },
        payload: {
          repo_root: "/tmp/detail-repo",
          prompt: "Detail test",
        },
      });
      const created = JSON.parse(createResponse.body);

      const response = await app.inject({
        method: "GET",
        url: `/api/jobs/${created.job_id}`,
        headers: { authorization: authHeader },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.job_id).toBe(created.job_id);
      expect(body.tasks).toBeDefined();
      expect(body.traces).toBeDefined();
      expect(Array.isArray(body.traces)).toBe(true);
      // Should have the initial RECEIVED trace
      expect(body.traces.length).toBeGreaterThanOrEqual(1);
      expect(body.traces[0].event_type).toBe("RECEIVED");
    });

    it("should return 404 for nonexistent job", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/jobs/nonexistent-id",
        headers: { authorization: authHeader },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // ── POST /api/jobs/:id/cancel ───────────────────────

  describe("POST /api/jobs/:id/cancel", () => {
    it("should cancel a RECEIVED job", async () => {
      const createResponse = await app.inject({
        method: "POST",
        url: "/api/jobs",
        headers: { authorization: authHeader },
        payload: {
          repo_root: "/tmp/cancel-repo",
          prompt: "Cancel test",
        },
      });
      const created = JSON.parse(createResponse.body) as Job;

      const response = await app.inject({
        method: "POST",
        url: `/api/jobs/${created.job_id}/cancel`,
        headers: { authorization: authHeader },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe("CANCELED");
    });

    it("should return 404 for nonexistent job", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/jobs/nonexistent/cancel",
        headers: { authorization: authHeader },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // ── Phase Approval/Rejection ────────────────────────

  describe("Phase approve/reject", () => {
    async function createJobInWaitingApproval(
      phase: string,
    ): Promise<string> {
      // Create job
      const createResponse = await app.inject({
        method: "POST",
        url: "/api/jobs",
        headers: { authorization: authHeader },
        payload: {
          repo_root: "/tmp/approval-repo",
          prompt: "Approval test",
        },
      });
      const created = JSON.parse(createResponse.body) as Job;

      // Manually set job to WAITING_APPROVAL with specified phase
      // (In production, the orchestrator does this)
      const store = new FileStore(tmpDir);
      await store.updateJob(created.job_id, {
        status: "WAITING_APPROVAL",
        current_phase: phase as "spec" | "impl" | "test",
      });

      return created.job_id;
    }

    it("should approve a phase", async () => {
      const jobId = await createJobInWaitingApproval("spec");

      const response = await app.inject({
        method: "POST",
        url: `/api/jobs/${jobId}/phases/spec/approve`,
        headers: { authorization: authHeader },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe("APPROVED");
    });

    it("should reject a phase with reason", async () => {
      const jobId = await createJobInWaitingApproval("impl");

      const response = await app.inject({
        method: "POST",
        url: `/api/jobs/${jobId}/phases/impl/reject`,
        headers: { authorization: authHeader },
        payload: { reason: "Missing error handling" },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe("PLANNING");
    });

    it("should reject approval for wrong phase", async () => {
      const jobId = await createJobInWaitingApproval("spec");

      const response = await app.inject({
        method: "POST",
        url: `/api/jobs/${jobId}/phases/impl/approve`,
        headers: { authorization: authHeader },
      });
      expect(response.statusCode).toBe(409);
    });

    it("should reject approval for non-WAITING_APPROVAL job", async () => {
      const createResponse = await app.inject({
        method: "POST",
        url: "/api/jobs",
        headers: { authorization: authHeader },
        payload: {
          repo_root: "/tmp/wrong-state-repo",
          prompt: "Wrong state",
        },
      });
      const created = JSON.parse(createResponse.body) as Job;

      const response = await app.inject({
        method: "POST",
        url: `/api/jobs/${created.job_id}/phases/spec/approve`,
        headers: { authorization: authHeader },
      });
      expect(response.statusCode).toBe(409);
    });

    it("should reject invalid phase name", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/jobs/some-id/phases/invalid/approve",
        headers: { authorization: authHeader },
      });
      expect(response.statusCode).toBe(400);
    });

    it("should require rejection reason", async () => {
      const jobId = await createJobInWaitingApproval("spec");

      const response = await app.inject({
        method: "POST",
        url: `/api/jobs/${jobId}/phases/spec/reject`,
        headers: { authorization: authHeader },
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });
  });

  // ── Events ──────────────────────────────────────────

  describe("EventBus", () => {
    it("should emit events on job creation", async () => {
      const events: unknown[] = [];
      eventBus.on("job:created", (e) => events.push(e));

      await app.inject({
        method: "POST",
        url: "/api/jobs",
        headers: { authorization: authHeader },
        payload: {
          repo_root: "/tmp/event-repo",
          prompt: "Event test",
        },
      });

      expect(events.length).toBe(1);
    });

    it("should emit events on job cancel", async () => {
      const events: unknown[] = [];
      eventBus.on("job:status_changed", (e) => events.push(e));

      const createResponse = await app.inject({
        method: "POST",
        url: "/api/jobs",
        headers: { authorization: authHeader },
        payload: {
          repo_root: "/tmp/cancel-event-repo",
          prompt: "Cancel event test",
        },
      });
      const created = JSON.parse(createResponse.body) as Job;

      await app.inject({
        method: "POST",
        url: `/api/jobs/${created.job_id}/cancel`,
        headers: { authorization: authHeader },
      });

      expect(events.length).toBeGreaterThanOrEqual(1);
    });
  });
});
