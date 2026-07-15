#!/usr/bin/env node
/**
 * sync-inbox.mjs — 拉取 YonBIP 审批待办列表 → 写 v3 data/inbox.json
 *
 * 这是 SKILL.md 里「待办来源 ──sync──► inbox.json」的落地实现。
 * 设计边界：本脚本只负责【待办列表】这一步；单据详情字段 / 附件 / AI 分析
 * 由 enrich-details.mjs 负责（按需 POST /api/enrich/:id 或调度器批量）。
 *
 * 取数：统一调用 iuap-apcom-cli：
 *   workflow inboxtask list-inbox
 * 登录态、YonClaw / Browser Relay / API Gateway / 本地 Cookie 由 iuap-apcom-cli 统一 HTTP 管线处理。
 *
 * CLI：
 *   node sync-inbox.mjs                 # 拉待办 → 写 inbox.json（默认 skill 内 data/）
 *   node sync-inbox.mjs --data <dir>    # 指定 data 目录（如 YonWork 真实 data）
 *   node sync-inbox.mjs --page-size N   # 单页条数（默认 200）
 *   node sync-inbox.mjs --proxy <url>   # 兼容旧参数；业务取数不再直接使用代理 URL
 *   node sync-inbox.mjs --dry-run       # 只拉取打印计数，不写盘
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { itemPrimaryId } from "./approval-utils.mjs";
import { runBipCli } from "./bip-cli-client.mjs";
import { resolveHandler, resolveTodoMetadata } from "./doc-handlers/index.mjs";
import { docTypeFromTodo as canonicalDocTypeFromTodo } from "./doc-type-utils.mjs";
import { normalizeObservedActions } from "./observed-actions.mjs";
import { resolveReceivedAt, strongerReceivedAt, toIsoTimestamp } from "./received-at.mjs";
import {
  applyServiceIdentity,
  extractSourceServiceCode,
  SERVICE_NAME_PROVIDER,
  resolveServiceIdentities,
} from "./service-identity-resolver.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(HERE, "..");

// ── 纯函数：待办 item → v3 inbox item ─────────────────────

/**
 * 生成兼容业务显示名（docType）。serviceName 由同步解析器注入时优先使用，
 * 否则只接受中文 icon/标题等安全来源，绝不把 serviceCode 当作名称。
 */
export function docTypeFromTodo(todo) {
  return canonicalDocTypeFromTodo(todo);
}

function taskIdFromTodo(todo = {}) {
  if (todo.taskId) return String(todo.taskId);
  if (todo.businessKey) return String(todo.businessKey);
  const webUrl = todo.webUrl || todo.mUrl || "";
  try {
    return new URL(webUrl).searchParams.get("taskId") || "";
  } catch {
    return new URLSearchParams(String(webUrl).split("?").slice(1).join("?")).get("taskId") || "";
  }
}

function buttonText(button = {}) {
  const name = button.name;
  if (typeof name === "string") return name.trim();
  if (name && typeof name === "object") {
    return String(name.zh_CN || name.text || name.en_US || name.zh_TW || "").trim();
  }
  return "";
}

export function isReturnedToDrafterTodo(todo = {}) {
  const text = [
    todo.title,
    todo.content,
    todo.businessData?.taskName,
    todo.taskName,
    todo.nodeName,
  ].filter(Boolean).join(" ");
  return /(退回|驳回).{0,12}(制单|发起|申请)人?(?:待办)?|退回制单待办/.test(text);
}

function observedActionsFromTodo(todo = {}, observedAt = undefined) {
  const buttons = Array.isArray(todo.buttons) ? todo.buttons : [];
  const actions = buttons
    .map((button) => {
      const callback = String(button.callBackExecType || "").toLowerCase();
      const text = buttonText(button);
      if (callback === "agree") {
        return {
          action: "approve",
          label: text || "通过",
          enabled: true,
          callBackExecType: "agree",
          buttonIndex: button.buttonIndex,
        };
      }
      if (callback === "reject") {
        return {
          action: /驳回|拒绝/.test(text) ? "reject" : "return",
          label: text || "退回",
          enabled: true,
          callBackExecType: "reject",
          buttonIndex: button.buttonIndex,
        };
      }
      return null;
    })
    .filter(Boolean);
  return normalizeObservedActions(actions, {
    source: "todo.buttons",
    observedAt,
    requiresRefresh: true,
    endpointHint: "workflow.runtime",
  });
}

