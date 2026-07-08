#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { executeApproval } from "./approval-executor.mjs";
import { findStateItems, itemPrimaryId } from "./approval-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(__dirname, "..");

export function parseArgs(argv = process.argv.slice(2)) {
  const opts = {
    primaryIds: [],
    action: "approve",
    comment: undefined,
    mode: "tempsave",
    rejectTarget: undefined,
    selectedByRejecter: undefined,
    fieldAssignments: {},
    dataDir: process.env.APPROVE_INBOX_DATA || join(SKILL_DIR, "data"),
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--primary-ids" && argv[i + 1]) opts.primaryIds = JSON.parse(argv[++i]);
    else if (argv[i] === "--action" && argv[i + 1]) opts.action = argv[++i];
    else if (argv[i] === "--comment" && argv[i + 1]) opts.comment = argv[++i];
    else if (argv[i] === "--mode" && argv[i + 1]) opts.mode = argv[++i];
    else if (argv[i] === "--reject-target" && argv[i + 1]) opts.rejectTarget = argv[++i];
    else if (argv[i] === "--selected-by-rejecter" && argv[i + 1]) opts.selectedByRejecter = argv[++i];
    else if (argv[i] === "--field-assignments" && argv[i + 1]) opts.fieldAssignments = JSON.parse(argv[++i]);
    else if (argv[i] === "--data" && argv[i + 1]) opts.dataDir = argv[++i];
  }
  if (!Array.isArray(opts.primaryIds) || opts.primaryIds.length === 0) throw new Error("Missing --primary-ids");
  if (!["approve", "reject", "return"].includes(opts.action)) throw new Error(`Invalid --action: ${opts.action}`);
  if (opts.action === "approve" && opts.comment === undefined) opts.comment = "同意";
  if (opts.action !== "approve") {
    if (!opts.comment) throw new Error("退回/驳回必须提供 --comment");
    if (!opts.rejectTarget) opts.rejectTarget = "-1";
    if (opts.selectedByRejecter == null) opts.selectedByRejecter = "0";
  }
  return opts;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf-8"));
}

export async function runApprovalFromData(opts, deps = {}) {
  const stateFile = join(opts.dataDir, "inbox.json");
  if (!existsSync(stateFile)) throw new Error(`inbox.json not found: ${stateFile}`);
  const state = readJson(stateFile);
  const items = findStateItems(state, opts.primaryIds);
  if (items.length === 0) throw new Error("No matching items");
  const detailsById = new Map(items.map((item) => {
    const id = itemPrimaryId(item);
    const file = join(opts.dataDir, "details", `${id}.json`);
    return [id, existsSync(file) ? readJson(file) : null];
  }));
  return executeApproval(items, {
    ids: opts.primaryIds,
    action: opts.action,
    comment: opts.comment,
    mode: opts.mode,
    rejectTarget: opts.rejectTarget,
    selectedByRejecter: opts.selectedByRejecter,
    fieldAssignments: opts.fieldAssignments,
    detailsById,
  }, deps);
}

async function main() {
  const opts = parseArgs();
  const result = await runApprovalFromData(opts);
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    process.stderr.write(`[iform] Fatal: ${err.message || String(err)}\n`);
    console.log(JSON.stringify({ success: false, error: err.message || String(err) }));
    process.exit(1);
  });
}
