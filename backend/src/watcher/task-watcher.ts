import * as fs from "node:fs/promises";
import * as path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import type { IStateStore } from "../store/interface.js";
import { EventBus } from "../events/bus.js";
import { parseClaudeOutput, toReport } from "../tmux/output-parser.js";
import { createTraceEntry } from "../domain/trace.js";
import type { Phase } from "@multi-agent/shared";

// ─── Types ──────────────────────────────────────────────

export interface TaskWatcherConfig {
  tmpDir: string;
  /** Use polling instead of native fs events (recommended for WSL2). */
  usePolling?: boolean;
  /** Polling interval in ms when usePolling is true. Default: 1000 */
  pollingInterval?: number;
}

// ─── Task Watcher ───────────────────────────────────────

/**
 * Watches for .done and .error sentinel files using chokidar,
 * replacing the polling-based task completion detection.
 *
 * On detecting a .done file:
 *  1. Reads the task output JSON
 *  2. Parses it into a Report
 *  3. Transitions the task to COMPLETED
 *  4. Emits task:done event
 *
 * On detecting a .error file:
 *  1. Transitions the task to FAILED
 *  2. Emits task:error event
 */
export class TaskWatcher {
  private watchers = new Map<string, FSWatcher>();
  private processedTasks = new Set<string>();

