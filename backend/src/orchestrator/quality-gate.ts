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
  auditorVerdict?: "PASS" | "FAIL";
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

    // Check auditor reports for PASS/FAIL verdict
    const auditorTasks = phaseTasks.filter((t) => t.assignee === "auditor");
    const auditorReports = phaseReports.filter((r) =>
      auditorTasks.some((t) => t.task_id === r.task_id),
    );

    let auditorVerdict: "PASS" | "FAIL" | undefined;
    if (auditorReports.length > 0) {
      const latestAuditorReport = auditorReports[auditorReports.length - 1];

      // Prefer structured gate_verdict field from Report
      if (latestAuditorReport.gate_verdict) {
        auditorVerdict = latestAuditorReport.gate_verdict;
      } else {
        // Fallback: parse summary text for PASS/FAIL
        const summaryText = latestAuditorReport.summary.toUpperCase();
        if (summaryText.includes("FAIL")) {
          auditorVerdict = "FAIL";
        } else if (summaryText.includes("PASS")) {
          auditorVerdict = "PASS";
        }
      }

      if (auditorVerdict === "FAIL") {
        // Extract issues from auditor findings
        for (const finding of latestAuditorReport.findings) {
          issues.push(`Auditor: ${finding.claim} (evidence: ${finding.evidence})`);
        }
        // Include next_actions as fix instructions
        for (const action of latestAuditorReport.next_actions) {
          issues.push(`Fix required: ${action}`);
        }
      }
    }

    const passed =
      issues.length === 0 &&
      completedTasks.length > 0 &&
      completedTasks.length === phaseTasks.length &&
      auditorVerdict !== "FAIL";

    return ok({
      passed,
      phase,
      totalTasks: phaseTasks.length,
      completedTasks: completedTasks.length,
      reportsReceived: phaseReports.length,
      issues,
      auditorVerdict,
    });
  }
}
