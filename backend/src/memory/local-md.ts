import * as fs from "node:fs/promises";
import * as path from "node:path";
import { nanoid } from "nanoid";
import type { MemoryUpdate, MemoryType } from "@multi-agent/shared";
import type { MemoryContextInput, MemoryProvider } from "./provider.js";

// ─── Constants ──────────────────────────────────────────

const MAX_CONTEXT_CHARS = 6000;

const TYPE_TO_FILE: Record<MemoryType, string> = {
  decision: "decisions.md",
  convention: "conventions.md",
  known_issue: "known_issues.md",
  glossary: "glossary.md",
};

const TYPE_PREFIX: Record<MemoryType, string> = {
  decision: "DEC",
  convention: "CON",
  known_issue: "ISS",
  glossary: "GLO",
};

// ─── LocalMdMemoryProvider ──────────────────────────────

export class LocalMdMemoryProvider implements MemoryProvider {
  private readonly memoryDir: string;
  private readonly pendingDir: string;
  private readonly approvedDir: string;
  private readonly rejectedDir: string;

  constructor(memoryDir: string) {
    this.memoryDir = memoryDir;
    this.pendingDir = path.join(memoryDir, "pending");
    this.approvedDir = path.join(memoryDir, "approved");
    this.rejectedDir = path.join(memoryDir, "rejected");
  }

  /**
   * Ensure all necessary directories exist.
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.memoryDir, { recursive: true });
    await fs.mkdir(this.pendingDir, { recursive: true });
    await fs.mkdir(this.approvedDir, { recursive: true });
    await fs.mkdir(this.rejectedDir, { recursive: true });
  }

  /**
   * Read all .md files, filter by keywords + recency, format with citation IDs.
   * Output is capped at MAX_CONTEXT_CHARS (~1500 tokens).
   */
  async getContext(input: MemoryContextInput): Promise<string> {
    await this.initialize();

    const sections: string[] = [];

    for (const [type, filename] of Object.entries(TYPE_TO_FILE)) {
      const filePath = path.join(this.memoryDir, filename);
      let content: string;
      try {
        content = await fs.readFile(filePath, "utf-8");
      } catch {
        continue;
      }

      if (content.trim().length === 0) continue;

      // Parse entries and filter by keywords if provided
      const entries = this.parseEntries(content);
      const filtered =
        input.keywords.length > 0
          ? entries.filter((e) => this.matchesKeywords(e, input.keywords))
          : entries;

      if (filtered.length === 0) continue;

      // Sort by recency (newest first based on citation ID date)
      filtered.sort((a, b) => b.citationId.localeCompare(a.citationId));

      sections.push(
        `### ${this.typeLabel(type as MemoryType)}`,
        ...filtered.map((e) => `- [${e.citationId}] ${e.title}: ${e.body}`),
      );
    }

    if (sections.length === 0) {
      return "(no memory entries)";
    }

    const result = sections.join("\n");
    if (result.length > MAX_CONTEXT_CHARS) {
      return (
        result.slice(0, MAX_CONTEXT_CHARS - 40) +
        "\n\n<!-- Memory context truncated -->"
      );
    }
    return result;
  }

  /**
   * Apply approved updates by appending them to the appropriate .md files.
   */
  async applyUpdates(updates: MemoryUpdate[]): Promise<void> {
    await this.initialize();

    for (const update of updates) {
      const filename = TYPE_TO_FILE[update.type];
      const filePath = path.join(this.memoryDir, filename);
      const entry = this.formatEntry(update);
      await fs.appendFile(filePath, entry, "utf-8");
    }
  }

  /**
   * Propose a new memory update. Writes to pending/{id}.json.
   */
  async proposeUpdate(
    update: Omit<MemoryUpdate, "id" | "status" | "proposed_at">,
  ): Promise<MemoryUpdate> {
    await this.initialize();

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const seq = await this.getNextSequence(update.type, dateStr);
    const citationId = `${TYPE_PREFIX[update.type]}-${dateStr}-${String(seq).padStart(2, "0")}`;

    const full: MemoryUpdate = {
      ...update,
      id: citationId,
      status: "proposed",
      proposed_at: now.toISOString(),
    };

    const pendingPath = path.join(this.pendingDir, `${citationId}.json`);
    await fs.writeFile(pendingPath, JSON.stringify(full, null, 2), "utf-8");

    return full;
  }

  /**
   * List all pending updates.
   */
  async listPendingUpdates(): Promise<MemoryUpdate[]> {
    await this.initialize();
    return this.readUpdatesFromDir(this.pendingDir);
  }

  /**
   * List all entries (pending + approved + rejected).
   */
  async listAllEntries(): Promise<MemoryUpdate[]> {
    await this.initialize();

    const [pending, approved, rejected] = await Promise.all([
      this.readUpdatesFromDir(this.pendingDir),
      this.readUpdatesFromDir(this.approvedDir),
      this.readUpdatesFromDir(this.rejectedDir),
    ]);

    return [...pending, ...approved, ...rejected];
  }