  constructor(
    private readonly config: TaskWatcherConfig,
    private readonly store: IStateStore,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * Start watching a job's tmp directory for .done/.error files.
   * If the directory does not exist yet, it will be created.
   */
  async watchJob(jobId: string): Promise<void> {
    if (this.watchers.has(jobId)) return;

    const jobDir = path.join(this.config.tmpDir, jobId);
    await fs.mkdir(jobDir, { recursive: true });

    const watcher = watch(jobDir, {
      ignoreInitial: true,
      usePolling: this.config.usePolling ?? false,
      interval: this.config.pollingInterval ?? 1000,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    watcher.on("add", (filePath) => {
      this.handleFileAdded(jobId, filePath).catch((e) => {
        console.error(`[TaskWatcher] Error handling file ${filePath}:`, e);
      });
    });

    this.watchers.set(jobId, watcher);

    // Scan for already-existing sentinel files (race condition prevention)
    await this.scanExisting(jobId);
  }

  /**
   * One-shot scan for already-existing .done/.error files.
   * Handles the case where files were created before the watcher was set up.
   */
  async scanExisting(jobId: string): Promise<void> {
    const jobDir = path.join(this.config.tmpDir, jobId);

    let entries: string[];
    try {
      entries = await fs.readdir(jobDir);
    } catch {
      return; // Directory doesn't exist yet
    }

    for (const entry of entries) {
      if (entry.endsWith(".done") || entry.endsWith(".error")) {
        const filePath = path.join(jobDir, entry);
        await this.handleFileAdded(jobId, filePath);
      }
    }
  }

  /**
   * Stop watching a specific job.
   */
  async unwatchJob(jobId: string): Promise<void> {
    const watcher = this.watchers.get(jobId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(jobId);
    }
  }

  /**
   * Close all watchers and clean up.
   */
  async close(): Promise<void> {
    for (const [jobId, watcher] of this.watchers) {
      await watcher.close();
      this.watchers.delete(jobId);
    }
    this.processedTasks.clear();
  }

  /**
   * Check if all tasks for a job's current phase are in a terminal state.
   */
  async areAllTasksDone(jobId: string, phase: Phase): Promise<boolean> {
    const tasksResult = await this.store.listTasksByJob(jobId);
    if (tasksResult.isErr()) return false;

    const phaseTasks = tasksResult.value.filter((t) => t.phase === phase);
    return phaseTasks.every(
      (t) =>
        t.status === "COMPLETED" ||
        t.status === "FAILED" ||
        t.status === "CANCELED",
    );
  }

  // ─── Internal ────────────────────────────────────────

  private async handleFileAdded(
    jobId: string,
    filePath: string,
  ): Promise<void> {
    const basename = path.basename(filePath);

    if (basename.endsWith(".done")) {
      const taskId = basename.replace(".done", "");
      await this.handleTaskDone(jobId, taskId);
    } else if (basename.endsWith(".error")) {
      const taskId = basename.replace(".error", "");
      await this.handleTaskError(jobId, taskId);
    }
  }

  private async handleTaskDone(jobId: string, taskId: string): Promise<void> {
    const key = `${jobId}:${taskId}:done`;
    if (this.processedTasks.has(key)) return;
    this.processedTasks.add(key);

    // Read task to get phase and assignee
    const taskResult = await this.store.getTask(taskId, jobId);
    if (taskResult.isErr()) {
      console.error(
        `[TaskWatcher] Failed to get task ${taskId}:`,
        taskResult.error,
      );
      return;
    }
    const task = taskResult.value;
    if (task.status !== "RUNNING") return;

    // Read and parse output
    const outputFile = path.join(
      this.config.tmpDir,
      jobId,
      `${taskId}.json`,
    );
    let rawOutput: string;
    try {
      rawOutput = await fs.readFile(outputFile, "utf-8");
    } catch (e) {
      await this.failTask(
        jobId,
        taskId,
        task.assignee,
        `Failed to read output: ${String(e)}`,
      );
      return;
    }

    const parseResult = parseClaudeOutput(rawOutput);
    if (parseResult.isErr()) {
      // Create a basic report from raw output
      const basicReport = toReport(
        {
          summary: rawOutput.slice(0, 500),
          findings: [],
          risks: [],
          contradictions: [],
          next_actions: [],
          artifact_updates: [],
        },
        taskId,
        jobId,
        task.phase,
      );
      await this.store.createReport(basicReport);
    } else {
      const report = toReport(parseResult.value, taskId, jobId, task.phase);
      await this.store.createReport(report);
    }

    // Transition RUNNING -> COMPLETED
    await this.store.updateTask(taskId, jobId, {
      status: "COMPLETED",
      updated_at: new Date().toISOString(),
    });

    await this.store.appendTrace(
      createTraceEntry(
        jobId,
        task.assignee as `kobito-${number}`,
        "REPORTED",
        `Task completed: ${task.objective.slice(0, 100)}`,
        { task_id: taskId },
      ),
    );

    this.eventBus.emitIdempotent(
      {
        type: "task:done",
        job_id: jobId,
        task_id: taskId,
        phase: task.phase,
        role: task.assignee,
        artifacts: [],
        timestamp: new Date().toISOString(),
      },
      key,
    );
  }

  private async handleTaskError(
    jobId: string,
    taskId: string,
  ): Promise<void> {
    const key = `${jobId}:${taskId}:error`;
    if (this.processedTasks.has(key)) return;
    this.processedTasks.add(key);

    const taskResult = await this.store.getTask(taskId, jobId);
    if (taskResult.isErr()) return;
    const task = taskResult.value;
    if (task.status !== "RUNNING") return;

    // Try to read error details
    const errorFile = path.join(
      this.config.tmpDir,
      jobId,
      `${taskId}.error`,
    );
    let errorMsg = "Task execution error";
    try {
      errorMsg = await fs.readFile(errorFile, "utf-8");
    } catch {
      // Use default message
    }

    await this.failTask(jobId, taskId, task.assignee, errorMsg);
  }

  private async failTask(
    jobId: string,
    taskId: string,
    assignee: string,
    error: string,
  ): Promise<void> {
    await this.store.updateTask(taskId, jobId, {
      status: "FAILED",
      updated_at: new Date().toISOString(),
    });

    await this.store.appendTrace(
      createTraceEntry(
        jobId,
        assignee as `kobito-${number}`,
        "FAILED",
        `Task failed: ${error.slice(0, 200)}`,
        { task_id: taskId },
      ),
    );

    this.eventBus.emitIdempotent(
      {
        type: "task:error",
        job_id: jobId,
        task_id: taskId,
        error,
        timestamp: new Date().toISOString(),
      },
      `${jobId}:${taskId}:error`,
    );
  }
}
