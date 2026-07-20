#!/usr/bin/env node
/**
 * server.mjs — 智能待办独立 Web 服务（零依赖）
 *
 * 仅使用 Node.js 内置模块，提供 REST API + 静态 index.html。
 * 可单独运行：`node skills/iuap-apcom-myapproval/web/server.mjs`，浏览器访问 http://localhost:3891。
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
  mkdirSync,
  renameSync,
  unlinkSync,
  copyFileSync,
  cpSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join, dirname, basename, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomBytes } from "node:crypto";

const execFileAsync = promisify(execFile);

import {
  normalizeInbox,
  normalizeDetail,
  fallbackDetail,
  isCompleteAnalysis,
  buildCompositeAdvice,
  deriveListAiSuggestion,
} from "./normalize.mjs";
import { buildWidgetData } from "./widget-data.mjs";
import { buildCockpitData } from "./cockpit-normalize.mjs";
import { loadUiConfig } from "../scripts/ui-config.mjs";
import { loadTableViewConfig } from "../scripts/table-view-config.mjs";
import { loadCardViewConfig } from "../scripts/card-view-config.mjs";
import { loadDetailCardConfig } from "../scripts/detail-card-config.mjs";
import { loadPersonalRulesConfig } from "../scripts/personal-rules-config.mjs";
import { buildTableView, tableConfigUsesDetailPath } from "../scripts/table-view-builder.mjs";
import { buildDetailCardFields } from "../scripts/detail-card-builder.mjs";
import { buildFieldDisplaySections, mergeDetailCardSections } from "../scripts/field-display-plan.mjs";
import { validateConfig } from "../scripts/config-schema-validator.mjs";
import { runUiConfigDiagnostics } from "../scripts/ui-config-diagnostics.mjs";
import { executeApproval } from "../scripts/approval-executor.mjs";
import { queryCloudAuditResult } from "../scripts/cloud-audit-result.mjs";
import { parseWebUrl } from "../scripts/fetch-bill-detail.mjs";
import { syncInbox } from "../scripts/sync-inbox.mjs";
import { withStateCommitLock } from "../scripts/state-commit-lock.mjs";
import {
  analysisKey,
  detailContentHash,
  itemRevision,
  legacyDetailMatchesItem,
} from "../scripts/detail-cache-identity.mjs";
import {
  sanitizeIdentityBearingUrl,
  sanitizeStoredIdentityData,
} from "../scripts/identity-data-sanitizer.mjs";
import { resolveRuntimeContext } from "../scripts/runtime-context.mjs";
import {
  buildRuntimeIdentity,
  identityMatchesState,
  issueFromError,
  scopeDataDir,
  verifyManagedCliIdentity,
} from "../scripts/runtime-identity.mjs";
import {
  activeApprovalProcessing,
  clearItemsApprovalProcessing,
  findStateItems,
  isValidPrimaryId,
  itemPrimaryId,
  markItemsApprovalProcessing,
  moveItemsToDone,
  normalizeApprovalBody,
  updateItemsApprovalProcessing,
} from "../scripts/approval-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.APPROVE_INBOX_PORT || process.env.PORT || 3891);
const SERVICE_PROTOCOL_VERSION = 6;

// ── 路径常量 ────────────────────────────────────────────
const SKILL_DIR = join(__dirname, "..");
// 数据目录默认在 skill 内 data/；可用 APPROVE_INBOX_DATA 指向外部目录（如 yonclaw 真实 data）
const DATA_ROOT = process.env.APPROVE_INBOX_DATA || join(SKILL_DIR, "data");
let DATA_DIR = DATA_ROOT;
let STATE_FILE = join(DATA_DIR, "inbox.json");
let DETAILS_DIR = join(DATA_DIR, "details");
let ATTACH_DIR = join(DATA_DIR, "attachments");
const CONFIG_DIR = join(SKILL_DIR, "config");
let UI_ASSETS_DIR = join(DATA_DIR, "ui-assets");
const HTML_FILE = join(__dirname, "index.html");
const WEB_STATIC_FILES = new Set(["message-list-render.js", "message-list.css"]);
const WIDGET_DIR = join(SKILL_DIR, "widget");
const SYNC_SCRIPT = join(SKILL_DIR, "scripts", "sync-inbox.mjs");
const ENRICH_SCRIPT = process.env.APPROVE_INBOX_ENRICH_SCRIPT || join(SKILL_DIR, "scripts", "enrich-details.mjs");
const AUTH_MODE = process.env.APPROVE_INBOX_AUTH_MODE === "local-dev"
  ? "local-dev"
  : "managed-yonwork";
const LOCAL_DEV_MODE = AUTH_MODE === "local-dev";
const SERVICE_RUNTIME_CONTEXT = resolveRuntimeContext({ skillDir: SKILL_DIR, dataDir: DATA_ROOT, port: PORT });
const PROFILE_DIR = process.env.APPROVE_INBOX_PROFILE_DIR || SERVICE_RUNTIME_CONTEXT.profileDir || "";

function sha256(value) {
  return createHash("sha256").update(String(value), "utf-8").digest("hex");
}

const SERVICE_IDENTITY = Object.freeze({
  skillId: SERVICE_RUNTIME_CONTEXT.skillId,
  serviceInstanceKey: process.env.APPROVE_INBOX_SERVICE_INSTANCE_KEY
    || sha256(JSON.stringify({
      skillId: SERVICE_RUNTIME_CONTEXT.skillId,
      profileKey: process.env.APPROVE_INBOX_PROFILE_KEY || sha256(`profile\0${resolve(PROFILE_DIR || SKILL_DIR)}`),
      port: PORT,
      protocolVersion: SERVICE_PROTOCOL_VERSION,
      authMode: AUTH_MODE,
      proxyContextFingerprint: process.env.APPROVE_INBOX_PROXY_CONTEXT_FINGERPRINT
        || (process.env.YONCLAW_REQ_PROXY_BASE_URL
          ? sha256(`yonclaw-proxy:${String(process.env.YONCLAW_REQ_PROXY_BASE_URL).trim().replace(/\/+$/, "")}`)
          : ""),
    })),
  profileKey: process.env.APPROVE_INBOX_PROFILE_KEY
    || sha256(`profile\0${resolve(PROFILE_DIR || SKILL_DIR)}`),
  authMode: AUTH_MODE,
  proxyContext: {
    fingerprint: process.env.APPROVE_INBOX_PROXY_CONTEXT_FINGERPRINT
      || (process.env.YONCLAW_REQ_PROXY_BASE_URL
        ? sha256(`yonclaw-proxy:${String(process.env.YONCLAW_REQ_PROXY_BASE_URL).trim().replace(/\/+$/, "")}`)
        : ""),
  },
});
const INSTANCE_ID = process.env.APPROVE_INBOX_INSTANCE_ID || randomBytes(16).toString("hex");
const INSTANCE_TOKEN = process.env.APPROVE_INBOX_INSTANCE_TOKEN || "";
const IDENTITY_CACHE_TTL_MS = Math.max(0, Number(process.env.APPROVE_INBOX_IDENTITY_CACHE_TTL_MS ?? 10_000) || 0);
const APPROVAL_RECONCILIATION_DELAYS_MS = String(
  process.env.APPROVE_INBOX_APPROVAL_RECONCILIATION_DELAYS_MS || "0,30000,90000",
).split(",")
  .map((value) => Math.max(0, Number(value.trim())))
  .filter(Number.isFinite);
let dataAccessAllowed = LOCAL_DEV_MODE;
let activeIdentitySession = null;
let identityVerificationPromise = null;
let identityEpoch = 0;
const authState = {
  status: LOCAL_DEV_MODE ? "local-dev" : "unknown",
  issue: null,
  lastVerifiedAt: null,
};

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

function clipForLog(value, maxLength = 4000) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...<truncated ${text.length - maxLength} chars>`;
}

function scriptErrorDetails(error, { stdout, stderr } = {}) {
  return {
    error: String(error?.message || error || "script_failed"),
    code: error?.code ?? null,
    signal: error?.signal ?? null,
    stdout: clipForLog(stdout ?? error?.stdout ?? ""),
    stderr: clipForLog(stderr ?? error?.stderr ?? ""),
  };
}

function logScriptProcessError(label, details) {
  log(`${label} failed: ${details.error}${details.code ? ` code=${details.code}` : ""}${details.signal ? ` signal=${details.signal}` : ""}`);
  if (details.stderr) log(`${label} stderr: ${details.stderr}`);
  if (details.stdout) log(`${label} stdout: ${details.stdout}`);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setDataDir(nextDir) {
  DATA_DIR = nextDir;
  STATE_FILE = join(DATA_DIR, "inbox.json");
  DETAILS_DIR = join(DATA_DIR, "details");
  ATTACH_DIR = join(DATA_DIR, "attachments");
  UI_ASSETS_DIR = join(DATA_DIR, "ui-assets");
}

function captureDataContext() {
  if (!dataAccessAllowed || !activeIdentitySession?.identity?.dataScopeKey) return null;
  return Object.freeze({
    scopeKey: activeIdentitySession.identity.dataScopeKey,
    identityEpoch: activeIdentitySession.identity.identityEpoch,
    dataDir: DATA_DIR,
    stateFile: STATE_FILE,
    detailsDir: DETAILS_DIR,
    attachDir: ATTACH_DIR,
    uiAssetsDir: UI_ASSETS_DIR,
  });
}

function requestDataContext(req) {
  return req?.approveInboxDataContext || captureDataContext();
}

function dataContextIsCurrent(context) {
  return !!(
    context
      && dataAccessAllowed
      && context.scopeKey === activeIdentitySession?.identity?.dataScopeKey
      && context.identityEpoch === activeIdentitySession?.identity?.identityEpoch
  );
}

let legacyQuarantined = false;
function quarantineLegacyData() {
  if (legacyQuarantined || LOCAL_DEV_MODE) return;
  legacyQuarantined = true;
  const legacyRoot = join(DATA_ROOT, "legacy-v1");
  const names = [
    "inbox.json",
    "details",
    "attachments",
    "ui-assets",
    "ui.config.json",
    "table-view.config.json",
    "card-view.config.json",
    "detail-card-view.config.json",
    "personal-rules.config.json",
  ];
  const existing = names.filter((name) => existsSync(join(DATA_ROOT, name)));
  if (existing.length === 0) return;
  mkdirSync(legacyRoot, { recursive: true });
  for (const name of existing) {
    const source = join(DATA_ROOT, name);
    let target = join(legacyRoot, name);
    if (existsSync(target)) target = join(legacyRoot, `${name}.${Date.now()}`);
    renameSync(source, target);
  }
}

function activateIdentitySession(session) {
  const nextScope = session?.identity?.dataScopeKey || "";
  const previousScope = activeIdentitySession?.identity?.dataScopeKey || "";
  if (!nextScope) throw new Error("verified identity is incomplete");
  if (nextScope !== previousScope) {
    identityEpoch += 1;
    resetScopeRuntimeState(nextScope);
  }
  const identity = { ...session.identity, identityEpoch: Math.max(identityEpoch, 1) };
  const activated = { ...session, identity };
  activeIdentitySession = activated;
  quarantineLegacyData();
  setDataDir(LOCAL_DEV_MODE ? DATA_ROOT : scopeDataDir(DATA_ROOT, identity));
  dataAccessAllowed = true;
  authState.status = LOCAL_DEV_MODE ? "local-dev" : "ready";
  authState.issue = null;
  authState.lastVerifiedAt = new Date().toISOString();
  reconcileApprovalOwnershipAfterActivation();
  return activated;
}

function reconcileApprovalOwnershipAfterActivation() {
  const context = captureDataContext();
  try {
    withStateCommitLock(context.dataDir, () => {
      const state = readState(context);
      if (!state) return;
      let changed = false;
      for (const item of state.items || []) {
        const processing = item?.approvalProcessing;
        if (!processing || processing.state !== "processing" || processing.ownerInstanceId === INSTANCE_ID) continue;
        const now = new Date().toISOString();
        item.approvalProcessing = {
          ...processing,
          state: "needs_review",
          phase: "reconciliation",
          phaseStartedAt: now,
          lastCheckedAt: now,
          remoteOutcome: "unknown",
          reasonCode: "SERVICE_RESTART_RECONCILIATION",
          previousOwnerInstanceId: processing.ownerInstanceId || null,
          ownerInstanceId: INSTANCE_ID,
        };
        item.runtimeActions = [];
        changed = true;
      }
      if (changed) writeStateUnlocked(state, context);
    });
  } catch (error) {
    log(`审批任务实例接管检查稍后重试: ${error?.code || error?.message || error}`);
  }
}

function localDevIdentitySession() {
  const identity = buildRuntimeIdentity({
    profileDir: SERVICE_RUNTIME_CONTEXT.profileDir || SKILL_DIR,
    userId: "local-dev-user",
    tenantId: "local-dev-tenant",
    environment: "local-dev",
  });
  return {
    success: true,
    identity,
    rawIdentity: { userId: "local-dev-user", tenantId: "local-dev-tenant", environment: "local-dev" },
    listResult: null,
    authMode: "local-dev",
    attempts: 1,
  };
}

function cachedIdentitySession() {
  if (!dataAccessAllowed || !activeIdentitySession || IDENTITY_CACHE_TTL_MS <= 0) return null;
  const verifiedAt = Date.parse(authState.lastVerifiedAt || "");
  if (!Number.isFinite(verifiedAt) || Date.now() - verifiedAt > IDENTITY_CACHE_TTL_MS) return null;
  return activeIdentitySession;
}

async function verifyAndActivateIdentity(pageSize) {
  const session = await verifyManagedCliIdentity({
    env: process.env,
    profileDir: PROFILE_DIR,
    skillDir: SKILL_DIR,
    dataDir: DATA_ROOT,
    pageSize,
  });
  if (SERVICE_IDENTITY.profileKey && session.identity.profileKey !== SERVICE_IDENTITY.profileKey) {
    const error = new Error("service Profile 与 CLI Profile 不一致");
    error.code = "SERVICE_PROFILE_MISMATCH";
    throw error;
  }
  return activateIdentitySession(session);
}

async function ensureActiveIdentity({ pageSize = 200, forceFresh = false } = {}) {
  if (LOCAL_DEV_MODE) {
    return activeIdentitySession || activateIdentitySession(localDevIdentitySession());
  }
  if (!forceFresh) {
    const cached = cachedIdentitySession();
    if (cached) return cached;
    if (identityVerificationPromise) return identityVerificationPromise;
  }
  const verification = verifyAndActivateIdentity(pageSize);
  if (!forceFresh) identityVerificationPromise = verification;
  try {
    return await verification;
  } catch (error) {
    const issue = publicIssue(issueFromError(error, { exhausted: true }));
    dataAccessAllowed = false;
    activeIdentitySession = null;
    authState.status = issue.code === "AUTH_REQUIRED_IN_YONWORK" ? "invalid" : "unavailable";
    authState.issue = issue;
    authState.lastVerifiedAt = new Date().toISOString();
    if (!error.issue) error.issue = issue;
    throw error;
  } finally {
    if (!forceFresh && identityVerificationPromise === verification) identityVerificationPromise = null;
  }
}

function safeIdentityStatus() {
  return {
    status: authState.status,
    scopeKey: dataAccessAllowed ? activeIdentitySession?.identity?.dataScopeKey || null : null,
  };
}

function publicIssue(issue = {}) {
  const source = issue || {};
  const code = source.code || source.errorCode || "RUNTIME_IDENTITY_ERROR";
  return {
    category: source.category || "runtime",
    code,
    errorCode: code,
    userMessage: source.userMessage || "当前身份校验失败，请稍后重试。",
    httpStatus: Number(source.httpStatus) || (code === "AUTH_REQUIRED_IN_YONWORK" ? 401 : 503),
    retryable: source.retryable !== false,
    recovery: source.recovery || { action: "retry-sync", label: "重新同步" },
  };
}

function publicSyncReport(report = {}) {
  const {
    proxy,
    dataDir,
    inbox,
    cliPath,
    rawIdentity,
    ...safe
  } = report || {};
  if (safe.issue) safe.issue = publicIssue(safe.issue);
  return safe;
}

function identityFailurePayload(error) {
  const issue = publicIssue(error?.issue || issueFromError(error, { exhausted: true }));
  return {
    success: false,
    issue,
    identity: { status: "unknown", scopeKey: null },
    cache: { visible: false, stale: false, snapshotId: null },
    analysis: { started: false, running: schedulerRunningForCurrentScope() },
    error: issue.userMessage,
  };
}

function issueHttpStatus(issue = {}) {
  const value = issue || {};
  return Number(value.httpStatus) || (value.code === "AUTH_REQUIRED_IN_YONWORK" ? 401 : 503);
}

function identityChangedIssue(reason = "用户、租户或待办快照已变化") {
  return {
    category: "identity",
    code: "IDENTITY_CHANGED_DURING_SYNC",
    errorCode: "IDENTITY_CHANGED_DURING_SYNC",
    reason,
    userMessage: "检测到用户或租户已切换，审批未写入本地状态，请刷新后重试。",
    httpStatus: 409,
    retryable: true,
    recovery: { action: "retry-sync", label: "刷新当前账号数据" },
  };
}

function approvalReconciliationPayload(results = [], remoteCompleted = [], cause = null) {
  const remoteOutcomeUnknown = results.some((entry) =>
    entry?.remoteOutcomeUnknown === true || entry?.remoteOutcome === "unknown");
  const remoteCommitted = remoteCompleted.length > 0 || results.some((entry) =>
    entry?.remoteCommitted === true || entry?.remoteOutcome === "confirmed_committed");
  const code = remoteOutcomeUnknown
    ? "APPROVAL_REMOTE_OUTCOME_UNKNOWN"
    : "APPROVAL_REMOTE_COMMITTED_RECONCILE";
  const userMessage = remoteOutcomeUnknown
    ? "审批请求的远端结果暂时无法确认，请刷新当前账号待办核对，勿重复提交。"
    : "审批已在远端执行，但本地状态未能安全确认，请刷新当前账号待办核对，勿重复提交。";
  const issue = publicIssue({
    category: "approval",
    code,
    errorCode: code,
    userMessage,
    httpStatus: 409,
    retryable: true,
    recovery: { action: "retry-sync", label: "刷新核对审批结果" },
  });
  return {
    success: false,
    issue,
    identity: { status: "unknown", scopeKey: null },
    cache: { visible: false, stale: false, snapshotId: null },
    analysis: { started: false, running: false },
    remoteOutcome: remoteOutcomeUnknown ? "unknown" : "confirmed_committed",
    remoteCommitted,
    remoteOutcomeUnknown,
    remoteCompleted: [...remoteCompleted],
    approved: [],
    completed: [],
    results,
    error: userMessage,
    ...(cause?.code ? { reconciliationCause: cause.code } : {}),
  };
}

function verifiedTodoRows(session = {}) {
  const list = session.listResult || {};
  for (const candidate of [
    list.items,
    list.data?.items,
    list.result?.items,
    list.result,
    list.data?.result,
  ]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function approvalTaskIdentity(row = {}, tenantKeyOverride = "") {
  const webUrl = sanitizeIdentityBearingUrl(firstText(row.webUrl, row.mUrl));
  const parsed = parseWebUrl(webUrl);
  return Object.freeze({
    primaryId: firstText(row.primaryId, row.id),
    taskId: firstText(row.taskId, row.workflowTaskId, row.businessKey, parsed.taskId),
    tenantKey: firstText(tenantKeyOverride, row.tenantKey),
    webUrl,
    businessKey: firstText(row.workflowBusinessKey, row.businessKey),
    serviceCode: firstText(row.sourceServiceCode, row.serviceCode),
  });
}

function approvalTaskSignature(row = {}, tenantKeyOverride = "") {
  const identity = approvalTaskIdentity(row, tenantKeyOverride);
  return sha256(JSON.stringify([
    identity.primaryId,
    identity.taskId,
    identity.tenantKey,
    identity.webUrl,
    identity.businessKey,
    identity.serviceCode,
  ]));
}

function staleApprovalSnapshotError(reason = "审批任务参数已变化") {
  const error = new Error(reason);
  error.code = "STALE_APPROVAL_SNAPSHOT";
  error.issue = {
    ...identityChangedIssue(reason),
    code: error.code,
    errorCode: error.code,
    userMessage: "审批任务已更新或不再属于当前用户/租户，请刷新列表后重新核对。",
  };
  return error;
}

function verifiedTodoByPrimaryId(session = {}) {
  const byId = new Map();
  const duplicates = new Set();
  const currentTenantId = firstText(
    session?.listResult?.currentTenantId,
    session?.listResult?.data?.currentTenantId,
    session?.listResult?.result?.currentTenantId,
  );
  for (const row of verifiedTodoRows(session)) {
    if (!currentTenantId || firstText(row?.tenantId) !== currentTenantId) continue;
    const id = approvalTaskIdentity(row).primaryId;
    if (!id) continue;
    if (byId.has(id)) duplicates.add(id);
    else byId.set(id, row);
  }
  for (const id of duplicates) byId.delete(id);
  return { byId, duplicates };
}

function prepareApprovalTaskSnapshot(session, localItems = []) {
  const { byId, duplicates } = verifiedTodoByPrimaryId(session);
  const tenantKey = firstText(session?.identity?.tenantKey);
  if (!tenantKey) throw staleApprovalSnapshotError("审批身份缺少租户作用域");
  const snapshots = new Map();
  const executableItems = [];
  for (const localItem of localItems) {
    const id = itemPrimaryId(localItem);
    if (!id || duplicates.has(id)) {
      throw staleApprovalSnapshotError("审批任务标识重复或无效，无法确定唯一远端任务");
    }
    const latestRow = byId.get(id);
    if (!latestRow) {
      throw staleApprovalSnapshotError("审批任务已不属于当前身份的最新待办列表");
    }
    if (firstText(localItem.tenantKey) !== tenantKey) {
      throw staleApprovalSnapshotError("审批任务不属于当前租户作用域");
    }
    const localSignature = approvalTaskSignature(localItem);
    const latestSignature = approvalTaskSignature(latestRow, tenantKey);
    if (localSignature !== latestSignature) {
      throw staleApprovalSnapshotError("审批任务关键参数与当前待办快照不一致");
    }
    const latest = approvalTaskIdentity(latestRow, tenantKey);
    snapshots.set(id, Object.freeze({ signature: latestSignature }));
    executableItems.push({
      ...localItem,
      id: latest.primaryId,
      primaryId: latest.primaryId,
      todoId: firstText(latestRow.id, localItem.todoId),
      taskId: latest.taskId,
      workflowTaskId: latest.taskId,
      workflowBusinessKey: latest.businessKey || null,
      tenantKey,
      webUrl: latest.webUrl,
      ...(latest.serviceCode
        ? {
            ...(!localItem.serviceCode ? { serviceCode: latest.serviceCode } : {}),
            sourceServiceCode: latest.serviceCode,
          }
        : {}),
    });
  }
  return { snapshots, executableItems };
}

async function verifyApprovalCommandIdentity(
  expectedSession,
  primaryIds = [],
  { requireMembership = false, taskSnapshots = null } = {},
) {
  const latestSession = LOCAL_DEV_MODE
    ? expectedSession
    : await verifyManagedCliIdentity({
        env: process.env,
        profileDir: PROFILE_DIR,
        skillDir: SKILL_DIR,
        dataDir: DATA_ROOT,
        pageSize: INBOX_SYNC_PAGE_SIZE,
      });
  const expectedScope = expectedSession?.identity?.dataScopeKey || "";
  const latestScope = latestSession?.identity?.dataScopeKey || "";
  if (!expectedScope || expectedScope !== latestScope) {
    const error = new Error("审批命令执行前后用户或租户身份已变化");
    error.code = "IDENTITY_CHANGED_DURING_APPROVAL";
    error.issue = {
      ...identityChangedIssue("审批命令执行前后用户或租户身份已变化"),
      code: error.code,
      errorCode: error.code,
    };
    throw error;
  }
  if (requireMembership) {
    const ids = primaryIds.map(String);
    const { byId, duplicates } = verifiedTodoByPrimaryId(latestSession);
    const missing = ids.filter((id) => !byId.has(id) || duplicates.has(id));
    if (missing.length > 0) {
      throw staleApprovalSnapshotError("审批任务已不属于当前身份的最新待办列表");
    }
    if (taskSnapshots instanceof Map) {
      const changed = ids.filter((id) => {
        const expected = taskSnapshots.get(id);
        const latestRow = byId.get(id);
        return !expected
          || !latestRow
          || expected.signature !== approvalTaskSignature(latestRow, latestSession.identity?.tenantKey);
      });
      if (changed.length > 0) {
        throw staleApprovalSnapshotError("危险审批命令执行前任务关键参数已变化");
      }
    }
  }
  return latestSession;
}

/** 读取本地真实 state（参考格式 {inbox,done} 或 v3 ApproveInboxData）；不存在返回 null */
function readState(context = captureDataContext()) {
  if (!dataAccessAllowed) return null;
  const file = context?.stateFile || STATE_FILE;
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    log(`读取 inbox.json 失败: ${e.message}`);
    return null;
  }
}

