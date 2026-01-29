import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { acquireDevelopLock, isDevelopLocked } from "../../../src/git/lock.js";

describe("DevelopLock", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "lock-test-"),
    );
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  describe("acquireDevelopLock", () => {
    it("should acquire and release a lock", async () => {
      const result = await acquireDevelopLock(tmpDir);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        await result.value.release();
      }
    });

    it("should fail to acquire if already locked", async () => {
      const first = await acquireDevelopLock(tmpDir);
      expect(first.isOk()).toBe(true);

      // Try to acquire again without releasing
      const second = await acquireDevelopLock(tmpDir, { retries: 0 });
      expect(second.isErr()).toBe(true);

      // Cleanup
      if (first.isOk()) {
        await first.value.release();
      }
    });

    it("should succeed after previous lock is released", async () => {
      const first = await acquireDevelopLock(tmpDir);
      expect(first.isOk()).toBe(true);
      if (first.isOk()) {
        await first.value.release();
      }

      const second = await acquireDevelopLock(tmpDir);
      expect(second.isOk()).toBe(true);
      if (second.isOk()) {
        await second.value.release();
      }
    });
  });

  describe("isDevelopLocked", () => {
    it("should return false when not locked", async () => {
      // Need to create the lock file first for check to work
      const lockDir = path.join(tmpDir, ".orchestrator");
      await fs.promises.mkdir(lockDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(lockDir, "develop.lock"),
        "",
      );

      const locked = await isDevelopLocked(tmpDir);
      expect(locked).toBe(false);
    });

    it("should return true when locked", async () => {
      const result = await acquireDevelopLock(tmpDir);
      expect(result.isOk()).toBe(true);

      const locked = await isDevelopLocked(tmpDir);
      expect(locked).toBe(true);

      if (result.isOk()) {
        await result.value.release();
      }
    });

    it("should return false when lock file does not exist", async () => {
      const locked = await isDevelopLocked(tmpDir);
      expect(locked).toBe(false);
    });
  });
});
