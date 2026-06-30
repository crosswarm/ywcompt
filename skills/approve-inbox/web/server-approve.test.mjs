import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const servers = [];

function tempDir() {
  return mkdtempSync(join(tmpdir(), "approve-inbox-server-"));
}

function writeFakeCli(dir) {
  const file = join(dir, "bip-cli.js");
  writeFileSync(file, `
const fs = require("fs");
if (process.env.FAKE_CLI_LOG) fs.appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
const idsArg = process.argv[process.argv.indexOf("--primary-ids") + 1] || "[]";
const ids = JSON.parse(idsArg);
if (process.env.FAKE_APPROVE_MODE === "fail") {
  console.log(JSON.stringify({ success: false, message: "fake failure" }));
} else if (process.env.FAKE_APPROVE_MODE === "partial") {
  console.log(JSON.stringify({ results: ids.map((id, idx) => ({ primaryId: id, success: idx === 0, error: idx === 0 ? undefined : "failed" })) }));
} else {
  console.log(JSON.stringify({ success: true }));
}
`, "utf-8");
  return file;
}

function writeFakeTextutil(dir) {
  const binDir = join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  const file = join(binDir, "textutil");
  writeFileSync(file, `#!/usr/bin/env node
process.stdout.write("<h1>Converted Preview</h1><p>fake document body</p>");
`, "utf-8");
  chmodSync(file, 0o755);
  return binDir;
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
  const text = readFileSync(join(ctx.dir, "cli-args.json"), "utf-8").trim();
  return text ? text.split("\\n").map((line) => JSON.parse(line)) : [];
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

function serverEnv({ port, dataDir, cliPath, mode, dir, extraEnv = {} }) {
  return {
    ...process.env,
    APPROVE_INBOX_PORT: String(port),
    APPROVE_INBOX_AUTO: "0",
    APPROVE_INBOX_AUTO_SYNC: "0",
    APPROVE_INBOX_DATA: dataDir,
    APPROVE_INBOX_APPROVAL_TRANSPORT: "cli",
    APPROVE_INBOX_SKIP_CLI_AUTH_CHECK: "1",
    BIP_CLI_PATH: cliPath,
    FAKE_APPROVE_MODE: mode,
    FAKE_CLI_LOG: join(dir, "cli-args.json"),
    ...extraEnv,
  };
}

async function startServer({ mode = "success", items, meta, extraEnv = {} }) {
  const dir = tempDir();
  const dataDir = join(dir, "data");
  mkdirSync(dataDir, { recursive: true });
  writeState(dataDir, items, meta);
  const cliPath = writeFakeCli(dir);
  const port = 43000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://localhost:${port}`;
  const proc = spawn(process.execPath, ["skills/approve-inbox/web/server.mjs"], {
    cwd: process.cwd(),
    env: serverEnv({ port, dataDir, cliPath, mode, dir, extraEnv }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  servers.push(proc);
  await waitForServer(baseUrl);
  return { proc, baseUrl, dataDir, dir };
}

async function startServerWithoutState({ mode = "success" } = {}) {
  const dir = tempDir();
  const dataDir = join(dir, "data");
  mkdirSync(dataDir, { recursive: true });
  const cliPath = writeFakeCli(dir);
  const port = 43000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://localhost:${port}`;
  const proc = spawn(process.execPath, ["skills/approve-inbox/web/server.mjs"], {
    cwd: process.cwd(),
    env: serverEnv({ port, dataDir, cliPath, mode, dir }),
    stdio: ["ignore", "pipe", "pipe"],
  });
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

    const resp = await fetch(`${ctx.baseUrl}/api/attachments/m1/${encodeURIComponent("合同.docx")}?preview=html`);
    const body = await resp.text();

    assert.equal(resp.status, 200);
    assert.match(resp.headers.get("content-type") || "", /text\/html/);
    assert.match(body, /Converted Preview/);
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
    assert.equal(manifest.type, "iframe");
    assert.equal(manifest.entryUrl, `${ctx.baseUrl}/widget/?returnTo=${encodeURIComponent("http://localhost:5173/cockpit")}`);
    assert.equal(manifest.dataUrl, `${ctx.baseUrl}/api/widget/todos`);
    assert.equal(manifest.centerEmbedUrl, `${ctx.baseUrl}/?embed=cockpit-drawer&detailOwner=host`);
    assert.equal(manifest.refreshUrl, `${ctx.baseUrl}/api/widget/refresh?returnTo=${encodeURIComponent("http://localhost:5173/cockpit")}`);
    assert.equal(manifest.refreshMethod, "POST");
    assert.deepEqual(manifest.capabilities.includes("return-to-cockpit"), false);
    await stopServer(ctx);
  });

  it("serves a cockpit drawer embed page without standalone chrome", async () => {
    const ctx = await startServer({
      items: [{ id: "m1", title: "请购单", status: "pending", riskLevel: "medium" }],
    });

    const resp = await fetch(`${ctx.baseUrl}/?embed=cockpit-drawer&detailOwner=host`);
    const html = await resp.text();

    assert.equal(resp.status, 200);
    assert.match(html, /is-cockpit-embed/);
    assert.match(html, /HOST_OWNS_DETAIL/);
    assert.match(html, /approve-inbox:request-detail/);
    assert.match(html, /detailUrl/);
    assert.doesNotMatch(html, /<header class="app-header">/);
    assert.doesNotMatch(html, /id="btnReturn"/);
    assert.doesNotMatch(html, /id="btnSync"/);
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
    assert.equal(Object.hasOwn(json, "analysis"), false);
    await stopServer(ctx);
  });

  it("does not expose local runtime paths over HTTP unless explicitly enabled", async () => {
    const ctx = await startServer({
      items: [{ id: "m1", title: "请购单", status: "pending", riskLevel: "medium" }],
    });

    const resp = await fetch(`${ctx.baseUrl}/api/runtime-context?full=1`);
    const json = await resp.json();

    assert.equal(resp.status, 200);
    assert.equal(json.skillId, "approve-inbox");
    assert.equal(json.widgetUrl, `${ctx.baseUrl}/widget/`);
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
    assert.deepEqual(readCliCalls(ctx)[0], [
      "workflow",
      "task",
      "batch-approve",
      "--primary-ids",
      JSON.stringify(["m1"]),
      "--content",
      "同意",
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
    assert.deepEqual(readCliCalls(ctx)[0], [
      "workflow",
      "task",
      "batch-reject",
      "--primary-ids",
      JSON.stringify(["m1"]),
      "--content",
      "资料不完整",
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
    assert.match(json.results[0].error, /属于「其他租户」/);
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
    assert.match(json.error, /其他租户/);
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
