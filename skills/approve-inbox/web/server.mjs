#!/usr/bin/env node
/**
 * server.mjs — 审批消息中心 v3 独立 Web 服务（零依赖）
 *
 * 仅使用 Node.js 内置模块，提供 REST API + 静态 index.html。
 * 可单独运行：`node skills/approve-inbox/web/server.mjs`，浏览器访问 http://localhost:3891。
 *
 * 数据来源优先级：
 *   1. 真实数据 data/inbox.json + data/details/<id>.json（由 scripts/sync-inbox.mjs 抓取落盘）
 *   2. 缺失时触发真实同步；同步失败则返回错误，不回退样例数据
 *
 * 所有对外数据均经 normalize.mjs 转换为 v3 契约（ApproveInboxData / ApproveInboxDetail）。
 */

import { createServer } from "node:http";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  createReadStream,
  statSync,
} from "node:fs";
import { join, dirname, basename, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

import { normalizeInbox, normalizeDetail, fallbackDetail, isCompleteAnalysis } from "./normalize.mjs";
import { buildWidgetData } from "./widget-data.mjs";
import { buildCockpitData } from "./cockpit-normalize.mjs";
import { executeApproval } from "../scripts/approval-executor.mjs";
import { syncInbox } from "../scripts/sync-inbox.mjs";
import { resolveRuntimeContext } from "../scripts/runtime-context.mjs";
import {
  findStateItems,
  isValidPrimaryId,
  itemPrimaryId,
  moveItemsToDone,
  normalizeApprovalBody,
} from "../scripts/approval-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.APPROVE_INBOX_PORT || process.env.PORT || 3891);

// ── 路径常量 ────────────────────────────────────────────
const SKILL_DIR = join(__dirname, "..");
// 数据目录默认在 skill 内 data/；可用 APPROVE_INBOX_DATA 指向外部目录（如 yonclaw 真实 data）
const DATA_DIR = process.env.APPROVE_INBOX_DATA || join(SKILL_DIR, "data");
const STATE_FILE = join(DATA_DIR, "inbox.json");
const DETAILS_DIR = join(DATA_DIR, "details");
const ATTACH_DIR = join(DATA_DIR, "attachments");
const HTML_FILE = join(__dirname, "index.html");
const WIDGET_DIR = join(SKILL_DIR, "widget");
const SYNC_SCRIPT = join(SKILL_DIR, "scripts", "sync-inbox.mjs");
const ENRICH_SCRIPT = join(SKILL_DIR, "scripts", "enrich-details.mjs");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
};

// ── 工具函数 ────────────────────────────────────────────
function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function html(res, content) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(content);
}

function sendFile(res, filePath) {
  const ext = extname(filePath).toLowerCase();
  const stat = statSync(filePath);
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Content-Length": stat.size,
    "Cache-Control": "no-store",
  });
  createReadStream(filePath).pipe(res);
}