function handlerSupportsApproval(handler, todo = {}) {
  if (!handler || typeof handler.approvalStrategy !== "function") return false;
  try {
    const strategy = handler.approvalStrategy({}, todo);
    return Boolean(strategy?.kind && strategy.kind !== "unsupported");
  } catch {
    return false;
  }
}

/** 待办 item → v3 ApproveInboxItem（不含 riskLevel/advice，留给 enrich 分析回填）。 */
export function mapTodoToItem(todo, opts = {}) {
  const serviceTodo = applyServiceIdentity(todo, opts.serviceResolution);
  const handler = resolveHandler(serviceTodo);
  const metadata = resolveTodoMetadata(serviceTodo);
  const serviceCode = serviceTodo.serviceCode || "";
  const serviceName = serviceTodo.serviceName || "";
  const docType = serviceName || docTypeFromTodo(serviceTodo);
  const returnedToDrafter = isReturnedToDrafterTodo(todo);
  const status = returnedToDrafter ? "done" : (todo.doneStatus === 0 || todo.doneStatus == null ? "pending" : "done");
  const submittedAt = toIsoTimestamp(todo.commitTsLong) || toIsoTimestamp(todo.commitTime);
  const receivedAt = resolveReceivedAt(todo);
  const primaryId = String(todo.primaryId || todo.id || "");
  const observedActions = observedActionsFromTodo(todo, opts.observedAt);
  const runtimeActions = status !== "done" && handlerSupportsApproval(handler, serviceTodo)
    ? observedActions.map((action) => ({ ...action }))
    : [];
  const item = {
    id: primaryId,
    primaryId,
    todoId: todo.id ? String(todo.id) : null,
    taskId: taskIdFromTodo(todo),
    workflowBusinessKey: todo.businessKey ? String(todo.businessKey) : null,
    title: todo.title || "",
    ...(serviceCode ? { serviceCode } : {}),
    ...(serviceTodo.sourceServiceCode ? { sourceServiceCode: serviceTodo.sourceServiceCode } : {}),
    ...(serviceName ? { serviceName } : {}),
    ...(serviceTodo.serviceNameSource ? { serviceNameSource: serviceTodo.serviceNameSource } : {}),
    docType,
    displayKey: serviceCode || docType,
    displayLabel: serviceName || docType,
    handlerId: metadata.handlerId,
    framework: metadata.framework,
    status,
    submittedAt,
    ...receivedAt,
    submitter: todo.commitUserName || todo.commitUser?.username || null,
    // 租户（跨租户标注用）：待办列表是跨租户聚合的，详情取数只对代理当前租户有权
    tenantId: todo.tenantId || null,
    tenantName: todo.tenantInfo?.tenantName || null,
    // webUrl 含 19 位雪花 id，全程字符串（enrich 解析它取 billnum/id/query）
    webUrl: todo.webUrl || todo.mUrl || "",
    observedActions,
    runtimeActions,
  };
  if (returnedToDrafter) {
    item.completedAt = submittedAt;
    item.completedAction = "return";
    item.approvalAction = "return";
    item.completionSource = "todo.returned-to-drafter";
  }
  return item;
}

