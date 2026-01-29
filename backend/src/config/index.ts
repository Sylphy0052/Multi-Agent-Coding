import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import { AppConfigSchema } from "./schema.js";
import type { AppConfig } from "./schema.js";
import { estimateMaxJobs, getSystemResources } from "./estimator.js";

/**
 * Deep merge two objects. Source values override target values.
 * Arrays are replaced, not merged.
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (
      srcVal !== null &&
      srcVal !== undefined &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      typeof tgtVal === "object" &&
      tgtVal !== null &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else if (srcVal !== undefined) {
      result[key] = srcVal;
    }
  }
  return result;
}

/**
 * Parse env vars with ORCHESTRATOR_ prefix into nested config.
 * Example: ORCHESTRATOR_SERVER_PORT=8080 -> { server: { port: 8080 } }
 */
function parseEnvOverrides(): Record<string, unknown> {
  const prefix = "ORCHESTRATOR_";
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix) || value === undefined) continue;

    const parts = key
      .slice(prefix.length)
      .toLowerCase()
      .split("_");

    if (parts.length < 2) continue;

    const section = parts[0];
    const field = parts.slice(1).join("_");

    if (!result[section]) {
      result[section] = {};
    }

    // Try to parse as number or boolean
    let parsed: unknown = value;
    if (value === "true") parsed = true;
    else if (value === "false") parsed = false;
    else if (/^\d+$/.test(value)) parsed = parseInt(value, 10);
    else if (/^\d+\.\d+$/.test(value)) parsed = parseFloat(value);

    (result[section] as Record<string, unknown>)[field] = parsed;
  }

  return result;
}

/**
 * Load configuration from YAML file, environment variables, and defaults.
 * Priority: env vars > YAML file > schema defaults
 */
export function loadConfig(configPath?: string): AppConfig {
  let fileConfig: Record<string, unknown> = {};

  // Load YAML config file
  const resolvedPath = configPath ?? "config/default.yaml";
  if (fs.existsSync(resolvedPath)) {
    const content = fs.readFileSync(resolvedPath, "utf-8");
    fileConfig = (yaml.load(content) as Record<string, unknown>) ?? {};
  }

  // Parse env var overrides
  const envConfig = parseEnvOverrides();

  // Merge: file <- env
  const merged = deepMerge(fileConfig, envConfig);

  // Validate and apply defaults via Zod
  const config = AppConfigSchema.parse(merged);

  // Resolve max_jobs if "auto"
  if (config.orchestrator.max_jobs === "auto") {
    const resources = getSystemResources();
    const estimated = estimateMaxJobs(
      resources,
      config.estimation,
      config.orchestrator.default_parallelism,
      config.orchestrator.max_jobs_hard_limit,
    );
    config.orchestrator.max_jobs = estimated;
  }

  return config;
}

export type { AppConfig } from "./schema.js";
