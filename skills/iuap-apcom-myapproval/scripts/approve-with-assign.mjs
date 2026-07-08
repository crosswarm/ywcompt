#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { parseArgs, runApprovalFromData } from "./approve-iform.mjs";

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.fieldAssignments || Object.keys(opts.fieldAssignments).length === 0) {
    throw new Error("Missing --field-assignments");
  }
  opts.action = "approve";
  opts.mode = "tempsave";
  if (!opts.comment) opts.comment = "同意";
  const result = await runApprovalFromData(opts);
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    process.stderr.write(`[iform-assign] Fatal: ${err.message || String(err)}\n`);
    console.log(JSON.stringify({ success: false, error: err.message || String(err) }));
    process.exit(1);
  });
}
