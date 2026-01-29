import * as os from "node:os";
import type { EstimationConfig } from "./schema.js";

export interface SystemResources {
  cpuCores: number;
  freeMemGb: number;
}

export function getSystemResources(): SystemResources {
  return {
    cpuCores: os.cpus().length,
    freeMemGb: os.freemem() / (1024 * 1024 * 1024),
  };
}

/**
 * Estimate the max number of concurrent jobs based on system resources.
 *
 * Formula (from spec NFR 3.0):
 *   mem_reservation = base_gb + (agents_per_job * gb_per_agent) + (max_jobs * gb_per_job_overhead)
 *   effective_mem = max(0, free_mem - mem_reservation)
 *   max_jobs = clamp(1, min(floor(effective_mem / mem_per_job), floor(cpu / min_cpu_per_job)), hard_limit)
 */
export function estimateMaxJobs(
  resources: SystemResources,
  config: EstimationConfig,
  defaultParallelism: number,
  hardLimit: number,
): number {
  const agentsPerJob = 1 + defaultParallelism; // AI-chan + N Kobito
  const memReservation =
    config.base_gb +
    agentsPerJob * config.gb_per_agent +
    1 * config.gb_per_job_overhead;

  const effectiveMemGb = Math.max(0, resources.freeMemGb - memReservation);
  const memBased = Math.floor(effectiveMemGb / config.mem_per_job_gb);
  const cpuBased = Math.floor(resources.cpuCores / config.min_cpu_per_job);

  return Math.max(1, Math.min(memBased, cpuBased, hardLimit));
}
