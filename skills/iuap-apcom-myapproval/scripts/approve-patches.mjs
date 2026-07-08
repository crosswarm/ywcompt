#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { isBipCliFailure, runBipCli } from "./bip-cli-client.mjs";

function isMainModule(metaUrl) {
  return process.argv[1] && fileURLToPath(metaUrl) === process.argv[1];
}

function parseArgs(argv = process.argv.slice(2)) {
  const opts = { bills: null, billsFile: null, readStdin: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--bills" && argv[i + 1]) opts.bills = JSON.parse(argv[++i]);
    else if (argv[i] === "--bills-file" && argv[i + 1]) opts.billsFile = argv[++i];
    else if (argv[i] === "--bills-stdin") opts.readStdin = true;
  }
  return opts;
}

async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

export async function readJsonResponse(resp, label) {
  const text = await resp.text();
  if (!text.trim()) {
    throw new Error(`${label} returned empty response (HTTP ${resp.status})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.replace(/\s+/g, " ").slice(0, 200);
    throw new Error(`${label} returned non-JSON response (HTTP ${resp.status}): ${snippet}`);
  }
}

async function loadBills(opts) {
  if (opts.bills) return opts.bills;
  if (opts.billsFile) return JSON.parse(readFileSync(opts.billsFile, "utf-8"));
  if (opts.readStdin) return readStdinJson();
  return null;
}

function successIdsFromCliResult(result, bills) {
  const ids = new Set();
  for (const key of ["successIds", "primaryIds", "completed"]) {
    if (Array.isArray(result?.[key])) {
      for (const id of result[key]) ids.add(String(id));
    }
  }
  const nested = Array.isArray(result?.bills) ? result.bills : result?.results;
  if (Array.isArray(nested)) {
    for (const row of nested) {
      if (row?.success === true || row?.success === "true") {
        const id = row.primaryId || row.id;
        if (id) ids.add(String(id));
      }
    }
  }
  if (ids.size === 0 && !isBipCliFailure(result) && (result?.success === true || result?.code === 200 || result?.flag === 0)) {
    for (const bill of bills) {
      if (bill?.primaryId) ids.add(String(bill.primaryId));
    }
  }
  return ids;
}

export async function approvePatches(bills, { runBipCli: runner = runBipCli, log = () => {}, cliPath, env, timeoutMs = 180_000 } = {}) {
  if (!Array.isArray(bills) || bills.length === 0) {
    throw new Error("Missing bills");
  }
  log("[approve-patches] delegated to iuap-apcom-cli workflow task patch-approve");
  const cliResult = await runner(
    ["workflow", "task", "patch-approve"],
    { bills: JSON.stringify(bills), comment: "同意" },
    { dangerous: true, cliPath, env, timeoutMs },
  );
  const successful = successIdsFromCliResult(cliResult, bills);
  const failed = isBipCliFailure(cliResult);
  const results = bills.map((bill) => {
    const id = String(bill?.primaryId || "");
    const success = successful.has(id) || (!failed && successful.size === 0 && (cliResult?.success === true || cliResult?.code === 200 || cliResult?.flag === 0));
    return {
      ...bill,
      success,
      ...(success ? {} : { error: cliResult?.message || cliResult?.error || "patch_approve_failed" }),
    };
  });
  const successItems = results.filter((r) => r.success);
  const failItems = results.filter((r) => !r.success);
  return {
    successCount: successItems.length,
    failCount: failItems.length,
    primaryIds: successItems.map((r) => r.primaryId).filter(Boolean),
    bills: results,
    result: cliResult,
  };
}

async function main() {
  const opts = parseArgs();
  const bills = await loadBills(opts);
  if (!Array.isArray(bills) || bills.length === 0) {
    throw new Error("Missing --bills, --bills-file, or --bills-stdin");
  }
  const result = await approvePatches(bills, { log: (message) => process.stderr.write(`${message}\n`) });
  console.log(JSON.stringify(result, null, 2));
  if (result.failCount > 0) process.exitCode = 1;
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`Fatal: ${err.message || String(err)}\n`);
    console.log(JSON.stringify({ success: false, error: err.message || String(err) }));
    process.exit(1);
  });
}
