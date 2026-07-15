import { createHash } from "node:crypto";
import { join, resolve, sep } from "node:path";

import {
  clearBipCliCapabilityCache,
  resolveApproveInboxBipCliPath,
  runBipCli,
} from "./bip-cli-client.mjs";

export const MANAGED_AUTH_MODE = "managed-yonwork";

function hashIdentityPart(label, value) {
  return createHash("sha256").update(`${label}\0${String(value)}`, "utf8").digest("hex");
}

function requiredText(value, field) {
  const text = String(value || "").trim();
  if (!text) {
    throw new RuntimeIdentityError(buildIssue(
      "IDENTITY_INCOMPLETE",
      `当前 YonWork 身份缺少 ${field}`,
      "无法确认当前用户或租户，请重新进入 YonWork 后刷新。",
      { category: "identity", httpStatus: 503, retryable: true },
    ));
  }
  return text;
}

function environmentFromUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return new URL(text).hostname || "";
  } catch {
    return "";
  }
}

function environmentComparisonKey(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  const host = environmentFromUrl(text) || text;
  const yonbipHost = host.match(/^([a-z0-9-]+)\.yonyoucloud\.com$/i);
  return yonbipHost ? yonbipHost[1] : host;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function unwrapResult(result = {}) {
  return result?.data && typeof result.data === "object"
    ? result.data
    : (result?.result && typeof result.result === "object" ? result.result : result);
}

function environmentFromListResult(result = {}) {
  const value = unwrapResult(result) || {};
  const rows = Array.isArray(value.items)
    ? value.items
    : (Array.isArray(value.result) ? value.result : []);
  const firstBusinessUrl = rows.find((row) => firstText(row?.webUrl, row?.mUrl));
  return firstText(
    value.environment,
    value.env,
    value.envId,
    environmentFromUrl(firstText(value.baseUrl, value.yonbipBaseUrl)),
    environmentFromUrl(firstText(firstBusinessUrl?.webUrl, firstBusinessUrl?.mUrl)),
  );
}

function profileDirFromCliPath(cliPath) {
  const normalized = resolve(String(cliPath || ""));
  const marker = `${sep}userData${sep}runtime${sep}openclaw${sep}skills${sep}iuap-apcom-cli`;
  const index = normalized.indexOf(marker);
  return index >= 0 ? normalized.slice(0, index) : "";
}

function buildIssue(errorCode, reason, userMessage, options = {}) {
  const code = String(errorCode || "RUNTIME_IDENTITY_ERROR");
  return {
    category: options.category || "runtime",
    code,
    errorCode: code,
    reason: String(reason || code),
    userMessage: String(userMessage || reason || code),
    httpStatus: Number(options.httpStatus) || 503,
    retryable: options.retryable !== false,
    recovery: options.recovery || {
      action: "retry-sync",
      label: "重新同步",
    },
  };
}

export class RuntimeIdentityError extends Error {
  constructor(issue, options = {}) {
    const normalized = issue?.errorCode ? issue : issueFromError(issue);
    super(normalized.reason || normalized.userMessage, options.cause ? { cause: options.cause } : undefined);
    this.name = "RuntimeIdentityError";
    this.code = normalized.errorCode;
    this.issue = normalized;
  }
}

export function isUnauthorizedError(error) {
  const statuses = [
    error?.status,
    error?.statusCode,
    error?.code,
    error?.errcode,
    error?.result?.status,
    error?.result?._httpStatus,
    error?.result?.code,
    error?.result?.errcode,
  ].map(Number).filter(Number.isFinite);
  if (statuses.includes(401)) return true;
  const text = [
    error?.message,
    error?.stderr,
    error?.stdout,
    error?.result?.message,
    error?.result?.error,
  ].filter(Boolean).join(" ");
  return /(?:HTTP\s*)?401\b|unauthori[sz]ed|获取\s*secret\s*失败[^\n]*401/i.test(text);
}

export function issueFromError(error, { exhausted = true } = {}) {
  if (error?.issue?.errorCode) return error.issue;
  const code = error?.code || "";
  const reason = String(error?.message || error || "runtime_identity_error");
  if (code === "HOST_AUTH_CONTEXT_MISSING") {
    return buildIssue(code, reason, "智能待办未获得当前 YonWork 登录上下文，请重新进入智能待办。", {
      category: "service-context",
      httpStatus: 503,
      recovery: { action: "reopen-in-yonwork", label: "重新进入智能待办" },
    });
  }
  if (isUnauthorizedError(error)) {
    return buildIssue(
      exhausted ? "AUTH_REQUIRED_IN_YONWORK" : "AUTH_RETRY_REQUIRED",
      reason,
      exhausted
        ? "YonWork 登录状态已失效，请在 YonWork 中重新登录后刷新。"
        : "正在重新确认当前 YonWork 登录状态。",
      {
        category: "auth",
        httpStatus: 401,
        recovery: { action: "login-in-yonwork", label: "在 YonWork 中重新登录" },
      },
    );
  }
  if (/缺少命令[^\n]*whoami|capabilit[^\n]*whoami|能力不兼容[^\n]*whoami/i.test(reason)) {
    return buildIssue(
      "CLI_IDENTITY_UNSUPPORTED",
      reason,
      "当前 Profile 的 iuap-apcom-cli 版本不支持身份校验，请升级后重试。",
      { category: "runtime", httpStatus: 503, retryable: false },
    );
  }
  if (/未找到[^\n]*Profile sibling|PROFILE_CLI_NOT_FOUND/i.test(reason)) {
    return buildIssue(
      "PROFILE_CLI_NOT_FOUND",
      reason,
      "当前 YonWork Profile 缺少智能待办所需的 CLI，请重新安装或升级。",
      { category: "service-context", httpStatus: 503, retryable: false },
    );
  }
  return buildIssue(code || "RUNTIME_IDENTITY_ERROR", reason, "当前身份校验失败，请稍后重试。", {
    category: "runtime",
    httpStatus: 503,
  });
}

export function normalizeWhoamiIdentity(result = {}) {
  const value = unwrapResult(result) || {};
  const user = value.user && typeof value.user === "object" ? value.user : {};
  const userInfo = value.userInfo && typeof value.userInfo === "object" ? value.userInfo : {};
  const tenant = value.tenant && typeof value.tenant === "object" ? value.tenant : {};
  const currentTenant = value.currentTenant && typeof value.currentTenant === "object" ? value.currentTenant : {};
  const baseUrl = firstText(value.baseUrl, value.yonbipBaseUrl, result?.baseUrl);
  const yhtUserId = firstText(
    value.yhtUserId,
    value.yht_user_id,
    user.yhtUserId,
    user.yht_user_id,
    userInfo.yhtUserId,
    userInfo.yht_user_id,
  );
  const genericUserId = firstText(
    value.userId,
    value.userid,
    user.userId,
    user.id,
    userInfo.userId,
    userInfo.id,
  );
  return {
    yhtUserId,
    userId: firstText(yhtUserId, genericUserId),
    tenantId: firstText(
      value.tenantId,
      value.tenantid,
      value.currentTenantId,
      tenant.tenantId,
      tenant.id,
      currentTenant.tenantId,
      currentTenant.id,
      user.tenantId,
    ),
    environment: firstText(value.environment, value.env, value.envId, environmentFromUrl(baseUrl)),
  };
}

export function buildRuntimeIdentity({ profileDir, userId, tenantId, environment = "managed-yonwork" } = {}) {
  const normalizedProfileDir = resolve(requiredText(profileDir, "profileDir"));
  const normalizedUserId = requiredText(userId, "userId");
  const normalizedTenantId = requiredText(tenantId, "tenantId");
  const normalizedEnvironment = firstText(environment, "managed-yonwork");
  const profileKey = hashIdentityPart("profile", normalizedProfileDir);
  const userKey = hashIdentityPart("user", normalizedUserId);
  const tenantKey = hashIdentityPart("tenant", normalizedTenantId);
  const dataScopeKey = hashIdentityPart(
    "scope",
    `${profileKey}\0${normalizedEnvironment}\0${userKey}\0${tenantKey}`,
  );
  return {
    schemaVersion: 2,
    profileKey,
    userKey,
    tenantKey,
    dataScopeKey,
    scopeKey: dataScopeKey,
    environment: normalizedEnvironment,
  };
}

export function scopeDataDir(dataRoot, identity) {
  const root = resolve(requiredText(dataRoot, "dataRoot"));
  for (const field of ["profileKey", "userKey", "tenantKey", "dataScopeKey"]) {
    if (!/^[a-f0-9]{64}$/.test(String(identity?.[field] || ""))) {
      throw new RuntimeIdentityError(buildIssue(
        "IDENTITY_SCOPE_INVALID",
        `身份作用域缺少有效的 ${field}`,
        "当前身份数据目录无效，请重新进入智能待办。",
        { category: "identity", httpStatus: 503, retryable: false },
      ));
    }
  }
  return join(
    root,
    "scopes",
    identity.profileKey,
    identity.userKey,
    identity.tenantKey,
    identity.dataScopeKey,
  );
}

export function identityMatchesState(identity, state) {
  const stamped = state?.meta?.identity || state?.identity || {};
  const stampedScope = stamped.dataScopeKey || stamped.scopeKey || state?.meta?.dataScopeKey || "";
  return !!(identity?.dataScopeKey && stampedScope && identity.dataScopeKey === stampedScope);
}

export function clearBipCliCaches(cliPath = null) {
  clearBipCliCapabilityCache(cliPath);
}

function assertCommandResult(result, command) {
  const statuses = [
    result?.status,
    result?._httpStatus,
    result?.code,
    result?.errcode,
  ].map(Number).filter(Number.isFinite);
  const failureStatus = statuses.find((status) => status >= 400);
  const flagFailed = Object.hasOwn(result || {}, "flag") && result.flag !== 0 && result.flag !== "0";
  if (result?.success === false || result?.error || failureStatus !== undefined || flagFailed) {
    const error = new Error(result?.message || result?.error || `${command} failed`);
    error.result = result;
    error.status = statuses.includes(401) ? 401 : failureStatus;
    throw error;
  }
  return result;
}

function assertStableIdentity(before, after, listResult) {
  const beforeKey = `${before.environment}\0${before.yhtUserId}`;
  const afterKey = `${after.environment}\0${after.yhtUserId}`;
  if (beforeKey !== afterKey) {
    throw new RuntimeIdentityError(buildIssue(
      "IDENTITY_CHANGED_DURING_PROBE",
      "YonWork 用户或租户在身份探测期间发生变化",
      "检测到用户或租户已切换，请重新刷新。",
      { category: "identity", httpStatus: 409 },
    ));
  }
  const listTenantId = firstText(
    listResult?.currentTenantId,
    listResult?.data?.currentTenantId,
    listResult?.result?.currentTenantId,
  );
  if (!listTenantId) {
    throw new RuntimeIdentityError(buildIssue(
      "IDENTITY_INCOMPLETE",
      "list-inbox 未返回 currentTenantId",
      "无法确认当前租户，请在 YonWork 中重新选择租户后刷新。",
      { category: "identity", httpStatus: 503 },
    ));
  }
  const whoamiTenantIds = [before.tenantId, after.tenantId].filter(Boolean);
  if (whoamiTenantIds.some((tenantId) => tenantId !== listTenantId)) {
    throw new RuntimeIdentityError(buildIssue(
      "TENANT_CONTEXT_MISMATCH",
      "whoami 与 list-inbox 返回的当前租户不一致",
      "检测到租户已切换，请重新刷新。",
      { category: "identity", httpStatus: 409 },
    ));
  }
}

function resolveStableEnvironment(before, after, listEnvironment, fallbackEnvironment) {
  const beforeEnvironment = firstText(before.environment);
  const afterEnvironment = firstText(after.environment);
  const inboxEnvironment = firstText(listEnvironment);

  if (
    beforeEnvironment
    && afterEnvironment
    && environmentComparisonKey(beforeEnvironment) !== environmentComparisonKey(afterEnvironment)
  ) {
    throw new RuntimeIdentityError(buildIssue(
      "IDENTITY_CHANGED_DURING_PROBE",
      "YonWork 环境在身份探测期间发生变化",
      "检测到运行环境已切换，请重新刷新。",
      { category: "identity", httpStatus: 409 },
    ));
  }

  const whoamiEnvironment = firstText(beforeEnvironment, afterEnvironment);
  if (
    whoamiEnvironment
    && inboxEnvironment
    && environmentComparisonKey(whoamiEnvironment) !== environmentComparisonKey(inboxEnvironment)
  ) {
    throw new RuntimeIdentityError(buildIssue(
      "ENVIRONMENT_CONTEXT_MISMATCH",
      "whoami 与 list-inbox 返回的 YonBIP 环境不一致",
      "检测到运行环境不一致，请重新进入智能待办后刷新。",
      { category: "identity", httpStatus: 409 },
    ));
  }

  return firstText(whoamiEnvironment, inboxEnvironment, fallbackEnvironment);
}

function assertManagedHostContext(env) {
  if (String(env.YONCLAW_REQ_PROXY_BASE_URL || "").trim()) return;
  const error = new Error("缺少 YONCLAW_REQ_PROXY_BASE_URL，无法使用当前 YonWork 托管认证上下文");
  error.code = "HOST_AUTH_CONTEXT_MISSING";
  throw new RuntimeIdentityError(issueFromError(error), { cause: error });
}

async function runProbe({ runner, cliPath, profileDir, environment, pageSize, runOptions }) {
  const beforeResult = assertCommandResult(await runner("whoami", {}, runOptions), "whoami");
  const before = normalizeWhoamiIdentity(beforeResult);
  before.yhtUserId = requiredText(before.yhtUserId, "yhtUserId");
  before.userId = before.yhtUserId;

  const listResult = assertCommandResult(await runner(
    "workflow inboxtask list-inbox",
    { pageSize },
    runOptions,
  ), "workflow inboxtask list-inbox");

  const afterResult = assertCommandResult(await runner("whoami", {}, runOptions), "whoami");
  const after = normalizeWhoamiIdentity(afterResult);
  after.yhtUserId = requiredText(after.yhtUserId, "yhtUserId");
  after.userId = after.yhtUserId;
  const listEnvironment = environmentFromListResult(listResult);
  const resolvedEnvironment = resolveStableEnvironment(before, after, listEnvironment, environment);
  if (!resolvedEnvironment) {
    throw new RuntimeIdentityError(buildIssue(
      "CLI_PROFILE_UNBOUND",
      "whoami 与 list-inbox 均未返回可绑定当前 Profile 的 YonBIP environment/baseUrl",
      "无法确认当前 YonWork 环境，请重新进入智能待办。",
      { category: "service-context", httpStatus: 503, retryable: true },
    ));
  }
  before.environment = resolvedEnvironment;
  after.environment = resolvedEnvironment;
  assertStableIdentity(before, after, listResult);
  const tenantId = firstText(
    listResult?.currentTenantId,
    listResult?.data?.currentTenantId,
    listResult?.result?.currentTenantId,
  );
  before.tenantId = tenantId;

  return {
    rawIdentity: before,
    identity: buildRuntimeIdentity({
      profileDir,
      userId: before.yhtUserId,
      tenantId,
      environment: before.environment,
    }),
    listResult,
    cliPath,
  };
}

export async function verifyManagedCliIdentity(options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  assertManagedHostContext(env);

  let cliPath;
  try {
    cliPath = resolveApproveInboxBipCliPath({
      ...options,
      env,
      runtimeMode: MANAGED_AUTH_MODE,
    });
  } catch (error) {
    throw new RuntimeIdentityError(issueFromError(error), { cause: error });
  }

  const profileDir = resolve(firstText(options.profileDir, profileDirFromCliPath(cliPath)));
  const expectedCliPath = join(
    profileDir,
    "userData",
    "runtime",
    "openclaw",
    "skills",
    "iuap-apcom-cli",
    "scripts",
    "bip-cli.js",
  );
  if (resolve(cliPath) !== resolve(expectedCliPath)) {
    throw new RuntimeIdentityError(buildIssue(
      "PROFILE_CLI_MISMATCH",
      "iuap-apcom-cli 不属于当前 YonWork Profile",
      "智能待办服务与当前 YonWork Profile 不一致，请重新进入智能待办。",
      { category: "service-context", httpStatus: 409 },
    ));
  }

  const runner = options.runBipCli || runBipCli;
  const clearCaches = options.clearCaches || clearBipCliCaches;
  const runOptions = {
    ...(options.runOptions || {}),
    cliPath,
    env,
    runtimeMode: MANAGED_AUTH_MODE,
  };
  const environment = firstText(options.environment, env.APPROVE_INBOX_ENV, env.YONBIP_ENV);
  const pageSize = Number(options.pageSize) > 0 ? Number(options.pageSize) : 200;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const report = await runProbe({ runner, cliPath, profileDir, environment, pageSize, runOptions });
      return {
        success: true,
        identity: report.identity,
        rawIdentity: report.rawIdentity,
        listResult: report.listResult,
        cliPath,
        authMode: MANAGED_AUTH_MODE,
        attempts: attempt,
      };
    } catch (error) {
      if (isUnauthorizedError(error) && attempt === 1) {
        clearCaches(cliPath);
        continue;
      }
      const issue = issueFromError(error, { exhausted: isUnauthorizedError(error) });
      throw new RuntimeIdentityError(issue, { cause: error });
    }
  }
  throw new RuntimeIdentityError(issueFromError(new Error("HTTP 401"), { exhausted: true }));
}