/** 待办列表 → v3 ApproveInboxData（summaries/reviewSummary 由 normalizeInbox 在 serve 时算）。 */
export function buildInboxData(todos, opts = {}) {
  const observedAt = opts.lastSyncAt || new Date().toISOString();
  const serviceResolutions = opts.serviceResolutions instanceof Map ? opts.serviceResolutions : new Map();
  const items = (todos || []).map((todo) => {
    const sourceServiceCode = extractSourceServiceCode(todo);
    return mapTodoToItem(todo, {
      observedAt,
      serviceResolution: sourceServiceCode ? serviceResolutions.get(sourceServiceCode) : null,
    });
  });
  const currentTenantId = opts.currentTenant?.id ? String(opts.currentTenant.id) : "";
  if (currentTenantId) {
    for (const item of items) {
      if (item.tenantId && String(item.tenantId) !== currentTenantId) {
        item.runtimeActions = [];
      }
    }
  }
  const summary = summarizeItemsForTenant(items, currentTenantId, opts.lastSyncAt || null);
  const data = {
    businessType: "approve-inbox",
    summary,
    viewSettings: { defaultTabId: "all-todo", defaultSort: "received-desc" },
    items,
  };
  // 当前代理租户（跨租户标注用）；探测失败则不写，前端回退「不过滤」
  if (opts.currentTenant && opts.currentTenant.id) {
    const rawPendingCount = items.filter((item) => item.status !== "done").length;
    data.meta = {
      currentTenantId: opts.currentTenant.id,
      currentTenantName: opts.currentTenant.name || opts.currentTenant.id,
      syncedAt: opts.lastSyncAt || null,
      rawSummary: {
        total: items.length,
        pendingCount: rawPendingCount,
        doneCount: items.length - rawPendingCount,
        crossTenantCount: items.length - summary.total,
      },
    };
  }
  return data;
}

function stateItems(existingState) {
  if (!existingState) return [];
  if (existingState.businessType === "approve-inbox" && Array.isArray(existingState.items)) return existingState.items;
  return [
    ...(existingState.inbox || []),
    ...(existingState.pending || []),
    ...(existingState.done || []),
  ];
}

function preservedDoneStateItems(existingState) {
  if (!existingState) return [];
  if (existingState.businessType === "approve-inbox" && Array.isArray(existingState.items)) {
    return existingState.items.filter((item) => item?.status === "done");
  }
  return Array.isArray(existingState.done) ? existingState.done : [];
}

export function mergePreservedReceivedAt(data, existingState) {
  if (!data || !Array.isArray(data.items) || !existingState) return data;
  const strongestByTaskId = new Map();
  for (const item of stateItems(existingState)) {
    const taskId = String(item?.taskId || "").trim();
    if (!taskId) continue;
    const previous = strongestByTaskId.get(taskId);
    strongestByTaskId.set(taskId, previous ? strongerReceivedAt(previous, item) : resolveReceivedAt(item));
  }
  for (const item of data.items) {
    const taskId = String(item?.taskId || "").trim();
    if (!taskId || !strongestByTaskId.has(taskId)) continue;
    Object.assign(item, strongerReceivedAt(item, strongestByTaskId.get(taskId)));
  }
  return data;
}

function itemBelongsToCurrentTenant(item, currentTenantId) {
  if (!currentTenantId) return true;
  return !item.tenantId || String(item.tenantId) === String(currentTenantId);
}

function summarizeItemsForTenant(items, currentTenantId, lastSyncAt) {
  const scopedItems = currentTenantId
    ? items.filter((item) => itemBelongsToCurrentTenant(item, currentTenantId))
    : items;
  const pendingCount = scopedItems.filter((item) => item.status !== "done").length;
  return {
    total: scopedItems.length,
    pendingCount,
    doneCount: scopedItems.length - pendingCount,
    lastSyncAt: lastSyncAt || null,
  };
}

function normalizePreservedDoneItem(item = {}) {
  const id = itemPrimaryId(item);
  if (!id) return null;
  return {
    ...item,
    id,
    primaryId: item.primaryId || id,
    status: "done",
    runtimeActions: [],
  };
}

