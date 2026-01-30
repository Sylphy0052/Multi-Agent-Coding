import type { EventBus } from "../../events/bus.js";
import type { AssetStore } from "../store.js";
import type { ContextManager } from "../../context/context-manager.js";
import { extractText } from "./ocr.js";
import { extractFindings, generateSummary } from "./findings-extractor.js";
import type { AssetAnalysis } from "@multi-agent/shared";
import * as path from "node:path";

export class AnalysisPipeline {
  constructor(
    private readonly assetStore: AssetStore,
    private readonly contextManager: ContextManager,
    private readonly eventBus: EventBus,
    private readonly stateDir: string,
  ) {}

  registerListeners(): void {
    this.eventBus.on("asset:uploaded", (event) => {
      if (event.type !== "asset:uploaded") return;
      this.analyze(event.job_id, event.asset_id).catch((e) => {
        console.error(`[AnalysisPipeline] Error analyzing asset ${event.asset_id}:`, e);
      });
    });
  }

  async analyze(jobId: string, assetId: string): Promise<void> {
    const asset = await this.assetStore.getAsset(jobId, assetId);
    if (!asset) return;

    const ext = path.extname(asset.filename) || ".png";
    const imagePath = this.assetStore.getAssetFilePath(jobId, assetId, ext);

    let ocrText = "";
    let analysis: AssetAnalysis;

    try {
      ocrText = await extractText(imagePath);
      const findings = extractFindings(ocrText);
      const summary = generateSummary(ocrText, findings);

      analysis = {
        status: "done",
        ocr_text: ocrText,
        summary,
        ui_findings: findings,
        analyzed_at: new Date().toISOString(),
      };
    } catch (e) {
      analysis = {
        status: "error",
        ocr_text: "",
        summary: `Analysis failed: ${String(e)}`,
        ui_findings: [],
        analyzed_at: new Date().toISOString(),
      };
    }

    await this.assetStore.updateAnalysis(jobId, assetId, analysis);

    // Update context with screenshot findings
    if (analysis.status === "done") {
      const findingsText = analysis.ui_findings.length > 0
        ? analysis.ui_findings.map((f) =>
            `- [${f.severity.toUpperCase()}] ${f.title}: ${f.detail}`
          ).join("\n")
        : `- No error patterns detected. OCR: ${analysis.ocr_text.slice(0, 200)}`;

      await this.contextManager.updateSection(
        jobId,
        "screenshots",
        `### Asset ${assetId}\n- OCR: ${analysis.ocr_text.slice(0, 500)}\n- Findings:\n${findingsText}`,
        `asset.analyzed#${assetId}`,
      );
    }

    this.eventBus.emit({
      type: "asset:analyzed",
      job_id: jobId,
      asset_id: assetId,
      ocr_text: ocrText.slice(0, 1000),
      summary: analysis.summary,
      timestamp: new Date().toISOString(),
    });
  }
}
