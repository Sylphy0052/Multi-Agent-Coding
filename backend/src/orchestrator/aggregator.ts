import type { Report, Phase } from "@multi-agent/shared";
import { ok, err, Result } from "neverthrow";
import type { IStateStore } from "../store/interface.js";

// ─── Types ──────────────────────────────────────────────

export interface AggregationResult {
  phase: Phase;
  combinedSummary: string;
  allFindings: Report["findings"];
  allRisks: string[];
  contradictions: string[];
  nextActions: string[];
  reportCount: number;
}

// ─── Aggregator ─────────────────────────────────────────

export class Aggregator {
  constructor(private readonly store: IStateStore) {}

  /**
   * Collect and aggregate all reports for a job phase.
   */
  async aggregate(
    jobId: string,
    phase: Phase,
  ): Promise<Result<AggregationResult, Error>> {
    const reportsResult = await this.store.listReportsByJob(jobId);
    if (reportsResult.isErr()) return err(reportsResult.error);

    const phaseReports = reportsResult.value.filter((r) => r.phase === phase);

    if (phaseReports.length === 0) {
      return err(new Error(`No reports found for job ${jobId} phase ${phase}`));
    }

    const combinedSummary = phaseReports
      .map((r, i) => `[Report ${i + 1}] ${r.summary}`)
      .join("\n\n");

    const allFindings = phaseReports.flatMap((r) => r.findings);
    const allRisks = [...new Set(phaseReports.flatMap((r) => r.risks))];
    const nextActions = [...new Set(phaseReports.flatMap((r) => r.next_actions))];

    // Detect contradictions across reports
    const contradictions = this.detectContradictions(phaseReports);

    return ok({
      phase,
      combinedSummary,
      allFindings,
      allRisks,
      contradictions,
      nextActions,
      reportCount: phaseReports.length,
    });
  }

  /**
   * Basic contradiction detection across reports.
   * Compares findings and looks for conflicting claims.
   */
  private detectContradictions(reports: Report[]): string[] {
    const contradictions: string[] = [];

    // Collect contradictions already flagged by individual reports
    for (const report of reports) {
      contradictions.push(...report.contradictions);
    }

    // Cross-report comparison: look for low-confidence findings
    // that conflict with high-confidence ones
    const allFindings = reports.flatMap((r) =>
      r.findings.map((f) => ({ ...f, reportTaskId: r.task_id })),
    );

    for (let i = 0; i < allFindings.length; i++) {
      for (let j = i + 1; j < allFindings.length; j++) {
        const a = allFindings[i];
        const b = allFindings[j];

        // Skip findings from the same report
        if (a.reportTaskId === b.reportTaskId) continue;

        // Flag if one has very high confidence and the other very low
        // on similar claims (simple heuristic: overlapping keywords)
        if (
          Math.abs(a.confidence - b.confidence) > 0.5 &&
          this.claimsSimilar(a.claim, b.claim)
        ) {
          contradictions.push(
            `Confidence conflict: "${a.claim}" (${a.confidence}) vs "${b.claim}" (${b.confidence})`,
          );
        }
      }
    }

    return contradictions;
  }

  /**
   * Simple heuristic: check if two claims share significant keywords.
   */
  private claimsSimilar(a: string, b: string): boolean {
    const wordsA = new Set(
      a.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
    );
    const wordsB = new Set(
      b.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
    );

    let overlap = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) overlap++;
    }

    const minSize = Math.min(wordsA.size, wordsB.size);
    return minSize > 0 && overlap / minSize > 0.5;
  }
}
