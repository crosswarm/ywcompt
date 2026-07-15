import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer as createTcpServer } from "node:net";

const servers = [];

function tempDir() {
  return mkdtempSync(join(tmpdir(), "approve-inbox-server-"));
}

async function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createTcpServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

function writeFakeCli(dir) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "bip-cli.js");
  writeFileSync(file, `
const fs = require("fs");
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--schema") {
  process.stdout.write(JSON.stringify([
    "whoami",
    "workflow inboxtask list-inbox",
    "workflow inboxtask get-document",
    "workflow inboxtask list-action",
    "workflow inboxtask approve-iform",
    "workflow inboxtask reject-iform",
    "workflow inboxtask approve-patch",
    "workflow inboxtask get-intelligent-result",
    "workflow task batch-approve",
    "workflow task batch-reject",
    "auth permission apply",
  ].map((path) => ({ path }))));
  process.exit(0);
}
const optionIndex = args.findIndex((arg) => arg.startsWith("--"));
const commandPath = args.slice(0, optionIndex === -1 ? args.length : optionIndex).join(" ");
let input = {};
try {
  const raw = fs.readFileSync(0, "utf-8").trim();
  input = raw ? JSON.parse(raw) : {};
} catch {
  input = {};
}
const logPath = process.env.FAKE_CLI_LOG;
let previous = [];
if (logPath && fs.existsSync(logPath)) {
  previous = fs.readFileSync(logPath, "utf-8")
    .trim()
    .split("\\n")
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}
if (logPath) fs.appendFileSync(logPath, JSON.stringify({ args, commandPath, input }) + "\\n");

function parseIds(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function write(payload) {
  console.log(JSON.stringify(payload));
}

if (process.env.FAKE_CLI_AUTH === "401" && (commandPath === "whoami" || commandPath === "workflow inboxtask list-inbox")) {
  process.stderr.write("获取 secret 失败: HTTP 401");
  process.exit(1);
}

if (commandPath === "whoami") {
  write({
    success: true,
    yhtUserId: process.env.FAKE_USER_ID || "fake-user",
    currentTenantId: process.env.FAKE_TENANT_ID || "fake-tenant",
  });
} else if (commandPath === "workflow inboxtask list-inbox") {
  write({ success: true, currentTenantId: process.env.FAKE_TENANT_ID || "fake-tenant", items: [] });
} else if (commandPath === "workflow inboxtask list-action") {
  write({
    success: true,
    source: "fake-cli",
    actions: [
      { action: "approve", label: "通过", enabled: true },
      { action: "reject", label: "驳回", enabled: true },
    ],
  });
} else if (commandPath === "workflow inboxtask get-intelligent-result") {
  const auditDelay = Number(process.env.FAKE_AUDIT_DELAY || 0);
  if (auditDelay > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, auditDelay);
  const auditCount = previous.filter((call) => call.commandPath === "workflow inboxtask get-intelligent-result").length + 1;
  write({
    status: "success",
    code: 200,
    message: "操作成功",
    resultId: "res-" + auditCount,
    queryId: "q-" + auditCount,
    resultDesc: auditCount === 1 ? "高风险，请拒绝" : "低风险，可通过",
    AISummaryResultDesc: auditCount === 1 ? "系统判断存在严重风险。" : "系统判断无异常。",
  });
} else if (commandPath === "workflow task batch-approve" || commandPath === "workflow task batch-reject") {
  const ids = parseIds(input.primaryIds);
  if (process.env.FAKE_APPROVE_MODE === "argfail") {
    process.stderr.write("error: unknown option '--yes'");
    process.exit(1);
  } else if (process.env.FAKE_APPROVE_MODE === "fail") {
    write({ success: false, message: "fake failure" });
  } else if (process.env.FAKE_APPROVE_MODE === "partial") {
    write({ results: ids.map((id, idx) => ({ primaryId: id, success: idx === 0, error: idx === 0 ? undefined : "failed" })) });
  } else {
    write({ results: ids.map((id) => ({ primaryId: id, success: true })) });
  }
} else {
  write({ success: true });
}
`, "utf-8");
  return file;
}

function writeFakeTextutil(dir) {
  const binDir = join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  const file = join(binDir, "textutil");
  writeFileSync(file, `#!${process.execPath}
process.stdout.write("<h1>Converted Preview</h1><p>fake document body</p>");
`, "utf-8");
  chmodSync(file, 0o755);
  return binDir;
}

function writeFakeEnrich(dir) {
  const file = join(dir, "fake-enrich.cjs");
  writeFileSync(file, `
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
const dataIndex = args.indexOf("--data");
const idIndex = args.indexOf("--id");
const dataDir = dataIndex >= 0 ? args[dataIndex + 1] : "";
const id = idIndex >= 0 ? args[idIndex + 1] : "m1";
if (process.env.FAKE_ENRICH_LOG) {
  fs.appendFileSync(process.env.FAKE_ENRICH_LOG, JSON.stringify(args) + "\\n");
}
setTimeout(() => {
  if (process.env.FAKE_ENRICH_WRITE_DETAIL === "1") {
    const detailsDir = path.join(dataDir, "details");
    fs.mkdirSync(detailsDir, { recursive: true });
    fs.writeFileSync(path.join(detailsDir, id + ".json"), JSON.stringify({
      id,
      title: "Fresh enriched detail",
      analysis: { conclusion: { advice: "approve" }, fieldAnalysis: [], ruleAnalysis: [] },
    }));
  }
  if (process.env.FAKE_ENRICH_WRITE_INBOX === "1") {
    const inboxPath = path.join(dataDir, "inbox.json");
    const state = JSON.parse(fs.readFileSync(inboxPath, "utf-8"));
    if (state.items && state.items[0]) state.items[0].title = "STALE_ENRICH_STATE";
    fs.writeFileSync(inboxPath, JSON.stringify(state, null, 2));
  }
  if (process.env.FAKE_ENRICH_WRITE_ATTACHMENT === "1") {
    const attachmentDir = path.join(dataDir, "attachments", id);
    fs.mkdirSync(attachmentDir, { recursive: true });
    fs.writeFileSync(path.join(attachmentDir, "proof.txt"), "staged attachment");
  }
  const failed = process.env.FAKE_ENRICH_FAIL === "1";
  process.stdout.write(JSON.stringify({
    processed: 1,
    results: failed
      ? [{ id: "m1", step: "done", analysis: null, analysisError: "agent_failed" }]
      : [{ id: "m1", step: "done", analysis: { conclusion: { advice: "approve" } } }],
  }));
}, Number(process.env.FAKE_ENRICH_DELAY || 0));
`, "utf-8");
  return file;
}

