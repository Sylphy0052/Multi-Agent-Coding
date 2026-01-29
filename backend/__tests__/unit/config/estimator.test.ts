import { describe, it, expect } from "vitest";
import { estimateMaxJobs } from "../../../src/config/estimator.js";

const defaultEstConfig = {
  base_gb: 2,
  gb_per_agent: 0.8,
  gb_per_job_overhead: 1.0,
  mem_per_job_gb: 6,
  min_cpu_per_job: 4,
};

describe("estimateMaxJobs", () => {
  it("should return 1 for minimal resources", () => {
    const result = estimateMaxJobs(
      { cpuCores: 2, freeMemGb: 4 },
      defaultEstConfig,
      2, // parallelism
      4, // hard limit
    );
    expect(result).toBe(1);
  });

  it("should be CPU-limited when memory is abundant", () => {
    const result = estimateMaxJobs(
      { cpuCores: 8, freeMemGb: 100 },
      defaultEstConfig,
      2,
      4,
    );
    // cpu: floor(8/4)=2, mem: large, hard_limit: 4 -> min(mem, 2, 4) = 2
    expect(result).toBe(2);
  });

  it("should be memory-limited when CPUs are abundant", () => {
    const result = estimateMaxJobs(
      { cpuCores: 64, freeMemGb: 16 },
      defaultEstConfig,
      2,
      4,
    );
    // mem_reservation = 2 + 3*0.8 + 1.0 = 5.4
    // effective = 16 - 5.4 = 10.6
    // mem_based = floor(10.6 / 6) = 1
    // cpu_based = floor(64/4) = 16
    // min(1, 16, 4) = 1
    expect(result).toBe(1);
  });

  it("should respect hard limit", () => {
    const result = estimateMaxJobs(
      { cpuCores: 128, freeMemGb: 256 },
      defaultEstConfig,
      2,
      4,
    );
    expect(result).toBeLessThanOrEqual(4);
  });

  it("should never return less than 1", () => {
    const result = estimateMaxJobs(
      { cpuCores: 1, freeMemGb: 0.5 },
      defaultEstConfig,
      2,
      4,
    );
    expect(result).toBe(1);
  });

  it("should account for higher parallelism", () => {
    const lowParallelism = estimateMaxJobs(
      { cpuCores: 16, freeMemGb: 32 },
      defaultEstConfig,
      1,
      10,
    );
    const highParallelism = estimateMaxJobs(
      { cpuCores: 16, freeMemGb: 32 },
      defaultEstConfig,
      5,
      10,
    );
    // Higher parallelism = more memory reservation = fewer jobs (or equal)
    expect(highParallelism).toBeLessThanOrEqual(lowParallelism);
  });
});
