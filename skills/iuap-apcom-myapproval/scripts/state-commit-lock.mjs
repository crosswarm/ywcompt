import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function busyError() {
  const error = new Error("state commit is already in progress");
  error.code = "STATE_COMMIT_BUSY";
  return error;
}

export function stateCommitLockPath(dataDir) {
  return join(dataDir, "service", "state-commit.lock");
}

export function withStateCommitLock(dataDir, commit) {
  const lockPath = stateCommitLockPath(dataDir);
  mkdirSync(join(dataDir, "service"), { recursive: true });
  let fd = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fd = openSync(lockPath, "wx", 0o600);
      writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let holder = null;
      try { holder = JSON.parse(readFileSync(lockPath, "utf-8")); } catch { /* stale lock */ }
      if (processIsAlive(Number(holder?.pid))) throw busyError();
      try { unlinkSync(lockPath); } catch { throw busyError(); }
    }
  }
  if (fd == null) throw busyError();
  try {
    return commit();
  } finally {
    try { closeSync(fd); } catch { /* already closed */ }
    try { if (existsSync(lockPath)) unlinkSync(lockPath); } catch { /* best-effort unlock */ }
  }
}
