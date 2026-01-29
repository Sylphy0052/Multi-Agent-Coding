import type { FastifyInstance } from "fastify";
import fastifyBasicAuth from "@fastify/basic-auth";

export interface AuthConfig {
  username: string;
  password: string;
}

/**
 * Register Basic Auth with optional path exclusions.
 * Excluded paths skip authentication entirely (e.g., health check, SSE).
 */
export async function registerBasicAuth(
  app: FastifyInstance,
  config: AuthConfig,
  excludePaths: string[] = [],
): Promise<void> {
  await app.register(fastifyBasicAuth, {
    validate: async (username, password) => {
      if (username !== config.username || password !== config.password) {
        throw new Error("Unauthorized");
      }
    },
    authenticate: { realm: "Multi-Agent Orchestrator" },
  });

  app.addHook("onRequest", (request, reply, done) => {
    // Skip auth for excluded paths and non-API paths (static files)
    const url = request.url.split("?")[0];
    if (
      excludePaths.some((p) => url === p || url.startsWith(p + "/")) ||
      !url.startsWith("/api/")
    ) {
      done();
      return;
    }
    app.basicAuth(request, reply, done);
  });
}