function log(...args) {
  process.stderr.write(`[server] ${args.join(" ")}\n`);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 读取本地真实 state（参考格式 {inbox,done} 或 v3 ApproveInboxData）；不存在返回 null */
function readState() {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch (e) {
    log(`读取 inbox.json 失败: ${e.message}`);
    return null;
  }
}

function writeState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

/** 读取本地真实详情文件；不存在返回 null */
function readRawDetail(id) {
  const file = join(DETAILS_DIR, `${id}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    log(`读取详情 ${id} 失败: ${e.message}`);
    return null;
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const s = Buffer.concat(chunks).toString();
      if (!s) return resolve({});
      try {
        resolve(JSON.parse(s));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    execFile(
      "node",
      [scriptPath, ...args],
      { timeout: 180_000, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject({ error: err.message, stderr });
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve({ raw: stdout, stderr });
        }
      }
    );
  });
}

// ── 路由处理 ────────────────────────────────────────────

// GET / — index.html
function handleIndex(req, res, url) {
  if (!existsSync(HTML_FILE)) {
    json(res, { error: "index.html not found" }, 500);
    return;
  }
  let content = readFileSync(HTML_FILE, "utf-8");
  if (url?.searchParams?.get("embed") === "cockpit-drawer") {
    content = content.replace(/\s*<header class="app-header">[\s\S]*?<\/header>\s*/, "\n");
  }
  html(res, content);
}

function isAllowedReturnTo(raw) {
  if (!raw || typeof raw !== "string") return false;
  try {
    const url = new URL(raw);
    if (url.protocol === "yonclaw:") return true;
    if (!["http:", "https:"].includes(url.protocol)) return false;
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function centerUrlWithReturnTo(returnTo) {
  if (!isAllowedReturnTo(returnTo)) return `${SERVER_URL}/`;
  return `${SERVER_URL}/?returnTo=${encodeURIComponent(returnTo)}`;
}

function widgetRefreshUrl(returnTo) {
  const url = new URL(`${SERVER_URL}/api/widget/refresh`);
  if (isAllowedReturnTo(returnTo)) url.searchParams.set("returnTo", returnTo);
  return url.toString();
}

function safeRuntimeContext({ full = false } = {}) {
  const ctx = resolveRuntimeContext({ skillDir: SKILL_DIR, dataDir: DATA_DIR, serverUrl: SERVER_URL, port: PORT });
  const state = readState();
  const safe = {
    skillId: ctx.skillId,
    serverUrl: ctx.serverUrl,
    widgetUrl: ctx.widgetUrl,
    centerUrl: ctx.centerUrl,
    dataAvailable: !!state,
  };
  if (full && process.env.APPROVE_INBOX_EXPOSE_RUNTIME_PATHS === "1") return { ...safe, ...ctx };
  return safe;
}

function widgetManifest(returnTo) {
  const ctx = safeRuntimeContext();
  const entryUrl = returnTo && isAllowedReturnTo(returnTo)
    ? `${ctx.widgetUrl}?returnTo=${encodeURIComponent(returnTo)}`
    : ctx.widgetUrl;
  return {
    id: "approve-inbox-smart-todo",
    skillId: "iuap-apcom-myapproval",
    name: "智能待办",
    title: "智能待办",
    type: "iframe",
    businessType: "approval-message-center",
    version: "1.0.1",
    description: "ai-workbench 驾驶舱智能待办 business 组件(approval-message-center)。宿主经 cockpitDataUrl 取数写 widget.data;iframe 入口展示预览,支持主题跟随与双向交互。",
    entryUrl,
    widgetUrl: entryUrl,
    dataUrl: `${ctx.serverUrl}/api/widget/todos`,
    cockpitDataUrl: `${ctx.serverUrl}/api/widget/cockpit`,
    centerEmbedUrl: `${ctx.serverUrl}/?embed=cockpit-drawer&detailOwner=host`,
    refreshUrl: widgetRefreshUrl(returnTo),
    refreshMethod: "POST",
    runtimeContextUrl: `${ctx.serverUrl}/api/runtime-context`,
    preferredSize: { w: 6, h: 5, minW: 4, minH: 4 },
    capabilities: ["open-center", "refresh", "theme-aware", "host-bridge", "request-detail"],
    themeContract: {
      message: "approve-inbox:theme",
      tokens: ["primary", "primaryHover", "bg", "surface", "text", "textMuted", "danger", "warning", "success", "radius", "mode", "fontFamily"],
    },
    bridge: {
      ready: "approve-inbox:ready",
      openCenter: "approve-inbox:open-center",
      requestDetail: "approve-inbox:request-detail",
      approveResult: "approve-inbox:approve-result",
      reload: "approve-inbox:reload",
    },
  };
}

function handleWidgetStatic(req, res, path) {
  let rawRel = "index.html";
  if (path !== "/widget/" && path !== "/widget") {
    try {
      rawRel = decodeURIComponent(path.slice("/widget/".length));
    } catch {
      json(res, { error: "Invalid widget path" }, 400);
      return;
    }
  }
  const rel = rawRel || "index.html";
  const filePath = resolve(WIDGET_DIR, rel);
  const root = resolve(WIDGET_DIR);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    json(res, { error: "Invalid widget path" }, 400);
    return;
  }
  if (!existsSync(filePath)) {
    json(res, { error: "Widget file not found" }, 404);
    return;
  }
  sendFile(res, filePath);
}

function realInboxResponse(state = readState()) {
  if (!state) return null;
  const data = normalizeInbox(state);
  if (!data || !Array.isArray(data.items)) return null;
  // 给每个 item 标注是否已有「完整」分析（读 detail）——前端据此统计/标注「待分析」
  for (const it of data.items) {
    const raw = readRawDetail(it.id);
    it.analyzed = isCompleteAnalysis(raw?.analysis) || isCompleteAnalysis(raw);
    const attachments = Array.isArray(raw?.content?.attachments)
      ? raw.content.attachments
      : (Array.isArray(raw?.attachments) ? raw.attachments : []);
    it.attachmentCount = Number(raw?.attachmentCount || raw?.content?.attachmentCount || attachments.length || 0);
    it.hasAttachments = !!(raw?.hasAttachments || it.attachmentCount > 0);
  }
  return { ...data, dataSource: "real" };
}

function inboxResponse() {
  return realInboxResponse();
}

function isUsableInboxData(data) {
  return !!(data && data.dataSource === "real" && Array.isArray(data.items) && data.items.length > 0);
}

function realInboxUnavailablePayload(syncReport = null) {
  const error = syncReport?.message || syncReport?.error || inboxSyncState.lastError || "未取到真实待办数据";
  return {
    success: false,
    dataSource: "unavailable",
    mode: "real",
    error,
    sync: syncReport || inboxSyncState.lastResult || null,
  };
}

function isCrossTenantItemForCurrentState(item = {}, state = {}) {
  const currentTenantId = state?.meta?.currentTenantId ? String(state.meta.currentTenantId) : "";
  const tenantId = item?.tenantId ? String(item.tenantId) : "";
  return !!(currentTenantId && tenantId && tenantId !== currentTenantId);
}

function crossTenantApprovalResult(item = {}, state = {}, action = "approve") {
  const title = item.title ? `「${item.title}」` : "当前待办";
  const tenantText = item.tenantName || item.tenantId || "其他租户";
  const currentText = state?.meta?.currentTenantName || state?.meta?.currentTenantId || "当前租户";
  return {
    type: "unavailable",
    primaryId: itemPrimaryId(item),
    action,
    success: false,
    tenantId: item.tenantId || null,
    currentTenantId: state?.meta?.currentTenantId || null,
    error: `${title}属于「${tenantText}」，当前服务租户是「${currentText}」；请在 YonWork 切换到对应租户并重新同步后再操作`,
  };
}

// GET /api/inbox — v3 ApproveInboxData（真实数据强制；无真实数据时先同步，失败则报错）
async function handleInbox(req, res) {
  let data = inboxResponse();
  let syncReport = null;
  if (!isUsableInboxData(data) && AUTO_SYNC_ENABLED) {
    syncReport = await runRefreshCycle("first-load", { limit: STARTUP_ANALYSIS_LIMIT, analyze: AUTO_ENABLED });
    data = inboxResponse();
  }
  if (!isUsableInboxData(data)) {
    json(res, realInboxUnavailablePayload(syncReport), 503);
    return;
  }
  json(res, data);
}

function handleRuntimeContext(req, res, url) {
  json(res, safeRuntimeContext({ full: url.searchParams.get("full") === "1" }));
}

function handleWidgetManifest(req, res, url) {
  json(res, widgetManifest(url.searchParams.get("returnTo") || ""));
}

function handleWidgetTodos(req, res, url) {
  const data = inboxResponse();
  if (!isUsableInboxData(data)) {
    json(res, {
      success: false,
      businessType: "approve-inbox-widget",
      state: "unavailable",
      error: inboxSyncState.lastError || "未取到真实待办数据",
      summary: { pendingCount: 0, highPriorityCount: 0, attentionCount: 0, lastSyncAt: null },
      items: [],
      magicSummary: "待办数据暂不可用，请进入待办中心或稍后刷新。",
      actions: {
        openCenterUrl: centerUrlWithReturnTo(url.searchParams.get("returnTo") || ""),
        refreshUrl: widgetRefreshUrl(url.searchParams.get("returnTo") || ""),
      },
    }, 503);
    return;
  }
  const limit = url.searchParams.get("limit") || undefined;
  const payload = buildWidgetData(data, {
    limit,
    centerUrl: centerUrlWithReturnTo(url.searchParams.get("returnTo") || ""),
    refreshUrl: widgetRefreshUrl(url.searchParams.get("returnTo") || ""),
  });
  json(res, { success: true, ...payload });
}

// GET /api/widget/cockpit — ai-workbench 驾驶舱 business 组件(approval-message-center)形态。
// 供 yoncockpit-controller agent 取数后写入 widget.data。轻量只读,不触发重型 enrich。
function handleWidgetCockpit(req, res, url) {
  const data = inboxResponse();
  const returnTo = url.searchParams.get("returnTo") || "";
  if (!isUsableInboxData(data)) {
    json(res, {
      success: false,
      businessType: "approval-message-center",
      state: "unavailable",
      error: inboxSyncState.lastError || "未取到真实待办数据",
      messages: [],
      todoStats: { todo: 0, actionable: 0, urgent: 0, done: 0, highRisk: 0 },
      highlights: [],
      queryMeta: { status: "todo", filterSummary: "待办数据暂不可用,请进入待办中心或稍后刷新。" },
      syncedAt: null,
      actions: {
        openCenterUrl: centerUrlWithReturnTo(returnTo),
        refreshUrl: widgetRefreshUrl(returnTo),
      },
    }, 503);
    return;
  }
  const payload = buildCockpitData(data, {
    limit: url.searchParams.get("limit") || undefined,
    centerUrl: centerUrlWithReturnTo(returnTo),
    refreshUrl: widgetRefreshUrl(returnTo),
  });
  json(res, { success: true, ...payload });
}

async function handleWidgetRefresh(req, res, url) {
  const sync = await runInboxSyncOnce("widget-refresh");
  const data = inboxResponse();
  if (!isUsableInboxData(data)) {
    json(res, {
      success: false,
      businessType: "approve-inbox-widget",
      state: "unavailable",
      error: sync.message || sync.error || inboxSyncState.lastError || "未取到真实待办数据",
      sync,
      summary: { pendingCount: 0, highPriorityCount: 0, attentionCount: 0, lastSyncAt: null },
      items: [],
      magicSummary: "待办数据暂不可用，请进入待办中心或稍后刷新。",
      actions: {
        openCenterUrl: centerUrlWithReturnTo(url.searchParams.get("returnTo") || ""),
        refreshUrl: widgetRefreshUrl(url.searchParams.get("returnTo") || ""),
      },
    }, 503);
    return;
  }
  const payload = buildWidgetData(data, {
    limit: url.searchParams.get("limit") || undefined,
    centerUrl: centerUrlWithReturnTo(url.searchParams.get("returnTo") || ""),
    refreshUrl: widgetRefreshUrl(url.searchParams.get("returnTo") || ""),
  });
  json(res, { success: true, sync, ...payload });
}

// GET /api/details/:id — v3 ApproveInboxDetail
function handleDetail(req, res, id) {
  // 列表项做兜底标题来源
  const state = readState();
  const data = state ? normalizeInbox(state) : { items: [] };
  const item = (data?.items || []).find((i) => i.id === id) || {};

  const raw = readRawDetail(id);
  if (raw) {
    json(res, { ...normalizeDetail(raw, item), dataSource: "real" });
    return;
  }
  json(res, { ...fallbackDetail(item), dataSource: "fallback" });
}

async function convertAttachmentToHtml(filePath) {
  const textutilArgs = ["-convert", "html", "-stdout", filePath];
  try {
    const { stdout } = await execFileAsync("textutil", textutilArgs, {
      timeout: 15000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (stdout && stdout.trim()) return stdout;
  } catch (e) {
    if (e.code !== "ENOENT") log(`textutil preview failed: ${e.message}`);
  }

  try {
    const { stdout } = await execFileAsync("pandoc", [filePath, "-t", "html"], {
      timeout: 15000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (stdout && stdout.trim()) return stdout;
  } catch (e) {
    if (e.code !== "ENOENT") log(`pandoc preview failed: ${e.message}`);
  }

  try {
    const { stdout } = await execFileAsync("strings", ["-n", "6", filePath], {
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const text = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 2000)
      .join("\n");
    if (text) return `<pre>${escapeHtml(text)}</pre>`;
  } catch (e) {
    if (e.code !== "ENOENT") log(`strings preview failed: ${e.message}`);
  }

  return "";
}

// GET /api/attachments/:id/:filename
async function handleAttachment(req, res, id, filename, options = {}) {
  if (!isValidPrimaryId(id)) {
    json(res, { error: "Invalid attachment id" }, 400);
    return;
  }
  const safeName = basename(filename);
  const filePath = join(ATTACH_DIR, id, safeName);
  if (!existsSync(filePath)) {
    json(res, { error: "File not found" }, 404);
    return;
  }
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  if (options.preview === "html") {
    if (![".doc", ".docx", ".rtf"].includes(ext)) {
      json(res, { error: "Preview conversion is not supported for this file type" }, 415);
      return;
    }
    const htmlContent = await convertAttachmentToHtml(filePath);
    if (!htmlContent) {
      json(res, { error: "No local document converter is available" }, 501);
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, max-age=3600",
    });
    res.end(htmlContent);
    return;
  }

  const stat = statSync(filePath);
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Content-Length": stat.size,
    "Content-Disposition": `inline; filename="${encodeURIComponent(safeName)}"`,
    "Cache-Control": "private, max-age=3600",
  });
  createReadStream(filePath).pipe(res);
}

// ── 离线分析调度 ────────────────────────────────────────
// 边界：YonClaw 抓待办列表写 data/inbox.json；本服务负责定时对未分析单据自动 enrich
// （抓字段+claude分析+附件，经 YonClaw BIP 代理）。设 APPROVE_INBOX_AUTO=0 关闭。
const AUTO_ENABLED = process.env.APPROVE_INBOX_AUTO !== "0";
const AUTO_INTERVAL = Number(process.env.APPROVE_INBOX_AUTO_INTERVAL || 300) * 1000; // 默认 5min
const AUTO_LIMIT = Number(process.env.APPROVE_INBOX_AUTO_LIMIT || 2); // 每轮最多分析 N 条
const AUTO_SYNC_ENABLED = process.env.APPROVE_INBOX_AUTO_SYNC !== "0";
const INBOX_SYNC_PAGE_SIZE = Number(process.env.APPROVE_INBOX_SYNC_PAGE_SIZE || 200);
const STARTUP_ANALYSIS_LIMIT = Number(process.env.APPROVE_INBOX_STARTUP_ANALYSIS_LIMIT || process.env.APPROVE_INBOX_SYNC_LIMIT || 10);
const MANUAL_ANALYSIS_LIMIT = Number(process.env.APPROVE_INBOX_SYNC_LIMIT || 10);
const schedulerState = {
  enabled: AUTO_ENABLED,
  running: false,
  lastRunAt: null,
  lastResult: null,
  enrichedTotal: 0,
};
const inboxSyncState = {
  enabled: AUTO_SYNC_ENABLED,
  running: false,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
};
let inboxSyncPromise = null;

function runInboxSyncOnce(reason = "manual") {
  if (!AUTO_SYNC_ENABLED) return Promise.resolve({ success: false, skipped: "disabled" });
  if (inboxSyncPromise) return inboxSyncPromise;
  inboxSyncPromise = (async () => {
    inboxSyncState.running = true;
    inboxSyncState.lastError = null;
    try {
      const report = await syncInbox({ data: DATA_DIR, pageSize: INBOX_SYNC_PAGE_SIZE });
      const success = !report.error;
      inboxSyncState.lastRunAt = new Date().toISOString();
      inboxSyncState.lastResult = { ...report, reason, success };
      inboxSyncState.lastError = success ? null : (report.message || report.error || "sync_failed");
      return { ...report, reason, success };
    } catch (e) {
      const error = String(e.message || e);
      inboxSyncState.lastRunAt = new Date().toISOString();
      inboxSyncState.lastResult = { reason, success: false, error };
      inboxSyncState.lastError = error;
      return { reason, success: false, error };
    } finally {
      inboxSyncState.running = false;
      inboxSyncPromise = null;
    }
  })();
  return inboxSyncPromise;
}

async function runRefreshCycle(reason = "scheduled", { limit = AUTO_LIMIT, analyze = AUTO_ENABLED } = {}) {
  const sync = await runInboxSyncOnce(reason);
  const data = inboxResponse();
  const hasData = isUsableInboxData(data);
  const canAnalyze = analyze && hasData && !schedulerState.running;
  const analysis = canAnalyze
    ? (runEnrichOnce(limit), { started: true, running: true, limit })
    : { started: false, running: schedulerState.running };

  return {
    success: hasData && sync.success !== false,
    hasData,
    sync,
    analysis,
    error: hasData ? null : (sync.message || sync.error || "未取到真实待办数据"),
  };
}

/**
 * 跑一次离线 enrich（对未分析待办）。
 * 用【子进程】跑 enrich-details CLI —— claude 分析是 execSync 同步阻塞，放子进程里
 * 才不会冻住 server 事件循环（否则每轮最长 limit×120s server 无响应）。
 */
async function runEnrichOnce(limit = AUTO_LIMIT) {
  if (schedulerState.running) return { skipped: "running" };
  if (!existsSync(STATE_FILE)) return { skipped: "no_inbox" };
  schedulerState.running = true;
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [ENRICH_SCRIPT, "--data", DATA_DIR, "--limit", String(limit)],
      { timeout: 300000, maxBuffer: 16 * 1024 * 1024 },
    );
    let report = {};
    try { report = JSON.parse(stdout); } catch { /* 子进程可能夹杂非 JSON 输出 */ }
    const done = (report.results || []).filter((r) => r.step === "done").length;
    schedulerState.lastRunAt = new Date().toISOString();
    schedulerState.lastResult = { processed: report.processed, done, proxy: report.proxy, skippedCrossTenant: report.skippedCrossTenant, error: report.error };
    schedulerState.enrichedTotal += done;
    return { success: !report.error, ...schedulerState.lastResult };
  } catch (e) {
    schedulerState.lastRunAt = new Date().toISOString();
    schedulerState.lastResult = { error: String(e.message || e) };
    return { success: false, error: String(e.message || e) };
  } finally {
    schedulerState.running = false;
  }
}

// ── 单据级异步 enrich（按需「重新分析本单」）────────────────
// claude 分析 execSync 阻塞，故按需 enrich 也走子进程：点击立即返回，前端轮询 /api/details。
const enrichJobs = new Map(); // id → { status:'running'|'done'|'error', startedAt, finishedAt?, error? }

function spawnEnrichJob(id) {
  const existing = enrichJobs.get(id);
  if (existing && existing.status === "running") return existing;
  const job = { status: "running", startedAt: new Date().toISOString() };
  enrichJobs.set(id, job);
  execFile(
    process.execPath,
    [ENRICH_SCRIPT, "--data", DATA_DIR, "--id", id, "--force"],
    { timeout: 180000, maxBuffer: 16 * 1024 * 1024 },
    (err) => {
      job.status = err ? "error" : "done";
      job.finishedAt = new Date().toISOString();
      if (err) job.error = String(err.message || err);
    },
  );
  return job;
}

/** 启动服务内自动刷新：启动即同步+分析，之后每 5 分钟同步待办并分析。 */
function startScheduler() {
  if (!AUTO_SYNC_ENABLED && !AUTO_ENABLED) {
    log("自动同步与离线分析均已关闭（APPROVE_INBOX_AUTO_SYNC=0, APPROVE_INBOX_AUTO=0）");
    return;
  }
  log(`服务内自动刷新启动：每 ${AUTO_INTERVAL / 1000}s 同步待办并分析（每轮分析 ${AUTO_LIMIT} 条）`);
  runRefreshCycle("startup", { limit: STARTUP_ANALYSIS_LIMIT, analyze: AUTO_ENABLED }).then((report) => {
    if (report.sync?.success) log(`启动同步完成：${report.sync.pending ?? 0} 个待办，${report.sync.done ?? 0} 个已办`);
    else log(`启动同步未完成：${report.sync?.message || report.sync?.error || report.sync?.skipped || "unknown"}`);
    if (report.analysis?.started) log(`启动智能分析已触发：最多 ${report.analysis.limit} 条`);
  });
  setInterval(() => {
    runRefreshCycle("scheduled", { limit: AUTO_LIMIT, analyze: AUTO_ENABLED }).then((report) => {
      if (report.sync?.success) log(`定时刷新完成：${report.sync.pending ?? 0} 个待办，${report.sync.done ?? 0} 个已办`);
      else log(`定时刷新未完成：${report.sync?.message || report.sync?.error || report.sync?.skipped || "unknown"}`);
    });
  }, AUTO_INTERVAL);
}

// GET /api/sync-status — 离线分析调度状态（含正在 enrich 的单据 id）
function handleSyncStatus(req, res) {
  const enriching = [...enrichJobs.entries()].filter(([, j]) => j.status === "running").map(([id]) => id);
  json(res, { ...schedulerState, interval: AUTO_INTERVAL / 1000, limit: AUTO_LIMIT, enriching, inboxSync: inboxSyncState });
}

// GET /api/enrich-status/:id — 单条 enrich 任务状态（前端轮询用）
function handleEnrichStatus(req, res, id) {
  const job = enrichJobs.get(id);
  json(res, job ? { id, ...job } : { id, status: "idle" });
}

// POST /api/enrich/:id — 按需对单条单据 enrich（异步子进程：抓字段+claude分析，不阻塞事件循环）。
// 立即返回 queued，前端轮询 /api/enrich-status/:id 或 /api/details/:id 拿最终结果。
async function handleEnrichOne(req, res, id) {
  const state = readState();
  if (!state) {
    json(res, { success: false, error: "未加载真实待办数据，无法分析单据" }, 503);
    return;
  }
  const items = findStateItems(state, [id]);
  if (items.length === 0) {
    json(res, { success: false, error: "No matching item" }, 404);
    return;
  }
  const item = items[0];
  if (isCrossTenantItemForCurrentState(item, state)) {
    const tenantText = item.tenantName || item.tenantId || "其他租户";
    const currentText = state?.meta?.currentTenantName || state?.meta?.currentTenantId || "当前租户";
    json(res, {
      success: false,
      type: "cross_tenant",
      tenantId: item.tenantId || null,
      currentTenantId: state?.meta?.currentTenantId || null,
      error: `当前单据属于「${tenantText}」，当前服务租户是「${currentText}」；请在 YonWork 切换到对应租户并重新同步后再分析附件`,
    }, 409);
    return;
  }
  const job = spawnEnrichJob(id);
  json(res, { success: true, queued: true, status: job.status, startedAt: job.startedAt });
}

// POST /api/sync — 刷新待办列表 + 触发一轮离线分析。
// 同步待办列表会等待完成并返回最新 data；AI 分析子进程非阻塞，前端轮询 sync-status + inbox。
async function handleSync(req, res) {
  const cycle = await runRefreshCycle("manual", { limit: MANUAL_ANALYSIS_LIMIT, analyze: true });
  const syncReport = cycle.sync;
  const data = inboxResponse();
  if (!isUsableInboxData(data)) {
    json(res, realInboxUnavailablePayload(syncReport), 503);
    return;
  }
  json(res, { success: syncReport.success !== false, mode: "real", data, sync: syncReport, ...cycle.analysis });
}

// POST /api/approve — 审批（真实数据先执行真实动作，成功后再落 done）
async function handleApprove(req, res) {
  let body;
  try {
    body = await parseBody(req);
  } catch {
    json(res, { success: false, error: "Invalid JSON body" }, 400);
    return;
  }
  const payload = normalizeApprovalBody(body);
  if (!payload.ok) {
    json(res, { success: false, error: payload.error }, payload.status || 400);
    return;
  }

  const state = readState();
  if (!state) {
    json(res, {
      success: false,
      mode: "real",
      action: payload.action,
      approved: [],
      completed: [],
      error: "未加载真实待办数据，无法执行审批",
    }, 503);
    return;
  }

  const items = findStateItems(state, payload.ids);
  if (items.length === 0) {
    json(res, { success: false, error: "No matching items" }, 404);
    return;
  }

  const blockedResults = [];
  const executableItems = [];
  for (const item of items) {
    if (isCrossTenantItemForCurrentState(item, state)) {
      blockedResults.push(crossTenantApprovalResult(item, state, payload.action));
    } else {
      executableItems.push(item);
    }
  }

  const detailsById = new Map(executableItems.map((item) => {
    const id = itemPrimaryId(item);
    return [id, readRawDetail(id)];
  }));

  const result = executableItems.length > 0
    ? await executeApproval(executableItems, { ...payload, detailsById })
    : { success: false, successIds: [], results: [] };
  const completed = result.successIds || [];
  if (completed.length > 0 && moveItemsToDone(state, new Set(completed), payload.action) > 0) {
    writeState(state);
  }
  const results = [...blockedResults, ...(result.results || [])];

  json(res, {
    success: results.length > 0 && results.every((r) => r?.success === true),
    mode: "real",
    action: payload.action,
    approved: completed,
    completed,
    results,
  });
}

// ── 路由分发 ────────────────────────────────────────────
async function handler(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && path === "/") {
      handleIndex(req, res, url);
    } else if (req.method === "GET" && path === "/api/runtime-context") {
      handleRuntimeContext(req, res, url);
    } else if (req.method === "GET" && path === "/api/widget/todos") {
      handleWidgetTodos(req, res, url);
    } else if (req.method === "GET" && path === "/api/widget/cockpit") {
      handleWidgetCockpit(req, res, url);
    } else if (req.method === "POST" && path === "/api/widget/refresh") {
      await handleWidgetRefresh(req, res, url);
    } else if (req.method === "GET" && path === "/widget/manifest.json") {
      handleWidgetManifest(req, res, url);
    } else if (req.method === "GET" && (path === "/widget" || path === "/widget/" || path.startsWith("/widget/"))) {
      handleWidgetStatic(req, res, path);
    } else if (req.method === "GET" && path === "/api/inbox") {
      await handleInbox(req, res);
    } else if (req.method === "GET" && path.startsWith("/api/attachments/")) {
      const rest = path.slice("/api/attachments/".length);
      const slash = rest.indexOf("/");
      if (slash > 0) {
        await handleAttachment(req, res, decodeURIComponent(rest.slice(0, slash)), decodeURIComponent(rest.slice(slash + 1)), {
          preview: url.searchParams.get("preview") || "",
        });
      } else {
        json(res, { error: "Invalid path" }, 400);
      }
    } else if (req.method === "GET" && path === "/api/sync-status") {
      handleSyncStatus(req, res);
    } else if (req.method === "GET" && path.startsWith("/api/enrich-status/")) {
      handleEnrichStatus(req, res, decodeURIComponent(path.slice("/api/enrich-status/".length)));
    } else if (req.method === "GET" && path.startsWith("/api/details/")) {
      handleDetail(req, res, decodeURIComponent(path.slice("/api/details/".length)));
    } else if (req.method === "POST" && path.startsWith("/api/enrich/")) {
      await handleEnrichOne(req, res, decodeURIComponent(path.slice("/api/enrich/".length)));
    } else if (req.method === "POST" && path === "/api/sync") {
      await handleSync(req, res);
    } else if (req.method === "POST" && path === "/api/approve") {
      await handleApprove(req, res);
    } else if (req.method === "POST" && path === "/api/shutdown") {
      json(res, { success: true, message: "Server shutting down" });
      setTimeout(() => server.close(() => process.exit(0)), 100);
    } else {
      json(res, { error: "Not found" }, 404);
    }
  } catch (e) {
    log(`Error: ${e.message}`);
    json(res, { error: e.message }, 500);
  }
}

// ── 打开浏览器（供 yonclaw 调用时单独打开审批页面）──────────
// 注意：不要命名为 URL，会遮蔽全局 URL 构造函数（handler 里用 new URL）
const SERVER_URL = `http://localhost:${PORT}`;
const AUTO_OPEN = process.argv.includes("--open") || process.env.APPROVE_INBOX_OPEN === "1";

function openBrowser() {
  if (!AUTO_OPEN) return;
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", SERVER_URL] : [SERVER_URL];
  execFile(opener, args, () => {});
}

// ── 启动 ────────────────────────────────────────────────
const server = createServer(handler);

// 端口被占用时认为服务已在运行：直接复用（yonclaw 可反复调用不报错）
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`\n  审批消息中心 v3 已在运行: \x1b[36m${SERVER_URL}\x1b[0m（复用现有实例）\n`);
    openBrowser();
    process.exit(0);
  } else {
    console.error(`[server] 启动失败: ${err.message}`);
    process.exit(1);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  审批消息中心 v3 已启动`);
  console.log(`  数据目录: ${DATA_DIR}`);
  console.log(`  打开浏览器访问: \x1b[36m${SERVER_URL}\x1b[0m\n`);
  openBrowser();
  startScheduler();
});
