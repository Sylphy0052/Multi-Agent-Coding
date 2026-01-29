import * as fs from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { registerBasicAuth } from "./auth/basic-auth.js";
import { registerJobsRoutes } from "./routes/jobs.js";
import { registerPhasesRoutes } from "./routes/phases.js";
import { registerEventsRoutes } from "./routes/events.js";
import { EventBus } from "./events/bus.js";
import type { IStateStore } from "./store/interface.js";

export interface AppConfig {
  auth?: {
    username: string;
    password: string;
  };
  cors?: boolean;
  /** Absolute path to frontend dist directory for static file serving. */
  staticDir?: string;
}

export interface AppDeps {
  store: IStateStore;
  eventBus?: EventBus;
}

export async function buildApp(
  config: AppConfig,
  deps: AppDeps,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: "info",
    },
  });

  // CORS (development)
  if (config.cors !== false) {
    await app.register(cors, { origin: true });
  }

  // Basic Auth (skip for health check, SSE, and static files)
  if (config.auth) {
    await registerBasicAuth(app, config.auth, [
      "/api/health",
      "/api/events",
    ]);
  }

  const eventBus = deps.eventBus ?? new EventBus();

  // Routes
  await registerJobsRoutes(app, { store: deps.store, eventBus });
  await registerPhasesRoutes(app, { store: deps.store, eventBus });
  await registerEventsRoutes(app, {
    eventBus,
    auth: config.auth,
  });

  // Health check (no auth)
  app.get("/api/health", async () => ({ status: "ok" }));

  // Static file serving (frontend)
  if (config.staticDir && fs.existsSync(config.staticDir)) {
    await app.register(fastifyStatic, {
      root: config.staticDir,
      prefix: "/",
      wildcard: false,
    });

    // SPA fallback: serve index.html for non-API routes
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.status(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
