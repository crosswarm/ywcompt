#!/usr/bin/env node
/**
 * server.mjs — 审批消息中心 v3 独立 Web 服务（零依赖）
 *
 * 仅使用 Node.js 内置模块，提供 REST API + 静态 index.html。
 * 可单独运行：`node skills/approve-inbox/web/server.mjs`，浏览器访问 http://localhost:3891。
 *
 * 数据来源优先级：
 *   1. 真实数据 data/inbox.json + data/details/<id>.json（由 scripts/sync-inbox.mjs 抓取落盘）
 *   2. 缺失时回退到 sample-data.mjs（无 YonBIP 凭据也能查看 v3 视觉）
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
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

import { normalizeInbox, normalizeDetail, fallbackDetail, isCompleteAnalysis } from "./normalize.mjs";
import { SAMPLE_INBOX, SAMPLE_DETAILS } from "./sample-data.mjs";

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
const SYNC_SCRIPT = join(SKILL_DIR, "scripts", "sync-inbox.mjs");
const ENRICH_SCRIPT = join(SKILL_DIR, "scripts", "enrich-details.mjs");

const MIME_TYPES = {
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
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

function log(...args) {
  process.stderr.write(`[server] ${args.join(" ")}\n`);
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
function handleIndex(req, res) {
  if (!existsSync(HTML_FILE)) {
    json(res, { error: "index.html not found" }, 500);
    return;
  }
  html(res, readFileSync(HTML_FILE, "utf-8"));
}

// GET /api/inbox — v3 ApproveInboxData（真实优先，回退 sample）
function handleInbox(req, res) {
  const state = readState();
  if (state) {
    const data = normalizeInbox(state);
    if (data && data.items.length > 0) {
      // 给每个 item 标注是否已有「完整」分析（读 detail）——前端据此统计/标注「待分析」
      for (const it of data.items) {
        const raw = readRawDetail(it.id);
        it.analyzed = isCompleteAnalysis(raw?.analysis) || isCompleteAnalysis(raw);
      }
      json(res, { ...data, dataSource: "real" });
      return;
    }
  }
  json(res, { ...SAMPLE_INBOX, dataSource: "sample" });
}

// GET /api/details/:id — v3 ApproveInboxDetail
function handleDetail(req, res, id) {
  // 列表项做兜底标题来源
  const state = readState();
  const data = state ? normalizeInbox(state) : SAMPLE_INBOX;
  const item = (data?.items || []).find((i) => i.id === id) || {};

  const raw = readRawDetail(id);
  if (raw) {
    json(res, { ...normalizeDetail(raw, item), dataSource: "real" });
    return;
  }
  if (SAMPLE_DETAILS[id]) {
    json(res, { ...SAMPLE_DETAILS[id], dataSource: "sample" });
    return;
  }
  json(res, { ...fallbackDetail(item), dataSource: "fallback" });
}

// GET /api/attachments/:id/:filename
function handleAttachment(req, res, id, filename) {
  const safeName = basename(filename);
  const filePath = join(ATTACH_DIR, id, safeName);
  if (!existsSync(filePath)) {
    json(res, { error: "File not found" }, 404);
    return;
  }
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
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
const schedulerState = {
  enabled: AUTO_ENABLED,
  running: false,
  lastRunAt: null,
  lastResult: null,
  enrichedTotal: 0,
};

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

/** 启动定时离线分析调度（仅真实数据；首轮延迟 5s 启动） */
function startScheduler() {
  if (!AUTO_ENABLED) {
    log("离线分析调度已关闭（APPROVE_INBOX_AUTO=0）");
    return;
  }
  if (!existsSync(STATE_FILE)) {
    log("无真实 inbox，跳过离线分析调度（样例模式）");
    return;
  }
  log(`离线分析调度启动：每 ${AUTO_INTERVAL / 1000}s 对未分析待办 enrich（每轮 ${AUTO_LIMIT} 条）`);
  setTimeout(() => runEnrichOnce(), 5000);
  setInterval(() => runEnrichOnce(), AUTO_INTERVAL);
}

