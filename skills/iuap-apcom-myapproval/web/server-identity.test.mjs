import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { buildRuntimeIdentity, scopeDataDir } from "../scripts/runtime-identity.mjs";

const SERVER_SCRIPT = resolve("skills/iuap-apcom-myapproval/web/server.mjs");
const servers = new Set();
const tempDirs = new Set();

const RAW_USER_ID = "raw-user-id-should-never-leak";
const RAW_TENANT_ID = "raw-tenant-id-should-never-leak";
const RAW_ENVIRONMENT = "c1.yonyoucloud.com";
const RAW_PROXY_URL = "http://proxy-user:proxy-secret@127.0.0.1:47777/private-context";
const LEGACY_MARKER = "OLD_TENANT_CACHE_MUST_NOT_BE_VISIBLE";

function sha256(value) {
  return createHash("sha256").update(String(value), "utf-8").digest("hex");
}

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "approve-inbox-identity-"));
  tempDirs.add(dir);
  return dir;
}

function managedItem(id, tenantId = RAW_TENANT_ID) {
  return {
    id,
    primaryId: id,
    title: `Managed todo ${id}`,
    doneStatus: 0,
    tenantId,
    webUrl: `https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/${id}?taskId=task-${id}`,
    buttons: [{ name: "通过", callBackExecType: "agree", buttonIndex: 0 }],
  };
}

function writeFakeCli(profileDir) {
  const cliDir = join(
    profileDir,
    "userData",
    "runtime",
    "openclaw",
    "skills",
    "iuap-apcom-cli",
    "scripts",
  );
  mkdirSync(cliDir, { recursive: true });
  const cliPath = join(cliDir, "bip-cli.js");
  writeFileSync(cliPath, `
const fs = require("fs");
// /yonbip-mid-sscia/cloudAudit/queryCloudAuditResultDesc
const args = process.argv.slice(2);
const schema = [
  "whoami",
  "workflow inboxtask get-document",
  "workflow inboxtask get-intelligent-result",
  "workflow task todo-list",
  "workflow task todo-detail",
  "workflow task deal",
  "workflow task reject",
  "workflow task batch-approve",
  "workflow task batch-reject",
  "auth permission apply",
];
if (args.length === 1 && args[0] === "--schema") {
  process.stdout.write(JSON.stringify(schema.map((path) => ({ path }))));
  process.exit(0);
}

const optionIndex = args.findIndex((arg) => arg.startsWith("--"));
const commandPath = args.slice(0, optionIndex === -1 ? args.length : optionIndex).join(" ");
let input = {};
try {
  const raw = fs.readFileSync(0, "utf-8").trim();
  input = raw ? JSON.parse(raw) : {};
} catch {}

let state = JSON.parse(fs.readFileSync(process.env.FAKE_RUNTIME_STATE, "utf-8"));
fs.appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify({ commandPath, input, args }) + "\\n");
const callNumber = fs.readFileSync(process.env.FAKE_CLI_LOG, "utf-8").trim().split("\\n").length;
if (Number(state.pauseAtCall) === callNumber) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(state.pauseMs || 300));
  if (state.reloadAfterPause) state = JSON.parse(fs.readFileSync(process.env.FAKE_RUNTIME_STATE, "utf-8"));
}

if (state.auth === "401" && (commandPath === "whoami" || commandPath === "workflow task todo-list")) {
  process.stderr.write("获取 secret 失败: HTTP 401");
  process.exit(1);
}

function write(value) {
  process.stdout.write(JSON.stringify(value));
}

function parseIds(value) {
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

if (commandPath === "whoami") {
  write({
    success: true,
    yhtUserId: state.userId,
    currentTenantId: state.tenantId,
    environment: state.environment,
  });
} else if (commandPath === "workflow task todo-list") {
  write({ success: true, currentTenantId: state.tenantId, items: state.items || [], hasNext: false, total: (state.items || []).length });
} else if (commandPath === "workflow task todo-detail") {
  if (state.switchAfterListAction && Array.isArray(state.nextItems)) {
    fs.writeFileSync(process.env.FAKE_RUNTIME_STATE, JSON.stringify({
      ...state,
      items: state.nextItems,
      switchAfterListAction: false,
    }, null, 2));
  }
  const taskId = String(input.taskId || "");
  const match = (state.items || []).find((item) => {
    const fromUrl = String(item.webUrl || "").match(/taskId=([\\w-]+)/);
    return String(item.taskId || "") === taskId
      || String(item.businessKey || "") === taskId
      || (fromUrl && fromUrl[1] === taskId);
  });
  const buttons = Array.isArray(match && match.buttons) ? match.buttons : [];
  const availableActions = [];
  if (buttons.some((b) => b.callBackExecType === "agree")) availableActions.push("complete");
  if (buttons.some((b) => b.callBackExecType === "reject")) availableActions.push("reject");
  write({
    todo: {
      route: "workflow-engine",
      availableActions,
      actionAvailability: {},
      task: match ? { id: taskId, source: "iuap-apcom-auth", processInstanceId: match.processInstanceId || "proc-1" } : null,
    },
    document: {},
  });
} else if (commandPath === "workflow task batch-approve" || commandPath === "workflow task batch-reject") {
  const ids = parseIds(input.primaryIds);
  if (state.approvalMode === "throw") {
    process.stderr.write("simulated transport timeout after request dispatch");
    process.exit(1);
  } else if (state.approvalMode === "throw401") {
    process.stderr.write("HTTP 401 unauthorized after request dispatch");
    process.exit(1);
  } else if (state.approvalMode === "fail") {
    write({ success: false, message: "fake approval failed" });
  } else if (state.approvalMode === "partial") {
    write({
      success: false,
      results: ids.map((id, index) => ({
        primaryId: id,
        success: index === 0,
        ...(index === 0 ? {} : { error: "fake partial failure" }),
      })),
    });
  } else {
    if (state.switchAfterDangerous && state.nextIdentity) {
      fs.writeFileSync(process.env.FAKE_RUNTIME_STATE, JSON.stringify({
        ...state,
        ...state.nextIdentity,
        switchAfterDangerous: false,
      }, null, 2));
    }
    write({ success: true, successIds: ids });
  }
} else {
  write({ success: true });
}
`, "utf-8");
  return cliPath;
}

