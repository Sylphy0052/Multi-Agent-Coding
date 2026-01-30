import * as fs from "node:fs";
import * as path from "node:path";
import type { FastifyInstance } from "fastify";
import type { AssetStore } from "../assets/store.js";
import type { EventBus } from "../events/bus.js";

export interface AssetsRouteDeps {
  assetStore: AssetStore;
  eventBus: EventBus;
}

export async function registerAssetsRoutes(
  app: FastifyInstance,
  deps: AssetsRouteDeps,
): Promise<void> {
  const { assetStore, eventBus } = deps;

  // POST /api/jobs/:jobId/assets - Upload a screenshot asset (multipart)
  app.post("/api/jobs/:jobId/assets", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    const fileBuffer = Buffer.concat(chunks);

    const allowedMimeTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowedMimeTypes.includes(data.mimetype)) {
      return reply.status(400).send({
        error: `Unsupported mime type: ${data.mimetype}. Allowed: ${allowedMimeTypes.join(", ")}`,
      });
    }

    const asset = await assetStore.saveAsset(
      jobId,
      fileBuffer,
      data.filename,
      data.mimetype,
    );

    eventBus.emit({
      type: "asset:uploaded",
      job_id: jobId,
      asset_id: asset.asset_id,
      asset_type: asset.type,
      timestamp: asset.uploaded_at,
    });

    return reply.status(201).send(asset);
  });

  // GET /api/jobs/:jobId/assets - List all assets for a job
  app.get("/api/jobs/:jobId/assets", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const assets = await assetStore.listAssets(jobId);
    return reply.send(assets);
  });

  // GET /api/jobs/:jobId/assets/:assetId - Get asset metadata
  app.get("/api/jobs/:jobId/assets/:assetId", async (request, reply) => {
    const { jobId, assetId } = request.params as { jobId: string; assetId: string };
    const asset = await assetStore.getAsset(jobId, assetId);
    if (!asset) {
      return reply.status(404).send({ error: "Asset not found" });
    }
    return reply.send(asset);
  });

  // GET /api/jobs/:jobId/assets/:assetId/file - Serve the image file
  app.get("/api/jobs/:jobId/assets/:assetId/file", async (request, reply) => {
    const { jobId, assetId } = request.params as { jobId: string; assetId: string };
    const asset = await assetStore.getAsset(jobId, assetId);
    if (!asset) {
      return reply.status(404).send({ error: "Asset not found" });
    }

    const ext = path.extname(asset.filename) || ".png";
    const filePath = assetStore.getAssetFilePath(jobId, assetId, ext);

    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: "Asset file not found on disk" });
    }

    const stream = fs.createReadStream(filePath);
    return reply
      .type(asset.mime_type)
      .header("Content-Disposition", `inline; filename="${asset.filename}"`)
      .send(stream);
  });

  // GET /api/jobs/:jobId/assets/:assetId/analysis - Get analysis results
  app.get("/api/jobs/:jobId/assets/:assetId/analysis", async (request, reply) => {
    const { jobId, assetId } = request.params as { jobId: string; assetId: string };
    const asset = await assetStore.getAsset(jobId, assetId);
    if (!asset) {
      return reply.status(404).send({ error: "Asset not found" });
    }
    return reply.send(asset.analysis);
  });
}
