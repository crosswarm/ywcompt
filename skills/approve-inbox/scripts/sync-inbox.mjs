#!/usr/bin/env node
/**
 * sync-inbox.mjs — 拉取 YonBIP 审批待办列表 → 写 v3 data/inbox.json
 *
 * 这是 SKILL.md 里「待办来源 ──sync──► inbox.json」的落地实现。
 * 设计边界：本脚本只负责【待办列表】这一步；单据详情字段 / 附件 / AI 分析
 * 由 enrich-details.mjs 负责（按需 POST /api/enrich/:id 或调度器批量）。
 *
 * 取数：走 YonClaw 本机 BIP 代理（端口动态，detectProxy 自动探测），代理自动注入
 * 登录态凭据，无需 cookie。待办列表 API（实测）：
 *   POST {proxy}/iuap-apcom-messagecenter/client/mobile/todo/items/PC/query?appName=pc-client&userId=userId
 *   body {pageIndex,pageSize} → { flag:0, result:[ {primaryId,title,webUrl,commitUserName,
 *         commitTsLong,doneStatus,serviceCode,serviceIcon,...} ] }
 *
 * CLI：
 *   node sync-inbox.mjs                 # 拉待办 → 写 inbox.json（默认 skill 内 data/）
 *   node sync-inbox.mjs --data <dir>    # 指定 data 目录（如 YonClaw 真实 data）
 *   node sync-inbox.mjs --page-size N   # 单页条数（默认 200）
 *   node sync-inbox.mjs --proxy <url>   # 指定代理（默认自动探测）
 *   node sync-inbox.mjs --dry-run       # 只拉取打印计数，不写盘
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { detectProxy } from "./enrich-details.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(HERE, "..");

// ── 纯函数：待办 item → v3 inbox item ─────────────────────

/**
 * 从待办推断单据类型名（docType）。
 * 首选：serviceIcon 文件名是 URL 编码的中文单据类型名（.../请购单.svg）。
 * 回退：serviceCode 去掉 list 后缀（pu_applyorderlist → pu_applyorder）。
 */
export function docTypeFromTodo(todo) {
  const icon = todo?.serviceIcon || "";
  if (icon) {
    try {
      const base = decodeURIComponent(icon.split("/").pop() || "");
      const name = base.replace(/\.[a-z0-9]+$/i, "").replace(/\s+/g, " ").trim();
      if (name && /[一-龥]/.test(name)) return name.slice(0, 20);
    } catch {
      // 解码失败走回退
    }
  }
  const sc = (todo?.serviceCode || "").replace(/list$/, "");
  return sc || "审批单";
}

/** 待办 item → v3 ApproveInboxItem（不含 riskLevel/advice，留给 enrich 分析回填）。 */
export function mapTodoToItem(todo) {
  const status = todo.doneStatus === 0 || todo.doneStatus == null ? "pending" : "done";
  const ts = todo.commitTsLong ?? todo.createTsLong ?? todo.msgTsLong;
  const submittedAt = ts ? new Date(Number(ts)).toISOString() : null;
  return {
    id: String(todo.primaryId),
    title: todo.title || "",
    docType: docTypeFromTodo(todo),
    status,
    submittedAt,
    submitter: todo.commitUserName || todo.commitUser?.username || null,
    // 租户（跨租户标注用）：待办列表是跨租户聚合的，详情取数只对代理当前租户有权
    tenantId: todo.tenantId || null,
    tenantName: todo.tenantInfo?.tenantName || null,
    // webUrl 含 19 位雪花 id，全程字符串（enrich 解析它取 billnum/id/query）
    webUrl: todo.webUrl || todo.mUrl || "",
    runtimeActions:
      status === "done"
        ? []
        : [
            { action: "approve", label: "通过", enabled: true },
            { action: "reject", label: "驳回", enabled: true },
          ],
  };
}

/** 待办列表 → v3 ApproveInboxData（summaries/reviewSummary 由 normalizeInbox 在 serve 时算）。 */
export function buildInboxData(todos, opts = {}) {
  const items = (todos || []).map(mapTodoToItem);
  const pendingCount = items.filter((i) => i.status !== "done").length;
  const data = {
    businessType: "approve-inbox",
    summary: {
      total: items.length,
      pendingCount,
      doneCount: items.length - pendingCount,
      lastSyncAt: opts.lastSyncAt || null,
    },
    viewSettings: { defaultTabId: "all-todo" },
    items,
  };
  // 当前代理租户（跨租户标注用）；探测失败则不写，前端回退「不过滤」
  if (opts.currentTenant && opts.currentTenant.id) {
    data.meta = {
      currentTenantId: opts.currentTenant.id,
      currentTenantName: opts.currentTenant.name || opts.currentTenant.id,
      syncedAt: opts.lastSyncAt || null,
    };
  }
  return data;
}

// ── 取数 ──────────────────────────────────────────────────

const TODO_PATH =
  "/iuap-apcom-messagecenter/client/mobile/todo/items/PC/query?appName=pc-client&userId=userId";

