import type { Phase, Task } from "@multi-agent/shared";
import { ok, err, Result } from "neverthrow";
import { nanoid } from "nanoid";
import type { IStateStore } from "../store/interface.js";
import type { LoadedPersonaSet } from "../personas/loader.js";
import { buildAiChanPlanningPrompt } from "../personas/prompt-builder.js";
import { createTask } from "../domain/task.js";

// ─── Types ──────────────────────────────────────────────

export interface PlannerConfig {
  model: string;
  skipPermissions: boolean;
}

export interface TaskTemplate {
  objective: string;
  inputs: string[];
  constraints: string[];
  acceptance_criteria: string[];
}

export interface PlanResult {
  tasks: Task[];
  prompt: string;
}

// ─── Planner ────────────────────────────────────────────

export class Planner {
  constructor(
    private readonly config: PlannerConfig,
    private readonly store: IStateStore,
  ) {}

  /**
   * Build the planning prompt for AI-chan to decompose the user request.
   */
  buildPlanningPrompt(
    personas: LoadedPersonaSet,
    userPrompt: string,
    phase: Phase,
    parallelism: number,
  ): string {
    return buildAiChanPlanningPrompt(personas, userPrompt, phase, parallelism);
  }

  /**
   * Parse AI-chan's planning response into task templates.
   */
  parsePlanResponse(raw: string): Result<TaskTemplate[], Error> {
    try {
      // Try to extract JSON array from the response
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return err(new Error("No JSON array found in planning response"));
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) {
        return err(new Error("Planning response is not an array"));
      }

      const templates: TaskTemplate[] = parsed.map(
        (item: Record<string, unknown>) => ({
          objective: String(item.objective ?? ""),
          inputs: Array.isArray(item.inputs)
            ? item.inputs.map(String)
            : [],
          constraints: Array.isArray(item.constraints)
            ? item.constraints.map(String)
            : [],
          acceptance_criteria: Array.isArray(item.acceptance_criteria)
            ? item.acceptance_criteria.map(String)
            : [],
        }),
      );

      return ok(templates);
    } catch (e) {
      return err(
        new Error(`Failed to parse planning response: ${(e as Error).message}`),
      );
    }
  }

  /**
   * Create Task entities from templates and persist them.
   */
  async createTasks(
    jobId: string,
    phase: Phase,
    templates: TaskTemplate[],
  ): Promise<Result<Task[], Error>> {
    const tasks: Task[] = [];

    for (let i = 0; i < templates.length; i++) {
      const template = templates[i];
      const task = createTask({
        job_id: jobId,
        assignee: `kobito-${i + 1}`,
        phase,
        objective: template.objective,
        inputs: template.inputs,
        constraints: template.constraints,
        acceptance_criteria: template.acceptance_criteria,
      });

      const result = await this.store.createTask(task);
      if (result.isErr()) return err(result.error);
      tasks.push(task);
    }

    return ok(tasks);
  }

  /**
   * Generate default task templates when AI-chan planning is not available
   * or for fallback scenarios.
   */
  generateDefaultTemplates(
    userPrompt: string,
    phase: Phase,
    parallelism: number,
  ): TaskTemplate[] {
    const templates: TaskTemplate[] = [];

    for (let i = 0; i < parallelism; i++) {
      templates.push({
        objective: `${phase} phase task ${i + 1}: ${userPrompt.slice(0, 200)}`,
        inputs: [`User prompt: ${userPrompt.slice(0, 500)}`],
        constraints: [`Phase: ${phase}`, `Task ${i + 1} of ${parallelism}`],
        acceptance_criteria: [
          `Produce a valid ${phase} artifact`,
          "Follow project coding standards",
        ],
      });
    }

    return templates;
  }
}