function writeRuntimeState(ctx, overrides = {}) {
  const previous = existsSync(ctx.runtimeStatePath)
    ? JSON.parse(readFileSync(ctx.runtimeStatePath, "utf-8"))
    : {};
  const next = {
    auth: "ok",
    userId: RAW_USER_ID,
    tenantId: RAW_TENANT_ID,
    environment: RAW_ENVIRONMENT,
    items: [],
    approvalMode: "success",
    ...previous,
    ...overrides,
  };
  writeFileSync(ctx.runtimeStatePath, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

function seedLegacyCache(dataRoot) {
  mkdirSync(join(dataRoot, "details"), { recursive: true });
  mkdirSync(join(dataRoot, "attachments", "legacy-item"), { recursive: true });
  writeFileSync(join(dataRoot, "inbox.json"), JSON.stringify({
    businessType: "approve-inbox",
    items: [{ id: "legacy-item", title: LEGACY_MARKER, status: "pending" }],
    summary: { total: 1, pendingCount: 1, doneCount: 0 },
  }), "utf-8");
  writeFileSync(join(dataRoot, "details", "legacy-item.json"), JSON.stringify({
    id: "legacy-item",
    title: LEGACY_MARKER,
  }), "utf-8");
  writeFileSync(join(dataRoot, "attachments", "legacy-item", "secret.txt"), LEGACY_MARKER, "utf-8");
  writeFileSync(join(dataRoot, "ui.config.json"), JSON.stringify({ legacyMarker: LEGACY_MARKER }), "utf-8");
}

function cleanManagedEnv() {
  const env = { ...process.env };
  for (const key of [
    "APPROVE_INBOX_BIP_CLI",
    "APPROVE_INBOX_OPEN",
    "APPROVE_INBOX_PROXY",
    "BIP_CLI_PATH",
    "BIP_CLI_SETTINGS",
    "IUAP_APCOM_CLI_DIR",
    "YONCLAW_REQ_PROXY_BASE_URL",
    "YONCLAW_BROWSER_RELAY_BASE_URL",
    "YONCLAW_BROWSER_RELAY_URL",
    "YONCLAW_BROWSER_RELAY_TOKEN",
  ]) delete env[key];
  return env;
}

async function freePort() {
  const probe = createTcpServer();
  await new Promise((resolvePromise, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolvePromise);
  });
  const port = probe.address().port;
  await new Promise((resolvePromise) => probe.close(resolvePromise));
  return port;
}

async function waitForServer(ctx) {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (ctx.proc.exitCode !== null) {
      throw new Error(`server exited early (${ctx.proc.exitCode})\n${ctx.stderr}\n${ctx.stdout}`);
    }
    try {
      const response = await fetch(`${ctx.baseUrl}/api/service-identity`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`server did not start: ${lastError?.message || "timeout"}\n${ctx.stderr}`);
}

async function startManagedServer({
  proxyUrl = RAW_PROXY_URL,
  runtime = {},
  legacyCache = false,
  fakeEnrichDelay = 0,
  extraEnv = {},
} = {}) {
  const dir = tempDir();
  const dataRoot = join(dir, "data");
  const profileDir = join(dir, "profile-raw-id-should-never-leak");
  const cliLogPath = join(dir, "cli-calls.jsonl");
  const runtimeStatePath = join(dir, "runtime-state.json");
  mkdirSync(dataRoot, { recursive: true });
  const cliPath = writeFakeCli(profileDir);
  const fakeEnrichPath = join(dir, "fake-enrich.mjs");
  if (fakeEnrichDelay > 0) {
    writeFileSync(fakeEnrichPath, `
await new Promise((resolvePromise) => setTimeout(resolvePromise, ${Number(fakeEnrichDelay)}));
process.stdout.write(JSON.stringify({ processed: 1, results: [{ id: "a-item", step: "done", analysis: { ok: true } }] }));
`, "utf-8");
  }
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const ctx = {
    baseUrl,
    cliLogPath,
    cliPath,
    dataRoot,
    dir,
    port,
    profileDir,
    runtimeStatePath,
    stderr: "",
    stdout: "",
  };
  writeRuntimeState(ctx, runtime);
  if (legacyCache) seedLegacyCache(dataRoot);

  const normalizedProxy = String(proxyUrl || "").trim().replace(/\/+$/, "");
  const env = {
    ...cleanManagedEnv(),
    APPROVE_INBOX_PORT: String(port),
    APPROVE_INBOX_AUTO: "0",
    APPROVE_INBOX_AUTO_INTERVAL: "3600",
    APPROVE_INBOX_AUTO_SYNC: "1",
    APPROVE_INBOX_AUTH_MODE: "managed-yonwork",
    APPROVE_INBOX_IDENTITY_CACHE_TTL_MS: "0",
    APPROVE_INBOX_DATA: dataRoot,
    APPROVE_INBOX_PROFILE_DIR: profileDir,
    APPROVE_INBOX_PROFILE_KEY: sha256(`profile\0${resolve(profileDir)}`),
    APPROVE_INBOX_PROXY_CONTEXT_FINGERPRINT: normalizedProxy
      ? sha256(`yonclaw-proxy:${normalizedProxy}`)
      : "",
    APPROVE_INBOX_SERVICE_INSTANCE_KEY: sha256(`test-service\0${resolve(profileDir)}\0${normalizedProxy}`),
    APPROVE_INBOX_SKIP_CLI_AUTH_CHECK: "0",
    FAKE_CLI_LOG: cliLogPath,
    FAKE_RUNTIME_STATE: runtimeStatePath,
    ...(fakeEnrichDelay > 0 ? { APPROVE_INBOX_ENRICH_SCRIPT: fakeEnrichPath } : {}),
    ...extraEnv,
  };
  if (normalizedProxy) env.YONCLAW_REQ_PROXY_BASE_URL = normalizedProxy;

  ctx.proc = spawn(process.execPath, [SERVER_SCRIPT], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  servers.add(ctx);
  ctx.proc.stdout.on("data", (chunk) => { ctx.stdout += chunk.toString(); });
  ctx.proc.stderr.on("data", (chunk) => { ctx.stderr += chunk.toString(); });
  await waitForServer(ctx);
  // The server starts its managed identity sync asynchronously. Under the full
  // parallel test suite, issuing a manual sync as soon as the HTTP port opens can
  // race that startup probe and turn an otherwise valid test request into a 409.
  await waitForCliIdle(ctx, 100, 10_000);
  return ctx;
}

function readCliCalls(ctx) {
  if (!existsSync(ctx.cliLogPath)) return [];
  const text = readFileSync(ctx.cliLogPath, "utf-8").trim();
  return text ? text.split("\n").map((line) => JSON.parse(line)) : [];
}

async function waitForCliCallCount(ctx, expected, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (readCliCalls(ctx).length >= expected) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`timed out waiting for ${expected} CLI calls`);
}

async function waitForCliIdle(ctx, quietMs = 200, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let count = readCliCalls(ctx).length;
  let unchangedSince = Date.now();
  while (Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    const next = readCliCalls(ctx).length;
    if (next !== count) {
      count = next;
      unchangedSince = Date.now();
    } else if (Date.now() - unchangedSince >= quietMs) {
      return count;
    }
  }
  throw new Error("timed out waiting for CLI calls to become idle");
}

function statePath(ctx, identity = buildRuntimeIdentity({
  profileDir: ctx.profileDir,
  userId: RAW_USER_ID,
  tenantId: RAW_TENANT_ID,
  environment: RAW_ENVIRONMENT,
})) {
  return join(scopeDataDir(ctx.dataRoot, identity), "inbox.json");
}

function readScopedState(ctx, identity) {
  return JSON.parse(readFileSync(statePath(ctx, identity), "utf-8"));
}

async function waitForScopedState(ctx, predicate, message, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = readScopedState(ctx);
    if (predicate(state)) return state;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(message);
}

function writeScopedDetail(ctx, id, detail) {
  const detailsDir = join(dirname(statePath(ctx)), "details");
  mkdirSync(detailsDir, { recursive: true });
  writeFileSync(join(detailsDir, `${id}.json`), JSON.stringify(detail, null, 2), "utf-8");
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  return { response, text, body: text ? JSON.parse(text) : null };
}

async function sync(ctx) {
  return requestJson(`${ctx.baseUrl}/api/sync`, { method: "POST" });
}

async function approve(ctx, ids) {
  return requestJson(`${ctx.baseUrl}/api/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, action: "approve", comment: "同意" }),
  });
}

function approvalCalls(calls) {
  return calls.filter((call) => (
    call.commandPath === "workflow task todo-detail"
    || call.commandPath === "workflow task batch-approve"
    || call.commandPath === "workflow task batch-reject"
    || call.commandPath === "workflow task deal"
    || call.commandPath === "workflow task reject"
  ));
}

function identityProbeCommands(calls) {
  return calls
    .filter((call) => call.commandPath === "whoami" || call.commandPath === "workflow task todo-list")
    .map((call) => call.commandPath);
}

async function stopServer(ctx) {
  if (!ctx?.proc || ctx.proc.exitCode !== null) return;
  ctx.proc.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => ctx.proc.once("exit", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 1000)),
  ]);
  if (ctx.proc.exitCode === null) ctx.proc.kill("SIGKILL");
}

afterEach(async () => {
  await Promise.all([...servers].map(stopServer));
  servers.clear();
  for (const dir of tempDirs) rmSync(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
  tempDirs.clear();
});

describe("managed YonWork service identity boundary", () => {
  it("does not let the legacy skip flag enable local-dev authentication", async () => {
    const ctx = await startManagedServer({
      proxyUrl: "",
      extraEnv: {
        APPROVE_INBOX_AUTH_MODE: "",
        APPROVE_INBOX_SKIP_CLI_AUTH_CHECK: "1",
      },
    });

    const identity = await requestJson(`${ctx.baseUrl}/api/service-identity`);
    const health = await requestJson(`${ctx.baseUrl}/api/health/cli`);

    assert.equal(identity.body.serviceIdentity.authMode, "managed-yonwork");
    assert.equal(health.response.status, 503);
    assert.equal(health.body.issue.code, "HOST_AUTH_CONTEXT_MISSING");
  });

  it("rejects managed shutdown when no instance token was provisioned", async () => {
    const ctx = await startManagedServer({
      extraEnv: { APPROVE_INBOX_INSTANCE_ID: "managed-instance-id" },
    });

    const result = await requestJson(`${ctx.baseUrl}/api/shutdown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId: "managed-instance-id", instanceToken: "" }),
    });

    assert.equal(result.response.status, 503);
    assert.equal(result.body.error, "shutdown protection unavailable");
  });

  it("requires the exact instance id and token before shutdown", async () => {
    const ctx = await startManagedServer({
      extraEnv: {
        APPROVE_INBOX_INSTANCE_ID: "managed-instance-id",
        APPROVE_INBOX_INSTANCE_TOKEN: "managed-instance-token",
      },
    });
    const identity = await requestJson(`${ctx.baseUrl}/api/service-identity`);
    assert.equal(identity.body.instanceId, "managed-instance-id");
    assert.equal(identity.body.shutdownProtected, true);

    const missing = await requestJson(`${ctx.baseUrl}/api/shutdown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId: "managed-instance-id" }),
    });
    assert.equal(missing.response.status, 403);

    const wrong = await requestJson(`${ctx.baseUrl}/api/shutdown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId: "other", instanceToken: "managed-instance-token" }),
    });
    assert.equal(wrong.response.status, 409);

    const accepted = await requestJson(`${ctx.baseUrl}/api/shutdown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId: "managed-instance-id", instanceToken: "managed-instance-token" }),
    });
    assert.equal(accepted.response.status, 200);
  });

  it("never returns a new identity scope to an older in-flight widget request", async () => {
    const ctx = await startManagedServer({
      runtime: {
        items: [managedItem("a-item")],
      },
    });
    const baseCalls = await waitForCliIdle(ctx);
    writeRuntimeState(ctx, {
      pauseAtCall: baseCalls + 4,
      pauseMs: 500,
      reloadAfterPause: true,
    });
    const pending = requestJson(`${ctx.baseUrl}/api/widget/todos`);
    await waitForCliCallCount(ctx, baseCalls + 4);
    writeRuntimeState(ctx, {
      userId: "user-b-must-not-leak",
      tenantId: "tenant-b-must-not-leak",
      items: [{ ...managedItem("b-item", "tenant-b-must-not-leak"), title: "USER_B_WIDGET_SECRET" }],
      pauseAtCall: null,
    });

    const result = await pending;
    assert.equal(result.response.status, 409);
    assert.equal(result.body.issue.code, "IDENTITY_CHANGED_DURING_SYNC");
    assert.doesNotMatch(result.text, /USER_B_WIDGET_SECRET|user-b-must-not-leak|tenant-b-must-not-leak/);
    assert.equal(result.body.cache.visible, false);
  });

  it("answers widget refresh from cache immediately and lands the sync in the background", async () => {
    const ctx = await startManagedServer({ runtime: { items: [managedItem("a-1")] } });
    const seeded = await sync(ctx);
    assert.equal(seeded.response.status, 200);
    await waitForCliIdle(ctx);

    // 上游多出一条新待办：缓存响应不应等它,后台同步随后落盘。
    writeRuntimeState(ctx, { items: [managedItem("a-1"), managedItem("a-2")] });

    const refresh = await requestJson(`${ctx.baseUrl}/api/widget/refresh`, { method: "POST" });
    assert.equal(refresh.response.status, 200);
    assert.equal(refresh.body.success, true);
    assert.equal(refresh.body.sync.accepted, true);
    assert.equal(refresh.body.sync.mode, "background");
    assert.equal(refresh.body.sync.reason, "widget-refresh");
    assert.equal(refresh.body.sync.running, true);
    assert.equal(refresh.body.sync.scope, "currentTenant");
    assert.equal(refresh.body.sync.pending, 1);
    assert.equal(refresh.body.summary.pendingCount, 1);
    assert.equal(refresh.body.items.length, 1);
    assert.equal(refresh.body.items.some((item) => String(item.id || item.primaryId) === "a-2"), false);

    await waitForScopedState(
      ctx,
      (state) => (state.items || []).some((item) => String(item.id || item.primaryId) === "a-2"),
      "widget refresh background sync did not land the new todo",
    );
  });

  it("projects an in-flight inbox sync only onto the identity scope that started it", async () => {
    const ctx = await startManagedServer({ runtime: { items: [] } });
    const baseCalls = await waitForCliIdle(ctx);
    writeRuntimeState(ctx, {
      // POST /api/sync 的路由身份探测占 3 次调用；handleSync 会复用该会话，
      // 因此第 4 次正好是提交前复核的首个 whoami。
      pauseAtCall: baseCalls + 4,
      pauseMs: 1200,
      reloadAfterPause: false,
    });

    const pendingSync = sync(ctx);
    await waitForCliCallCount(ctx, baseCalls + 4);

    const aStatus = await requestJson(`${ctx.baseUrl}/api/sync-status`);
    assert.equal(aStatus.response.status, 200);
    assert.equal(aStatus.body.inboxSync.running, true);

    writeRuntimeState(ctx, {
      userId: "scope-b-user",
      tenantId: "scope-b-tenant",
      items: [],
      pauseAtCall: null,
    });
    const bStatus = await requestJson(`${ctx.baseUrl}/api/sync-status`);
    assert.equal(bStatus.response.status, 200);
    assert.equal(bStatus.body.inboxSync.running, false);
    assert.equal(bStatus.body.running, false);

    await pendingSync;
  });

  it("projects an in-flight analysis only onto the identity scope that started it", async () => {
    const ctx = await startManagedServer({
      runtime: { items: [managedItem("a-item")] },
      fakeEnrichDelay: 1000,
    });
    await waitForCliIdle(ctx);

    const queued = await requestJson(`${ctx.baseUrl}/api/personal-rules-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          version: 1,
          enabled: true,
          rules: [{ id: "identity-scope", ruleName: "身份域", checkpoint: "只分析当前身份" }],
        },
      }),
    });
    assert.equal(queued.response.status, 200);
    assert.equal(queued.body.reanalysis.queued === true || queued.body.reanalysis.deferred === true, true);

    const aStatus = await requestJson(`${ctx.baseUrl}/api/sync-status`);
    assert.equal(aStatus.body.running, true);

    writeRuntimeState(ctx, {
      userId: "scope-b-user",
      tenantId: "scope-b-tenant",
      items: [],
    });
    const bStatus = await requestJson(`${ctx.baseUrl}/api/sync-status`);
    assert.equal(bStatus.response.status, 200);
    assert.equal(bStatus.body.running, false);
    assert.equal(bStatus.body.inboxSync.running, false);

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1100));
  });

  it("returns HOST_AUTH_CONTEXT_MISSING when the managed proxy context is absent", async () => {
    const ctx = await startManagedServer({ proxyUrl: "" });

    const { response, body } = await requestJson(`${ctx.baseUrl}/api/health/cli`);

    assert.equal(response.status, 503);
    assert.equal(body.ready, false);
    assert.equal(body.issue.code, "HOST_AUTH_CONTEXT_MISSING");
    assert.equal(body.cache.visible, false);
  });

  it("exposes only opaque service identity fields after real Profile verification", async () => {
    const ctx = await startManagedServer();
    const health = await requestJson(`${ctx.baseUrl}/api/health/cli`);
    assert.equal(health.response.status, 200);
    assert.equal(health.body.identityVerified, true);

    const { response, body, text } = await requestJson(`${ctx.baseUrl}/api/service-identity`);

    assert.equal(response.status, 200);
    assert.match(body.serviceIdentity.profileKey, /^[a-f0-9]{64}$/);
    assert.match(body.serviceIdentity.proxyContext.fingerprint, /^[a-f0-9]{64}$/);
    assert.match(body.serviceIdentity.serviceInstanceKey, /^[a-f0-9]{64}$/);
    for (const secret of [
      ctx.profileDir,
      basename(ctx.profileDir),
      RAW_PROXY_URL,
      "proxy-secret",
      RAW_USER_ID,
      RAW_TENANT_ID,
      RAW_ENVIRONMENT,
    ]) assert.equal(text.includes(secret), false, `service identity leaked ${secret}`);
  });

  it("coalesces concurrent read identity checks and reuses the short-lived verified session", async () => {
    const ctx = await startManagedServer({
      runtime: { items: [managedItem("m1")] },
      extraEnv: { APPROVE_INBOX_IDENTITY_CACHE_TTL_MS: "20" },
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 35));
    const callsBefore = readCliCalls(ctx).length;

    const results = await Promise.all([
      requestJson(`${ctx.baseUrl}/api/inbox`),
      requestJson(`${ctx.baseUrl}/api/sync-status`),
      requestJson(`${ctx.baseUrl}/api/ui-config`),
    ]);
    assert.deepEqual(results.map((result) => result.response.status), [200, 200, 200]);
    assert.deepEqual(identityProbeCommands(readCliCalls(ctx).slice(callsBefore)), [
      "whoami",
      "workflow task todo-list",
      "whoami",
    ]);

    const afterProbe = readCliCalls(ctx).length;
    await Promise.all([
      requestJson(`${ctx.baseUrl}/api/inbox`),
      requestJson(`${ctx.baseUrl}/api/sync-status`),
    ]);
    assert.equal(readCliCalls(ctx).length, afterProbe);
  });

  it("fails a 401 sync closed without returning old data or starting analysis", async () => {
    const ctx = await startManagedServer({ runtime: { auth: "401" }, legacyCache: true });

    const { response, body, text } = await sync(ctx);

    assert.equal(response.status, 401);
    assert.equal(body.success, false);
    assert.equal(body.issue.code, "AUTH_REQUIRED_IN_YONWORK");
    assert.equal(Object.hasOwn(body, "data"), false);
    assert.equal(body.cache.visible, false);
    assert.equal(body.analysis.started, false);
    assert.equal(text.includes(LEGACY_MARKER), false);
  });

  it("does not expose user A scoped data through any guarded API after switching to user B with 401", async () => {
    const ctx = await startManagedServer({ runtime: { items: [managedItem("a-item")] } });
    const initial = await sync(ctx);
    assert.equal(initial.response.status, 200);
    const state = readScopedState(ctx);
    const scopeDir = dirname(statePath(ctx));
    const marker = "USER_A_SCOPED_SECRET";
    writeScopedDetail(ctx, "a-item", {
      id: "a-item",
      title: marker,
      content: { attachments: [{ fileName: "secret.txt" }] },
      _approveInbox: {
        scopeKey: state.meta.identity.dataScopeKey,
        snapshotId: state.meta.snapshotId,
      },
    });
    mkdirSync(join(scopeDir, "attachments", "a-item"), { recursive: true });
    writeFileSync(join(scopeDir, "attachments", "a-item", "secret.txt"), marker, "utf-8");
    writeFileSync(join(scopeDir, "ui.config.json"), JSON.stringify({ marker }), "utf-8");

    writeRuntimeState(ctx, { auth: "401", userId: "user-b", items: [] });
    const failedSync = await sync(ctx);
    assert.equal(failedSync.response.status, 401);

    const results = await Promise.all([
      requestJson(`${ctx.baseUrl}/api/inbox`),
      requestJson(`${ctx.baseUrl}/api/details/a-item`),
      requestJson(`${ctx.baseUrl}/api/attachments/a-item/secret.txt`),
      requestJson(`${ctx.baseUrl}/api/ui-config`),
      requestJson(`${ctx.baseUrl}/api/enrich/a-item`, { method: "POST" }),
      approve(ctx, ["a-item"]),
    ]);
    for (const result of results) {
      assert.equal(result.response.status, 401);
      assert.equal(result.text.includes(marker), false);
      assert.equal(result.body?.cache?.visible, false);
    }
  });

  it("accepts an authenticated empty inbox as a successful real snapshot", async () => {
    const ctx = await startManagedServer({ runtime: { items: [] } });

    const { response, body } = await sync(ctx);

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.mode, "real");
    assert.deepEqual(body.data.items, []);
    assert.equal(body.cache.visible, true);
    assert.equal(body.analysis.started, false);
    assert.match(body.cache.snapshotId, /^[0-9a-f-]{36}$/);
  });

  it("guards detail, attachment, config, and approval routes from old cache after auth failure", async () => {
    const ctx = await startManagedServer({ runtime: { auth: "401" }, legacyCache: true });
    const failedSync = await sync(ctx);
    assert.equal(failedSync.response.status, 401);
    const callsBefore = readCliCalls(ctx).length;

    const results = await Promise.all([
      requestJson(`${ctx.baseUrl}/api/details/legacy-item`),
      fetch(`${ctx.baseUrl}/api/attachments/legacy-item/secret.txt`).then(async (response) => ({
        response,
        text: await response.text(),
      })),
      requestJson(`${ctx.baseUrl}/api/ui-config`),
      approve(ctx, ["legacy-item"]),
    ]);

    for (const result of results) {
      assert.equal(result.response.status, 401);
      assert.equal(result.text.includes(LEGACY_MARKER), false);
    }
    assert.deepEqual(approvalCalls(readCliCalls(ctx).slice(callsBefore)), []);
  });

  it("serves detail and attachment only from the current inbox snapshot", async () => {
    const ctx = await startManagedServer({ runtime: { items: [managedItem("m1")] } });
    const initial = await sync(ctx);
    assert.equal(initial.response.status, 200);
    const initialState = readScopedState(ctx);
    const scopeKey = initialState.meta.identity.dataScopeKey;
    const snapshotId = initialState.meta.snapshotId;
    writeScopedDetail(ctx, "m1", {
      id: "m1",
      title: "Current detail",
      content: { attachments: [{ fileName: "current.txt" }] },
      _approveInbox: { scopeKey, snapshotId },
    });
    const attachmentDir = join(dirname(statePath(ctx)), "attachments", "m1");
    mkdirSync(attachmentDir, { recursive: true });
    writeFileSync(join(attachmentDir, "current.txt"), "CURRENT_ATTACHMENT", "utf-8");

    const currentDetail = await requestJson(`${ctx.baseUrl}/api/details/m1`);
    const currentAttachment = await fetch(`${ctx.baseUrl}/api/attachments/m1/current.txt`);
    assert.equal(currentDetail.response.status, 200);
    assert.equal(currentAttachment.status, 200);
    assert.equal(await currentAttachment.text(), "CURRENT_ATTACHMENT");

    writeRuntimeState(ctx, {
      items: [{
        ...managedItem("m1"),
        webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/m1?taskId=task-m1-new",
      }],
    });
    const refreshed = await sync(ctx);
    assert.equal(refreshed.response.status, 200);
    assert.notEqual(readScopedState(ctx).meta.snapshotId, snapshotId);

    const staleDetail = await requestJson(`${ctx.baseUrl}/api/details/m1`);
    const staleAttachment = await requestJson(`${ctx.baseUrl}/api/attachments/m1/current.txt`);
    assert.equal(staleDetail.response.status, 200);
    assert.equal(staleDetail.body.dataSource, "real");
    assert.equal(staleDetail.body.enriched, false);
    assert.notEqual(staleDetail.body.title, "Current detail");
    assert.equal(JSON.stringify(staleDetail.body).includes("current.txt"), false);
    assert.equal(staleAttachment.response.status, 409);
    assert.equal(staleAttachment.body.issue.code, "STALE_ATTACHMENT_SNAPSHOT");
    assert.equal(staleAttachment.body.issue.category, "snapshot");

    writeRuntimeState(ctx, { items: [] });
    const emptied = await sync(ctx);
    assert.equal(emptied.response.status, 200);
    const removedDetail = await requestJson(`${ctx.baseUrl}/api/details/m1`);
    const removedAttachment = await requestJson(`${ctx.baseUrl}/api/attachments/m1/current.txt`);
    assert.equal(removedDetail.response.status, 404);
    assert.equal(removedAttachment.response.status, 404);
  });

  it("upgrades a legacy detail when the stable workflow URL still matches the current item", async () => {
    const item = managedItem("m1");
    const ctx = await startManagedServer({ runtime: { items: [item] } });
    const initial = await sync(ctx);
    assert.equal(initial.response.status, 200);
    const initialState = readScopedState(ctx);
    writeScopedDetail(ctx, "m1", {
      id: "m1",
      title: "Legacy detail survives",
      originalUrl: item.webUrl,
      content: { fields: [{ name: "amount", value: "100" }] },
      _approveInbox: {
        scopeKey: initialState.meta.identity.dataScopeKey,
        snapshotId: initialState.meta.snapshotId,
      },
    });

    const refreshed = await sync(ctx);
    assert.equal(refreshed.response.status, 200);
    const detail = await requestJson(`${ctx.baseUrl}/api/details/m1`);
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.enriched, true);
    assert.equal(detail.body.fields.some((field) => field.name === "amount" && field.value === "100"), true);
    const upgraded = JSON.parse(readFileSync(join(dirname(statePath(ctx)), "details", "m1.json"), "utf-8"));
    assert.equal(upgraded._approveInbox.schemaVersion, 2);
    assert.match(upgraded._approveInbox.itemRevision, /^[a-f0-9]{64}$/);
  });
});

