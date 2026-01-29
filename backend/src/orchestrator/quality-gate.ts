import type { Phase, Task, Report } from "@multi-agent/shared";
import { ok, err, Result } from "neverthrow";
import type { IStateStore } from "../store/interface.js";

// ─── Types ──────────────────────────────────────────────

export interface QualityCheckResult {
  passed: boolean;
  phase: Phase;
  totalTasks: number;
  completedTasks: number;
  reportsReceived: number;
  issues: string[];
}

// ─── Quality Gate ───────────────────────────────────────

export class QualityGate {
  constructor(private readonly store: IStateStore) {}

  /**
   * Check whether all tasks in a phase are complete and have reports.
   */
  async check(
    jobId: string,
    phase: Phase,
  ): Promise<Result<QualityCheckResult, Error>> {
    const tasksResult = await this.store.listTasksByJob(jobId);
    if (tasksResult.isErr()) return err(tasksResult.error);

    const reportsResult = await this.store.listReportsByJob(jobId);
    if (reportsResult.isErr()) return err(reportsResult.error);

    const phaseTasks = tasksResult.value.filter((t) => t.phase === phase);
    const phaseReports = reportsResult.value.filter((r) => r.phase === phase);

    const issues: string[] = [];

    // Check all tasks completed
    const completedTasks = phaseTasks.filter(
      (t) => t.status === "COMPLETED",
    );
    const failedTasks = phaseTasks.filter((t) => t.status === "FAILED");

    if (failedTasks.length > 0) {
      issues.push(
        `${failedTasks.length} task(s) failed: ${failedTasks.map((t) => t.task_id).join(", ")}`,
      );
    }

    // Check all completed tasks have reports
    const reportTaskIds = new Set(phaseReports.map((r) => r.task_id));
    const missingReports = completedTasks.filter(
      (t) => !reportTaskIds.has(t.task_id),
    );
    if (missingReports.length > 0) {
      issues.push(
        `Missing reports for task(s): ${missingReports.map((t) => t.task_id).join(", ")}`,
      );
    }

    // All tasks must be in a terminal state (COMPLETED or FAILED)
    const pendingTasks = phaseTasks.filter(
      (t) => t.status !== "COMPLETED" && t.status !== "FAILED" && t.status !== "CANCELED",
    );
    if (pendingTasks.length > 0) {
      issues.push(
        `${pendingTasks.length} task(s) still in progress`,
      );
    }

    const passed =
      issues.length === 0 &&
      completedTasks.length > 0 &&
      completedTasks.length === phaseTasks.length;

    return ok({
      passed,
      phase,
      totalTasks: phaseTasks.length,
      completedTasks: completedTasks.length,
      reportsReceived: phaseReports.length,
      issues,
    });
  }
}