/** 经代理 POST 待办列表 API（凭据由代理自动注入）。 */
export async function fetchTodoList(proxyUrl, { pageSize = 200 } = {}) {
  const url = `${proxyUrl}${TODO_PATH}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageIndex: 1, pageSize }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`待办列表响应非 JSON：${text.slice(0, 120)}`);
  }
  if (j.flag !== 0) throw new Error(`待办列表失败：flag=${j.flag} msg=${j.msg || ""}`);
  return Array.isArray(j.result) ? j.result : [];
}

/** 解码 ADT(JWT) 的 payload.sub = 当前代理注入的租户 id。纯函数。 */
export function decodeAdtSub(adt) {
  try {
    const parts = String(adt || "").split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
    return payload.sub || null;
  } catch {
    return null;
  }
}

/**
 * 探测当前代理注入的租户 id（generateADT → 解码 ADT.sub）。失败返回 null。
 * 待办列表跨租户聚合，但详情取数只对此租户有权——用它标注跨租户单据。
 */
export async function fetchCurrentTenant(proxyUrl) {
  try {
    const r = await fetch(
      `${proxyUrl}/iuap-yonbuilder-runtime/bill/generateADT?domainKey=x&terminalType=1&billNo=x&id=1`,
      { signal: AbortSignal.timeout(8000) },
    );
    const j = await r.json();
    return decodeAdtSub(j?.data?.ADT);
  } catch {
    return null;
  }
}

// ── 主流程 ────────────────────────────────────────────────

function inboxPath(dataDir) {
  const DATA = dataDir || join(SKILL_DIR, "data");
  return { DATA, INBOX: join(DATA, "inbox.json") };
}

export async function syncInbox(opts = {}) {
  const { DATA, INBOX } = inboxPath(opts.data);
  const proxy = await detectProxy(opts.proxy);
  if (!proxy) return { error: "no_proxy", dataDir: DATA };

  let todos;
  try {
    todos = await fetchTodoList(proxy, { pageSize: opts.pageSize || 200 });
  } catch (err) {
    return { error: "fetch_failed", message: String(err.message || err), proxy, dataDir: DATA };
  }

  // 当前代理租户 + 从待办建 tenantId→name 映射（探测失败则不写 meta，前端不过滤）
  const currentTenantId = await fetchCurrentTenant(proxy);
  const nameMap = {};
  for (const t of todos) if (t.tenantId && t.tenantInfo?.tenantName) nameMap[t.tenantId] = t.tenantInfo.tenantName;
  const currentTenant = currentTenantId ? { id: currentTenantId, name: nameMap[currentTenantId] || currentTenantId } : null;

  const data = buildInboxData(todos, { lastSyncAt: new Date().toISOString(), currentTenant });

  // 从已有详情回填列表徽标（advice/risk/tags），避免重新 sync 后列表徽标丢失（幂等）
  try {
    const detailsDir = join(DATA, "details");
    const { deriveItemBadges } = await import("../web/normalize.mjs");
    for (const it of data.items) {
      const f = join(detailsDir, `${it.id}.json`);
      if (!existsSync(f)) continue;
      let d;
      try { d = JSON.parse(readFileSync(f, "utf-8")); } catch { continue; }
      const badges = d.analysis ? deriveItemBadges(d.analysis) : null;
      if (badges) {
        it.advice = badges.advice;
        it.riskLevel = badges.riskLevel;
        if (badges.smartTags.length) it.smartTags = badges.smartTags;
      }
    }
  } catch {
    // 回填失败不阻断 sync
  }

  if (!opts.dryRun) {
    if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
    writeFileSync(INBOX, JSON.stringify(data, null, 2), "utf-8");
  }

  return {
    proxy,
    dataDir: DATA,
    inbox: INBOX,
    written: !opts.dryRun,
    currentTenant: currentTenant ? `${currentTenant.name}(${currentTenant.id})` : null,
    total: data.items.length,
    pending: data.summary.pendingCount,
    done: data.summary.doneCount,
  };
}

// ── CLI ───────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { data: null, pageSize: 200, proxy: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--data") a.data = argv[++i];
    else if (x === "--page-size") a.pageSize = Number(argv[++i]);
    else if (x === "--proxy") a.proxy = argv[++i];
    else if (x === "--dry-run") a.dryRun = true;
  }
  return a;
}

function isMain() {
  // fileURLToPath 解码比对：install 路径含空格时 import.meta.url 编码成 %20，直接比会漏判
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
}
if (isMain()) {
  const opts = parseArgs(process.argv.slice(2));
  syncInbox(opts).then((report) => {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (report.error === "no_proxy") {
      process.stderr.write("\n[提示] 未探测到 YonClaw BIP 代理。确认 YonClaw 运行中，或 --proxy 指定。\n");
    } else if (report.error === "fetch_failed") {
      process.stderr.write(`\n[提示] 待办拉取失败：${report.message}\n`);
    }
  });
}
