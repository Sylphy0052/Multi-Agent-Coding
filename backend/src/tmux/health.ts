import type { TmuxController, TmuxSession } from "./controller.js";

export interface HealthStatus {
  sessionAlive: boolean;
  paneCount: number;
}

/**
 * Check the health of a tmux session for a job.
 */
export async function checkSessionHealth(
  tmux: TmuxController,
  session: TmuxSession,
): Promise<HealthStatus> {
  const alive = await tmux.isSessionAlive(session);
  if (!alive) {
    return { sessionAlive: false, paneCount: 0 };
  }

  try {
    const panes = await tmux.listPanes(session);
    return { sessionAlive: true, paneCount: panes.length };
  } catch {
    return { sessionAlive: true, paneCount: 0 };
  }
}
