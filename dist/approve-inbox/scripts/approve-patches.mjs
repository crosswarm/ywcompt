#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getBrowserAuth } from "./browser-auth.mjs";
import { detectProxy } from "./enrich-details.mjs";
import { getCookies } from "./fetch-bill-detail.mjs";

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

function buildHeaders(cookieStr, xsrfToken) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json;charset=utf-8",
    "X-XSRF-TOKEN": xsrfToken || "",
    "Domain-Key": "developplatform",
    Cookie: cookieStr || "",
  };
}

function baseUrl() {
  return process.env.APPROVE_INBOX_PROXY || process.env.APPROVE_INBOX_BASE || "https://c1.yonyoucloud.com";
}

async function getYonclawAuth({ log = () => {} } = {}) {
  if (!process.env.APPROVE_INBOX_PROXY) {
    const proxy = await detectProxy();
    if (proxy) process.env.APPROVE_INBOX_PROXY = proxy;
  }
  const creds = await getCookies();
  if (creds) return creds;
  log("[auth] YonWork proxy/cookie unavailable, falling back to bip-cli browser auth");
  return getBrowserAuth({ log });
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

async function getBillDetail(headers, taskId, billId, fetchImpl = fetch) {
  const url = `${baseUrl()}/iuap-yonbuilder-runtime/bill/detail`
    + "?terminalType=1&busiObj=CJJBDYJZSP&fromMessage=1&from_mc_workflow=1"
    + "&serviceCode=&apptype=mdf&businessStepCode=JJBDYJZSP"
    + `&taskId=${encodeURIComponent(taskId || "")}&adt=wf`
    + "&billnum=CJJBDYJZSP&tplid=2155065408128811043"
    + `&id=${encodeURIComponent(billId || "")}&pageDetail=true`;
  const json = await readJsonResponse(await fetchImpl(url, { headers }), "Detail API");
  if (json.code !== 200) throw new Error(`Detail API failed (${json.code}): ${JSON.stringify(json).slice(0, 200)}`);
  return json.data;
}

async function saveApproval(headers, taskId, billData, fetchImpl = fetch) {
  const formData = { ...billData, shjg2: "1", _status: "Update" };
  const url = `${baseUrl()}/iuap-yonbuilder-runtime/bill/save`
    + "?cmdname=cmdSave&businessActName=补丁任务审批单-保存"
    + "&terminalType=1&busiObj=CJJBDYJZSP&fromMessage=1&from_mc_workflow=1"
    + "&serviceCode=&apptype=mdf&businessStepCode=JJBDYJZSP"
    + `&taskId=${encodeURIComponent(taskId || "")}&adt=wf`;
  const json = await readJsonResponse(await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ billnum: "CJJBDYJZSP", data: JSON.stringify(formData) }),
  }), "Save API");
  if (json.code !== 200) throw new Error(`Save API failed (${json.code}): ${JSON.stringify(json).slice(0, 200)}`);
  return json.data;
}

async function loadBills(opts) {
  if (opts.bills) return opts.bills;
  if (opts.billsFile) return JSON.parse(readFileSync(opts.billsFile, "utf-8"));
  if (opts.readStdin) return readStdinJson();
  return null;
}

export async function approvePatches(bills, { getAuth = getYonclawAuth, fetchImpl = fetch, log = () => {} } = {}) {
  if (!Array.isArray(bills) || bills.length === 0) {
    throw new Error("Missing bills");
  }
  const creds = await getAuth({ log });
  const headers = buildHeaders(creds.cookieStr, creds.xsrfToken);
  const results = [];
  for (const bill of bills) {
    try {
      const detail = await getBillDetail(headers, bill.taskId, bill.billId, fetchImpl);
      await saveApproval(headers, bill.taskId, detail, fetchImpl);
      results.push({ ...bill, success: true });
    } catch (err) {
      results.push({ ...bill, success: false, error: err.message || String(err) });
    }
  }
  const successItems = results.filter((r) => r.success);
  const failItems = results.filter((r) => !r.success);
  return {
    successCount: successItems.length,
    failCount: failItems.length,
    primaryIds: successItems.map((r) => r.primaryId).filter(Boolean),
    bills: results,
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
