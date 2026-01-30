import * as fs from "node:fs/promises";
import * as path from "node:path";
import { nanoid } from "nanoid";
import type { Asset, AssetAnalysis } from "@multi-agent/shared";

export class AssetStore {
  constructor(private readonly stateDir: string) {}

  async saveAsset(
    jobId: string,
    fileBuffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<Asset> {
    const assetId = nanoid(12);
    const ext = path.extname(filename) || ".png";
    const assetsDir = this.getAssetsDir(jobId);
    await fs.mkdir(assetsDir, { recursive: true });

    // Save the file
    const filePath = path.join(assetsDir, `${assetId}${ext}`);
    await fs.writeFile(filePath, fileBuffer);

    // Create metadata
    const asset: Asset = {
      asset_id: assetId,
      job_id: jobId,
      type: "screenshot",
      filename,
      mime_type: mimeType,
      uploaded_at: new Date().toISOString(),
      tags: [],
      analysis: {
        status: "pending",
        ocr_text: "",
        summary: "",
        ui_findings: [],
      },
    };

    // Save metadata
    const metaPath = path.join(assetsDir, `${assetId}.json`);
    await fs.writeFile(metaPath, JSON.stringify(asset, null, 2), "utf-8");

    return asset;
  }

  async getAsset(jobId: string, assetId: string): Promise<Asset | null> {
    const metaPath = path.join(this.getAssetsDir(jobId), `${assetId}.json`);
    try {
      const content = await fs.readFile(metaPath, "utf-8");
      return JSON.parse(content) as Asset;
    } catch {
      return null;
    }
  }

  async listAssets(jobId: string): Promise<Asset[]> {
    const assetsDir = this.getAssetsDir(jobId);
    let entries: string[];
    try {
      entries = await fs.readdir(assetsDir);
    } catch {
      return [];
    }

    const assets: Asset[] = [];
    for (const entry of entries) {
      if (entry.endsWith(".json")) {
        try {
          const content = await fs.readFile(path.join(assetsDir, entry), "utf-8");
          assets.push(JSON.parse(content) as Asset);
        } catch {
          // Skip invalid files
        }
      }
    }
    return assets.sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
  }

  async updateAnalysis(
    jobId: string,
    assetId: string,
    analysis: AssetAnalysis,
  ): Promise<void> {
    const asset = await this.getAsset(jobId, assetId);
    if (!asset) return;
    asset.analysis = analysis;
    const metaPath = path.join(this.getAssetsDir(jobId), `${assetId}.json`);
    await fs.writeFile(metaPath, JSON.stringify(asset, null, 2), "utf-8");
  }

  getAssetFilePath(jobId: string, assetId: string, ext: string): string {
    return path.join(this.getAssetsDir(jobId), `${assetId}${ext}`);
  }

  private getAssetsDir(jobId: string): string {
    return path.join(this.stateDir, "jobs", jobId, "assets");
  }
}