describe("managed approval identity and snapshot boundary", () => {
  it("does not use a stale-snapshot detail to choose an approval transport", async () => {
    const item = { ...managedItem("m1"), webUrl: "" };
    const ctx = await startManagedServer({ runtime: { items: [item] } });
    const initial = await sync(ctx);
    assert.equal(initial.response.status, 200);
    const state = readScopedState(ctx);
    writeScopedDetail(ctx, "m1", {
      id: "m1",
      billDetail: { source: "stale-mdf-detail" },
      _approveInbox: {
        scopeKey: state.meta.identity.dataScopeKey,
        snapshotId: "older-snapshot",
      },
    });
    const callsBefore = readCliCalls(ctx).length;

    const result = await approve(ctx, ["m1"]);
    assert.equal(result.response.status, 202);
    assert.equal(result.body.accepted, true);
    await waitForScopedState(
      ctx,
      (latest) => latest.items[0].approvalProcessing?.state === "needs_review",
      "unsupported approval did not surface for review",
    );
    assert.deepEqual(approvalCalls(readCliCalls(ctx).slice(callsBefore)), []);
    const settled = readScopedState(ctx).items[0];
    assert.equal(settled.status, "pending");
    assert.ok(settled.approvalProcessing.issue?.userMessage, "failure must carry a user-visible reason");
  });

  it("requires reconciliation when the dangerous CLI request has an unknown remote outcome", async () => {
    const ctx = await startManagedServer({
      runtime: {
        items: [managedItem("m1")],
        approvalMode: "throw",
      },
    });
    const initialSync = await sync(ctx);
    assert.equal(initialSync.response.status, 200);

    const { response, body } = await approve(ctx, ["m1"]);
    assert.equal(response.status, 202);
    assert.equal(body.accepted, true);
    const state = await waitForScopedState(ctx, (latest) => latest.items[0].approvalProcessing?.state === "needs_review", "unknown result was not persisted");
    assert.equal(state.items[0].status, "pending");
    assert.equal(state.items[0].approvalProcessing.remoteOutcome, "unknown");
    assert.deepEqual(state.items[0].runtimeActions, []);
    const repeated = await approve(ctx, ["m1"]);
    assert.equal(repeated.response.status, 409);
    assert.equal(repeated.body.issue.code, "APPROVAL_ALREADY_PROCESSING");
  });

  it("preserves AUTH_REQUIRED_IN_YONWORK when a dangerous request throws 401", async () => {
    const ctx = await startManagedServer({
      runtime: {
        items: [managedItem("m1")],
        approvalMode: "throw401",
      },
    });
    const initialSync = await sync(ctx);
    assert.equal(initialSync.response.status, 200);

    const { response, body } = await approve(ctx, ["m1"]);
    assert.equal(response.status, 202);
    assert.equal(body.accepted, true);
    const state = await waitForScopedState(ctx, (latest) => latest.items[0].approvalProcessing?.state === "needs_review", "401 result was not persisted");
    assert.equal(state.items[0].status, "pending");
    assert.equal(state.items[0].approvalProcessing.remoteOutcome, "unknown");
    assert.equal(state.items[0].approvalProcessing.issue.code, "AUTH_REQUIRED_IN_YONWORK");
    assert.deepEqual(state.items[0].runtimeActions, []);
  });

  it("reports remote reconciliation instead of local success when identity changes after the dangerous command", async () => {
    const ctx = await startManagedServer({
      runtime: {
        items: [managedItem("m1")],
        switchAfterDangerous: true,
        nextIdentity: {
          userId: "switched-user",
          tenantId: "switched-tenant",
          items: [managedItem("b1", "switched-tenant")],
        },
      },
    });
    const initialSync = await sync(ctx);
    assert.equal(initialSync.response.status, 200);

    const { response, body } = await approve(ctx, ["m1"]);
    assert.equal(response.status, 202);
    assert.equal(body.accepted, true);
    const state = await waitForScopedState(ctx, (latest) => latest.items[0].approvalProcessing?.state === "needs_review", "identity switch was not persisted for review");
    assert.equal(state.items[0].status, "pending");
    assert.equal(state.items[0].approvalProcessing.remoteOutcome, "confirmed_committed");
  });

  it("revalidates user and tenant before approval and blocks an identity switch", async () => {
    const ctx = await startManagedServer({ runtime: { items: [managedItem("m1")] } });
    const initialSync = await sync(ctx);
    assert.equal(initialSync.response.status, 200);
    await waitForCliIdle(ctx);
    const callsBefore = readCliCalls(ctx).length;
    writeRuntimeState(ctx, {
      userId: "different-user",
      tenantId: "different-tenant",
      items: [managedItem("m1", "different-tenant")],
    });

    const { response, body } = await approve(ctx, ["m1"]);
    const newCalls = readCliCalls(ctx).slice(callsBefore);

    assert.equal(response.status, 503);
    assert.deepEqual(body.completed, []);
    assert.deepEqual(identityProbeCommands(newCalls).slice(0, 3), [
      "whoami",
      "workflow task todo-list",
      "whoami",
    ]);
    assert.deepEqual(approvalCalls(newCalls), []);
    assert.equal(readScopedState(ctx).items[0].status, "pending");
  });

  it("does not approve a task absent from the latest verified snapshot", async () => {
    const ctx = await startManagedServer({ runtime: { items: [managedItem("m1")] } });
    const initialSync = await sync(ctx);
    assert.equal(initialSync.response.status, 200);
    await waitForCliIdle(ctx);
    const callsBefore = readCliCalls(ctx).length;
    writeRuntimeState(ctx, { items: [] });

    const { response, body } = await approve(ctx, ["m1"]);
    const newCalls = readCliCalls(ctx).slice(callsBefore);

    assert.notEqual(response.status, 200);
    assert.deepEqual(body.completed || [], []);
    assert.deepEqual(identityProbeCommands(newCalls).slice(0, 3), [
      "whoami",
      "workflow task todo-list",
      "whoami",
    ]);
    assert.deepEqual(approvalCalls(newCalls), []);
    assert.equal(readScopedState(ctx).items[0].status, "pending");
  });

  it("rejects the same primary id when approval-critical task fields changed since sync", async () => {
    const initialItem = managedItem("m1");
    const changedItem = {
      ...managedItem("m1"),
      webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/m1-v2?taskId=task-m1-v2",
      businessKey: "business-m1-v2",
      serviceCode: "changed-service-code",
    };
    const ctx = await startManagedServer({ runtime: { items: [initialItem] } });
    const initialSync = await sync(ctx);
    assert.equal(initialSync.response.status, 200);
    const callsBefore = readCliCalls(ctx).length;
    writeRuntimeState(ctx, { items: [changedItem] });

    const { response, body } = await approve(ctx, ["m1"]);
    const newCalls = readCliCalls(ctx).slice(callsBefore);

    assert.equal(response.status, 409);
    assert.equal(body.issue.code, "STALE_APPROVAL_SNAPSHOT");
    assert.deepEqual(body.completed || [], []);
    assert.deepEqual(approvalCalls(newCalls), []);
    assert.equal(readScopedState(ctx).items[0].status, "pending");
  });

  it("rechecks the canonical task signature after action refresh and before the dangerous command", async () => {
    const initialItem = managedItem("m1");
    const changedItem = {
      ...managedItem("m1"),
      webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/m1-v3?taskId=task-m1-v3",
    };
    const ctx = await startManagedServer({
      runtime: {
        items: [initialItem],
        switchAfterListAction: true,
        nextItems: [changedItem],
      },
    });
    const initialSync = await sync(ctx);
    assert.equal(initialSync.response.status, 200);
    const callsBefore = readCliCalls(ctx).length;

    const { response, body } = await approve(ctx, ["m1"]);
    assert.equal(response.status, 202);
    assert.equal(body.accepted, true);
    await waitForScopedState(
      ctx,
      (latest) => latest.items[0].approvalProcessing?.state === "needs_review",
      "stale task signature did not surface for review",
    );
    const newCalls = readCliCalls(ctx).slice(callsBefore);
    assert.equal(newCalls.filter((call) => call.commandPath === "workflow task todo-detail").length, 1);
    assert.equal(newCalls.some((call) => call.commandPath === "workflow task batch-approve"), false);
    const settled = readScopedState(ctx).items[0];
    assert.equal(settled.status, "pending");
    assert.equal(settled.approvalProcessing.reasonCode, "STALE_APPROVAL_SNAPSHOT");
  });

  it("moves done only after CLI success and always revalidates first", async () => {
    const ctx = await startManagedServer({
      runtime: { items: [managedItem("m1")], approvalMode: "fail" },
    });
    const initialSync = await sync(ctx);
    assert.equal(initialSync.response.status, 200);
    await waitForCliIdle(ctx);

    let callsBefore = readCliCalls(ctx).length;
    const failed = await approve(ctx, ["m1"]);
    assert.equal(failed.response.status, 202);
    assert.equal(failed.body.accepted, true);
    await waitForScopedState(
      ctx,
      (latest) => latest.items[0].approvalProcessing?.state === "needs_review",
      "failed approval did not surface for review",
    );
    let newCalls = readCliCalls(ctx).slice(callsBefore);
    assert.equal(readScopedState(ctx).items[0].status, "pending");
    assert.deepEqual(identityProbeCommands(newCalls).slice(0, 3), [
      "whoami",
      "workflow task todo-list",
      "whoami",
    ]);

    // 失败终态是待核对而非静默解锁;重试前先经用户出口清除,再走完整审批链路。
    const reset = await fetch(`${ctx.baseUrl}/api/approve/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["m1"] }),
    });
    assert.equal(reset.status, 200);
    await waitForScopedState(ctx, (latest) => !latest.items[0].approvalProcessing, "reset did not unlock the item");

    writeRuntimeState(ctx, { approvalMode: "success" });
    await waitForCliIdle(ctx);
    callsBefore = readCliCalls(ctx).length;
    const succeeded = await approve(ctx, ["m1"]);
    assert.equal(succeeded.response.status, 202);
    assert.equal(succeeded.body.accepted, true);
    await waitForScopedState(ctx, (latest) => latest.items[0].status === "done", "successful approval did not complete");
    newCalls = readCliCalls(ctx).slice(callsBefore);
    assert.equal(readScopedState(ctx).items[0].status, "done");
    assert.deepEqual(identityProbeCommands(newCalls).slice(0, 3), [
      "whoami",
      "workflow task todo-list",
      "whoami",
    ]);
    const batchIndex = newCalls.findIndex((call) => call.commandPath === "workflow task batch-approve");
    assert.ok(batchIndex > 2, "approval command must run after the preflight identity probe");
    assert.deepEqual(identityProbeCommands(newCalls).slice(-3), [
      "whoami",
      "workflow task todo-list",
      "whoami",
    ]);
  });

  it("moves only successful IDs for a partial CLI result", async () => {
    const ctx = await startManagedServer({
      runtime: {
        items: [managedItem("m1"), managedItem("m2")],
        approvalMode: "partial",
      },
    });
    const initialSync = await sync(ctx);
    assert.equal(initialSync.response.status, 200);

    const { response, body } = await approve(ctx, ["m1", "m2"]);
    assert.equal(response.status, 202);
    assert.equal(body.accepted, true);
    const state = await waitForScopedState(ctx, (latest) =>
      latest.items.find((item) => item.id === "m1").status === "done"
        && latest.items.find((item) => item.id === "m2").approvalProcessing?.state === "needs_review",
    "partial approval did not settle");
    assert.equal(state.items.find((item) => item.id === "m1").status, "done");
    const failedItem = state.items.find((item) => item.id === "m2");
    assert.equal(failedItem.status, "pending");
    assert.ok(failedItem.approvalProcessing.issue?.userMessage, "failed id must carry a user-visible reason");
  });
});