  /**
   * Approve a pending update: append to .md, move JSON to approved/.
   */
  async approveUpdate(id: string): Promise<void> {
    const pendingPath = path.join(this.pendingDir, `${id}.json`);
    const update = await this.readUpdateFile(pendingPath);
    if (!update) {
      throw new Error(`Pending update not found: ${id}`);
    }

    // Update status
    update.status = "approved";

    // Append to the appropriate .md file
    const filename = TYPE_TO_FILE[update.type];
    const filePath = path.join(this.memoryDir, filename);
    const entry = this.formatEntry(update);
    await fs.appendFile(filePath, entry, "utf-8");

    // Move to approved/
    const approvedPath = path.join(this.approvedDir, `${id}.json`);
    await fs.writeFile(approvedPath, JSON.stringify(update, null, 2), "utf-8");
    await fs.unlink(pendingPath);
  }

  /**
   * Reject a pending update: move JSON to rejected/.
   */
  async rejectUpdate(id: string): Promise<void> {
    const pendingPath = path.join(this.pendingDir, `${id}.json`);
    const update = await this.readUpdateFile(pendingPath);
    if (!update) {
      throw new Error(`Pending update not found: ${id}`);
    }

    // Update status
    update.status = "rejected";

    // Move to rejected/
    const rejectedPath = path.join(this.rejectedDir, `${id}.json`);
    await fs.writeFile(
      rejectedPath,
      JSON.stringify(update, null, 2),
      "utf-8",
    );
    await fs.unlink(pendingPath);
  }

  // ─── Internal helpers ─────────────────────────────────

  private formatEntry(update: MemoryUpdate): string {
    return [
      "",
      `## [${update.id}] ${update.title}`,
      "",
      `**Category:** ${update.category}`,
      `**Confidence:** ${update.confidence}`,
      `**Proposed by:** ${update.proposed_by}`,
      `**Sources:** ${update.sources.join(", ") || "(none)"}`,
      `**Keywords:** ${update.keywords.join(", ") || "(none)"}`,
      "",
      update.body,
      "",
      `> Rationale: ${update.rationale}`,
      "",
    ].join("\n");
  }

  private parseEntries(
    content: string,
  ): Array<{ citationId: string; title: string; body: string; raw: string }> {
    const entries: Array<{
      citationId: string;
      title: string;
      body: string;
      raw: string;
    }> = [];

    // Split by ## [ID] headers
    const pattern = /^## \[([A-Z]{3}-\d{4}-\d{2}-\d{2}-\d{2})\] (.+)$/gm;
    let match: RegExpExecArray | null;
    const positions: Array<{
      citationId: string;
      title: string;
      start: number;
    }> = [];

    while ((match = pattern.exec(content)) !== null) {
      positions.push({
        citationId: match[1],
        title: match[2],
        start: match.index,
      });
    }

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const end =
        i + 1 < positions.length ? positions[i + 1].start : content.length;
      const raw = content.slice(pos.start, end).trim();
      // Extract body (everything after the header line)
      const bodyStart = raw.indexOf("\n");
      const body = bodyStart >= 0 ? raw.slice(bodyStart).trim() : "";

      entries.push({
        citationId: pos.citationId,
        title: pos.title,
        body,
        raw,
      });
    }

    return entries;
  }

  private matchesKeywords(
    entry: { citationId: string; title: string; body: string; raw: string },
    keywords: string[],
  ): boolean {
    const text = `${entry.title} ${entry.body}`.toLowerCase();
    return keywords.some((kw) => text.includes(kw.toLowerCase()));
  }

  private typeLabel(type: MemoryType): string {
    switch (type) {
      case "decision":
        return "Decisions";
      case "convention":
        return "Conventions";
      case "known_issue":
        return "Known Issues";
      case "glossary":
        return "Glossary";
    }
  }

  private async readUpdatesFromDir(dir: string): Promise<MemoryUpdate[]> {
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      return [];
    }

    const updates: MemoryUpdate[] = [];
    for (const file of files.filter((f) => f.endsWith(".json"))) {
      const update = await this.readUpdateFile(path.join(dir, file));
      if (update) updates.push(update);
    }
    return updates;
  }

  private async readUpdateFile(
    filePath: string,
  ): Promise<MemoryUpdate | null> {
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw) as MemoryUpdate;
    } catch {
      return null;
    }
  }

  private async getNextSequence(
    type: MemoryType,
    dateStr: string,
  ): Promise<number> {
    const prefix = TYPE_PREFIX[type];
    const pattern = `${prefix}-${dateStr}-`;

    // Check across all directories for existing IDs with this prefix+date
    const dirs = [this.pendingDir, this.approvedDir, this.rejectedDir];
    let maxSeq = 0;

    for (const dir of dirs) {
      let files: string[];
      try {
        files = await fs.readdir(dir);
      } catch {
        continue;
      }

      for (const file of files) {
        if (file.startsWith(pattern)) {
          const seqStr = file.replace(pattern, "").replace(".json", "");
          const seq = parseInt(seqStr, 10);
          if (!isNaN(seq) && seq > maxSeq) {
            maxSeq = seq;
          }
        }
      }
    }

    return maxSeq + 1;
  }
}