function stateSnapshotId(state = {}) {
  return String(state?.meta?.snapshotId || "").trim();
}

function currentStateItem(state, id) {
  return findStateItems(state || {}, [String(id)])[0] || null;
}

function detailBelongsToSnapshot(rawDetail, state, id, context) {
  const item = currentStateItem(state, id);
  if (!rawDetail || !item) return false;
  const snapshotId = stateSnapshotId(state);
  if (!snapshotId) return LOCAL_DEV_MODE;
  const binding = rawDetail._approveInbox || {};
  if (binding.schemaVersion === 2) {
    return binding.scopeKey === context?.scopeKey
      && binding.itemRevision === itemRevision(item);
  }
  return binding.snapshotId === snapshotId && binding.scopeKey === context?.scopeKey;
}

function bindDetailToSnapshot(rawDetail, state, context, id = "") {
  const snapshotId = stateSnapshotId(state);
  if (!snapshotId) return LOCAL_DEV_MODE ? rawDetail : null;
  const item = currentStateItem(state, id || rawDetail?.primaryId || rawDetail?.id);
  if (!item) return null;
  const revision = itemRevision(item);
  const contentHash = detailContentHash(rawDetail);
  return {
    ...rawDetail,
    _approveInbox: {
      schemaVersion: 2,
      scopeKey: context.scopeKey,
      snapshotId,
      itemRevision: revision,
      detailContentHash: contentHash,
      analysisKey: analysisKey(revision, contentHash, "approve-inbox-analysis-v1", "personal-rules-v1"),
    },
  };
}

function staleSnapshotIssue(resource = "detail") {
  const isAttachment = resource === "attachment";
  const code = isAttachment ? "STALE_ATTACHMENT_SNAPSHOT" : "STALE_DETAIL_SNAPSHOT";
  return publicIssue({
    category: "snapshot",
    code,
    errorCode: code,
    userMessage: isAttachment
      ? "附件不属于当前待办快照，请刷新列表后重新打开。"
      : "详情不属于当前待办快照，请刷新列表后重新加载。",
    httpStatus: 409,
    retryable: true,
    recovery: { action: "retry-sync", label: "刷新当前账号数据" },
  });
}

function attachmentNames(rawDetail = {}) {
  const entries = Array.isArray(rawDetail?.content?.attachments)
    ? rawDetail.content.attachments
    : (Array.isArray(rawDetail?.attachments) ? rawDetail.attachments : []);
  return new Set(entries.flatMap((entry) => {
    const values = [entry?.fileName, entry?.filename, entry?.name];
    for (const pathValue of [entry?.localPath, entry?.storagePath]) {
      if (pathValue) values.push(basename(String(pathValue)));
    }
    return values.map((value) => String(value || "").trim()).filter(Boolean);
  }));
}

function atomicWriteJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf-8", mode: 0o600 });
    renameSync(temporary, file);
  } catch (error) {
    try { if (existsSync(temporary)) unlinkSync(temporary); } catch { /* best-effort cleanup */ }
    throw error;
  }
}

function staleStateCommitError() {
  const error = new Error("待办快照已在提交前变化");
  error.code = "STALE_STATE_SNAPSHOT";
  return error;
}

function writeStateUnlocked(state, context = captureDataContext()) {
  if (!dataContextIsCurrent(context)) throw new Error("当前身份已变化，禁止写入待办状态");
  atomicWriteJson(context.stateFile, state);
}

function writeState(state, context = captureDataContext(), { expectedSnapshotId } = {}) {
  if (!dataContextIsCurrent(context)) throw new Error("当前身份已变化，禁止写入待办状态");
  return withStateCommitLock(context.dataDir, () => {
    if (!dataContextIsCurrent(context)) throw new Error("当前身份已变化，禁止写入待办状态");
    if (expectedSnapshotId !== undefined) {
      const onDisk = readState(context);
      if (!onDisk || stateSnapshotId(onDisk) !== expectedSnapshotId) throw staleStateCommitError();
    }
    writeStateUnlocked(state, context);
  });
}

/** 读取本地真实详情文件；不存在返回 null */
function readRawDetail(id, context = captureDataContext()) {
  if (!dataAccessAllowed) return null;
  const file = join(context?.detailsDir || DETAILS_DIR, `${id}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    log(`读取详情 ${id} 失败: ${e.message}`);
    return null;
  }
}

function writeRawDetail(id, detail, context = captureDataContext(), expectedSnapshotId = undefined) {
  if (!dataContextIsCurrent(context) || !id || !detail) return false;
  const state = readState(context);
  if (!state || !currentStateItem(state, id)) return false;
  if (expectedSnapshotId === undefined || stateSnapshotId(state) !== expectedSnapshotId) return false;
  const boundDetail = bindDetailToSnapshot(sanitizeStoredIdentityData(detail), state, context, id);
  if (!boundDetail) return false;
  atomicWriteJson(join(context.detailsDir, `${id}.json`), boundDetail);
  return true;
}

function readCurrentRawDetail(id, state, context = captureDataContext()) {
  const raw = readRawDetail(id, context);
  if (detailBelongsToSnapshot(raw, state, id, context)) return raw;
  const item = currentStateItem(state, id);
  const binding = raw?._approveInbox || {};
  const canUpgradeLegacy = raw
    && item
    && binding.schemaVersion !== 2
    && binding.scopeKey === context?.scopeKey
    && legacyDetailMatchesItem(raw, item);
  if (!canUpgradeLegacy) return null;
  const upgraded = bindDetailToSnapshot(sanitizeStoredIdentityData(raw), state, context, id);
  if (!upgraded) return null;
  atomicWriteJson(join(context.detailsDir, `${id}.json`), upgraded);
  return upgraded;
}

function createEnrichStaging(context, expectedSnapshotId) {
  if (!dataContextIsCurrent(context)) throw new Error("identity_changed");
  const state = readState(context);
  if (!state || stateSnapshotId(state) !== expectedSnapshotId) throw new Error("snapshot_changed");
  const stagingDir = join(
    context.dataDir,
    ".staging",
    `enrich-${process.pid}-${Date.now()}-${randomBytes(8).toString("hex")}`,
  );
  mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
  copyFileSync(context.stateFile, join(stagingDir, "inbox.json"));
  for (const name of ["details", "attachments"]) {
    const source = join(context.dataDir, name);
    if (existsSync(source)) cpSync(source, join(stagingDir, name), { recursive: true, force: true });
  }
  // Keep only details bound to the same scoped workflow item revision. A new
  // global list snapshot alone must not invalidate unrelated detail caches.
  const stagedDetailsDir = join(stagingDir, "details");
  if (existsSync(stagedDetailsDir)) {
    for (const name of readdirSync(stagedDetailsDir)) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      let raw = null;
      try { raw = JSON.parse(readFileSync(join(stagedDetailsDir, name), "utf-8")); } catch { /* invalid cache */ }
      if (detailBelongsToSnapshot(raw, state, id, context)) continue;
      try { unlinkSync(join(stagedDetailsDir, name)); } catch { /* best-effort cleanup */ }
      rmSync(join(stagingDir, "attachments", id), { recursive: true, force: true });
    }
  }
  const personalRules = join(context.dataDir, "personal-rules.config.json");
  if (existsSync(personalRules)) copyFileSync(personalRules, join(stagingDir, "personal-rules.config.json"));
  return stagingDir;
}

function cleanupEnrichStaging(stagingDir) {
  if (!stagingDir) return;
  try { rmSync(stagingDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
}

function promoteEnrichStaging({ stagingDir, context, expectedSnapshotId, results = [], fallbackIds = [] }) {
  if (!dataContextIsCurrent(context)) return false;
  return withStateCommitLock(context.dataDir, () => {
    if (!dataContextIsCurrent(context)) return false;
    const currentState = readState(context);
    if (!currentState) return false;
    let stagedState;
    try {
      stagedState = JSON.parse(readFileSync(join(stagingDir, "inbox.json"), "utf-8"));
    } catch {
      return false;
    }
    if (stateSnapshotId(stagedState) !== expectedSnapshotId) return false;
    if (!LOCAL_DEV_MODE && !identityMatchesState(activeIdentitySession?.identity, stagedState)) return false;

    const ids = [...new Set([
      ...results.map((entry) => String(entry?.id || "").trim()),
      ...fallbackIds.map((id) => String(id || "").trim()),
    ].filter(Boolean))];
    const currentById = new Map((currentState.items || []).map((item) => [itemPrimaryId(item), item]));
    const stagedById = new Map((stagedState.items || []).map((item) => [itemPrimaryId(item), item]));

    for (const id of ids) {
      const currentItem = currentById.get(id);
      const stagedItem = stagedById.get(id);
      if (!currentItem || !stagedItem || itemRevision(currentItem) !== itemRevision(stagedItem)) continue;
      const stagedAttachments = join(stagingDir, "attachments", id);
      if (existsSync(stagedAttachments)) {
        mkdirSync(join(context.attachDir, id), { recursive: true });
        cpSync(stagedAttachments, join(context.attachDir, id), { recursive: true, force: true });
      }
      const raw = readRawDetail(id, { detailsDir: join(stagingDir, "details") });
      if (raw) {
        const bound = bindDetailToSnapshot(sanitizeStoredIdentityData(raw), currentState, context, id);
        if (!bound) return false;
        atomicWriteJson(join(context.detailsDir, `${id}.json`), bound);
      }
    }

    let stateChanged = false;
    for (const id of ids) {
      const currentItem = currentById.get(id);
      const stagedItem = stagedById.get(id);
      if (!currentItem || !stagedItem || itemRevision(currentItem) !== itemRevision(stagedItem)) continue;
      for (const field of ["advice", "aiSuggestion", "riskLevel", "smartTags"]) {
        if (!Object.hasOwn(stagedItem, field)) continue;
        currentItem[field] = stagedItem[field];
        stateChanged = true;
      }
    }
    if (stateChanged) writeStateUnlocked(currentState, context);
    return true;
  });
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

function configPaths(kind, context = captureDataContext()) {
  const files = {
    ui: ["ui.json", "ui.config.json", "ui-config"],
    table: ["table-view.json", "table-view.config.json", "table-view"],
    card: ["card-view.json", "card-view.config.json", "card-view"],
    detail: ["detail-card-view.json", "detail-card-view.config.json", "detail-card-view"],
    personalRules: [null, "personal-rules.config.json", "personal-rules"],
  };
  const entry = files[kind];
  if (!entry) throw new Error(`Unknown config kind: ${kind}`);
  return {
    defaultConfigFile: entry[0] ? join(CONFIG_DIR, entry[0]) : "",
    userConfigFile: join(context?.dataDir || DATA_DIR, entry[1]),
    schemaName: entry[2],
  };
}

function currentUiConfig(context = captureDataContext()) {
  return loadUiConfig(configPaths("ui", context));
}

function currentTableViewConfig(context = captureDataContext()) {
  return loadTableViewConfig(configPaths("table", context));
}

function currentCardViewConfig(context = captureDataContext()) {
  return loadCardViewConfig(configPaths("card", context));
}

function currentDetailCardViewConfig(context = captureDataContext()) {
  return loadDetailCardConfig(configPaths("detail", context));
}

function currentPersonalRulesConfig(context = captureDataContext()) {
  return loadPersonalRulesConfig(configPaths("personalRules", context));
}

function defaultVisibleColumnsFromTable(tableViewConfig = {}) {
  const defaultColumns = tableViewConfig.groups?.default?.columns || tableViewConfig.defaultColumns || [];
  return defaultColumns.map((column) => column?.id).filter(Boolean);
}

function viewSettingsFromConfig(data = {}, uiConfig = currentUiConfig(), tableViewConfig = currentTableViewConfig()) {
  const base = data.viewSettings || {};
  return {
    ...base,
    layoutVariant: "maillist",
    defaultSort: base.defaultSort || "received-desc",
    defaultGroupBy: base.defaultGroupBy || "none",
    visibleColumns: Array.isArray(base.visibleColumns) && base.visibleColumns.length > 0
      ? base.visibleColumns
      : defaultVisibleColumnsFromTable(tableViewConfig),
  };
}

function enrichWithUiConfigs(data, context = captureDataContext()) {
  if (!data) return data;
  const uiConfig = currentUiConfig(context);
  const tableViewConfig = currentTableViewConfig(context);
  const cardViewConfig = currentCardViewConfig(context);
  const detailCardViewConfig = currentDetailCardViewConfig(context);
  return {
    ...data,
    uiConfig,
    tableViewConfig,
    cardViewConfig,
    detailCardViewConfig,
    viewSettings: viewSettingsFromConfig(data, uiConfig, tableViewConfig),
  };
}

function detailWithCardSections(detail, item = {}) {
  const detailCardViewConfig = currentDetailCardViewConfig();
  const configuredSections = buildDetailCardFields(item, detail, detailCardViewConfig);
  const plannedSections = buildFieldDisplaySections(detail);
  return {
    ...detail,
    detailCardSections: mergeDetailCardSections(configuredSections, plannedSections),
  };
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function explicitYhtUserId(...sources) {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const direct = firstText(source.yhtUserId, source.yht_user_id, source.summary?.yhtUserId, source.summary?.yht_user_id);
    if (direct) return direct;
  }
  return "";
}

function latestCloudAuditBaseUrl() {
  return firstText(
    process.env.APPROVE_INBOX_CLOUD_AUDIT_BASE,
    process.env.APPROVE_INBOX_PROXY,
    inboxSyncState.lastResult?.proxy,
    schedulerState.lastResult?.proxy,
    process.env.APPROVE_INBOX_BASE,
  );
}

function normalizeCloudAuditBusinessKey(value) {
  const text = firstText(value);
  if (!text) return "";
  if (/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(text)) return text.replace(":", "_");
  return text;
}

function businessKeyFromBillUrl(webUrl) {
  const text = firstText(webUrl);
  if (!text) return "";
  try {
    const url = new URL(text);
    const executionBusinessKey = normalizeCloudAuditBusinessKey(url.searchParams.get("executionBusinessKey"));
    if (executionBusinessKey) return executionBusinessKey;
    const sscBillNum = firstText(url.searchParams.get("sscBillNum"), url.searchParams.get("billNo"));
    const sscBillId = firstText(url.searchParams.get("sscBillId"), url.searchParams.get("billId"), url.searchParams.get("id"));
    if (sscBillNum && sscBillId) return `${sscBillNum}_${sscBillId}`;
  } catch {
    return "";
  }
  return "";
}

function cloudAuditWorkflowBusinessKey(value, taskId) {
  const businessKey = normalizeCloudAuditBusinessKey(value);
  return businessKey && businessKey !== taskId ? businessKey : "";
}

function buildCloudAuditContext(rawItem = {}, item = {}, rawDetail = {}, detail = {}) {
  const webUrl = firstText(
    rawItem.webUrl,
    rawItem.originalUrl,
    rawItem.summary?.webUrl,
    rawItem.summary?.originalUrl,
    item.webUrl,
    item.originalUrl,
    rawDetail.webUrl,
    rawDetail.originalUrl,
    rawDetail.summary?.webUrl,
    rawDetail.summary?.originalUrl,
    detail.webUrl,
    detail.originalUrl,
  );
  const parsed = parseWebUrl(webUrl);
  const taskId = firstText(
    rawItem.taskId,
    rawItem.workflowTaskId,
    rawItem.summary?.taskId,
    item.taskId,
    parsed.taskId,
  );
  return {
    taskId,
    businessKey: firstText(
      businessKeyFromBillUrl(webUrl),
      normalizeCloudAuditBusinessKey(parsed.businessKey),
      normalizeCloudAuditBusinessKey(detail.businessKey),
      normalizeCloudAuditBusinessKey(rawDetail?.businessKey),
      normalizeCloudAuditBusinessKey(rawDetail?.content?.businessKey),
      normalizeCloudAuditBusinessKey(rawDetail?.richDetail?.businessKey),
      normalizeCloudAuditBusinessKey(rawDetail?.richDetail?.meta?.businessKey),
      normalizeCloudAuditBusinessKey(rawItem.businessKey),
      normalizeCloudAuditBusinessKey(rawItem.summary?.businessKey),
      cloudAuditWorkflowBusinessKey(rawItem.workflowBusinessKey, taskId),
      cloudAuditWorkflowBusinessKey(rawItem.summary?.workflowBusinessKey, taskId),
      cloudAuditWorkflowBusinessKey(item.workflowBusinessKey, taskId),
    ),
    yhtUserId: explicitYhtUserId(rawItem, item, rawDetail, detail, activeIdentitySession?.rawIdentity),
  };
}

function detailWithSystemRuleAudit(detail, systemRuleAudit, analysis = detail) {
  const compositeAdvice = buildCompositeAdvice({
    systemRuleAudit,
    analysis,
    fallbackConclusion: detail?.conclusion,
  });
  return {
    ...detail,
    systemRuleAudit,
    compositeAdvice,
    conclusion: { advice: compositeAdvice.advice, label: compositeAdvice.label },
  };
}

function detailFromRawOrItem(raw, item, fallbackDataSource = "fallback") {
  return raw
    ? { ...normalizeDetail(raw, item), dataSource: "real" }
    : { ...fallbackDetail(item), dataSource: fallbackDataSource };
}

async function latestDetailWithSystemRuleAudit(id, dataContext, state, rawItem, item, raw, detail, options = {}) {
  const fallbackDataSource = options.fallbackDataSource || "fallback";
  const expectedSnapshotId = stateSnapshotId(state);
  const systemRuleAudit = await queryCloudAuditResult(
    buildCloudAuditContext(rawItem, item, raw || {}, detail),
    { baseUrl: latestCloudAuditBaseUrl() },
  );

  if (!dataContextIsCurrent(dataContext)) {
    const issue = identityChangedIssue("智能审核刷新期间用户或租户已切换");
    return { ok: false, status: 409, payload: { success: false, issue, error: issue.userMessage } };
  }
  const latestState = readState(dataContext);
  const latestRawItem = currentStateItem(latestState, id);
  if (!latestState || !latestRawItem || stateSnapshotId(latestState) !== expectedSnapshotId) {
    const issue = staleSnapshotIssue("detail");
    return { ok: false, status: 409, payload: { success: false, issue, error: issue.userMessage } };
  }
  const latestData = normalizeInbox(latestState);
  const latestItem = (latestData?.items || []).find((entry) => itemPrimaryId(entry) === itemPrimaryId(latestRawItem)) || latestRawItem;
  const latestRaw = readCurrentRawDetail(id, latestState, dataContext);
  const latestDetail = detailFromRawOrItem(latestRaw, latestItem, fallbackDataSource);
  const refreshed = detailWithSystemRuleAudit(
    latestDetail,
    systemRuleAudit,
    latestRaw?.analysis || latestDetail,
  );
  if (latestRaw && !writeRawDetail(id, {
    ...latestRaw,
    systemRuleAudit: refreshed.systemRuleAudit,
    compositeAdvice: refreshed.compositeAdvice,
  }, dataContext, expectedSnapshotId)) {
    const issue = staleSnapshotIssue("detail");
    return { ok: false, status: 409, payload: { success: false, issue, error: issue.userMessage } };
  }
  return { ok: true, detail: refreshed, item: latestItem };
}

function saveUserConfig(kind, body, context = captureDataContext()) {
  if (!dataContextIsCurrent(context)) {
    return { ok: false, identityChanged: true, errors: ["当前身份已变化"] };
  }
  const { userConfigFile, schemaName } = configPaths(kind, context);
  const config = body && typeof body === "object" && body.config && typeof body.config === "object" ? body.config : body;
  const report = validateConfig(schemaName, config || {});
  if (!report.ok) {
    return { ok: false, errors: report.errors };
  }
  if (!dataContextIsCurrent(context)) {
    return { ok: false, identityChanged: true, errors: ["当前身份已变化"] };
  }
  atomicWriteJson(userConfigFile, config || {});
  return { ok: true };
}

function safeDataFile(rootDir, relPath) {
  const rawRel = String(relPath || "").replace(/^\/+/, "");
  const filePath = resolve(rootDir, rawRel);
  const root = resolve(rootDir);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) return null;
  return filePath;
}

function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [scriptPath, ...args],
      { timeout: 180_000, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(scriptErrorDetails(err, { stdout, stderr }));
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

function handleWebStatic(req, res, path) {
  let fileName = "";
  try {
    fileName = decodeURIComponent(String(path || "").replace(/^\/+/, ""));
  } catch {
    json(res, { error: "Invalid static path" }, 400);
    return;
  }
  if (!WEB_STATIC_FILES.has(fileName)) {
    json(res, { error: "Static file not found" }, 404);
    return;
  }
  const filePath = join(__dirname, fileName);
  if (!existsSync(filePath)) {
    json(res, { error: "Static file not found" }, 404);
    return;
  }
  sendFile(res, filePath);
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
    centerEmbedUrl: ctx.centerEmbedUrl,
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
  const centerEmbedUrl = `${ctx.serverUrl}/?embed=cockpit-drawer`;
  return {
    id: "approve-inbox-smart-todo",
    skillId: "iuap-apcom-myapproval",
    skillAliases: ["iuap-apcom-approval", "iuap-apcom-approveinbox", "approve-inbox"],
    cockpitCatalogId: "builtin-business-approve-inbox",
    catalogId: "builtin-business-approve-inbox",
    catalogItemId: "builtin-business-approve-inbox",
    sourceWidgetId: "builtin-business-approve-inbox",
    name: "智能待办",
    title: "智能待办",
    type: "iframe",
    businessType: "approval-message-center",
    version: "1.0.1",
    description: "ai-workbench 驾驶舱智能待办 business 组件(approval-message-center)。宿主经 cockpitDataUrl 取数写 widget.data;iframe 入口展示预览,支持主题跟随与双向交互。",
    entryUrl,
    widgetUrl: entryUrl,
    dataUrl: `${ctx.serverUrl}/api/widget/todos`,
    dataPath: "/api/widget/todos",
    cockpitDataUrl: `${ctx.serverUrl}/api/widget/cockpit`,
    cockpitDataPath: "/api/widget/cockpit",
    centerEmbedUrl,
    centerEmbedPath: "/?embed=cockpit-drawer",
    refreshUrl: widgetRefreshUrl(returnTo),
    refreshPath: "/api/widget/refresh",
    refreshMethod: "POST",
    runtimeContextPath: "/api/runtime-context",
    runtimeContextUrl: `${ctx.serverUrl}/api/runtime-context`,
    link: {
      enabled: true,
      title: "打开智能待办",
      interaction: "drawer",
      targetType: "service",
      contentType: "iframe",
      url: centerEmbedUrl,
      allowFullscreen: true,
    },
    cockpitBinding: {
      componentId: "builtin-business-approve-inbox",
      businessType: "approval-message-center",
      defaultComposition: "single-preset-business-widget",
      forbidDefaultVisualizations: true,
      visualizationOptInFlag: "dataIntent.allowApproveInboxVisualization",
      dataSource: {
        type: "static",
        skillId: "iuap-apcom-myapproval",
        skillAliases: ["iuap-apcom-approval", "iuap-apcom-approveinbox", "approve-inbox"],
        api: "/api/widget/cockpit",
        realData: true,
      },
    },
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

function realInboxResponse(context = captureDataContext()) {
  const state = readState(context);
  if (!state) return null;
  const data = normalizeInbox(state);
  if (!data || !Array.isArray(data.items)) return null;
  // 给每个 item 标注是否已有「完整」分析（读 detail）——前端据此统计/标注「待分析」
  for (const it of data.items) {
    const raw = readCurrentRawDetail(it.id, state, context);
    const detailFields = Array.isArray(raw?.content?.fields) ? raw.content.fields : [];
    const unavailableReason = raw?.content?.unavailableReason || null;
    it.detailFieldsUnavailable = raw?.content?.unavailable === true
      && unavailableReason !== "not_found"
      && detailFields.length === 0;
    it.analyzed = isCompleteAnalysis(raw?.analysis) || isCompleteAnalysis(raw);
    if (raw?.compositeAdvice?.advice) {
      it.advice = raw.compositeAdvice.advice;
      if (raw.compositeAdvice.riskLevel) it.riskLevel = raw.compositeAdvice.riskLevel;
    }
    it.aiSuggestion = it.detailFieldsUnavailable
      ? "该单据类型无法获取详情字段"
      : deriveListAiSuggestion({
          analysis: raw?.analysis || raw,
          systemRuleAudit: raw?.systemRuleAudit,
          analysisStatus: raw?.analysisError ? "failed" : raw?.analysisStatus,
        });
    const attachments = Array.isArray(raw?.content?.attachments)
      ? raw.content.attachments
      : (Array.isArray(raw?.attachments) ? raw.attachments : []);
    it.attachmentCount = Number(raw?.attachmentCount || raw?.content?.attachmentCount || attachments.length || 0);
    it.hasAttachments = !!(raw?.hasAttachments || it.attachmentCount > 0);
  }
  if (data.meta) {
    data.meta = {
      snapshotId: data.meta.snapshotId || null,
      syncedAt: data.meta.syncedAt || data.summary?.lastSyncAt || null,
      ...(data.meta.rawSummary ? { rawSummary: data.meta.rawSummary } : {}),
    };
  }
  return enrichWithUiConfigs({ ...data, dataSource: "real" }, context);
}

function inboxResponse(context = captureDataContext()) {
  return realInboxResponse(context);
}

function isUsableInboxData(data, context = captureDataContext()) {
  if (!(data && data.dataSource === "real" && Array.isArray(data.items))) return false;
  if (LOCAL_DEV_MODE) return true;
  if (!dataContextIsCurrent(context)) return false;
  const state = readState(context);
  return !!(activeIdentitySession?.identity && identityMatchesState(activeIdentitySession.identity, state));
}

function isPendingInboxItem(item) {
  // 与前端待办口径一致：已提交后台处理中(processing)/等待核对(needs_review)的条目
  // 乐观移出待办计数，避免驾驶舱卡片与列表 tab 数字打架。
  return item && (item.status === "pending" || !item.status) && !activeApprovalProcessing(item);
}

function projectSyncToCurrentTenant(sync = {}, data = null) {
  if (!data || !Array.isArray(data.items)) return sync;
  const visibleItems = data.items.filter((item) => !item.crossTenant);
  const pending = visibleItems.filter(isPendingInboxItem).length;
  const done = visibleItems.filter((item) => item?.status === "done").length;
  return {
    ...sync,
    scope: "currentTenant",
    total: visibleItems.length,
    pending,
    done,
  };
}

function realInboxUnavailablePayload(syncReport = null) {
  const issue = syncReport?.issue || authState.issue || null;
  const error = syncReport?.message || syncReport?.error || inboxSyncState.lastError || "未取到真实待办数据";
  return {
    success: false,
    dataSource: "unavailable",
    mode: "real",
    issue,
    identity: safeIdentityStatus(),
    cache: { visible: false, stale: false, snapshotId: null },
    analysis: { started: false, running: schedulerRunningForCurrentScope() },
    error,
    sync: syncReport || inboxSyncState.lastResult || null,
  };
}

function isCrossTenantItemForCurrentState(item = {}, state = {}) {
  const currentTenantKey = state?.meta?.currentTenantKey ? String(state.meta.currentTenantKey) : "";
  const tenantKey = item?.tenantKey ? String(item.tenantKey) : "";
  if (currentTenantKey || tenantKey) {
    return !!(currentTenantKey && tenantKey && tenantKey !== currentTenantKey);
  }
  const legacyCurrentTenantId = state?.meta?.currentTenantId ? String(state.meta.currentTenantId) : "";
  const legacyTenantId = item?.tenantId ? String(item.tenantId) : "";
  return !!(legacyCurrentTenantId && legacyTenantId && legacyTenantId !== legacyCurrentTenantId);
}

function crossTenantApprovalResult(item = {}, state = {}, action = "approve") {
  const title = item.title ? `「${item.title}」` : "当前待办";
  return {
    type: "unavailable",
    primaryId: itemPrimaryId(item),
    action,
    success: false,
    error: `${title}不属于当前租户作用域；请在 YonWork 切换到对应租户并重新同步后再操作`,
  };
}

// GET /api/inbox — v3 ApproveInboxData（真实数据强制；无真实数据时先同步，失败则报错）
async function handleInbox(req, res) {
  const context = requestDataContext(req);
  let data = inboxResponse(context);
  let syncReport = null;
  if (!isUsableInboxData(data, context) && AUTO_SYNC_ENABLED) {
    syncReport = await runRefreshCycle("first-load", { limit: STARTUP_ANALYSIS_LIMIT, analyze: AUTO_ENABLED });
    if (!dataContextIsCurrent(context)) {
      const issue = identityChangedIssue("加载待办期间用户或租户已切换");
      json(res, {
        success: false,
        issue,
        identity: { status: "changed", scopeKey: null },
        cache: { visible: false, stale: false, snapshotId: null },
        analysis: { started: false, running: schedulerRunningForCurrentScope() },
        error: issue.userMessage,
      }, 409);
      return;
    }
    data = inboxResponse(context);
  }
  if (!isUsableInboxData(data, context)) {
    const payload = realInboxUnavailablePayload(syncReport);
    json(res, payload, issueHttpStatus(payload.issue));
    return;
  }
  json(res, data);
}

function handleConfigRead(req, res, kind) {
  const loaders = {
    ui: currentUiConfig,
    table: currentTableViewConfig,
    card: currentCardViewConfig,
    detail: currentDetailCardViewConfig,
    personalRules: currentPersonalRulesConfig,
  };
  json(res, loaders[kind]());
}

async function handleConfigWrite(req, res, kind) {
  const context = requestDataContext(req);
  const body = await parseBody(req);
  if (!dataContextIsCurrent(context)) {
    const issue = identityChangedIssue("保存配置期间用户或租户已切换");
    json(res, {
      success: false,
      issue,
      identity: { status: "changed", scopeKey: null },
      cache: { visible: false, stale: false, snapshotId: null },
      analysis: { started: false, running: schedulerRunningForCurrentScope() },
      error: issue.userMessage,
    }, 409);
    return;
  }
  const result = saveUserConfig(kind, body, context);
  if (result.identityChanged) {
    const issue = identityChangedIssue("保存配置前用户或租户已切换");
    json(res, {
      success: false,
      issue,
      identity: { status: "changed", scopeKey: null },
      cache: { visible: false, stale: false, snapshotId: null },
      analysis: { started: false, running: schedulerRunningForCurrentScope() },
      error: issue.userMessage,
    }, 409);
    return;
  }
  if (!result.ok) {
    json(res, { success: false, errors: result.errors }, 400);
    return;
  }
  if (kind === "personalRules") {
    const config = currentPersonalRulesConfig();
    const reanalysis = body?.reanalyze === false
      ? { queued: false, reason: "disabled" }
      : queuePersonalRulesReanalysis();
    json(res, { success: true, config, reanalysis });
    return;
  }
  handleConfigRead(req, res, kind);
}

function queuePersonalRulesReanalysis() {
  const state = readState();
  const candidates = Array.isArray(state?.items)
    ? state.items.filter((item) => item?.status !== "done" && item?.webUrl)
    : [];
  if (candidates.length === 0) return { queued: false, reason: "no_pending_items", count: 0 };
  if (schedulerState.running) {
    pendingPersonalRulesReanalysisLimit = Math.max(pendingPersonalRulesReanalysisLimit, candidates.length);
    return { queued: true, deferred: true, reason: "analysis_running", count: candidates.length };
  }
  void runEnrichOnce(candidates.length, { force: true, pendingOnly: true });
  return { queued: true, count: candidates.length };
}

function handleUiConfigDiagnostics(req, res) {
  json(res, runUiConfigDiagnostics({ configDir: CONFIG_DIR, dataDir: DATA_DIR }));
}

function handleUiAsset(req, res, path) {
  const rel = decodeURIComponent(path.slice("/api/ui-assets/".length));
  const filePath = safeDataFile(UI_ASSETS_DIR, rel);
  if (!filePath || !existsSync(filePath)) {
    json(res, { error: "Asset not found" }, 404);
    return;
  }
  sendFile(res, filePath);
}

function handleTableView(req, res, url) {
  const context = requestDataContext(req);
  const data = inboxResponse(context);
  if (!isUsableInboxData(data, context)) {
    json(res, realInboxUnavailablePayload(null), 503);
    return;
  }
  const tableConfig = currentTableViewConfig(context);
  const detailsById = new Map();
  const state = readState(context);
  if (url.searchParams.get("details") === "1" || tableConfigUsesDetailPath(tableConfig)) {
    for (const item of data.items || []) {
      const id = item.id || item.primaryId;
      const raw = id ? readCurrentRawDetail(id, state, context) : null;
      if (raw) detailsById.set(id, normalizeDetail(raw, item));
    }
  }
  json(res, buildTableView({
    items: data.items,
    config: tableConfig,
    detailsById,
    status: url.searchParams.get("status") || "inbox",
    lastSyncAt: data.summary?.lastSyncAt || data.meta?.syncedAt || null,
    uiConfig: data.uiConfig || currentUiConfig(context),
  }));
}

function handleRuntimeContext(req, res, url) {
  json(res, safeRuntimeContext({ full: url.searchParams.get("full") === "1" }));
}

function handleWidgetManifest(req, res, url) {
  json(res, widgetManifest(url.searchParams.get("returnTo") || ""));
}

function shouldRefreshWidgetRead(url) {
  return url.searchParams.get("cache") !== "1" && url.searchParams.get("refresh") !== "0";
}

async function refreshBeforeWidgetRead(url, reason) {
  const context = captureDataContext();
  if (!shouldRefreshWidgetRead(url)) {
    return { context, data: inboxResponse(context), sync: null, identityChanged: !dataContextIsCurrent(context) };
  }
  const rawSync = await runInboxSyncOnce(reason);
  if (!dataContextIsCurrent(context)) {
    return { context, data: null, sync: rawSync, identityChanged: true };
  }
  const data = inboxResponse(context);
  const sync = projectSyncToCurrentTenant(rawSync, data);
  if (data && sync !== rawSync) inboxSyncState.lastResult = sync;
  return { context, data, sync, identityChanged: false };
}

function sendWidgetIdentityChanged(res) {
  const issue = identityChangedIssue("组件取数期间用户或租户已切换");
  json(res, {
    success: false,
    issue,
    identity: { status: "changed", scopeKey: null },
    cache: { visible: false, stale: false, snapshotId: null },
    analysis: { started: false, running: schedulerRunningForCurrentScope() },
    error: issue.userMessage,
  }, 409);
}

async function handleWidgetTodos(req, res, url) {
  const { context, data, sync, identityChanged } = await refreshBeforeWidgetRead(url, "widget-todos-load");
  if (identityChanged) return sendWidgetIdentityChanged(res);
  if (!isUsableInboxData(data, context)) {
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
      link: {
        enabled: true,
        title: "打开智能待办",
        interaction: "drawer",
        targetType: "service",
        contentType: "iframe",
        url: `${SERVER_URL}/?embed=cockpit-drawer`,
        allowFullscreen: true,
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
  json(res, { success: true, sync, ...payload });
}

// GET /api/widget/cockpit — ai-workbench 驾驶舱 business 组件(approval-message-center)形态。
// 供 yoncockpit-controller agent 取数后写入 widget.data。默认轻量同步一次,不触发重型 enrich。
async function handleWidgetCockpit(req, res, url) {
  const { context, data, sync, identityChanged } = await refreshBeforeWidgetRead(url, "widget-cockpit-load");
  if (identityChanged) return sendWidgetIdentityChanged(res);
  const returnTo = url.searchParams.get("returnTo") || "";
  if (!isUsableInboxData(data, context)) {
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
      link: {
        enabled: true,
        title: "打开智能待办",
        interaction: "drawer",
        targetType: "service",
        contentType: "iframe",
        url: `${SERVER_URL}/?embed=cockpit-drawer`,
        allowFullscreen: true,
      },
    }, 503);
    return;
  }
  const payload = buildCockpitData(data, {
    limit: url.searchParams.get("limit") || undefined,
    centerUrl: centerUrlWithReturnTo(returnTo),
    refreshUrl: widgetRefreshUrl(returnTo),
  });
  json(res, { success: true, sync, ...payload });
}

async function handleWidgetRefresh(req, res, url) {
  const context = captureDataContext();
  let data;
  let sync;
  const cached = inboxResponse(context);
  if (AUTO_SYNC_ENABLED && isUsableInboxData(cached, context)) {
    // 完整待办同步实测约 20s,超过驾驶舱组件超时;有可用缓存时立即返回缓存,
    // 同步转入后台执行,结果由下一次组件取数体现。
    void runInboxSyncOnce("widget-refresh");
    data = cached;
    sync = projectSyncToCurrentTenant({
      success: true,
      accepted: true,
      mode: "background",
      reason: "widget-refresh",
      running: true,
    }, data);
  } else {
    const rawSync = await runInboxSyncOnce("widget-refresh");
    if (!dataContextIsCurrent(context)) return sendWidgetIdentityChanged(res);
    data = inboxResponse(context);
    sync = projectSyncToCurrentTenant(rawSync, data);
    if (data && sync !== rawSync) inboxSyncState.lastResult = sync;
  }
  if (!isUsableInboxData(data, context)) {
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
      link: {
        enabled: true,
        title: "打开智能待办",
        interaction: "drawer",
        targetType: "service",
        contentType: "iframe",
        url: `${SERVER_URL}/?embed=cockpit-drawer`,
        allowFullscreen: true,
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
async function handleDetail(req, res, id) {
  const dataContext = requestDataContext(req);
  if (!dataContext) {
    const issue = authState.issue || issueFromError(new Error("identity unavailable"));
    json(res, identityFailurePayload({ issue }), issueHttpStatus(issue));
    return;
  }
  const state = readState(dataContext);
  const rawItem = currentStateItem(state, id);
  if (!state || !rawItem) {
    json(res, { success: false, error: "Detail not found" }, 404);
    return;
  }
  // 列表项做兜底标题来源；只允许当前 inbox snapshot 中仍存在的单据。
  const data = state ? normalizeInbox(state) : { items: [] };
  const item = (data?.items || []).find((entry) => itemPrimaryId(entry) === itemPrimaryId(rawItem)) || rawItem;

  const raw = readCurrentRawDetail(id, state, dataContext);
  const detail = detailFromRawOrItem(raw, item, "real");
  const includeSystemRuleAudit = new URL(req.url, SERVER_URL).searchParams.get("includeSystemRuleAudit") === "1";
  if (includeSystemRuleAudit) {
    const refreshed = await latestDetailWithSystemRuleAudit(
      id,
      dataContext,
      state,
      rawItem,
      item,
      raw,
      detail,
      { fallbackDataSource: "real" },
    );
    if (!refreshed.ok) {
      json(res, refreshed.payload, refreshed.status);
      return;
    }
    json(res, detailWithCardSections(refreshed.detail, refreshed.item));
    return;
  }
  // 详情主体来自当前 snapshot 的本地缓存，应立即返回。企业智能审核是高频远端数据，
  // 由前端在抽屉打开后通过 /api/system-rule-audit/:id 异步刷新，不能阻塞首屏详情。
  json(res, detailWithCardSections(detail, item));
}

// GET /api/system-rule-audit/:id — enterprise audit refresh for each detail open/manual retry.
// Standard detail loading calls this endpoint asynchronously; legacy hosts can opt into the
// synchronous equivalent through /api/details/:id?includeSystemRuleAudit=1.
async function handleSystemRuleAudit(req, res, id) {
  const dataContext = requestDataContext(req);
  if (!dataContext) {
    const issue = authState.issue || issueFromError(new Error("identity unavailable"));
    json(res, identityFailurePayload({ issue }), issueHttpStatus(issue));
    return;
  }
  const state = readState(dataContext);
  const rawItem = currentStateItem(state, id);
  if (!state || !rawItem) {
    json(res, { success: false, error: "Detail not found" }, 404);
    return;
  }
  const data = normalizeInbox(state);
  const item = (data?.items || []).find((entry) => itemPrimaryId(entry) === itemPrimaryId(rawItem)) || rawItem;
  const raw = readCurrentRawDetail(id, state, dataContext);
  const detail = detailFromRawOrItem(raw, item);
  const refreshed = await latestDetailWithSystemRuleAudit(id, dataContext, state, rawItem, item, raw, detail);
  if (!refreshed.ok) {
    json(res, refreshed.payload, refreshed.status);
    return;
  }
  json(res, {
    success: true,
    systemRuleAudit: refreshed.detail.systemRuleAudit,
    compositeAdvice: refreshed.detail.compositeAdvice,
    conclusion: refreshed.detail.conclusion,
  });
}

async function convertAttachmentToHtml(filePath) {
  const textutilArgs = ["-convert", "html", "-stdout", filePath];
  try {
    const { stdout } = await execFileAsync("textutil", textutilArgs, {
      timeout: 15000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    if (stdout && stdout.trim()) return stdout;
  } catch (e) {
    if (e.code !== "ENOENT") log(`textutil preview failed: ${e.message}`);
  }

  try {
    const { stdout } = await execFileAsync("pandoc", [filePath, "-t", "html"], {
      timeout: 15000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    if (stdout && stdout.trim()) return stdout;
  } catch (e) {
    if (e.code !== "ENOENT") log(`pandoc preview failed: ${e.message}`);
  }

  try {
    const { stdout } = await execFileAsync("strings", ["-n", "6", filePath], {
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
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
  const dataContext = requestDataContext(req);
  if (!dataContext) {
    const issue = authState.issue || issueFromError(new Error("identity unavailable"));
    json(res, identityFailurePayload({ issue }), issueHttpStatus(issue));
    return;
  }
  const safeName = basename(filename);
  const state = readState(dataContext);
  if (!state || !currentStateItem(state, id)) {
    json(res, { error: "File not found" }, 404);
    return;
  }
  const storedRawDetail = readRawDetail(id, dataContext);
  if (!storedRawDetail) {
    json(res, { error: "File not found" }, 404);
    return;
  }
  const rawDetail = readCurrentRawDetail(id, state, dataContext);
  if (!rawDetail) {
    const issue = staleSnapshotIssue("attachment");
    json(res, { success: false, issue, error: issue.userMessage }, 409);
    return;
  }
  if (!attachmentNames(rawDetail).has(safeName)) {
    json(res, { error: "File not found" }, 404);
    return;
  }
  const expectedSnapshotId = stateSnapshotId(state);
  const filePath = join(dataContext.attachDir, id, safeName);
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
    const latestState = readState(dataContext);
    if (!dataContextIsCurrent(dataContext)
        || stateSnapshotId(latestState) !== expectedSnapshotId
        || !detailBelongsToSnapshot(readRawDetail(id, dataContext), latestState, id, dataContext)) {
      const issue = identityChangedIssue("附件预览期间用户或租户已切换");
      json(res, { success: false, issue, error: issue.userMessage }, 409);
      return;
    }
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
  if (!dataContextIsCurrent(dataContext)) {
    const issue = identityChangedIssue("附件读取期间用户或租户已切换");
    json(res, { success: false, issue, error: issue.userMessage }, 409);
    return;
  }
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
const AUTO_LIMIT = Number(process.env.APPROVE_INBOX_AUTO_LIMIT || 2); // 每轮最多分析 N 项
const AUTO_SYNC_ENABLED = process.env.APPROVE_INBOX_AUTO_SYNC !== "0";
const INBOX_SYNC_PAGE_SIZE = Number(process.env.APPROVE_INBOX_SYNC_PAGE_SIZE || 200);
const STARTUP_ANALYSIS_LIMIT = Number(process.env.APPROVE_INBOX_STARTUP_ANALYSIS_LIMIT || process.env.APPROVE_INBOX_SYNC_LIMIT || 10);
const MANUAL_ANALYSIS_LIMIT = Number(process.env.APPROVE_INBOX_SYNC_LIMIT || 10);
const schedulerState = {
  enabled: AUTO_ENABLED,
  running: false,
  runningScopeKey: null,
  lastRunAt: null,
  lastResult: null,
  enrichedTotal: 0,
};
let pendingPersonalRulesReanalysisLimit = 0;
const inboxSyncState = {
  enabled: AUTO_SYNC_ENABLED,
  running: false,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
};
const inboxSyncPromises = new Map();

function currentRuntimeScopeKey() {
  return activeIdentitySession?.identity?.dataScopeKey || null;
}

function schedulerRunningForCurrentScope(scopeKey = currentRuntimeScopeKey()) {
  return !!(
    scopeKey
      && schedulerState.running
      && schedulerState.runningScopeKey === scopeKey
  );
}

function projectedSchedulerState(scopeKey = currentRuntimeScopeKey()) {
  const { runningScopeKey, enrichedTotal: _historicalEnrichedTotal, ...state } = schedulerState;
  return {
    ...state,
    running: schedulerRunningForCurrentScope(scopeKey),
  };
}

function projectedInboxSyncState(scopeKey = currentRuntimeScopeKey()) {
  return {
    ...inboxSyncState,
    running: !!(scopeKey && inboxSyncPromises.has(scopeKey)),
  };
}

function resetScopeRuntimeState(scopeKey) {
  schedulerState.lastRunAt = null;
  schedulerState.lastResult = null;
  schedulerState.enrichedTotal = 0;
  schedulerState.scopeKey = scopeKey;
  pendingPersonalRulesReanalysisLimit = 0;
  inboxSyncState.lastRunAt = null;
  inboxSyncState.lastResult = null;
  inboxSyncState.lastError = null;
  inboxSyncState.scopeKey = scopeKey;
  enrichJobs.clear();
}

async function runInboxSyncOnce(reason = "manual", { verifiedSession: suppliedSession = null } = {}) {
  if (!AUTO_SYNC_ENABLED) return Promise.resolve({ success: false, skipped: "disabled" });
  let verifiedSession;
  try {
    verifiedSession = suppliedSession || await ensureActiveIdentity({ pageSize: INBOX_SYNC_PAGE_SIZE, forceFresh: true });
    if (
      suppliedSession
      && (
        activeIdentitySession?.identity?.dataScopeKey !== suppliedSession.identity?.dataScopeKey
        || activeIdentitySession?.identity?.identityEpoch !== suppliedSession.identity?.identityEpoch
      )
    ) {
      const error = new Error("同步开始前用户或租户已切换");
      error.code = "IDENTITY_CHANGED_DURING_SYNC";
      throw error;
    }
  } catch (error) {
    const issue = publicIssue(error.issue || issueFromError(error, { exhausted: true }));
    return { reason, success: false, error: issue.userMessage, message: issue.userMessage, issue };
  }
  const scopeKey = verifiedSession.identity.dataScopeKey;
  const syncIdentityEpoch = verifiedSession.identity.identityEpoch;
  if (inboxSyncPromises.has(scopeKey)) return inboxSyncPromises.get(scopeKey);
  const promise = (async () => {
    inboxSyncState.running = true;
    inboxSyncState.lastError = null;
    try {
      const report = await syncInbox({
        data: DATA_ROOT,
        pageSize: INBOX_SYNC_PAGE_SIZE,
        currentInstanceId: INSTANCE_ID,
        verifiedSession,
        revalidateBeforeCommit: LOCAL_DEV_MODE
          ? async () => verifiedSession
          : async () => {
              const latestSession = await verifyManagedCliIdentity({
                env: process.env,
                profileDir: PROFILE_DIR,
                skillDir: SKILL_DIR,
                dataDir: DATA_ROOT,
                pageSize: 1,
              });
              const activeIdentity = activeIdentitySession?.identity;
              const capturedContextStillActive = activeIdentity?.dataScopeKey === scopeKey
                && activeIdentity?.identityEpoch === syncIdentityEpoch;
              return {
                ...latestSession,
                identity: {
                  ...latestSession.identity,
                  identityEpoch: capturedContextStillActive
                    ? syncIdentityEpoch
                    : (Number(activeIdentity?.identityEpoch) || 0),
                },
              };
            },
      });
      const success = report.success === true && !report.error;
      const safeReport = publicSyncReport(report);
      const isCurrentScope = activeIdentitySession?.identity?.dataScopeKey === scopeKey;
      if (!success && isCurrentScope) {
        dataAccessAllowed = false;
        authState.issue = safeReport.issue || authState.issue;
      }
      if (isCurrentScope) {
        inboxSyncState.lastRunAt = new Date().toISOString();
        inboxSyncState.lastResult = { ...safeReport, reason, success };
        inboxSyncState.lastError = success ? null : (safeReport.message || safeReport.error || "sync_failed");
      }
      return { ...safeReport, reason, success };
    } catch (e) {
      const issue = publicIssue(e.issue || issueFromError(e, { exhausted: true }));
      const error = issue.userMessage || String(e.message || e);
      if (activeIdentitySession?.identity?.dataScopeKey === scopeKey) {
        dataAccessAllowed = false;
        inboxSyncState.lastRunAt = new Date().toISOString();
        inboxSyncState.lastResult = { reason, success: false, error, issue };
        inboxSyncState.lastError = error;
      }
      return { reason, success: false, error, message: error, issue };
    } finally {
      inboxSyncPromises.delete(scopeKey);
      inboxSyncState.running = inboxSyncPromises.size > 0;
    }
  })();
  inboxSyncPromises.set(scopeKey, promise);
  return promise;
}

async function runRefreshCycle(
  reason = "scheduled",
  { limit = AUTO_LIMIT, analyze = AUTO_ENABLED, verifiedSession = null } = {},
) {
  const rawSync = await runInboxSyncOnce(reason, { verifiedSession });
  const currentScopeKey = activeIdentitySession?.identity?.dataScopeKey || "";
  const syncScopeKey = rawSync.identity?.dataScopeKey || "";
  const scopeStillCurrent = !!(syncScopeKey && syncScopeKey === currentScopeKey);
  if (rawSync.success === true && !scopeStillCurrent) {
    const issue = identityChangedIssue("同步完成前用户或租户已切换");
    rawSync.success = false;
    rawSync.issue = issue;
    rawSync.error = issue.userMessage;
    rawSync.message = issue.userMessage;
  }
  const data = rawSync.success === true && scopeStillCurrent ? inboxResponse() : null;
  const sync = projectSyncToCurrentTenant(rawSync, data);
  if (data && sync !== rawSync) inboxSyncState.lastResult = sync;
  const hasData = isUsableInboxData(data);
  const snapshotMatches = !!(
    rawSync.snapshotId
      && data?.meta?.snapshotId
      && rawSync.snapshotId === data.meta.snapshotId
      && activeIdentitySession?.identity
      && identityMatchesState(activeIdentitySession.identity, readState())
  );
  const canAnalyze = analyze
    && rawSync.success === true
    && scopeStillCurrent
    && hasData
    && data.items.length > 0
    && snapshotMatches
    && !schedulerState.running;
  const analysis = canAnalyze
    ? (runEnrichOnce(limit), { started: true, running: true, limit })
    : { started: false, running: schedulerRunningForCurrentScope() };

  return {
    success: rawSync.success === true && hasData,
    hasData,
    sync,
    analysis,
    issue: sync.issue || null,
    identity: safeIdentityStatus(),
    cache: {
      visible: rawSync.success === true && hasData,
      stale: false,
      snapshotId: rawSync.success === true ? data?.meta?.snapshotId || null : null,
    },
    error: rawSync.success === true && hasData ? null : (sync.message || sync.error || "未取到真实待办数据"),
  };
}

/**
 * 跑一次离线 enrich（对未分析待办）。
 * 用【子进程】跑 enrich-details CLI —— claude 分析是 execSync 同步阻塞，放子进程里
 * 才不会冻住 server 事件循环（否则每轮最长 limit×120s server 无响应）。
 */
async function runEnrichOnce(limit = AUTO_LIMIT, { force = false, pendingOnly = false } = {}) {
  if (schedulerState.running) return { skipped: "running" };
  const context = captureDataContext();
  if (!dataContextIsCurrent(context)) return { skipped: "identity_changed" };
  if (!existsSync(context.stateFile)) return { skipped: "no_inbox" };
  const expectedSnapshotId = stateSnapshotId(readState(context));
  if (!expectedSnapshotId && !LOCAL_DEV_MODE) return { skipped: "snapshot_missing" };
  schedulerState.running = true;
  schedulerState.runningScopeKey = context.scopeKey;
  let stagingDir = null;
  try {
    stagingDir = createEnrichStaging(context, expectedSnapshotId);
    const args = [ENRICH_SCRIPT, "--data", stagingDir, "--limit", String(limit)];
    if (force) args.push("--force");
    if (pendingOnly) args.push("--pending-only");
    const { stdout } = await execFileAsync(
      process.execPath,
      args,
      { timeout: 300000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
    );
    let report = {};
    try { report = JSON.parse(stdout); } catch { /* 子进程可能夹杂非 JSON 输出 */ }
    const results = Array.isArray(report.results) ? report.results : [];
    const done = results.filter((r) => r.step === "done" && r.analysis && !r.analysisError).length;
    const failed = results.filter((r) => r.error || r.analysisError || (r.step === "done" && !r.analysis));
    const analysisError = failed.length
      ? `analysis_failed:${failed.map((r) => `${r.id || "unknown"}:${r.analysisError || r.error || "empty_analysis"}`).join(",")}`
      : null;
    const error = report.error || analysisError || null;
    const result = { success: !error, processed: report.processed, done, skippedCrossTenant: report.skippedCrossTenant, error };
    if (!dataContextIsCurrent(context)) return { ...result, success: false, skipped: "identity_changed" };
    if (!promoteEnrichStaging({ stagingDir, context, expectedSnapshotId, results })) {
      return { ...result, success: false, skipped: "snapshot_changed" };
    }
    schedulerState.lastRunAt = new Date().toISOString();
    schedulerState.lastResult = result;
    schedulerState.enrichedTotal += done;
    return result;
  } catch (e) {
    const details = scriptErrorDetails(e);
    logScriptProcessError("enrich-details", details);
    const result = { success: false, ...details };
    if (dataContextIsCurrent(context)) {
      schedulerState.lastRunAt = new Date().toISOString();
      schedulerState.lastResult = result;
    }
    return result;
  } finally {
    cleanupEnrichStaging(stagingDir);
    schedulerState.running = false;
    schedulerState.runningScopeKey = null;
    const deferredLimit = pendingPersonalRulesReanalysisLimit;
    pendingPersonalRulesReanalysisLimit = 0;
    if (deferredLimit > 0) {
      void runEnrichOnce(deferredLimit, { force: true, pendingOnly: true });
    }
  }
}

// ── 单据级异步 enrich（按需「重新分析本单」）────────────────
// claude 分析 execSync 阻塞，故按需 enrich 也走子进程：点击立即返回，前端轮询 /api/details。
const enrichJobs = new Map(); // id → { status:'running'|'done'|'error', startedAt, finishedAt?, error? }

function spawnEnrichJob(id) {
  const context = captureDataContext();
  const state = readState(context);
  const item = currentStateItem(state, id);
  const targetItemRevision = item ? itemRevision(item) : "";
  const existing = enrichJobs.get(id);
  if (existing
      && existing.status === "running"
      && existing.scopeKey === context.scopeKey
      && existing.itemRevision === targetItemRevision) return existing;
  const expectedSnapshotId = stateSnapshotId(state);
  const job = {
    status: "running",
    startedAt: new Date().toISOString(),
    scopeKey: context.scopeKey,
    itemRevision: targetItemRevision,
  };
  enrichJobs.set(id, job);
  let stagingDir;
  try {
    stagingDir = createEnrichStaging(context, expectedSnapshotId);
  } catch (error) {
    job.status = "error";
    job.finishedAt = new Date().toISOString();
    job.error = error?.message || "snapshot_changed";
    return job;
  }
  execFile(
    process.execPath,
    [ENRICH_SCRIPT, "--data", stagingDir, "--id", id, "--force"],
    { timeout: 180000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
    (err, stdout, stderr) => {
      try {
        job.status = err ? "error" : "done";
        job.finishedAt = new Date().toISOString();
        if (err) {
          const details = scriptErrorDetails(err, { stdout, stderr });
          job.error = details.error;
          job.errorDetails = details;
          logScriptProcessError(`enrich-details:${id}`, details);
        } else if (!dataContextIsCurrent(context)) {
          job.status = "error";
          job.error = "snapshot_changed";
        } else {
          let report = {};
          try { report = JSON.parse(stdout); } catch { /* fake/legacy enrich may not return JSON */ }
          const results = Array.isArray(report.results) ? report.results : [];
          if (!promoteEnrichStaging({
            stagingDir,
            context,
            expectedSnapshotId,
            results,
            fallbackIds: [id],
          })) {
            job.status = "error";
            job.error = "snapshot_changed";
          }
        }
      } catch (error) {
        const details = scriptErrorDetails(error, { stdout, stderr });
        job.status = "error";
        job.finishedAt = new Date().toISOString();
        job.error = details.error;
        job.errorDetails = details;
        logScriptProcessError(`enrich-promote:${id}`, details);
      } finally {
        cleanupEnrichStaging(stagingDir);
      }
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
  log(`服务内自动刷新启动：每 ${AUTO_INTERVAL / 1000}s 同步待办并分析（每轮分析 ${AUTO_LIMIT} 项）`);
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
function currentAnalysisCoverage(context = captureDataContext()) {
  if (!dataContextIsCurrent(context)) {
    return {
      pendingTotal: 0,
      eligible: 0,
      analyzed: 0,
      remaining: 0,
      failed: 0,
      unavailable: 0,
      nonAnalyzable: 0,
      complete: false,
    };
  }
  const state = readState(context);
  const pendingItems = (normalizeInbox(state || {})?.items || []).filter((item) =>
    isPendingInboxItem(item) && !item.crossTenant);
  const items = pendingItems.filter((item) => item.voucher !== false);
  let eligible = 0;
  let analyzed = 0;
  let failed = 0;
  let unavailable = 0;
  for (const item of items) {
    const raw = readCurrentRawDetail(itemPrimaryId(item), state, context);
    const detailFields = Array.isArray(raw?.content?.fields) ? raw.content.fields : [];
    if (raw?.content?.unavailable === true && detailFields.length === 0) {
      unavailable++;
      continue;
    }
    eligible++;
    if (isCompleteAnalysis(raw?.analysis) || isCompleteAnalysis(raw)) analyzed++;
    else if (raw?.analysisError) failed++;
  }
  return {
    pendingTotal: pendingItems.length,
    eligible,
    analyzed,
    remaining: Math.max(0, eligible - analyzed - failed),
    failed,
    unavailable,
    nonAnalyzable: Math.max(0, pendingItems.length - eligible),
    complete: eligible > 0 && analyzed === eligible,
  };
}

function handleSyncStatus(req, res) {
  const enriching = [...enrichJobs.entries()].filter(([, j]) => j.status === "running").map(([id]) => id);
  const scopeKey = currentRuntimeScopeKey();
  json(res, {
    ...projectedSchedulerState(scopeKey),
    interval: AUTO_INTERVAL / 1000,
    limit: AUTO_LIMIT,
    enriching,
    analysisCoverage: currentAnalysisCoverage(),
    inboxSync: projectedInboxSyncState(scopeKey),
    auth: { status: authState.status, issue: authState.issue, lastVerifiedAt: authState.lastVerifiedAt },
  });
}

function handleServiceIdentity(req, res) {
  json(res, {
    success: true,
    serviceIdentity: SERVICE_IDENTITY,
    instanceId: INSTANCE_ID,
    shutdownProtected: Boolean(INSTANCE_TOKEN),
    protocolVersion: SERVICE_PROTOCOL_VERSION,
  });
}

async function handleCliHealth(req, res) {
  try {
    const session = await ensureActiveIdentity({ pageSize: 1, forceFresh: true });
    json(res, {
      ready: true,
      authMode: AUTH_MODE,
      profileMatch: true,
      proxyContextPresent: LOCAL_DEV_MODE || !!process.env.YONCLAW_REQ_PROXY_BASE_URL,
      cliReady: true,
      identityVerified: true,
      identity: { status: "ready", scopeKey: session.identity.dataScopeKey },
      serviceIdentity: SERVICE_IDENTITY,
    });
  } catch (error) {
    const payload = identityFailurePayload(error);
    json(res, {
      ...payload,
      ready: false,
      authMode: AUTH_MODE,
      profileMatch: payload.issue?.code !== "SERVICE_PROFILE_MISMATCH",
      proxyContextPresent: !!process.env.YONCLAW_REQ_PROXY_BASE_URL,
      cliReady: false,
      identityVerified: false,
      serviceIdentity: SERVICE_IDENTITY,
    }, issueHttpStatus(payload.issue));
  }
}

// GET /api/enrich-status/:id — 单项 enrich 任务状态（前端轮询用）
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
    json(res, {
      success: false,
      type: "cross_tenant",
      error: "当前单据不属于当前租户作用域；请在 YonWork 切换到对应租户并重新同步后再分析附件",
    }, 409);
    return;
  }
  const job = spawnEnrichJob(id);
  json(res, { success: true, queued: true, status: job.status, startedAt: job.startedAt });
}

// POST /api/sync — 刷新待办列表 + 触发一轮离线分析。
// 同步待办列表会等待完成并返回最新 data；AI 分析子进程非阻塞，前端轮询 sync-status + inbox。
async function handleSync(req, res) {
  const context = requestDataContext(req);
  const cycle = await runRefreshCycle("manual", {
    limit: MANUAL_ANALYSIS_LIMIT,
    analyze: true,
    verifiedSession: req.approveInboxIdentitySession,
  });
  if (!dataContextIsCurrent(context)) {
    const issue = identityChangedIssue("刷新期间用户或租户已切换");
    json(res, {
      success: false,
      issue,
      identity: { status: "changed", scopeKey: null },
      cache: { visible: false, stale: false, snapshotId: null },
      analysis: { started: false, running: schedulerRunningForCurrentScope() },
      error: issue.userMessage,
    }, 409);
    return;
  }
  const syncReport = cycle.sync;
  const data = cycle.success ? inboxResponse(context) : null;
  if (!cycle.success || !isUsableInboxData(data, context)) {
    const payload = {
      ...realInboxUnavailablePayload(syncReport),
      issue: cycle.issue || syncReport.issue || authState.issue,
      identity: cycle.identity || safeIdentityStatus(),
      cache: cycle.cache || { visible: false, stale: false, snapshotId: null },
      analysis: cycle.analysis || { started: false, running: schedulerRunningForCurrentScope() },
    };
    json(res, payload, issueHttpStatus(payload.issue));
    return;
  }
  json(res, {
    success: true,
    mode: "real",
    data,
    sync: syncReport,
    identity: cycle.identity,
    cache: cycle.cache,
    analysis: cycle.analysis,
    started: cycle.analysis.started,
    running: cycle.analysis.running,
  });
}

function updateApprovalJobState(context, jobId, updater) {
  if (!dataContextIsCurrent(context)) return false;
  return withStateCommitLock(context.dataDir, () => {
    if (!dataContextIsCurrent(context)) return false;
    const latestState = readState(context);
    if (!latestState) return false;
    const jobItems = findStateItems(latestState, (latestState.items || []).map(itemPrimaryId))
      .filter((item) => item?.approvalProcessing?.jobId === jobId);
    if (jobItems.length === 0) return false;
    updater(latestState, jobItems);
    writeStateUnlocked(latestState, context);
    return true;
  });
}

function approvalBackgroundIssue(entry = {}) {
  const issue = publicIssue(entry.issue || {
    category: "approval",
    code: entry.code || "APPROVAL_BACKGROUND_FAILED",
    errorCode: entry.code || "APPROVAL_BACKGROUND_FAILED",
    userMessage: entry.error || "审批后台处理未能确认结果，请刷新核对。",
    httpStatus: 409,
    retryable: true,
  });
  return { code: issue.code, userMessage: issue.userMessage };
}

function recordApprovalJobPhase(context, jobId, event = {}) {
  const at = event.at || new Date().toISOString();
  try {
    updateApprovalJobState(context, jobId, (_state, jobItems) => {
      for (const item of jobItems) {
        const processing = item.approvalProcessing;
        const history = Array.isArray(processing.phaseHistory) ? processing.phaseHistory : [];
        item.approvalProcessing = {
          ...processing,
          phase: event.phase || processing.phase || "processing",
          phaseStartedAt: at,
          lastCheckedAt: at,
          phaseHistory: [...history, { phase: event.phase || "processing", at }].slice(-16),
        };
        item.runtimeActions = [];
      }
    });
  } catch (error) {
    log(`审批任务 ${jobId} 阶段记录失败: ${error?.code || error?.message || error}`);
  }
}

function approvalTiming(processing = {}, finishedAt = new Date().toISOString()) {
  const startedMs = Date.parse(processing.submittedAt || "");
  const finishedMs = Date.parse(finishedAt);
  return {
    finishedAt,
    durationMs: Number.isFinite(startedMs) && Number.isFinite(finishedMs)
      ? Math.max(0, finishedMs - startedMs)
      : null,
  };
}

function approvalJobNeedsCommittedReconciliation(context, jobId) {
  if (!dataContextIsCurrent(context)) return false;
  const state = readState(context);
  return findStateItems(state || {}, (state?.items || []).map(itemPrimaryId)).some((item) =>
    item?.approvalProcessing?.jobId === jobId
      && item.approvalProcessing.remoteOutcome === "confirmed_committed");
}

function scheduleApprovalReconciliation(context, jobId) {
  log(`审批任务 ${jobId} 已安排远端对账：${APPROVAL_RECONCILIATION_DELAYS_MS.join(",")}ms`);
  for (const delayMs of APPROVAL_RECONCILIATION_DELAYS_MS) {
    const timer = setTimeout(async () => {
      if (!approvalJobNeedsCommittedReconciliation(context, jobId)) return;
      const report = await runInboxSyncOnce("approval-reconciliation");
      if (report.success && !approvalJobNeedsCommittedReconciliation(context, jobId)) {
        log(`审批任务 ${jobId} 已通过远端待办快照完成对账`);
      }
    }, delayMs);
    timer.unref?.();
  }
}

async function runApprovalJob({
  jobId,
  requestContext,
  approvalSession,
  executableItems,
  approvalTaskSnapshots,
  detailsById,
  payload,
}) {
  const ids = executableItems.map(itemPrimaryId);
  recordApprovalJobPhase(requestContext, jobId, { phase: "background_started" });
  try {
    const result = await executeApproval(executableItems, { ...payload, detailsById }, {
      bipCliPath: approvalSession.cliPath,
      env: process.env,
      onPhase: (event) => recordApprovalJobPhase(requestContext, jobId, event),
      beforeDangerousCommand: LOCAL_DEV_MODE
        ? undefined
        : async ({ primaryIds = [] }) => verifyApprovalCommandIdentity(
            approvalSession,
            primaryIds,
            { requireMembership: true, taskSnapshots: approvalTaskSnapshots },
          ),
      afterDangerousCommand: LOCAL_DEV_MODE
        ? undefined
        : async () => verifyApprovalCommandIdentity(approvalSession),
    });
    const completed = new Set((result.successIds || []).map(String));
    const results = result.results || [];
    const unknownEntry = results.find((entry) =>
      entry?.remoteCommitted === true
        || entry?.remoteOutcomeUnknown === true
        || entry?.remoteOutcome === "confirmed_committed"
        || entry?.remoteOutcome === "unknown");
    const guardedEntry = results.find((entry) => [
      "AUTH_REQUIRED_IN_YONWORK",
      "HOST_AUTH_CONTEXT_MISSING",
      "IDENTITY_CHANGED_DURING_APPROVAL",
      "STALE_APPROVAL_SNAPSHOT",
    ].includes(entry?.code || entry?.issue?.code));
    const remoteCommitConfirmed = Boolean(
      unknownEntry?.remoteCommitted === true
        || unknownEntry?.remoteOutcome === "confirmed_committed",
    );

    updateApprovalJobState(requestContext, jobId, (latestState, jobItems) => {
      const finishedAt = new Date().toISOString();
      for (const item of jobItems) {
        const timing = approvalTiming(item.approvalProcessing, finishedAt);
        item.lastApproval = {
          jobId,
          action: payload.action,
          outcome: completed.has(itemPrimaryId(item)) ? "success" : (unknownEntry ? "needs_review" : "failed"),
          submittedAt: item.approvalProcessing.submittedAt,
          phaseHistory: item.approvalProcessing.phaseHistory || [],
          ...timing,
        };
      }
      if (completed.size > 0) moveItemsToDone(latestState, completed, payload.action);
      const unresolvedIds = ids.filter((id) => !completed.has(id));
      if (unknownEntry) {
        updateItemsApprovalProcessing(latestState, unresolvedIds, {
          state: "needs_review",
          phase: "reconciliation",
          ...approvalTiming(jobItems[0]?.approvalProcessing, finishedAt),
          remoteOutcome: unknownEntry.remoteCommitted === true
            || unknownEntry.remoteOutcome === "confirmed_committed"
            ? "confirmed_committed"
            : "unknown",
          reasonCode: unknownEntry.code || unknownEntry.issue?.code || "APPROVAL_REMOTE_OUTCOME_UNKNOWN",
          issue: approvalBackgroundIssue(unknownEntry),
        });
      } else if (guardedEntry) {
        updateItemsApprovalProcessing(latestState, unresolvedIds, {
          state: "needs_review",
          phase: "reconciliation",
          ...approvalTiming(jobItems[0]?.approvalProcessing, finishedAt),
          remoteOutcome: guardedEntry.remoteOutcome || "unknown",
          reasonCode: guardedEntry.code || guardedEntry.issue?.code,
          issue: approvalBackgroundIssue(guardedEntry),
        });
      } else if (unresolvedIds.length > 0) {
        // 红线：非成功终态绝不静默清除。曾出现 CLI 刷新缺陷导致整批 unavailable 后
        // 单据无声回到待办、用户毫无感知；此处一律降级为待核对并携带用户可见原因，
        // 由「处理中/待核对」区提供重试/清除出口（清除即恢复待办可操作）。
        const failedEntry = results.find((entry) => entry && entry.success !== true) || null;
        updateItemsApprovalProcessing(latestState, unresolvedIds, {
          state: "needs_review",
          phase: "reconciliation",
          ...approvalTiming(jobItems[0]?.approvalProcessing, finishedAt),
          remoteOutcome: "confirmed_failed",
          reasonCode: failedEntry?.code || failedEntry?.issue?.code
            || (failedEntry?.type === "unavailable" ? "APPROVAL_ACTION_UNAVAILABLE" : "APPROVAL_BACKGROUND_FAILED"),
          issue: approvalBackgroundIssue(failedEntry || { error: "审批未成功且远端未返回原因，请核对后重试。" }),
        });
      }
    });
    const unresolvedCount = ids.filter((id) => !completed.has(id)).length;
    if (unresolvedCount > 0) {
      const reasonEntry = unknownEntry || guardedEntry
        || results.find((entry) => entry && entry.success !== true) || null;
      const reason = reasonEntry?.error || reasonEntry?.issue?.userMessage || reasonEntry?.code || "未知原因";
      log(`审批任务 ${jobId} 结束：成功 ${completed.size}/${ids.length}，待核对 ${unresolvedCount}（${reason}）`);
    } else {
      log(`审批任务 ${jobId} 完成：全部 ${ids.length} 条成功`);
    }
    if (remoteCommitConfirmed) scheduleApprovalReconciliation(requestContext, jobId);
  } catch (error) {
    log(`审批后台任务 ${jobId} 异常: ${error?.message || error}`);
    updateApprovalJobState(requestContext, jobId, (latestState, jobItems) => {
      const finishedAt = new Date().toISOString();
      updateItemsApprovalProcessing(latestState, ids, {
        state: "needs_review",
        phase: "reconciliation",
        ...approvalTiming(jobItems[0]?.approvalProcessing, finishedAt),
        remoteOutcome: "unknown",
        reasonCode: error?.code || "APPROVAL_BACKGROUND_EXCEPTION",
        issue: approvalBackgroundIssue({ code: error?.code, error: error?.message }),
      });
    });
  }
}

// POST /api/approve — 先持久化单据级处理中状态，危险远端动作在后台执行。
async function handleApprove(req, res) {
  const requestContext = requestDataContext(req);
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

  if (!dataContextIsCurrent(requestContext)) {
    const issue = identityChangedIssue("审批请求解析期间用户或租户已切换");
    json(res, {
      success: false,
      issue,
      identity: { status: "changed", scopeKey: null },
      cache: { visible: false, stale: false, snapshotId: null },
      analysis: { started: false, running: schedulerRunningForCurrentScope() },
      error: issue.userMessage,
    }, 409);
    return;
  }

  let approvalSession;
  try {
    approvalSession = req.approveInboxIdentitySession
      || await ensureActiveIdentity({ pageSize: INBOX_SYNC_PAGE_SIZE, forceFresh: true });
  } catch (error) {
    const failure = identityFailurePayload(error);
    json(res, failure, issueHttpStatus(failure.issue));
    return;
  }
  if (!dataContextIsCurrent(requestContext)
      || approvalSession.identity?.dataScopeKey !== requestContext.scopeKey) {
    const issue = identityChangedIssue("审批执行前用户或租户已切换");
    json(res, {
      success: false,
      issue,
      identity: { status: "changed", scopeKey: null },
      cache: { visible: false, stale: false, snapshotId: null },
      analysis: { started: false, running: schedulerRunningForCurrentScope() },
      error: issue.userMessage,
    }, 409);
    return;
  }

  let state = readState(requestContext);
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
  const foundIds = new Set(items.map((item) => itemPrimaryId(item)));
  const missingStateIds = payload.ids.map(String).filter((id) => !foundIds.has(id));
  if (missingStateIds.length > 0) {
    const failure = identityFailurePayload(staleApprovalSnapshotError(
      "审批请求包含不在当前本地快照中的任务",
    ));
    json(res, failure, 409);
    return;
  }

  const alreadyProcessing = items.find((item) => activeApprovalProcessing(item));
  if (alreadyProcessing) {
    const existing = activeApprovalProcessing(alreadyProcessing);
    const issue = publicIssue({
      category: "approval",
      code: "APPROVAL_ALREADY_PROCESSING",
      errorCode: "APPROVAL_ALREADY_PROCESSING",
      userMessage: existing.state === "needs_review"
        ? "该单据的上一次审批结果仍需核对，确认前不能再次操作。"
        : "该单据正在等待远端处理，请勿重复提交。",
      httpStatus: 409,
      retryable: false,
    });
    json(res, {
      success: false,
      issue,
      existingJobId: existing.jobId,
      processingState: existing.state,
      processingIds: [itemPrimaryId(alreadyProcessing)],
      error: issue.userMessage,
    }, 409);
    return;
  }

  const blockedResults = [];
  let executableItems = [];
  for (const item of items) {
    if (isCrossTenantItemForCurrentState(item, state)) {
      blockedResults.push(crossTenantApprovalResult(item, state, payload.action));
    } else {
      executableItems.push(item);
    }
  }

  let approvalTaskSnapshots = new Map();
  if (!LOCAL_DEV_MODE && executableItems.length > 0) {
    try {
      const prepared = prepareApprovalTaskSnapshot(approvalSession, executableItems);
      executableItems = prepared.executableItems;
      approvalTaskSnapshots = prepared.snapshots;
    } catch (error) {
      const failure = identityFailurePayload(error);
      json(res, failure, issueHttpStatus(failure.issue));
      return;
    }
  }

  if (executableItems.length === 0) {
    json(res, {
      success: false,
      mode: "real",
      action: payload.action,
      completed: [],
      results: blockedResults,
      error: blockedResults[0]?.error || "没有可执行的审批任务",
    }, 409);
    return;
  }

  const detailsById = new Map(executableItems.map((item) => {
    const id = itemPrimaryId(item);
    return [id, readCurrentRawDetail(id, state, requestContext)];
  }));

  const processingIds = executableItems.map(itemPrimaryId);
  const sourceSnapshotId = stateSnapshotId(state);
  const jobId = randomBytes(16).toString("hex");
  if (markItemsApprovalProcessing(state, processingIds, {
    jobId,
    action: payload.action,
    sourceSnapshotId,
    ownerInstanceId: INSTANCE_ID,
    phase: "queued",
  }) !== processingIds.length) {
    json(res, { success: false, error: "审批任务状态已变化，请刷新后重试" }, 409);
    return;
  }
  try {
    writeState(state, requestContext, { expectedSnapshotId: sourceSnapshotId });
  } catch (error) {
    const issue = error?.code === "STALE_STATE_SNAPSHOT"
      ? identityChangedIssue("审批提交前待办快照已变化")
      : issueFromError(error, { exhausted: true });
    json(res, { success: false, issue: publicIssue(issue), error: issue.userMessage }, issueHttpStatus(issue));
    return;
  }

  json(res, {
    success: true,
    accepted: true,
    mode: "background",
    action: payload.action,
    jobId,
    processingIds,
    blockedResults,
    message: "审批已提交后台处理，可关闭弹窗；处理完成前不能重复操作。",
  }, 202);

  setImmediate(() => {
    void runApprovalJob({
      jobId,
      requestContext,
      approvalSession,
      executableItems,
      approvalTaskSnapshots,
      detailsById,
      payload,
    });
  });
}

// POST /api/approve/reset — 清除等待核对(needs_review)条目的处理标记，复位为可操作 pending。
// needs_review 的用户出口：绝不静默把失败条目放回待办，改由用户显式「清除/重试」，
// 且必须经服务端权威清除（纯前端删标记会被下一次同步的服务端态覆盖回来）。
async function handleApproveReset(req, res) {
  const requestContext = requestDataContext(req);
  let body;
  try {
    body = await parseBody(req);
  } catch {
    json(res, { success: false, error: "Invalid JSON body" }, 400);
    return;
  }
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
  if (!ids.length) {
    json(res, { success: false, error: "ids required" }, 400);
    return;
  }
  if (!dataContextIsCurrent(requestContext)) {
    const issue = identityChangedIssue("清除审批处理标记期间用户或租户已切换");
    json(res, {
      success: false,
      issue,
      identity: { status: "changed", scopeKey: null },
      error: issue.userMessage,
    }, 409);
    return;
  }
  const idSet = new Set(ids);
  let cleared = 0;
  withStateCommitLock(requestContext.dataDir, () => {
    if (!dataContextIsCurrent(requestContext)) return;
    const latestState = readState(requestContext);
    if (!latestState || !Array.isArray(latestState.items)) return;
    // 只清除 needs_review；仍在 processing 的后台任务不可打断（避免与进行中的 job 竞态）。
    const resettable = findStateItems(latestState, [...idSet])
      .filter((item) => item?.approvalProcessing?.state === "needs_review")
      .map(itemPrimaryId);
    cleared = clearItemsApprovalProcessing(latestState, resettable);
    if (cleared > 0) writeStateUnlocked(latestState, requestContext);
  });
  json(res, { success: true, cleared });
}

// ── 路由分发 ────────────────────────────────────────────
function routeNeedsIdentity(method, path) {
  if (!path.startsWith("/api/")) return false;
  if ([
    "/api/runtime-context",
    "/api/service-identity",
    "/api/health/cli",
    "/api/shutdown",
  ].includes(path)) return false;
  return method === "GET" || method === "POST";
}

// 驾驶舱页面跑在公网域名下,通过 Private Network Access 预检访问本机服务,
// 因此除 localhost 外还需放行精确匹配的受信任远程来源;绝不使用通配符。
const ALLOWED_REMOTE_ORIGINS = new Set([
  "https://bip-daily.yonyoucloud.com",
  ...String(process.env.APPROVE_INBOX_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

function isAllowedOrigin(origin = "") {
  if (!origin) return true;
  if (ALLOWED_REMOTE_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

async function handler(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  const origin = String(req.headers.origin || "");
  if (!isAllowedOrigin(origin)) {
    json(res, { success: false, error: "origin not allowed" }, 403);
    return;
  }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (String(req.headers["access-control-request-private-network"] || "").toLowerCase() === "true") {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (routeNeedsIdentity(req.method, path)) {
      try {
        const pageSize = req.method === "POST" && ["/api/approve", "/api/sync"].includes(path)
          ? INBOX_SYNC_PAGE_SIZE
          : 1;
        req.approveInboxIdentitySession = await ensureActiveIdentity({
          pageSize,
          forceFresh: req.method !== "GET",
        });
        req.approveInboxDataContext = captureDataContext();
      } catch (error) {
        const payload = identityFailurePayload(error);
        json(res, payload, issueHttpStatus(payload.issue));
        return;
      }
    }
    if (req.method === "GET" && path === "/") {
      handleIndex(req, res, url);
    } else if (req.method === "GET" && WEB_STATIC_FILES.has(path.slice(1))) {
      handleWebStatic(req, res, path);
    } else if (req.method === "GET" && path === "/api/runtime-context") {
      handleRuntimeContext(req, res, url);
    } else if (req.method === "GET" && path === "/api/service-identity") {
      handleServiceIdentity(req, res);
    } else if (req.method === "GET" && path === "/api/health/cli") {
      await handleCliHealth(req, res);
    } else if (req.method === "GET" && path === "/api/widget/todos") {
      await handleWidgetTodos(req, res, url);
    } else if (req.method === "GET" && path === "/api/widget/cockpit") {
      await handleWidgetCockpit(req, res, url);
    } else if (req.method === "POST" && path === "/api/widget/refresh") {
      await handleWidgetRefresh(req, res, url);
    } else if (req.method === "GET" && path === "/widget/manifest.json") {
      handleWidgetManifest(req, res, url);
    } else if (req.method === "GET" && (path === "/widget" || path === "/widget/" || path.startsWith("/widget/"))) {
      handleWidgetStatic(req, res, path);
    } else if (req.method === "GET" && path === "/api/inbox") {
      await handleInbox(req, res);
    } else if (req.method === "GET" && path === "/api/table-view") {
      handleTableView(req, res, url);
    } else if (req.method === "GET" && path === "/api/ui-config") {
      handleConfigRead(req, res, "ui");
    } else if (req.method === "POST" && path === "/api/ui-config") {
      await handleConfigWrite(req, res, "ui");
    } else if (req.method === "GET" && path === "/api/table-config") {
      handleConfigRead(req, res, "table");
    } else if (req.method === "POST" && path === "/api/table-config") {
      await handleConfigWrite(req, res, "table");
    } else if (req.method === "GET" && path === "/api/card-config") {
      handleConfigRead(req, res, "card");
    } else if (req.method === "POST" && path === "/api/card-config") {
      await handleConfigWrite(req, res, "card");
    } else if (req.method === "GET" && path === "/api/detail-card-config") {
      handleConfigRead(req, res, "detail");
    } else if (req.method === "POST" && path === "/api/detail-card-config") {
      await handleConfigWrite(req, res, "detail");
    } else if (req.method === "GET" && path === "/api/personal-rules-config") {
      handleConfigRead(req, res, "personalRules");
    } else if (req.method === "POST" && path === "/api/personal-rules-config") {
      await handleConfigWrite(req, res, "personalRules");
    } else if (req.method === "GET" && path === "/api/ui-config/diagnostics") {
      handleUiConfigDiagnostics(req, res);
    } else if (req.method === "GET" && path.startsWith("/api/ui-assets/")) {
      handleUiAsset(req, res, path);
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
    } else if (req.method === "GET" && path.startsWith("/api/system-rule-audit/")) {
      await handleSystemRuleAudit(req, res, decodeURIComponent(path.slice("/api/system-rule-audit/".length)));
    } else if (req.method === "GET" && path.startsWith("/api/details/")) {
      await handleDetail(req, res, decodeURIComponent(path.slice("/api/details/".length)));
    } else if (req.method === "POST" && path.startsWith("/api/enrich/")) {
      await handleEnrichOne(req, res, decodeURIComponent(path.slice("/api/enrich/".length)));
    } else if (req.method === "POST" && path === "/api/sync") {
      await handleSync(req, res);
    } else if (req.method === "POST" && path === "/api/approve") {
      await handleApprove(req, res);
    } else if (req.method === "POST" && path === "/api/approve/reset") {
      await handleApproveReset(req, res);
    } else if (req.method === "POST" && path === "/api/shutdown") {
      const body = await parseBody(req);
      if (!LOCAL_DEV_MODE && !INSTANCE_TOKEN) {
        json(res, { success: false, error: "shutdown protection unavailable" }, 503);
        return;
      }
      if ((!LOCAL_DEV_MODE || body.instanceId) && body.instanceId !== INSTANCE_ID) {
        json(res, { success: false, error: "service instance mismatch" }, 409);
        return;
      }
      if ((!LOCAL_DEV_MODE || INSTANCE_TOKEN) && body.instanceToken !== INSTANCE_TOKEN) {
        json(res, { success: false, error: "invalid shutdown token" }, 403);
        return;
      }
      json(res, { success: true, message: "Server shutting down" });
      setTimeout(() => server.close(() => process.exit(0)), 100);
    } else {
      json(res, { error: "Not found" }, 404);
    }
  } catch (e) {
    const code = e?.code || e?.issue?.code || "INTERNAL_ERROR";
    log(`request failed: ${code}`);
    json(res, { success: false, error: "智能待办请求处理失败", code }, 500);
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
  execFile(opener, args, { windowsHide: true }, () => {});
}

// ── 启动 ────────────────────────────────────────────────
const server = createServer(handler);

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[server] 启动失败: ${SERVER_URL} 已被占用，必须由 ensure-service 完成实例身份校验与交接`);
    process.exit(1);
  } else {
    console.error(`[server] 启动失败: ${err.message}`);
    process.exit(1);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  智能待办已启动`);
  console.log(`  打开浏览器访问: \x1b[36m${SERVER_URL}\x1b[0m\n`);
  openBrowser();
  startScheduler();
});