function writeState(dataDir, items, meta = undefined) {
  mkdirSync(join(dataDir, "details"), { recursive: true });
  const state = {
    businessType: "approve-inbox",
    items,
    summary: { total: items.length, pendingCount: items.filter((i) => i.status !== "done").length, doneCount: items.filter((i) => i.status === "done").length },
  };
  if (meta) state.meta = meta;
  writeFileSync(join(dataDir, "inbox.json"), JSON.stringify(state, null, 2), "utf-8");
}

function readState(dataDir) {
  return JSON.parse(readFileSync(join(dataDir, "inbox.json"), "utf-8"));
}

function readCliCalls(ctx) {
  const file = join(ctx.dir, "cli-args.json");
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf-8").trim();
  return text ? text.split("\n").map((line) => JSON.parse(line)) : [];
}

function readEnrichCalls(ctx) {
  const file = join(ctx.dir, "enrich-args.json");
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf-8").trim();
  return text ? text.split("\n").map((line) => JSON.parse(line)) : [];
}

async function waitFor(predicate, message) {
  for (let i = 0; i < 80; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

async function waitForServer(baseUrl) {
  let lastError;
  for (let i = 0; i < 50; i++) {
    try {
      const resp = await fetch(`${baseUrl}/api/inbox`);
      if (resp.ok) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw lastError || new Error("server did not start");
}

async function waitForRoot(baseUrl) {
  let lastError;
  for (let i = 0; i < 50; i++) {
    try {
      const resp = await fetch(`${baseUrl}/`);
      if (resp.ok) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw lastError || new Error("server did not start");
}

function serverEnv({ port, dataDir, cliPath, profileDir, mode, dir, extraEnv = {} }) {
  return {
    ...process.env,
    APPROVE_INBOX_PORT: String(port),
    APPROVE_INBOX_AUTO: "0",
    APPROVE_INBOX_AUTO_SYNC: "0",
    APPROVE_INBOX_DATA: dataDir,
    APPROVE_INBOX_PROFILE_DIR: profileDir || "",
    APPROVE_INBOX_APPROVAL_TRANSPORT: "cli",
    APPROVE_INBOX_SKIP_CLI_AUTH_CHECK: "1",
    APPROVE_INBOX_AUTH_MODE: "local-dev",
    BIP_CLI_PATH: cliPath,
    FAKE_APPROVE_MODE: mode,
    FAKE_CLI_LOG: join(dir, "cli-args.json"),
    ...extraEnv,
  };
}

async function startServer({ mode = "success", items, meta, extraEnv = {}, fakeEnrichDelay = null, allowUnavailable = false }) {
  const dir = tempDir();
  const dataDir = join(dir, "data");
  mkdirSync(dataDir, { recursive: true });
  writeState(dataDir, items, meta);
  const profileDir = join(dir, "profile");
  const cliPath = writeFakeCli(join(profileDir, "userData", "runtime", "openclaw", "skills", "iuap-apcom-cli", "scripts"));
  const enrichEnv = fakeEnrichDelay === null ? {} : {
    APPROVE_INBOX_ENRICH_SCRIPT: writeFakeEnrich(dir),
    FAKE_ENRICH_LOG: join(dir, "enrich-args.json"),
    FAKE_ENRICH_DELAY: String(fakeEnrichDelay),
  };
  const port = await getFreePort();
  const baseUrl = `http://localhost:${port}`;
  const proc = spawn(process.execPath, ["skills/iuap-apcom-myapproval/web/server.mjs"], {
    cwd: process.cwd(),
    env: serverEnv({ port, dataDir, cliPath, profileDir, mode, dir, extraEnv: { ...enrichEnv, ...extraEnv } }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (process.env.APPROVE_INBOX_TEST_DEBUG === "1") proc.stderr.pipe(process.stderr);
  servers.push(proc);
  if (allowUnavailable) await waitForRoot(baseUrl);
  else await waitForServer(baseUrl);
  return { proc, baseUrl, dataDir, dir };
}

async function startServerWithoutState({ mode = "success" } = {}) {
  const dir = tempDir();
  const dataDir = join(dir, "data");
  mkdirSync(dataDir, { recursive: true });
  const profileDir = join(dir, "profile");
  const cliPath = writeFakeCli(join(profileDir, "userData", "runtime", "openclaw", "skills", "iuap-apcom-cli", "scripts"));
  const port = await getFreePort();
  const baseUrl = `http://localhost:${port}`;
  const proc = spawn(process.execPath, ["skills/iuap-apcom-myapproval/web/server.mjs"], {
    cwd: process.cwd(),
    env: serverEnv({ port, dataDir, cliPath, profileDir, mode, dir }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (process.env.APPROVE_INBOX_TEST_DEBUG === "1") proc.stderr.pipe(process.stderr);
  servers.push(proc);
  await waitForRoot(baseUrl);
  return { proc, baseUrl, dataDir, dir };
}

async function stopServer(ctx) {
  try {
    await fetch(`${ctx.baseUrl}/api/shutdown`, { method: "POST" });
  } catch {
    // ignore
  }
  ctx.proc.kill();
}

afterEach(async () => {
  while (servers.length) {
    const proc = servers.pop();
    if (!proc.killed) proc.kill();
  }
});

describe("/api/approve", () => {
  it("认证 401 时刷新不返回旧身份缓存且不启动分析", async () => {
    const ctx = await startServer({
      items: [{ id: "old-a", title: "用户 A 的待办", status: "pending", riskLevel: "high" }],
      fakeEnrichDelay: 0,
      allowUnavailable: true,
      extraEnv: {
        APPROVE_INBOX_AUTO: "0",
        APPROVE_INBOX_AUTO_SYNC: "1",
        APPROVE_INBOX_AUTH_MODE: "managed-yonwork",
        APPROVE_INBOX_SKIP_CLI_AUTH_CHECK: "0",
        YONCLAW_REQ_PROXY_BASE_URL: "http://managed-proxy.invalid",
        FAKE_CLI_AUTH: "401",
      },
    });

    const resp = await fetch(`${ctx.baseUrl}/api/sync`, { method: "POST" });
    const body = await resp.json();

    assert.equal(resp.status, 401);
    assert.equal(body.success, false);
    assert.equal(body.issue.code, "AUTH_REQUIRED_IN_YONWORK");
    assert.equal(body.cache.visible, false);
    assert.equal(Object.hasOwn(body, "data"), false);
    assert.equal(body.analysis.started, false);
    assert.deepEqual(readEnrichCalls(ctx), []);
    await stopServer(ctx);
  });

  it("persists and validates personal rules customized through YonWork", async () => {
    const ctx = await startServer({
      items: [{ id: "m1", title: "请购单", status: "pending", riskLevel: "medium" }],
    });
    const config = {
      version: 1,
      enabled: true,
      rules: [{
        id: "purchase-large-amount",
        ruleName: "大额采购复核",
        checkpoint: "采购金额超过 10 万元时必须由部门负责人复核",
        severityHint: "warning",
        match: ["请购", "采购"],
      }],
    };
    const normalizedConfig = {
      ...config,
      fieldDisplay: {
        enabled: true,
        instructions: "",
        pinnedFields: [],
        hiddenFields: [],
        collapsedFields: [],
      },
    };

    const writeResp = await fetch(`${ctx.baseUrl}/api/personal-rules-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config, reanalyze: false }),
    });
    assert.equal(writeResp.status, 200);
    assert.deepEqual(await writeResp.json(), {
      success: true,
      config: normalizedConfig,
      reanalysis: { queued: false, reason: "disabled" },
    });

    const readResp = await fetch(`${ctx.baseUrl}/api/personal-rules-config`);
    assert.deepEqual(await readResp.json(), normalizedConfig);
    assert.equal(existsSync(join(ctx.dataDir, "personal-rules.config.json")), true);

    const invalidResp = await fetch(`${ctx.baseUrl}/api/personal-rules-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { ...config, unexpected: true }, reanalyze: false }),
    });
    assert.equal(invalidResp.status, 400);
    await stopServer(ctx);
  });

  it("reanalyzes pending items after saving personal rules", async () => {
    const ctx = await startServer({
      items: [{
        id: "m1",
        title: "请购单",
        status: "pending",
        webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1",
      }],
      fakeEnrichDelay: 20,
    });
    const config = {
      version: 1,
      enabled: true,
      rules: [{ id: "purchase-check", ruleName: "采购复核", checkpoint: "核验采购金额" }],
    };

    const writeResp = await fetch(`${ctx.baseUrl}/api/personal-rules-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    });
    const written = await writeResp.json();
    assert.equal(writeResp.status, 200);
    assert.deepEqual(written.reanalysis, { queued: true, count: 1 });

    await waitFor(async () => {
      const status = await fetch(`${ctx.baseUrl}/api/sync-status`).then((resp) => resp.json());
      return status.running === false && status.lastResult?.success === true;
    }, "personal rule reanalysis did not finish");

    const calls = readEnrichCalls(ctx);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "--data");
    assert.match(calls[0][1], new RegExp(`^${join(ctx.dataDir, ".staging").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.deepEqual(calls[0].slice(2), ["--limit", "1", "--force", "--pending-only"]);
    await stopServer(ctx);
  });

  it("defers personal rule reanalysis while another analysis is running", async () => {
    const ctx = await startServer({
      items: [{
        id: "m1",
        title: "请购单",
        status: "pending",
        webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1",
      }],
      fakeEnrichDelay: 150,
    });
    const postConfig = (checkpoint) => fetch(`${ctx.baseUrl}/api/personal-rules-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          version: 1,
          enabled: true,
          rules: [{ id: "purchase-check", ruleName: "采购复核", checkpoint }],
        },
      }),
    }).then((resp) => resp.json());

    assert.deepEqual((await postConfig("第一次规则")).reanalysis, { queued: true, count: 1 });
    assert.deepEqual((await postConfig("更新后的规则")).reanalysis, {
      queued: true,
      deferred: true,
      reason: "analysis_running",
      count: 1,
    });

    await waitFor(async () => {
      const status = await fetch(`${ctx.baseUrl}/api/sync-status`).then((resp) => resp.json());
      return status.running === false && status.lastResult?.success === true && readEnrichCalls(ctx).length === 2;
    }, "deferred personal rule reanalysis did not finish");

    assert.equal(readEnrichCalls(ctx).length, 2);
    await stopServer(ctx);
  });

  it("reports a failed personal rule reanalysis instead of claiming it applied", async () => {
    const ctx = await startServer({
      items: [{
        id: "m1",
        title: "请购单",
        status: "pending",
        webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1",
      }],
      fakeEnrichDelay: 10,
      extraEnv: { FAKE_ENRICH_FAIL: "1" },
    });

    const writeResp = await fetch(`${ctx.baseUrl}/api/personal-rules-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          version: 1,
          enabled: true,
          rules: [{ id: "purchase-check", ruleName: "采购复核", checkpoint: "核验采购金额" }],
        },
      }),
    });
    assert.equal(writeResp.status, 200);

    let finalStatus;
    await waitFor(async () => {
      finalStatus = await fetch(`${ctx.baseUrl}/api/sync-status`).then((resp) => resp.json());
      return finalStatus.running === false && finalStatus.lastResult;
    }, "failed personal rule reanalysis did not report a result");

    assert.equal(finalStatus.lastResult.success, false);
    assert.match(finalStatus.lastResult.error, /analysis_failed:m1:agent_failed/);
    await stopServer(ctx);
  });

  it("rejects invalid attachment ids before resolving local paths", async () => {
    const ctx = await startServer({
      items: [{ id: "m1", title: "请购单", status: "pending", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
    });

    const resp = await fetch(`${ctx.baseUrl}/api/attachments/bad%2Fid/file.pdf`);
    const json = await resp.json();

    assert.equal(resp.status, 400);
    assert.equal(json.error, "Invalid attachment id");
    await stopServer(ctx);
  });

  it("serves URL-encoded Chinese attachment filenames", async () => {
    const ctx = await startServer({
      items: [{ id: "m1", title: "请购单", status: "pending", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
    });
    const dir = join(ctx.dataDir, "attachments", "m1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "请购单_增强说明版.docx"), "fake-docx", "utf-8");
    writeFileSync(join(ctx.dataDir, "details", "m1.json"), JSON.stringify({
      id: "m1",
      content: { attachments: [{ fileName: "请购单_增强说明版.docx" }] },
    }), "utf-8");

    const resp = await fetch(`${ctx.baseUrl}/api/attachments/m1/${encodeURIComponent("请购单_增强说明版.docx")}`);
    const body = await resp.text();

    assert.equal(resp.status, 200);
    assert.equal(body, "fake-docx");
    assert.match(resp.headers.get("content-type") || "", /officedocument/);
    await stopServer(ctx);
  });

  it("converts office attachments to html preview when requested", async () => {
    const seedDir = tempDir();
    const fakeBin = writeFakeTextutil(seedDir);
    const ctx = await startServer({
      items: [{ id: "m1", title: "请购单", status: "pending", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      extraEnv: { PATH: `${fakeBin}:${process.env.PATH || ""}` },
    });
    const dir = join(ctx.dataDir, "attachments", "m1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "合同.docx"), "fake-docx", "utf-8");
    writeFileSync(join(ctx.dataDir, "details", "m1.json"), JSON.stringify({
      id: "m1",
      content: { attachments: [{ fileName: "合同.docx" }] },
    }), "utf-8");

    const resp = await fetch(`${ctx.baseUrl}/api/attachments/m1/${encodeURIComponent("合同.docx")}?preview=html`);
    const body = await resp.text();

    assert.equal(resp.status, 200);
    assert.match(resp.headers.get("content-type") || "", /text\/html/);
    assert.match(body, /Converted Preview/);
    await stopServer(ctx);
  });

  it("does not serve an attachment file absent from the current detail manifest", async () => {
    const ctx = await startServer({
      items: [{ id: "m1", title: "请购单", status: "pending" }],
    });
    const dir = join(ctx.dataDir, "attachments", "m1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "old-secret.txt"), "OLD_SECRET", "utf-8");
    writeFileSync(join(ctx.dataDir, "details", "m1.json"), JSON.stringify({
      id: "m1",
      content: { attachments: [{ fileName: "current.txt" }] },
    }), "utf-8");

    const resp = await fetch(`${ctx.baseUrl}/api/attachments/m1/old-secret.txt`);
    assert.equal(resp.status, 404);
    assert.equal((await resp.text()).includes("OLD_SECRET"), false);
    await stopServer(ctx);
  });

  it("does not fall back to sample inbox when real state is missing", async () => {
    const ctx = await startServerWithoutState();

    const resp = await fetch(`${ctx.baseUrl}/api/inbox`);
    const json = await resp.json();

    assert.equal(resp.status, 503);
    assert.equal(json.success, false);
    assert.equal(json.dataSource, "unavailable");
    assert.notEqual(json.dataSource, "sample");
    await stopServer(ctx);
  });

  it("projects overall analysis into the list AI suggestion", async () => {
    const ctx = await startServer({
      items: [{ id: "m1", title: "请购单", status: "pending", riskLevel: "medium", advice: "caution" }],
    });
    writeFileSync(join(ctx.dataDir, "details", "m1.json"), JSON.stringify({
      id: "m1",
      analysis: {
        conclusion: { advice: "caution" },
        overallAnalysis: "请购金额超预算，建议补充预算审批后再提交。",
        ruleAnalysis: [],
      },
    }, null, 2));

    const resp = await fetch(`${ctx.baseUrl}/api/inbox`);
    const json = await resp.json();

    assert.equal(resp.status, 200);
    assert.equal(json.items[0].aiSuggestion, "请购金额超预算，建议补充预算审批后再提交。");
    await stopServer(ctx);
  });

  it("serves the smart todo widget and dynamic manifest", async () => {
    const ctx = await startServer({
      items: [{ id: "m1", title: "请购单", status: "pending", riskLevel: "high", dueAt: "2026-06-29T12:00:00.000Z" }],
    });

    const page = await fetch(`${ctx.baseUrl}/widget/`);
    const manifestResp = await fetch(`${ctx.baseUrl}/widget/manifest.json?returnTo=${encodeURIComponent("http://localhost:5173/cockpit")}`);
    const manifest = await manifestResp.json();
    const pageHtml = await page.text();

    assert.equal(page.status, 200);
    assert.match(pageHtml, /待办概览/);
    assert.doesNotMatch(pageHtml, /widget-header|btnRefresh|<h1>智能待办/);
    assert.equal(manifest.id, "approve-inbox-smart-todo");
    assert.equal(manifest.skillId, "iuap-apcom-myapproval");
    assert.deepEqual(manifest.skillAliases, ["iuap-apcom-approval", "iuap-apcom-approveinbox", "approve-inbox"]);
    assert.equal(manifest.cockpitCatalogId, "builtin-business-approve-inbox");
    assert.equal(manifest.catalogId, "builtin-business-approve-inbox");
    assert.equal(manifest.catalogItemId, "builtin-business-approve-inbox");
    assert.equal(manifest.sourceWidgetId, "builtin-business-approve-inbox");
    assert.equal(manifest.cockpitBinding.componentId, "builtin-business-approve-inbox");
    assert.equal(manifest.cockpitBinding.businessType, "approval-message-center");
    assert.equal(manifest.cockpitBinding.dataSource.skillId, "iuap-apcom-myapproval");
    assert.equal(manifest.type, "iframe");
    assert.equal(manifest.entryUrl, `${ctx.baseUrl}/widget/?returnTo=${encodeURIComponent("http://localhost:5173/cockpit")}`);
    assert.equal(manifest.dataUrl, `${ctx.baseUrl}/api/widget/todos`);
    assert.equal(manifest.dataPath, "/api/widget/todos");
    assert.equal(manifest.cockpitDataUrl, `${ctx.baseUrl}/api/widget/cockpit`);
    assert.equal(manifest.cockpitDataPath, "/api/widget/cockpit");
    assert.equal(manifest.centerEmbedUrl, `${ctx.baseUrl}/?embed=cockpit-drawer`);
    assert.equal(manifest.centerEmbedPath, "/?embed=cockpit-drawer");
    assert.equal(manifest.link.url, `${ctx.baseUrl}/?embed=cockpit-drawer`);
    assert.equal(manifest.link.contentType, "iframe");
    assert.equal(manifest.link.allowFullscreen, true);
    assert.equal(manifest.cockpitBinding.componentId, "builtin-business-approve-inbox");
    assert.equal(manifest.cockpitBinding.defaultComposition, "single-preset-business-widget");
    assert.equal(manifest.cockpitBinding.forbidDefaultVisualizations, true);
    assert.equal(manifest.cockpitBinding.visualizationOptInFlag, "dataIntent.allowApproveInboxVisualization");
    assert.equal(manifest.cockpitBinding.dataSource.skillId, "iuap-apcom-myapproval");
    assert.equal(manifest.refreshUrl, `${ctx.baseUrl}/api/widget/refresh?returnTo=${encodeURIComponent("http://localhost:5173/cockpit")}`);
    assert.equal(manifest.refreshPath, "/api/widget/refresh");
    assert.equal(manifest.refreshMethod, "POST");
    assert.equal(manifest.runtimeContextPath, "/api/runtime-context");
    assert.deepEqual(manifest.capabilities.includes("return-to-cockpit"), false);
    await stopServer(ctx);
  });

  it("serves a cockpit drawer embed page without standalone chrome", async () => {
    const ctx = await startServer({
      items: [{ id: "m1", title: "请购单", status: "pending", riskLevel: "medium" }],
    });

    const resp = await fetch(`${ctx.baseUrl}/?embed=cockpit-drawer`);
    const html = await resp.text();

    assert.equal(resp.status, 200);
    assert.match(html, /is-cockpit-embed/);
    assert.match(html, /HOST_OWNS_DETAIL/);
    assert.match(html, /!HOST_OWNS_DETAIL && state\.activeItemId && state\.detail/);
    assert.match(html, /approve-inbox:request-detail/);
    assert.match(html, /detailUrl/);
    assert.match(html, /@media \(max-width: 920px\)[\s\S]*?\.yc-approve-inbox-shell-drawer \{[\s\S]*?position: fixed;[\s\S]*?bottom: 0;[\s\S]*?top: auto;[\s\S]*?height: 100dvh;[\s\S]*?border-radius: 18px 18px 0 0;/);
    assert.match(html, /body\.sheet-open \.yc-sheet-overlay \{ opacity: 1; pointer-events: auto; \}/);
    assert.doesNotMatch(html, /<header class="app-header">/);
    assert.doesNotMatch(html, /id="btnReturn"/);
    assert.doesNotMatch(html, /id="btnSync"/);
    assert.doesNotMatch(html, /id="btnYonClawOpen"/);
    assert.match(html, /if \(status !== 'success'\) return '';/);
    await stopServer(ctx);
  });

  it("returns originalUrl on detail fallback from the state item webUrl", async () => {
    const originalUrl = "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1";
    const ctx = await startServer({
      items: [{ id: "m1", title: "请购单", status: "pending", riskLevel: "medium", webUrl: originalUrl }],
    });

    const resp = await fetch(`${ctx.baseUrl}/api/details/m1`);
    const json = await resp.json();

    assert.equal(resp.status, 200);
    assert.equal(json.dataSource, "real");
    assert.equal(json.originalUrl, originalUrl);
    await stopServer(ctx);
  });

  it("binds a controlled enrich result to the unchanged current snapshot", async () => {
    const ctx = await startServer({
      items: [{ id: "m1", title: "请购单", status: "pending" }],
      meta: { snapshotId: "snapshot-current" },
      fakeEnrichDelay: 20,
      extraEnv: { FAKE_ENRICH_WRITE_DETAIL: "1" },
    });

    const queued = await fetch(`${ctx.baseUrl}/api/enrich/m1`, { method: "POST" });
    assert.equal(queued.status, 200);
    await waitFor(async () => {
      const status = await fetch(`${ctx.baseUrl}/api/enrich-status/m1`).then((resp) => resp.json());
      return status.status === "done";
    }, "enriched detail was not bound to its snapshot");

    const raw = JSON.parse(readFileSync(join(ctx.dataDir, "details", "m1.json"), "utf-8"));
    assert.equal(raw._approveInbox.snapshotId, "snapshot-current");
    assert.match(raw._approveInbox.scopeKey, /^[a-f0-9]{64}$/);
    const detail = await fetch(`${ctx.baseUrl}/api/details/m1`);
    assert.equal(detail.status, 200);
    await stopServer(ctx);
  });

  it("keeps a late enrich process from overwriting a newer inbox snapshot", async () => {
    const ctx = await startServer({
      items: [{ id: "m1", title: "Original snapshot", status: "pending" }],
      meta: { snapshotId: "snapshot-original" },
      fakeEnrichDelay: 180,
      extraEnv: {
        FAKE_ENRICH_WRITE_DETAIL: "1",
        FAKE_ENRICH_WRITE_INBOX: "1",
      },
    });

    const queued = await fetch(`${ctx.baseUrl}/api/enrich/m1`, { method: "POST" });
    assert.equal(queued.status, 200);
    await waitFor(() => readEnrichCalls(ctx).length === 1, "enrich process did not start");
    writeState(
      ctx.dataDir,
      [{ id: "m1", title: "Newer synchronized snapshot", status: "pending" }],
      { snapshotId: "snapshot-newer" },
    );
    await waitFor(async () => {
      const status = await fetch(`${ctx.baseUrl}/api/enrich-status/m1`).then((resp) => resp.json());
      return status.status === "error";
    }, "late enrich process was not rejected");

    const live = readState(ctx.dataDir);
    assert.equal(live.meta.snapshotId, "snapshot-newer");
    assert.equal(live.items[0].title, "Newer synchronized snapshot");
    assert.equal(existsSync(join(ctx.dataDir, "details", "m1.json")), false);
    await stopServer(ctx);
  });

  it("keeps the service alive and marks the job failed when enrich promotion throws", async () => {
    const ctx = await startServer({
      items: [{ id: "m1", title: "请购单", status: "pending" }],
      meta: { snapshotId: "snapshot-current" },
      fakeEnrichDelay: 180,
      extraEnv: { FAKE_ENRICH_WRITE_ATTACHMENT: "1" },
    });

    const queued = await fetch(`${ctx.baseUrl}/api/enrich/m1`, { method: "POST" });
    assert.equal(queued.status, 200);
    await waitFor(() => readEnrichCalls(ctx).length === 1, "enrich process did not start");
    mkdirSync(join(ctx.dataDir, "attachments"), { recursive: true });
    writeFileSync(join(ctx.dataDir, "attachments", "m1"), "blocks destination directory", "utf-8");

    let finalStatus;
    await waitFor(async () => {
      finalStatus = await fetch(`${ctx.baseUrl}/api/enrich-status/m1`).then((resp) => resp.json());
      return finalStatus.status === "error";
    }, "promotion exception was not captured as a job failure");

    assert.match(finalStatus.error, /EEXIST|exist|directory/i);
    assert.equal(ctx.proc.exitCode, null);
    const health = await fetch(`${ctx.baseUrl}/api/service-identity`);
    assert.equal(health.status, 200);
    await stopServer(ctx);
  });

  it("returns detail immediately and refreshes cloud audit separately", async () => {
    const ctx = await startServer({
      items: [{
        id: "m1",
        title: "请购单",
        status: "pending",
        riskLevel: "medium",
        taskId: "task-1",
        workflowBusinessKey: "biz-1",
        webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1",
      }],
      extraEnv: { FAKE_AUDIT_DELAY: "600" },
    });
    writeFileSync(join(ctx.dataDir, "details", "m1.json"), JSON.stringify({
      id: "m1",
      title: "请购单",
      analysis: {
        conclusion: { advice: "approve", label: "建议通过" },
        fieldAnalysis: [{ name: "金额", value: "100", summary: "预算内", severity: "passed" }],
      },
    }, null, 2));

    const startedAt = Date.now();
    const first = await (await fetch(`${ctx.baseUrl}/api/details/m1`)).json();
    const detailElapsed = Date.now() - startedAt;
    let auditCalls = readCliCalls(ctx).filter((call) => call.commandPath === "workflow inboxtask get-intelligent-result");

    assert.ok(detailElapsed < 300, `base detail should not wait for cloud audit (${detailElapsed}ms)`);
    assert.equal(auditCalls.length, 0);
    assert.equal(first.compositeAdvice.source, "user");

    const refreshedFirst = await (await fetch(`${ctx.baseUrl}/api/system-rule-audit/m1`)).json();
    const cached = await (await fetch(`${ctx.baseUrl}/api/details/m1`)).json();
    const refreshedSecond = await (await fetch(`${ctx.baseUrl}/api/system-rule-audit/m1`)).json();
    auditCalls = readCliCalls(ctx).filter((call) => call.commandPath === "workflow inboxtask get-intelligent-result");

    assert.equal(auditCalls.length, 2);
    assert.deepEqual(auditCalls[0].input, { taskId: "task-1", businessKey: "biz-1" });
    assert.deepEqual(auditCalls[1].input, { taskId: "task-1", businessKey: "biz-1" });
    assert.equal(refreshedFirst.systemRuleAudit.resultId, "res-1");
    assert.equal(refreshedFirst.compositeAdvice.advice, "reject");
    assert.equal(refreshedFirst.compositeAdvice.source, "system");
    assert.equal(refreshedFirst.compositeAdvice.conflict, true);
    assert.equal(cached.systemRuleAudit.resultId, "res-1");
    assert.equal(cached.compositeAdvice.advice, "reject");
    assert.equal(refreshedSecond.systemRuleAudit.resultId, "res-2");
    assert.equal(refreshedSecond.compositeAdvice.advice, "approve");
    assert.equal(refreshedSecond.conclusion.advice, "approve");
    await stopServer(ctx);
  });

  it("returns compact widget todo data without requiring full inbox navigation", async () => {
    const ctx = await startServer({
      items: [
        { id: "m1", title: "高风险请购单", status: "pending", riskLevel: "high", advice: "reject", dueAt: "2026-06-29T12:00:00.000Z", smartTags: [{ label: "超预算", kind: "risk" }] },
        { id: "m2", title: "需关注待办", status: "pending", riskLevel: "medium", advice: "caution" },
        { id: "m3", title: "已办", status: "done", riskLevel: "high" },
      ],
    });

    const resp = await fetch(`${ctx.baseUrl}/api/widget/todos?limit=1&returnTo=${encodeURIComponent("http://localhost:5173/cockpit")}`);
    const json = await resp.json();

    assert.equal(resp.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.businessType, "approve-inbox-widget");
    assert.equal(json.summary.pendingCount, 2);
    assert.equal(json.summary.highPriorityCount, 1);
    assert.equal(json.summary.attentionCount, 1);
    assert.equal(Object.hasOwn(json.summary, "dueSoonCount"), false);
    assert.equal(json.items.length, 1);
    assert.equal(json.items[0].id, "m1");
    assert.equal(json.items[0].tags[0].label, "超预算");
    assert.equal(Object.hasOwn(json.items[0], "dueSoon"), false);
    assert.equal(json.actions.openCenterUrl, `${ctx.baseUrl}/?returnTo=${encodeURIComponent("http://localhost:5173/cockpit")}`);
    assert.equal(json.skillId, "iuap-apcom-myapproval");
    assert.deepEqual(json.skillAliases, ["iuap-apcom-approval", "iuap-apcom-approveinbox", "approve-inbox"]);
    assert.equal(json.link.url, `${ctx.baseUrl}/?embed=cockpit-drawer`);
    assert.equal(json.link.contentType, "iframe");
    assert.equal(json.link.allowFullscreen, true);
    await stopServer(ctx);
  });

  it("returns cockpit widget data with a fixed detail drawer link", async () => {
    const ctx = await startServer({
      items: [
        { id: "m1", title: "需关注待办", status: "pending", riskLevel: "medium", advice: "caution" },
      ],
    });

    const resp = await fetch(`${ctx.baseUrl}/api/widget/cockpit?limit=1`);
    const json = await resp.json();

    assert.equal(resp.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.businessType, "approval-message-center");
    assert.equal(json.skillId, "iuap-apcom-myapproval");
    assert.deepEqual(json.skillAliases, ["iuap-apcom-approval", "iuap-apcom-approveinbox", "approve-inbox"]);
    assert.equal(json.todoStats.todo, 1);
    assert.equal(json.link.url, `${ctx.baseUrl}/?embed=cockpit-drawer`);
    assert.equal(json.link.contentType, "iframe");
    assert.equal(json.link.allowFullscreen, true);
    await stopServer(ctx);
  });

  it("lets the cockpit refresh widget data without triggering heavy analysis", async () => {
    const ctx = await startServer({
      items: [
        { id: "m1", title: "需关注待办", status: "pending", riskLevel: "medium", advice: "caution" },
      ],
    });

    const resp = await fetch(`${ctx.baseUrl}/api/widget/refresh?limit=1`, { method: "POST" });
    const json = await resp.json();

    assert.equal(resp.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.businessType, "approve-inbox-widget");
    assert.equal(json.summary.attentionCount, 1);
    assert.equal(json.items.length, 1);
    assert.equal(json.sync.skipped, "disabled");
    assert.equal(json.sync.scope, "currentTenant");
    assert.equal(json.sync.pending, 1);
    assert.equal(json.sync.total, 1);
    assert.equal(Object.hasOwn(json, "analysis"), false);
    await stopServer(ctx);
  });

  it("projects widget refresh sync counts to current tenant instead of raw inbox totals", async () => {
    const ctx = await startServer({
      meta: { currentTenantId: "tenant-a", currentTenantName: "本租户" },
      items: [
        { id: "m1", title: "本租户待办", status: "pending", riskLevel: "medium", tenantId: "tenant-a" },
        { id: "m2", title: "跨租户待办", status: "pending", riskLevel: "high", tenantId: "tenant-b" },
      ],
    });

    const resp = await fetch(`${ctx.baseUrl}/api/widget/refresh`, { method: "POST" });
    const json = await resp.json();

    assert.equal(resp.status, 200);
    assert.equal(json.summary.pendingCount, 1);
    assert.equal(json.sync.scope, "currentTenant");
    assert.equal(json.sync.currentTenant, undefined);
    assert.equal(json.sync.total, 1);
    assert.equal(json.sync.pending, 1);
    assert.equal(json.magicSummary, "待办 1 项，需关注 1 项，主要类型为「审批单」。");
    await stopServer(ctx);
  });

  it("does not expose local runtime paths over HTTP unless explicitly enabled", async () => {
    const ctx = await startServer({
      items: [{ id: "m1", title: "请购单", status: "pending", riskLevel: "medium" }],
    });

    const resp = await fetch(`${ctx.baseUrl}/api/runtime-context?full=1`);
    const json = await resp.json();

    assert.equal(resp.status, 200);
    assert.equal(json.skillId, "iuap-apcom-myapproval");
    assert.equal(json.widgetUrl, `${ctx.baseUrl}/widget/`);
    assert.equal(json.centerEmbedUrl, `${ctx.baseUrl}/?embed=cockpit-drawer`);
    assert.equal(json.dataAvailable, true);
    assert.equal(Object.hasOwn(json, "skillDir"), false);
    assert.equal(Object.hasOwn(json, "dataDir"), false);
    await stopServer(ctx);
  });

  it("blocks widget static path traversal", async () => {
    const ctx = await startServer({
      items: [{ id: "m1", title: "请购单", status: "pending", riskLevel: "medium" }],
    });

    const resp = await fetch(`${ctx.baseUrl}/widget/..%2Fweb%2Fserver.mjs`);
    const json = await resp.json();

    assert.equal(resp.status, 400);
    assert.equal(json.error, "Invalid widget path");
    await stopServer(ctx);
  });

  it("does not fake sample approval when real state is missing", async () => {
    const ctx = await startServerWithoutState();

    const resp = await fetch(`${ctx.baseUrl}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["m1"], action: "approve", comment: "同意" }),
    });
    const json = await resp.json();

    assert.equal(resp.status, 503);
    assert.equal(json.success, false);
    assert.equal(json.mode, "real");
    assert.deepEqual(json.completed, []);
    await stopServer(ctx);
  });

  it("moves items to done only after CLI success", async () => {
    const ctx = await startServer({
      items: [{ id: "m1", title: "请购单", status: "pending", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
    });

    const resp = await fetch(`${ctx.baseUrl}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["m1"], action: "approve", comment: "同意" }),
    });
    const json = await resp.json();
    const state = readState(ctx.dataDir);

    assert.equal(json.success, true);
    assert.deepEqual(json.completed, ["m1"]);
    assert.equal(state.items[0].status, "done");
    const calls = readCliCalls(ctx);
    assert.equal(calls[0].commandPath, "workflow inboxtask list-action");
    assert.deepEqual(calls[0].input, {
      taskId: "task-1",
      todoId: "m1",
      webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1",
    });
    assert.equal(calls[1].commandPath, "workflow task batch-approve");
    assert.deepEqual(calls[1].input, { primaryIds: JSON.stringify(["m1"]), content: "同意" });
    assert.deepEqual(calls[1].args, [
      "workflow",
      "task",
      "batch-approve",
      "--input",
      "-",
      "--format",
      "json",
    ]);
    await stopServer(ctx);
  });

  it("moves MDF reject to done through CLI batch-reject", async () => {
    const ctx = await startServer({
      items: [{ id: "m1", title: "请购单", status: "pending", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
    });

    const resp = await fetch(`${ctx.baseUrl}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["m1"], action: "reject", comment: "资料不完整" }),
    });
    const json = await resp.json();
    const state = readState(ctx.dataDir);

    assert.equal(json.success, true);
    assert.deepEqual(json.completed, ["m1"]);
    assert.equal(state.items[0].status, "done");
    assert.equal(state.items[0].completedAction, "reject");
    const calls = readCliCalls(ctx);
    assert.equal(calls[0].commandPath, "workflow inboxtask list-action");
    assert.equal(calls[1].commandPath, "workflow task batch-reject");
    assert.deepEqual(calls[1].input, { primaryIds: JSON.stringify(["m1"]), content: "资料不完整" });
    assert.deepEqual(calls[1].args, [
      "workflow",
      "task",
      "batch-reject",
      "--input",
      "-",
      "--format",
      "json",
    ]);
    await stopServer(ctx);
  });

  it("does not move items when CLI fails", async () => {
    const ctx = await startServer({
      mode: "fail",
      items: [{ id: "m1", title: "请购单", status: "pending", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
    });

    const resp = await fetch(`${ctx.baseUrl}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["m1"], action: "approve", comment: "同意" }),
    });
    const json = await resp.json();
    const state = readState(ctx.dataDir);

    assert.equal(json.success, false);
    assert.deepEqual(json.completed, []);
    assert.equal(state.items[0].status, "pending");
    await stopServer(ctx);
  });

  it("reports a local CLI argument rejection as confirmed failed without reconciliation", async () => {
    const ctx = await startServer({
      mode: "argfail",
      items: [{ id: "m1", title: "请购单", status: "pending", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
    });

    const resp = await fetch(`${ctx.baseUrl}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["m1"], action: "approve", comment: "同意" }),
    });
    const json = await resp.json();
    const state = readState(ctx.dataDir);

    assert.equal(resp.status, 200);
    assert.equal(json.success, false);
    assert.equal(json.results[0].code, "CLI_REQUEST_REJECTED_BEFORE_SEND");
    assert.equal(json.results[0].remoteOutcome, "confirmed_failed");
    assert.equal(json.reconciliationRequired, undefined);
    assert.equal(json.issue, undefined);
    assert.equal(state.items[0].status, "pending");
    await stopServer(ctx);
  });

  it("blocks cross-tenant items before calling CLI", async () => {
    const ctx = await startServer({
      meta: { currentTenantId: "tenant-a", currentTenantName: "本租户" },
      items: [{
        id: "m1",
        title: "跨租户请购单",
        status: "pending",
        tenantId: "tenant-b",
        tenantName: "其他租户",
        runtimeActions: [{ action: "approve", enabled: true }],
        webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1",
      }],
    });

    const resp = await fetch(`${ctx.baseUrl}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["m1"], action: "approve", comment: "同意" }),
    });
    const json = await resp.json();
    const state = readState(ctx.dataDir);

    assert.equal(json.success, false);
    assert.deepEqual(json.completed, []);
    assert.equal(json.results[0].type, "unavailable");
    assert.match(json.results[0].error, /不属于当前租户作用域/);
    assert.equal(state.items[0].status, "pending");
    assert.equal(existsSync(join(ctx.dir, "cli-args.json")), false);
    await stopServer(ctx);
  });

  it("blocks cross-tenant enrich before spawning analysis", async () => {
    const ctx = await startServer({
      meta: { currentTenantId: "tenant-a", currentTenantName: "本租户" },
      items: [{
        id: "m1",
        title: "跨租户请购单",
        status: "pending",
        tenantId: "tenant-b",
        tenantName: "其他租户",
        webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?tenantId=tenant-b&taskId=task-1",
      }],
    });

    const resp = await fetch(`${ctx.baseUrl}/api/enrich/m1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const json = await resp.json();

    assert.equal(resp.status, 409);
    assert.equal(json.success, false);
    assert.equal(json.type, "cross_tenant");
    assert.match(json.error, /不属于当前租户作用域/);
    await stopServer(ctx);
  });

  it("moves only successful ids for partial batch results", async () => {
    const ctx = await startServer({
      mode: "partial",
      items: [
        { id: "m1", title: "请购单 1", status: "pending", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" },
        { id: "m2", title: "请购单 2", status: "pending", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/2?taskId=task-2" },
      ],
    });

    const resp = await fetch(`${ctx.baseUrl}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["m1", "m2"], action: "approve", comment: "同意" }),
    });
    const json = await resp.json();
    const state = readState(ctx.dataDir);

    assert.equal(json.success, false);
    assert.deepEqual(json.completed, ["m1"]);
    assert.equal(state.items.find((i) => i.id === "m1").status, "done");
    assert.equal(state.items.find((i) => i.id === "m2").status, "pending");
    await stopServer(ctx);
  });
});
