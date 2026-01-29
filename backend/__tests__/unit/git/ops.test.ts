import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { GitOps } from "../../../src/git/ops.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

describe("GitOps", () => {
  let tmpDir: string;
  let gitOps: GitOps;

  beforeEach(async () => {
    // Create a temporary git repository
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "gitops-test-"));
    await git(tmpDir, "init", "--initial-branch=main");
    await git(tmpDir, "config", "user.email", "test@test.com");
    await git(tmpDir, "config", "user.name", "Test User");

    // Create initial commit so main branch exists
    const readmePath = path.join(tmpDir, "README.md");
    await fs.promises.writeFile(readmePath, "# Test Repo\n");
    await git(tmpDir, "add", "README.md");
    await git(tmpDir, "commit", "-m", "Initial commit");

    gitOps = new GitOps({
      repoRoot: tmpDir,
      mainBranch: "main",
      developBranch: "develop",
    });
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  describe("ensureDevelopBranch", () => {
    it("should create develop branch from main", async () => {
      const result = await gitOps.ensureDevelopBranch();
      expect(result.isOk()).toBe(true);

      const branches = await git(tmpDir, "branch", "--list", "develop");
      expect(branches).toContain("develop");
    });

    it("should be idempotent if develop already exists", async () => {
      await gitOps.ensureDevelopBranch();
      const result = await gitOps.ensureDevelopBranch();
      expect(result.isOk()).toBe(true);
    });
  });

  describe("createJobBranch", () => {
    it("should create a job branch from develop", async () => {
      await gitOps.ensureDevelopBranch();
      const result = await gitOps.createJobBranch("jobs/test-job-1");
      expect(result.isOk()).toBe(true);

      const branches = await git(tmpDir, "branch", "--list", "jobs/test-job-1");
      expect(branches).toContain("jobs/test-job-1");
    });

    it("should fail if develop does not exist", async () => {
      const result = await gitOps.createJobBranch("jobs/test-job-1");
      expect(result.isErr()).toBe(true);
    });
  });

  describe("commitArtifacts", () => {
    it("should commit files on the job branch", async () => {
      await gitOps.ensureDevelopBranch();
      await gitOps.createJobBranch("jobs/test-job-1");

      // Checkout job branch and create artifact
      await git(tmpDir, "checkout", "jobs/test-job-1");
      const docsDir = path.join(tmpDir, "docs", "jobs", "test-job-1");
      await fs.promises.mkdir(docsDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(docsDir, "spec.md"),
        "# Spec\n\nTest specification",
      );
      await git(tmpDir, "checkout", "main");

      // Checkout job branch to stage the file
      await git(tmpDir, "checkout", "jobs/test-job-1");
      const result = await gitOps.commitArtifacts(
        "jobs/test-job-1",
        "Add spec artifact",
        ["docs/jobs/test-job-1/spec.md"],
      );
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toMatch(/^[a-f0-9]{40}$/);
      }

      // Verify commit exists
      const log = await git(tmpDir, "log", "--oneline", "-1");
      expect(log).toContain("Add spec artifact");
    });
  });

  describe("mergeJobToDevelop", () => {
    it("should merge job branch into develop with --no-ff", async () => {
      await gitOps.ensureDevelopBranch();
      await gitOps.createJobBranch("jobs/test-job-1");

      // Add a commit on the job branch
      await git(tmpDir, "checkout", "jobs/test-job-1");
      const artifactPath = path.join(tmpDir, "artifact.md");
      await fs.promises.writeFile(artifactPath, "# Artifact\n");
      await git(tmpDir, "add", "artifact.md");
      await git(tmpDir, "commit", "-m", "Add artifact");
      await git(tmpDir, "checkout", "main");

      const result = await gitOps.mergeJobToDevelop(
        "jobs/test-job-1",
        "Merge jobs/test-job-1 into develop",
      );
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toMatch(/^[a-f0-9]{40}$/);
      }

      // Verify merge commit message on develop
      await git(tmpDir, "checkout", "develop");
      const log = await git(tmpDir, "log", "--oneline", "-1");
      expect(log).toContain("Merge jobs/test-job-1 into develop");
    });

    it("should create a merge commit (no fast-forward)", async () => {
      await gitOps.ensureDevelopBranch();
      await gitOps.createJobBranch("jobs/test-job-1");

      // Add a commit on job branch
      await git(tmpDir, "checkout", "jobs/test-job-1");
      await fs.promises.writeFile(path.join(tmpDir, "file.txt"), "content");
      await git(tmpDir, "add", "file.txt");
      await git(tmpDir, "commit", "-m", "Add file");
      await git(tmpDir, "checkout", "main");

      await gitOps.mergeJobToDevelop(
        "jobs/test-job-1",
        "Merge jobs/test-job-1",
      );

      // Check that the merge commit has two parents (no-ff)
      await git(tmpDir, "checkout", "develop");
      const parents = await git(
        tmpDir,
        "log",
        "-1",
        "--format=%P",
      );
      const parentCount = parents.split(" ").length;
      expect(parentCount).toBe(2);
    });
  });

  describe("getCurrentBranch", () => {
    it("should return the current branch name", async () => {
      const result = await gitOps.getCurrentBranch();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe("main");
      }
    });
  });

  describe("branchExists", () => {
    it("should return true for existing branch", async () => {
      const result = await gitOps.branchExists("main");
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    });

    it("should return false for non-existing branch", async () => {
      const result = await gitOps.branchExists("nonexistent");
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(false);
      }
    });
  });

  describe("getLatestCommitHash", () => {
    it("should return a valid commit hash", async () => {
      const result = await gitOps.getLatestCommitHash();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toMatch(/^[a-f0-9]{40}$/);
      }
    });
  });

  describe("deleteBranch", () => {
    it("should delete a merged branch", async () => {
      await gitOps.ensureDevelopBranch();
      await gitOps.createJobBranch("jobs/test-delete");

      // Merge first to allow -d (safe delete)
      await git(tmpDir, "checkout", "jobs/test-delete");
      await fs.promises.writeFile(path.join(tmpDir, "tmp.txt"), "x");
      await git(tmpDir, "add", "tmp.txt");
      await git(tmpDir, "commit", "-m", "tmp");
      await git(tmpDir, "checkout", "develop");
      await git(tmpDir, "merge", "--no-ff", "-m", "merge", "jobs/test-delete");
      // Stay on develop so -d can verify the branch is merged into HEAD
      const result = await gitOps.deleteBranch("jobs/test-delete");
      expect(result.isOk()).toBe(true);

      const exists = await gitOps.branchExists("jobs/test-delete");
      if (exists.isOk()) {
        expect(exists.value).toBe(false);
      }
    });
  });
});
