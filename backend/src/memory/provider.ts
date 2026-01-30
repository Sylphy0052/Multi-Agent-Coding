import type { MemoryUpdate, Phase } from "@multi-agent/shared";

export interface MemoryContextInput {
  repoSummary: string;
  jobGoal: string;
  phase: Phase;
  keywords: string[];
}

export interface MemoryProvider {
  getContext(input: MemoryContextInput): Promise<string>;
  applyUpdates(updates: MemoryUpdate[]): Promise<void>;
  proposeUpdate(
    update: Omit<MemoryUpdate, "id" | "status" | "proposed_at">,
  ): Promise<MemoryUpdate>;
  listPendingUpdates(): Promise<MemoryUpdate[]>;
  listAllEntries(): Promise<MemoryUpdate[]>;
  approveUpdate(id: string): Promise<void>;
  rejectUpdate(id: string): Promise<void>;
}
