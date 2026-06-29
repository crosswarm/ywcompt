#!/usr/bin/env node
/**
 * runtime-context.mjs — resolve the approve-inbox skill runtime location.
 *
 * This is the small bridge YonClaw and cockpit services can call when they need
 * to discover where the current skill copy is running from and which local URLs
 * expose the widget/full inbox pages.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKILL_DIR = resolve(HERE, "..");
const SKILL_MARKER = `${sep}skills${sep}approve-inbox`;

function cleanPath(value) {
  if (!value) return null;
  return resolve(String(value));
}

function firstExistingOrFirst(candidates, exists = existsSync) {
  const clean = [...new Set(candidates.filter(Boolean).map((p) => resolve(String(p))))];
  return clean.find((p) => exists(p)) || clean[0] || null;
}

function skillDirFromApproveInboxPath(inputPath) {
  const p = cleanPath(inputPath);
  if (!p) return null;
  const idx = p.indexOf(SKILL_MARKER);
  if (idx < 0) return null;
  return p.slice(0, idx + SKILL_MARKER.length);
}

function runtimePartsFromSkillDir(skillDir) {
  const normalized = cleanPath(skillDir);
  const marker = `${sep}userData${sep}runtime${sep}openclaw${sep}skills${sep}approve-inbox`;
  const idx = normalized ? normalized.indexOf(marker) : -1;
  if (!normalized || idx < 0) {
    return {
      profileDir: null,
      runtimeDir: null,
      openclawDir: null,
    };
  }
  const profileDir = normalized.slice(0, idx);
  const runtimeDir = join(profileDir, "userData", "runtime");
  return {
    profileDir,
    runtimeDir,
    openclawDir: join(runtimeDir, "openclaw"),
  };
}

export function resolveRuntimeContext(options = {}) {
  const env = options.env || process.env;
  const exists = options.exists || existsSync;
  const port = Number(options.port || env.APPROVE_INBOX_PORT || env.PORT || 3891);
  const serverUrl = String(options.serverUrl || env.APPROVE_INBOX_SERVER_URL || `http://localhost:${port}`).replace(/\/$/, "");

  const skillDir = firstExistingOrFirst([
    env.APPROVE_INBOX_SKILL_DIR,
    skillDirFromApproveInboxPath(env.APPROVE_INBOX_DATA),
    options.skillDir,
    DEFAULT_SKILL_DIR,
  ], exists);

  const dataDir = cleanPath(env.APPROVE_INBOX_DATA || options.dataDir || (skillDir ? join(skillDir, "data") : null));
  const parts = runtimePartsFromSkillDir(skillDir);

  return {
    skillId: "approve-inbox",
    skillDir,
    dataDir,
    profileDir: parts.profileDir,
    runtimeDir: parts.runtimeDir,
    openclawDir: parts.openclawDir,
    serverUrl,
    widgetUrl: `${serverUrl}/widget/`,
    centerUrl: `${serverUrl}/`,
  };
}

function parseArgs(argv) {
  const args = { format: "json" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--format") args.format = argv[++i] || "json";
    else if (arg === "--server-url") args.serverUrl = argv[++i];
    else if (arg === "--port") args.port = Number(argv[++i]);
  }
  return args;
}

function printContext(ctx, format) {
  if (format === "env") {
    for (const [key, value] of Object.entries(ctx)) {
      if (value == null) continue;
      const envKey = `APPROVE_INBOX_${key.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase()}`;
      process.stdout.write(`${envKey}=${JSON.stringify(String(value))}\n`);
    }
    return;
  }
  process.stdout.write(`${JSON.stringify(ctx, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  printContext(resolveRuntimeContext(args), args.format);
}