export function mergePreservedDoneItems(data, existingState) {
  if (!data || !Array.isArray(data.items) || !existingState) return data;
  const currentIds = new Set(data.items.map(itemPrimaryId).filter(Boolean));
  const existingDone = preservedDoneStateItems(existingState);

  let appended = 0;
  for (const item of existingDone) {
    const doneItem = normalizePreservedDoneItem(item);
    if (!doneItem || currentIds.has(doneItem.id)) continue;
    data.items.push(doneItem);
    currentIds.add(doneItem.id);
    appended += 1;
  }

  if (appended > 0) {
    data.summary = summarizeItemsForTenant(
      data.items,
      data.meta?.currentTenantId || "",
      data.summary?.lastSyncAt || null,
    );
    if (data.meta?.rawSummary) {
      const rawPendingCount = data.items.filter((item) => item.status !== "done").length;
      data.meta.rawSummary = {
        ...data.meta.rawSummary,
        total: data.items.length,
        pendingCount: rawPendingCount,
        doneCount: data.items.length - rawPendingCount,
        crossTenantCount: data.items.length - data.summary.total,
      };
    }
  }
  return data;
}

function safeCompatibilityDocType(item = {}) {
  const serviceName = String(item.serviceName || "").trim();
  if (serviceName) return serviceName;
  const current = String(item.docType || "").trim();
  if (/[一-龥]/.test(current)) return current;
  return docTypeFromTodo(item);
}

/** 把一次批量解析结果应用到新待办和保留已办，并写入同步诊断摘要。 */
export function applyResolvedServiceIdentities(data, resolutionResult = {}) {
  if (!data || !Array.isArray(data.items)) return data;
  const bySourceCode = resolutionResult.bySourceCode instanceof Map
    ? resolutionResult.bySourceCode
    : new Map();

  for (const item of data.items) {
    const sourceServiceCode = extractSourceServiceCode(item);
    const resolution = sourceServiceCode ? bySourceCode.get(sourceServiceCode) : null;
    const previousDisplayKey = String(item.displayKey || "").trim();
    const previousDocType = String(item.docType || "").trim();
    const previousServiceCode = String(item.serviceCode || "").trim();
    const previousSourceServiceCode = String(item.sourceServiceCode || "").trim();
    const enriched = applyServiceIdentity(item, resolution);
    for (const field of [
      "sourceServiceCode",
      "serviceName",
      "serviceNameSource",
      "docTypeName",
      "displayLabel",
    ]) {
      if (!Object.prototype.hasOwnProperty.call(enriched, field)) delete item[field];
    }
    Object.assign(item, enriched);
    item.docType = safeCompatibilityDocType(item);
    if (item.serviceName) item.docTypeName = item.serviceName;
    const generatedLegacyKeys = new Set([
      previousDocType,
      previousServiceCode,
      previousSourceServiceCode,
      "审批单",
      "default",
    ].filter(Boolean));
    if (!previousDisplayKey || generatedLegacyKeys.has(previousDisplayKey)) {
      item.displayKey = item.handlerId || item.serviceCode || item.docType || "default";
    }
    if (item.serviceName) item.displayLabel = item.serviceName;
    else if (!item.displayLabel) item.displayLabel = item.docType || item.displayKey;
  }

  data.meta = {
    ...(data.meta || {}),
    serviceResolution: {
      provider: resolutionResult.provider === "bip-cli.auth.permission.apply"
        ? SERVICE_NAME_PROVIDER
        : (resolutionResult.provider || SERVICE_NAME_PROVIDER),
      resolvedCount: Number(resolutionResult.resolvedCount) || 0,
      unresolvedCount: Number(resolutionResult.unresolvedCount) || 0,
    },
  };
  return data;
}

// ── 取数 ──────────────────────────────────────────────────

/** 经 iuap-apcom-cli 拉取待办列表和当前租户。 */
export async function fetchTodoListResult(_proxyUrl, { pageSize = 200, runBipCli: run = runBipCli } = {}) {
  const result = await run(["workflow", "inboxtask", "list-inbox"], { pageSize });
  const todos = Array.isArray(result?.items)
    ? result.items
    : (Array.isArray(result?.result) ? result.result : []);
  return {
    todos,
    currentTenantId: result?.currentTenantId ? String(result.currentTenantId) : null,
    raw: result,
  };
}

