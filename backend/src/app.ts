import * as fs from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { registerBasicAuth } from "./auth/basic-auth.js";
import { registerJobsRoutes } from "./routes/jobs.js";
import { registerPhasesRoutes } from "./routes/phases.js";
import { registerEventsRoutes } from "./routes/events.js";
import { registerAssetsRoutes } from "./routes/assets.js";
import { registerMemoryRoutes } from "./routes/memory.js";
import { registerSkillsRoutes } from "./routes/skills.js";
import { EventBus } from "./events/bus.js";
import type { IStateStore } from "./store/interface.js";
import type { AssetStore } from "./assets/store.js";
import type { MemoryProvider } from "./memory/provider.js";
import type { SkillsRegistry } from "./skills/registry.js";

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
  assetStore?: AssetStore;
  memoryProvider?: MemoryProvider;
  skillsRegistry?: SkillsRegistry;
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

  // Multipart (file upload support)
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  });

  const eventBus = deps.eventBus ?? new EventBus();

  // Routes
  await registerJobsRoutes(app, { store: deps.store, eventBus });
  await registerPhasesRoutes(app, { store: deps.store, eventBus });
  await registerEventsRoutes(app, {
    eventBus,
    auth: config.auth,
  });

  // New routes (assets, memory, skills)
  if (deps.assetStore) {
    await registerAssetsRoutes(app, {
      assetStore: deps.assetStore,
      eventBus,
    });
  }
  if (deps.memoryProvider) {
    await registerMemoryRoutes(app, {
      memoryProvider: deps.memoryProvider,
      eventBus,
    });
  }
  if (deps.skillsRegistry) {
    await registerSkillsRoutes(app, {
      skillsRegistry: deps.skillsRegistry,
    });
  }

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
