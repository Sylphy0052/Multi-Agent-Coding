import * as lockfile from "proper-lockfile";
import * as path from "node:path";
import * as fs from "node:fs";
import { ok, err, Result } from "neverthrow";

// ─── Errors ─────────────────────────────────────────────

export class LockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockError";
  }
}

// ─── Types ──────────────────────────────────────────────

export interface DevelopLock {
  release(): Promise<void>;
}

export interface LockOptions {
  /** Number of retries before giving up (0 = no retries). */
  retries?: number;
  /** Time in ms before considering a lock stale. */
  stale?: number;
}

// ─── Lock Acquisition ───────────────────────────────────

const LOCK_DIR_NAME = ".orchestrator";
const LOCK_FILE_NAME = "develop.lock";

/**
 * Acquire an exclusive lock on the develop branch.
 * Lock failure should result in WAITING_RETRY, not FAILED.
 *
 * Uses proper-lockfile for cross-process safety.
 */
export async function acquireDevelopLock(
  repoRoot: string,
  options?: LockOptions,
): Promise<Result<DevelopLock, LockError>> {
  const lockDir = path.join(repoRoot, LOCK_DIR_NAME);
  const lockPath = path.join(lockDir, LOCK_FILE_NAME);

  try {
    // Ensure lock directory and file exist
    await fs.promises.mkdir(lockDir, { recursive: true });
    try {
      await fs.promises.access(lockPath);
    } catch {
      await fs.promises.writeFile(lockPath, "");
    }

    const release = await lockfile.lock(lockPath, {
      retries: options?.retries ?? 0,
      stale: options?.stale ?? 60_000,
    });

    return ok({
      release: async () => {
        await release();
      },
    });
  } catch (e) {
    return err(
      new LockError(
        `Failed to acquire develop lock: ${(e as Error).message}`,
      ),
    );
  }
}

/**
 * Check if the develop lock is currently held.
 */
export async function isDevelopLocked(repoRoot: string): Promise<boolean> {
  const lockPath = path.join(repoRoot, LOCK_DIR_NAME, LOCK_FILE_NAME);
  try {
    return await lockfile.check(lockPath);
  } catch {
    return false;
  }
}