/** 经 iuap-apcom-cli 拉取待办列表。保留 proxyUrl 参数兼容旧测试/调用方。 */
export async function fetchTodoList(proxyUrl, opts = {}) {
  const result = await fetchTodoListResult(proxyUrl, opts);
  return result.todos;
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
export async function fetchCurrentTenant(proxyUrl, opts = {}) {
  try {
    const result = await fetchTodoListResult(proxyUrl, { ...opts, pageSize: 1 });
    return result.currentTenantId;
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
  const proxy = opts.proxy || "";

  let todos;
  let currentTenantId = null;
  try {
    const result = await fetchTodoListResult(proxy, {
      pageSize: opts.pageSize || 200,
      runBipCli: opts.runBipCli,
    });
    todos = result.todos;
    currentTenantId = result.currentTenantId;
  } catch (err) {
    return { error: "fetch_failed", message: String(err.message || err), proxy, dataDir: DATA };
  }

  // 当前代理租户 + 从待办建 tenantId→name 映射（探测失败则不写 meta，前端不过滤）
  const nameMap = {};
  for (const t of todos) if (t.tenantId && t.tenantInfo?.tenantName) nameMap[t.tenantId] = t.tenantInfo.tenantName;
  const currentTenant = currentTenantId ? { id: currentTenantId, name: nameMap[currentTenantId] || currentTenantId } : null;

  let existingState = null;
  if (existsSync(INBOX)) {
    try { existingState = JSON.parse(readFileSync(INBOX, "utf-8")); } catch { existingState = null; }
  }

  let serviceResolution;
  try {
    serviceResolution = await resolveServiceIdentities(
      [...todos, ...preservedDoneStateItems(existingState)],
      {
        runBipCli: opts.runBipCli,
        concurrency: 4,
        timeoutMs: 15_000,
      },
    );
  } catch {
    serviceResolution = {
      bySourceCode: new Map(),
      resolvedCount: 0,
      unresolvedCount: 0,
      provider: SERVICE_NAME_PROVIDER,
    };
  }

  const freshData = buildInboxData(todos, {
    lastSyncAt: new Date().toISOString(),
    currentTenant,
    serviceResolutions: serviceResolution.bySourceCode,
  });
  mergePreservedReceivedAt(freshData, existingState);
  const data = mergePreservedDoneItems(freshData, existingState);
  applyResolvedServiceIdentities(data, serviceResolution);

  // 从已有详情回填列表徽标（advice/risk/tags），避免重新 sync 后列表徽标丢失（幂等）
  try {
    const detailsDir = join(DATA, "details");
    const { deriveItemBadges } = await import("../web/normalize.mjs");
    for (const it of data.items) {
      const f = join(detailsDir, `${it.id}.json`);
      if (!existsSync(f)) continue;
      let d;
      try { d = JSON.parse(readFileSync(f, "utf-8")); } catch { continue; }
      const analysisBadges = d.analysis ? deriveItemBadges(d.analysis) : null;
      const badges = d.compositeAdvice?.advice
        ? {
            advice: d.compositeAdvice.advice,
            aiSuggestion: analysisBadges?.aiSuggestion,
            riskLevel: d.compositeAdvice.riskLevel || it.riskLevel,
            smartTags: analysisBadges?.smartTags || [],
          }
        : analysisBadges;
      if (badges) {
        it.advice = badges.advice;
        if (badges.aiSuggestion) it.aiSuggestion = badges.aiSuggestion;
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
    transport: "iuap-apcom-cli",
    dataDir: DATA,
    inbox: INBOX,
    written: !opts.dryRun,
    currentTenant: currentTenant ? `${currentTenant.name}(${currentTenant.id})` : null,
    total: data.items.length,
    pending: data.summary.pendingCount,
    done: data.summary.doneCount,
    serviceResolved: serviceResolution.resolvedCount,
    serviceUnresolved: serviceResolution.unresolvedCount,
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
    if (report.error === "fetch_failed") {
      process.stderr.write(`\n[提示] 待办拉取失败：${report.message}\n`);
    }
  });
}
