import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ok, err, Result } from "neverthrow";
import { TmuxController, TmuxError } from "./controller.js";
import type { TmuxPane } from "./controller.js";

// ─── Types ──────────────────────────────────────────────

export interface ClaudeRunConfig {
  repoRoot: string;
  prompt: string;
  model: string;
  skipPermissions: boolean;
  outputFormat: "text" | "json" | "stream-json";
  timeoutSeconds: number;
}

export interface ClaudeTaskConfig extends ClaudeRunConfig {
  jobId: string;
  taskId: string;
  tmpDir: string;
}

// ─── Claude Runner ──────────────────────────────────────

export class ClaudeRunner {
  constructor(private readonly tmux: TmuxController) {}

  /**
   * Build the Claude CLI command string.
   */
  buildCommand(config: ClaudeRunConfig): string {
    const parts = ["claude", "-p", "--print"];

    if (config.skipPermissions) {
      parts.push("--dangerously-skip-permissions");
    }

    parts.push("--output-format", config.outputFormat);
    parts.push("--model", config.model);

    return parts.join(" ");
  }

  /**
   * Launch Claude CLI in a tmux pane with output redirected to a file.
   *
   * The output is redirected to: {tmpDir}/{taskId}.json
   * A sentinel file {tmpDir}/{taskId}.done is created on completion.
   */
  async launch(
    pane: TmuxPane,
    config: ClaudeTaskConfig,
  ): Promise<Result<void, TmuxError>> {
    // Ensure output directory exists
    const outputDir = path.join(config.tmpDir, config.jobId);
    await fs.mkdir(outputDir, { recursive: true });

    const outputFile = path.join(outputDir, `${config.taskId}.json`);
    const doneFile = path.join(outputDir, `${config.taskId}.done`);
    const promptFile = path.join(outputDir, `${config.taskId}.prompt.txt`);

    // Write prompt to file (avoids shell escaping issues with long prompts)
    await fs.writeFile(promptFile, config.prompt, "utf-8");

    const claudeCmd = this.buildCommand(config);

    // Build the shell command:
    // cd {repoRoot} && cat {promptFile} | {claudeCmd} > {outputFile} 2>&1; echo "DONE" > {doneFile}
    const shellCmd = [
      `cd ${this.shellEscape(config.repoRoot)}`,
      `cat ${this.shellEscape(promptFile)} | ${claudeCmd} > ${this.shellEscape(outputFile)} 2>&1`,
      `echo "DONE" > ${this.shellEscape(doneFile)}`,
    ].join(" && ");

    return this.tmux.sendKeys(pane, shellCmd);
  }

  /**
   * Check if a task has completed by looking for the .done sentinel file.
   */
  async isTaskDone(
    tmpDir: string,
    jobId: string,
    taskId: string,
  ): Promise<boolean> {
    const doneFile = path.join(tmpDir, jobId, `${taskId}.done`);
    try {
      await fs.access(doneFile);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read the output of a completed task.
   */
  async readTaskOutput(
    tmpDir: string,
    jobId: string,
    taskId: string,
  ): Promise<Result<string, Error>> {
    const outputFile = path.join(tmpDir, jobId, `${taskId}.json`);
    try {
      const content = await fs.readFile(outputFile, "utf-8");
      return ok(content);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private shellEscape(s: string): string {
    return `'${s.replace(/'/g, "'\\''")}'`;
  }
}
