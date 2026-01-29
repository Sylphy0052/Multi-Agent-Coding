import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ok, err, Result } from "neverthrow";

const execFileAsync = promisify(execFile);

// ─── Errors ─────────────────────────────────────────────

export class GitError extends Error {
  constructor(
    message: string,
    public readonly errorClass: "TRANSIENT" | "PERMANENT",
  ) {
    super(message);
    this.name = "GitError";
  }
}

// ─── Config ─────────────────────────────────────────────

export interface GitOpsConfig {
  repoRoot: string;
  mainBranch: string;
  developBranch: string;
}

// ─── GitOps ─────────────────────────────────────────────

export class GitOps {
  constructor(private readonly config: GitOpsConfig) {}

  private async git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, {
      cwd: this.config.repoRoot,
    });
    return stdout.trim();
  }

  /**
   * Ensure the develop branch exists. If not, create it from main.
   */
  async ensureDevelopBranch(): Promise<Result<void, GitError>> {
    try {
      const exists = await this.git(
        "branch",
        "--list",
        this.config.developBranch,
      );
      if (exists.length > 0) {
        return ok(undefined);
      }
      // Create develop from main
      await this.git(
        "branch",
        this.config.developBranch,
        this.config.mainBranch,
      );
      return ok(undefined);
    } catch (e) {
      return err(
        new GitError(
          `Failed to ensure develop branch: ${(e as Error).message}`,
          "PERMANENT",
        ),
      );
    }
  }

  /**
   * Create a job branch from develop.
   */
  async createJobBranch(jobBranch: string): Promise<Result<void, GitError>> {
    try {
      await this.git("branch", jobBranch, this.config.developBranch);
      return ok(undefined);
    } catch (e) {
      return err(
        new GitError(
          `Failed to create job branch: ${(e as Error).message}`,
          "PERMANENT",
        ),
      );
    }
  }

  /**
   * Commit artifact files on the specified branch.
   * Returns the commit hash.
   */
  async commitArtifacts(
    jobBranch: string,
    message: string,
    files: string[],
  ): Promise<Result<string, GitError>> {
    try {
      // Save current branch
      const currentBranch = await this.git(
        "rev-parse",
        "--abbrev-ref",
        "HEAD",
      );

      // Checkout job branch, stage files, commit
      await this.git("checkout", jobBranch);
      try {
        await this.git("add", ...files);
        await this.git("commit", "-m", message);
        const hash = await this.git("rev-parse", "HEAD");
        return ok(hash);
      } finally {
        // Restore original branch
        if (currentBranch !== jobBranch) {
          await this.git("checkout", currentBranch).catch(() => {
            // Ignore checkout errors during cleanup
          });
        }
      }
    } catch (e) {
      return err(
        new GitError(
          `Failed to commit artifacts: ${(e as Error).message}`,
          "TRANSIENT",
        ),
      );
    }
  }

  /**
   * Merge a job branch into develop using merge commit (no fast-forward).
   * Returns the merge commit hash.
   */
  async mergeJobToDevelop(
    jobBranch: string,
    message: string,
  ): Promise<Result<string, GitError>> {
    try {
      const currentBranch = await this.git(
        "rev-parse",
        "--abbrev-ref",
        "HEAD",
      );

      await this.git("checkout", this.config.developBranch);
      try {
        await this.git("merge", "--no-ff", "-m", message, jobBranch);
        const hash = await this.git("rev-parse", "HEAD");
        return ok(hash);
      } finally {
        if (currentBranch !== this.config.developBranch) {
          await this.git("checkout", currentBranch).catch(() => {
            // Ignore checkout errors during cleanup
          });
        }
      }
    } catch (e) {
      return err(
        new GitError(
          `Failed to merge to develop: ${(e as Error).message}`,
          "TRANSIENT",
        ),
      );
    }
  }

  /**
   * Get the current branch name.
   */
  async getCurrentBranch(): Promise<Result<string, GitError>> {
    try {
      const branch = await this.git("rev-parse", "--abbrev-ref", "HEAD");
      return ok(branch);
    } catch (e) {
      return err(
        new GitError(
          `Failed to get current branch: ${(e as Error).message}`,
          "PERMANENT",
        ),
      );
    }
  }

  /**
   * Check if a branch exists.
   */
  async branchExists(branch: string): Promise<Result<boolean, GitError>> {
    try {
      const result = await this.git("branch", "--list", branch);
      return ok(result.trim().length > 0);
    } catch (e) {
      return err(
        new GitError(
          `Failed to check branch: ${(e as Error).message}`,
          "PERMANENT",
        ),
      );
    }
  }

  /**
   * Get the latest commit hash on the current branch.
   */
  async getLatestCommitHash(): Promise<Result<string, GitError>> {
    try {
      const hash = await this.git("rev-parse", "HEAD");
      return ok(hash);
    } catch (e) {
      return err(
        new GitError(
          `Failed to get commit hash: ${(e as Error).message}`,
          "PERMANENT",
        ),
      );
    }
  }

  /**
   * Delete a branch (cleanup after merge).
   */
  async deleteBranch(branch: string): Promise<Result<void, GitError>> {
    try {
      await this.git("branch", "-d", branch);
      return ok(undefined);
    } catch (e) {
      return err(
        new GitError(
          `Failed to delete branch: ${(e as Error).message}`,
          "PERMANENT",
        ),
      );
    }
  }
}