// GET /api/sync-status — 离线分析调度状态（含正在 enrich 的单据 id）
function handleSyncStatus(req, res) {
  const enriching = [...enrichJobs.entries()].filter(([, j]) => j.status === "running").map(([id]) => id);
  json(res, { ...schedulerState, interval: AUTO_INTERVAL / 1000, limit: AUTO_LIMIT, enriching });
}

// GET /api/enrich-status/:id — 单条 enrich 任务状态（前端轮询用）
function handleEnrichStatus(req, res, id) {
  const job = enrichJobs.get(id);
  json(res, job ? { id, ...job } : { id, status: "idle" });
}

// POST /api/enrich/:id — 按需对单条单据 enrich（异步子进程：抓字段+claude分析，不阻塞事件循环）。
// 立即返回 queued，前端轮询 /api/enrich-status/:id 或 /api/details/:id 拿最终结果。
async function handleEnrichOne(req, res, id) {
  if (!existsSync(STATE_FILE)) {
    json(res, { success: false, error: "样例模式，无真实单据可 enrich" });
    return;
  }
  const job = spawnEnrichJob(id);
  json(res, { success: true, queued: true, status: job.status, startedAt: job.startedAt });
}

// POST /api/sync — 触发一轮离线分析（手动「同步全部 / 重新分析未完成」）。
// 非阻塞：后台子进程串行处理（claude 慢），立即返回，前端轮询 sync-status + 重开详情看结果。
async function handleSync(req, res) {
  if (!existsSync(STATE_FILE)) {
    json(res, { success: false, mode: "sample", error: "样例模式，无真实待办可分析（YonClaw 写入 data/inbox.json 后生效）" });
    return;
  }
  if (schedulerState.running) {
    json(res, { success: true, started: false, running: true });
    return;
  }
  const limit = Number(process.env.APPROVE_INBOX_SYNC_LIMIT || 10); // 手动同步一次多处理几条（跨租户/已完成会跳过）
  runEnrichOnce(limit); // 不 await
  json(res, { success: true, started: true, limit });
}

// POST /api/approve — 审批（真实数据本地落 done；样例模式仅回执）
async function handleApprove(req, res) {
  let body;
  try {
    body = await parseBody(req);
  } catch {
    json(res, { success: false, error: "Invalid JSON body" }, 400);
    return;
  }
  const ids = body.ids || body.primaryIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    json(res, { success: false, error: "ids required" }, 400);
    return;
  }

  const state = readState();
  if (!state) {
    json(res, {
      success: true,
      mode: "sample",
      approved: ids,
      message: "样例模式：审批仅在前端演示，未发起真实审批",
    });
    return;
  }

  // 真实数据：把对应项从 inbox 移到 done（本地状态）
  const idSet = new Set(ids);
  const inbox = state.inbox || [];
  const moved = inbox.filter((i) => idSet.has(i.primaryId || i.id));
  if (moved.length > 0) {
    state.inbox = inbox.filter((i) => !idSet.has(i.primaryId || i.id));
    state.done = [
      ...(state.done || []),
      ...moved.map((i) => ({ ...i, completedAt: new Date().toISOString() })),
    ];
    writeState(state);
  }
  json(res, {
    success: true,
    mode: "local",
    approved: moved.map((i) => i.primaryId || i.id),
    note: "已在本地标记为已办；如需真实审批请接入 CLI/审批脚本",
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
      handleIndex(req, res);
    } else if (req.method === "GET" && path === "/api/inbox") {
      handleInbox(req, res);
    } else if (req.method === "GET" && path.startsWith("/api/attachments/")) {
      const rest = path.slice("/api/attachments/".length);
      const slash = rest.indexOf("/");
      if (slash > 0) {
        handleAttachment(req, res, rest.slice(0, slash), rest.slice(slash + 1));
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
  const hasReal = existsSync(STATE_FILE);
  console.log(`\n  审批消息中心 v3 已启动`);
  console.log(`  数据模式: ${hasReal ? "真实数据 (data/inbox.json)" : "样例数据 (sample-data.mjs)"}`);
  console.log(`  打开浏览器访问: \x1b[36m${SERVER_URL}\x1b[0m\n`);
  openBrowser();
  startScheduler();
});
