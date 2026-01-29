import * as path from "node:path";
import { buildApp } from "./app.js";
import { createStore } from "./store/index.js";
import { EventBus } from "./events/bus.js";
import { loadConfig } from "./config/index.js";
import { loadPersonaSet } from "./personas/loader.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";

async function main(): Promise<void> {
  // ─── Load Configuration ───────────────────────────────
  const config = loadConfig();
  console.log(
    `[config] max_jobs=${String(config.orchestrator.max_jobs)}, model=${config.claude.model}`,
  );

  // ─── Initialize Store ─────────────────────────────────
  const store = createStore(config.orchestrator.state_dir);
  const initResult = await store.initialize();
  if (initResult.isErr()) {
    console.error("Failed to initialize store:", initResult.error.message);
    process.exit(1);
  }

  // ─── Load Personas ────────────────────────────────────
  const personaDir = path.resolve(config.personas.directory);
  const personaResult = loadPersonaSet(personaDir, config.personas.active_set);
  if (personaResult.isErr()) {
    console.error("Failed to load personas:", personaResult.error.message);
    process.exit(1);
  }
  const personas = personaResult.value;
  console.log(`[personas] loaded set "${config.personas.active_set}"`);

  // ─── Event Bus ────────────────────────────────────────
  const eventBus = new EventBus();

  // ─── Build App ────────────────────────────────────────
  const app = await buildApp(
    {
      auth: {
        username: config.auth.username,
        password: config.auth.password,
      },
      cors: true,
      staticDir: path.resolve("frontend/dist"),
    },
    { store, eventBus },
  );

  // ─── Start Orchestrator ───────────────────────────────
  const maxJobs =
    typeof config.orchestrator.max_jobs === "number"
      ? config.orchestrator.max_jobs
      : 2;

  const orchestrator = new Orchestrator(
    {
      scheduler: { maxJobs },
      planner: {
        model: config.claude.model,
        skipPermissions: config.claude.skip_permissions,
      },
      retry: {
        maxRetries: config.retry.max_retries,
        backoffSequence: config.retry.backoff_sequence,
        backoffCap: config.retry.backoff_cap,
      },
      git: {
        repoRoot: ".", // Will be overridden per-job by repo_root
        mainBranch: config.git.main_branch,
        developBranch: config.git.develop_branch,
      },
      tmpDir: config.orchestrator.tmp_dir,
      pollIntervalMs: 3000,
    },
    store,
    eventBus,
    personas,
  );

  orchestrator.start();
  console.log("[orchestrator] started");

  // ─── Start Server ─────────────────────────────────────
  await app.listen({
    port: config.server.port,
    host: config.server.host,
  });
  console.log(
    `Orchestrator API listening on http://${config.server.host}:${config.server.port}`,
  );

  // ─── Graceful Shutdown ────────────────────────────────
  const shutdown = async () => {
    console.log("Shutting down...");
    orchestrator.stop();
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
