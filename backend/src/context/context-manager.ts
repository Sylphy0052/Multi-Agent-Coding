import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Job, Phase } from "@multi-agent/shared";

export type ContextSection =
  | "goal"
  | "repo"
  | "memory"
  | "screenshots"
  | "skills"
  | "open_questions";

export class ContextManager {
  constructor(
    private readonly stateDir: string,
    private readonly templatePath: string,
  ) {}

  /**
   * Generate the initial context.md for a job from template + job data.
   */
  async generateInitialContext(job: Job): Promise<string> {
    let template: string;
    try {
      template = await fs.readFile(this.templatePath, "utf-8");
    } catch {
      // Fallback if template file doesn't exist
      template = this.getDefaultTemplate();
    }

    const context = template
      .replace("{{goal}}", job.user_prompt)
      .replace("{{success_criteria}}", job.constraints.length > 0
        ? job.constraints.map(c => `- ${c}`).join("\n")
        : "- (To be defined by spec phase)")
      .replace("{{constraints}}", [
        "- WSL2, tmux, Claude Code CLI",
        ...job.constraints.map(c => `- ${c}`),
      ].join("\n"))
      .replace("{{repo_snapshot}}", [
        `- Root: ${job.repo_root}`,
        `- Branch: ${job.git.job_branch}`,
        `- Mode: ${job.mode}`,
        `- Parallelism: ${job.parallelism}`,
      ].join("\n"))
      .replace("{{memory_decisions}}", "(none yet)")
      .replace("{{memory_conventions}}", "(none yet)")
      .replace("{{memory_known_issues}}", "(none yet)")
      .replace("{{screenshot_findings}}", "(none)")
      .replace("{{skills_applied}}", "(none)")
      .replace("{{open_questions}}", "(none)");

    // Save context
    const contextDir = this.getContextDir(job.job_id);
    await fs.mkdir(contextDir, { recursive: true });
    const contextPath = this.getContextPath(job.job_id);
    await fs.writeFile(contextPath, context, "utf-8");

    return context;
  }

  /**
   * Append-only update to a specific section (no overwrite per spec E2).
   */
  async updateSection(
    jobId: string,
    section: ContextSection,
    content: string,
    eventId: string,
  ): Promise<void> {
    const sectionFile = path.join(
      this.getContextDir(jobId),
      `${section}.append.md`,
    );

    const entry = [
      "",
      `<!-- Update: ${eventId} at ${new Date().toISOString()} -->`,
      content,
    ].join("\n");

    await fs.appendFile(sectionFile, entry, "utf-8");

    // Regenerate the composite context.md
    await this.recomposeContext(jobId);
  }

  /**
   * Read the current context.md for a job.
   */
  async getContext(jobId: string): Promise<string> {
    const contextPath = this.getContextPath(jobId);
    try {
      return await fs.readFile(contextPath, "utf-8");
    } catch {
      return "";
    }
  }

  /**
   * Get context truncated to a maximum character limit for prompt injection.
   * Uses priority-based trimming: Goal > Memory.hard > Skills > Screenshots > Memory.soft > Open Questions
   */
  async getContextForPrompt(
    jobId: string,
    maxChars: number = 16000,
  ): Promise<string> {
    const context = await this.getContext(jobId);
    if (context.length <= maxChars) return context;

    // Simple truncation with note
    return (
      context.slice(0, maxChars - 50) +
      "\n\n<!-- Context truncated for prompt injection -->"
    );
  }

  // ─── Internal ────────────────────────────────────────

  private getContextDir(jobId: string): string {
    return path.join(this.stateDir, "jobs", jobId, "context");
  }

  private getContextPath(jobId: string): string {
    return path.join(this.stateDir, "jobs", jobId, "context.md");
  }

  private async recomposeContext(jobId: string): Promise<void> {
    const contextDir = this.getContextDir(jobId);
    const contextPath = this.getContextPath(jobId);

    // Read base context
    let base: string;
    try {
      base = await fs.readFile(contextPath, "utf-8");
    } catch {
      base = "";
    }

    // Read all append files and add them
    let entries: string[];
    try {
      entries = await fs.readdir(contextDir);
    } catch {
      return;
    }

    const appendFiles = entries.filter((e) => e.endsWith(".append.md")).sort();
    const appendContents: string[] = [];

    for (const file of appendFiles) {
      try {
        const content = await fs.readFile(
          path.join(contextDir, file),
          "utf-8",
        );
        appendContents.push(content);
      } catch {
        // Skip
      }
    }

    if (appendContents.length > 0) {
      const composed =
        base + "\n\n---\n## Context Updates\n" + appendContents.join("\n");
      await fs.writeFile(contextPath, composed, "utf-8");
    }
  }

  private getDefaultTemplate(): string {
    return [
      "# Job Context",
      "",
      "## Goal",
      "{{goal}}",
      "",
      "## Success Criteria",
      "{{success_criteria}}",
      "",
      "## Constraints",
      "{{constraints}}",
      "",
      "## Repo Snapshot",
      "{{repo_snapshot}}",
      "",
      "## Memory Context",
      "### Decisions",
      "{{memory_decisions}}",
      "### Conventions",
      "{{memory_conventions}}",
      "### Known Issues",
      "{{memory_known_issues}}",
      "",
      "## Screenshot Findings",
      "{{screenshot_findings}}",
      "",
      "## Skills Applied",
      "{{skills_applied}}",
      "",
      "## Open Questions",
      "{{open_questions}}",
    ].join("\n");
  }
}
