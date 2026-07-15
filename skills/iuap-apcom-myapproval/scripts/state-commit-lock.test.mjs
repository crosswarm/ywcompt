import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stateCommitLockPath, withStateCommitLock } from "./state-commit-lock.mjs";

function tempDataDir() {
  return mkdtempSync(join(tmpdir(), "approve-inbox-state-lock-"));
}

describe("state commit lock", () => {
  it("runs one synchronous commit and always removes the lock", () => {
    const dataDir = tempDataDir();
    const lockPath = stateCommitLockPath(dataDir);
    let committed = false;

    const result = withStateCommitLock(dataDir, () => {
      committed = true;
      assert.equal(existsSync(lockPath), true);
      return "committed";
    });

    assert.equal(result, "committed");
    assert.equal(committed, true);
    assert.equal(existsSync(lockPath), false);
  });

  it("fails closed while a live process owns the lock", () => {
    const dataDir = tempDataDir();
    const lockPath = stateCommitLockPath(dataDir);
    mkdirSync(join(dataDir, "service"), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));

    assert.throws(
      () => withStateCommitLock(dataDir, () => assert.fail("commit must not run")),
      (error) => error?.code === "STATE_COMMIT_BUSY",
    );
  });

  it("removes a stale lock and cleans up after a failed commit", () => {
    const dataDir = tempDataDir();
    const lockPath = stateCommitLockPath(dataDir);
    mkdirSync(join(dataDir, "service"), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ pid: 2147483647 }));

    assert.throws(
      () => withStateCommitLock(dataDir, () => {
        throw new Error("commit failed");
      }),
      /commit failed/,
    );
    assert.equal(existsSync(lockPath), false);
  });
});
