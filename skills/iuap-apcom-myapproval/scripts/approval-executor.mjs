import { detectType } from "./bill-utils.mjs";
import { parseWebUrl } from "./fetch-bill-detail.mjs";
import { hasExplicitFailure, isStrictApiSuccess, itemPrimaryId } from "./approval-utils.mjs";
import { runBipCli } from "./bip-cli-client.mjs";
import { resolveHandler } from "./doc-handlers/index.mjs";
import { hasRequestedAction, normalizeObservedActions } from "./observed-actions.mjs";

const SCRIPT_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.APPROVE_INBOX_APPROVAL_TIMEOUT_MS || 60_000),
);
const ACTION_REFRESH_TIMEOUT_MS = Math.max(
  3_000,
  Number(process.env.APPROVE_INBOX_ACTION_REFRESH_TIMEOUT_MS || 15_000),
);
const APPROVAL_ACTIONS = new Set(["approve", "reject", "return"]);

function authorizationIssueFromError(error) {
  const text = [error?.message, error?.stderr, error?.stdout].filter(Boolean).join(" ");
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
  if (!statuses.includes(401) && !/(?:HTTP\s*)?401\b|unauthori[sz]ed|获取\s*secret\s*失败[^\n]*401/i.test(text)) return null;
  return {
    category: "auth",
    code: "AUTH_REQUIRED_IN_YONWORK",
    errorCode: "AUTH_REQUIRED_IN_YONWORK",
    userMessage: "YonWork 登录状态已失效，请在 YonWork 中重新登录后刷新。",
    httpStatus: 401,
    retryable: true,
    recovery: { action: "login-in-yonwork", label: "在 YonWork 中重新登录" },
  };
}

function authorizationIssueFromResult(result = {}) {
  if (!result || typeof result !== "object") return null;
  const statuses = [
    result.errcode,
    result.code,
    result.status,
    result._httpStatus,
  ].map(Number).filter(Number.isFinite);
  const text = [result.message, result.error, result.msg].filter(Boolean).join(" ");
  if (statuses.includes(401) || /(?:HTTP\s*)?401\b|unauthori[sz]ed|获取\s*secret\s*失败[^\n]*401/i.test(text)) {
    return authorizationIssueFromError({ status: 401, message: text || "HTTP 401" });
  }
  const nested = [result.results, result.bills].find(Array.isArray) || [];
  for (const entry of nested) {
    const issue = authorizationIssueFromResult(entry);
    if (issue) return issue;
  }
  return null;
}

function isConfirmedPreRequestCliFailure(error) {
  if (error?.remoteRequestStarted === false) return true;
  return /(?:^|\n)error:\s*(?:unknown option|unknown command|too many arguments|required option|missing required argument)|依赖能力不兼容|未找到 .*iuap-apcom-cli|CLI 路径必须是绝对路径|iuap-apcom-cli 启动失败/i.test(
    [error?.message, error?.stderr, error?.stdout].filter(Boolean).join("\n"),
  );
}

function isConfirmedRemoteSuccess(result) {
  const nested = Array.isArray(result?.results)
    ? result.results
    : (Array.isArray(result?.bills) ? result.bills : []);
  if (nested.length > 0) return nested.every((entry) => isStrictApiSuccess(entry));
  if (isStrictApiSuccess(result)) return true;
  return Number(result?.successCount) > 0
    && Number(result?.failCount || 0) === 0
    && Array.isArray(result?.primaryIds)
    && result.primaryIds.length === Number(result.successCount);
}

function approvalFailure(base, error) {
  return {
    ...base,
    success: false,
    error: error?.message || String(error),
    ...(error?.code || error?.issue?.code ? { code: error.code || error.issue.code } : {}),
    ...(error?.issue ? { issue: error.issue } : {}),
    ...(error?.remoteCommitted === true ? { remoteCommitted: true } : {}),
    ...(error?.remoteOutcomeUnknown === true ? { remoteOutcomeUnknown: true } : {}),
    ...(error?.remoteOutcome ? { remoteOutcome: error.remoteOutcome } : {}),
  };
}

function successIdsFromResult(result) {
  const ids = new Set();
  const nested = Array.isArray(result?.results)
    ? result.results
    : (Array.isArray(result?.bills) ? result.bills : null);
  // When per-item results are present they are authoritative. Top-level primaryIds
  // commonly echo every requested id and must never turn a failed row into success.
  if (!nested) {
    if (Array.isArray(result?.successIds)) {
      for (const id of result.successIds) ids.add(String(id));
    }
    if (Array.isArray(result?.primaryIds)) {
      for (const id of result.primaryIds) ids.add(String(id));
    }
    if (Array.isArray(result?.completed)) {
      for (const id of result.completed) ids.add(String(id));
    }
  }
  if (Array.isArray(nested)) {
    for (const row of nested) {
      if (row?.success === true || row?.success === "true") {
        const id = row.primaryId || row.id;
        if (id) ids.add(String(id));
      }
    }
  }
  return [...ids];
}

function hasExactSuccessMapping(result, pairs = []) {
  const nested = Array.isArray(result?.results)
    ? result.results
    : (Array.isArray(result?.bills) ? result.bills : null);
  if (nested?.some((row) => isStrictApiSuccess(row) && !(row.primaryId || row.id))) return false;

  const explicitIds = successIdsFromResult(result);
  if (explicitIds.length === 0) return false;

  const pairByRemoteId = new Map();
  for (const pair of pairs) {
    for (const id of new Set([pair.executionId, pair.itemId, pair.taskId].filter(Boolean).map(String))) {
      const owners = pairByRemoteId.get(id) || new Set();
      owners.add(pair.itemId);
      pairByRemoteId.set(id, owners);
    }
  }

  const mappedItemIds = new Set();
  for (const id of explicitIds) {
    const owners = pairByRemoteId.get(String(id));
    if (!owners || owners.size !== 1) return false;
    mappedItemIds.add([...owners][0]);
  }
  return explicitIds.length === pairs.length && mappedItemIds.size === pairs.length;
}

function workflowTaskId(item = {}) {
  const parsed = parseWebUrl(item.webUrl || "");
  const id = item.workflowTaskId || item.taskId || item.businessKey || parsed.taskId || itemPrimaryId(item);
  return id == null ? "" : String(id);
}

function workflowPairs(items = []) {
  return items
    .map((item) => ({
      itemId: itemPrimaryId(item),
      taskId: workflowTaskId(item),
      executionId: itemPrimaryId(item),
    }))
    .filter((pair) => pair.itemId && pair.executionId);
}

function localSuccessIdsFromResult(result, pairs = []) {
  const successfulExecutionIds = new Set(successIdsFromResult(result));
  if (successfulExecutionIds.size === 0) return [];
  return pairs
    .filter((pair) => successfulExecutionIds.has(pair.executionId) || successfulExecutionIds.has(pair.itemId) || successfulExecutionIds.has(pair.taskId))
    .map((pair) => pair.itemId);
}

function workflowCommandForAction(action) {
  return action === "approve" ? "batch-approve" : "batch-reject";
}

function workflowCommandPath(command) {
  if (command === "batch-approve" || command === "batch-reject") {
    return ["workflow", "task", command];
  }
  return ["workflow", "inboxtask", command];
}

function reportApprovalPhase(deps, phase, metadata = {}) {
  try {
    deps.onPhase?.({ phase, at: new Date().toISOString(), ...metadata });
  } catch {
    // Observability must never change the remote approval outcome.
  }
}

async function runWorkflowTaskCommand(command, input, deps = {}, metadata = {}) {
  const commandPath = workflowCommandPath(command);
  const guardContext = { command, commandPath, input, ...metadata };
  if (deps.beforeDangerousCommand) {
    try {
      reportApprovalPhase(deps, "identity_precheck", { command, primaryIds: metadata.primaryIds || [] });
      await deps.beforeDangerousCommand(guardContext);
    } catch (error) {
      error.remoteOutcome = "confirmed_failed";
      error.remoteOutcomeUnknown = false;
      error.remoteRequestStarted = false;
      throw error;
    }
  }
  let result;
  try {
    reportApprovalPhase(deps, "remote_request", { command, primaryIds: metadata.primaryIds || [] });
    result = await runBipCli(
      commandPath,
      input,
      {
        dangerous: true,
        runBipCli: deps.runBipCli,
        cliPath: deps.bipCliPath,
        existsSync: deps.existsSync,
        env: deps.env,
        timeoutMs: deps.scriptTimeoutMs || SCRIPT_TIMEOUT_MS,
        spawn: deps.spawn,
      },
    );
  } catch (error) {
    const authorizationIssue = authorizationIssueFromError(error);
    const preRequestFailure = !authorizationIssue && isConfirmedPreRequestCliFailure(error);
    const remoteTimeout = !authorizationIssue
      && !preRequestFailure
      && (error?.code === "ETIMEDOUT" || /timed?\s*out|timeout/i.test(`${error?.message || ""} ${error?.stderr || ""}`));
    if (authorizationIssue) {
      error.code = authorizationIssue.code;
      error.issue = authorizationIssue;
    } else if (remoteTimeout) {
      error.code = "APPROVAL_REMOTE_TIMEOUT";
      error.issue = {
        category: "approval",
        code: error.code,
        errorCode: error.code,
        userMessage: "远端审批请求超时，结果尚未确认，已转为待核对。",
        httpStatus: 504,
        retryable: false,
      };
    } else if (preRequestFailure && !error.code) {
      error.code = "CLI_REQUEST_REJECTED_BEFORE_SEND";
    }
    error.remoteOutcome = preRequestFailure ? "confirmed_failed" : "unknown";
    error.remoteOutcomeUnknown = !preRequestFailure;
    if (deps.afterDangerousCommand) {
      try {
        reportApprovalPhase(deps, "identity_postcheck", { command, primaryIds: metadata.primaryIds || [] });
        await deps.afterDangerousCommand({
          ...guardContext,
          error,
          remoteRequestStarted: !preRequestFailure,
          remoteOutcomeUnknown: !preRequestFailure,
        });
      } catch (identityError) {
        if (authorizationIssue) {
          error.postGuardError = identityError;
          throw error;
        }
        identityError.remoteOutcome = preRequestFailure ? "confirmed_failed" : "unknown";
        identityError.remoteOutcomeUnknown = !preRequestFailure;
        identityError.remoteRequestStarted = !preRequestFailure;
        identityError.remoteError = error;
        throw identityError;
      }
    }
    throw error;
  }
  if (deps.afterDangerousCommand) {
    try {
      reportApprovalPhase(deps, "identity_postcheck", { command, primaryIds: metadata.primaryIds || [] });
      await deps.afterDangerousCommand({ ...guardContext, result });
    } catch (error) {
      error.remoteOutcome = isStrictApiSuccess(result)
        ? "confirmed_committed"
        : (hasExplicitFailure(result) ? "confirmed_failed" : "unknown");
      error.remoteCommitted = error.remoteOutcome === "confirmed_committed";
      error.remoteOutcomeUnknown = error.remoteOutcome === "unknown";
      error.remoteResult = result;
      throw error;
    }
  }
  const authorizationIssue = authorizationIssueFromResult(result);
  if (authorizationIssue) {
    const error = new Error(authorizationIssue.userMessage);
    error.code = authorizationIssue.code;
    error.issue = authorizationIssue;
    error.remoteOutcome = "confirmed_failed";
    throw error;
  }
  if (!isConfirmedRemoteSuccess(result) && !hasExplicitFailure(result)) {
    const error = new Error("审批 CLI 返回无法确认的远端结果");
    error.code = "APPROVAL_REMOTE_OUTCOME_UNKNOWN";
    error.remoteOutcome = "unknown";
    error.remoteOutcomeUnknown = true;
    error.remoteResult = result;
    throw error;
  }
  return result;
}

async function runWorkflowBatch(taskIds, opts, deps = {}) {
  return runWorkflowTaskCommand(
    workflowCommandForAction(opts.action),
    {
      primaryIds: JSON.stringify(taskIds),
      content: opts.comment || (opts.action === "approve" ? "同意" : "不同意"),
    },
    deps,
    { primaryIds: taskIds.map(String) },
  );
}

function detectApprovalFramework(item = {}, detail = {}) {
  const webUrl = item.webUrl || "";
  const parsed = parseWebUrl(webUrl);
  const params = new URLSearchParams(webUrl.split("?").slice(1).join("?"));
  if (params.get("apptype") === "ynf" || webUrl.includes("/mdf-node/fragment/") || detail?.richDetail?.framework === "ynf") {
    return "ynf";
  }
  if (detail?.iformData || detail?.richDetail?.raw?.kind === "iform" || parsed.kind === "iform" || webUrl.includes("yonbip-ec-iform")) {
    return "iform";
  }
  if (parsed.kind === "voucher" || detail?.billDetail || detail?.richDetail?.framework === "mdf") return "mdf";
  return "unknown";
}

function isPatchItem(item = {}, detail = {}) {
  return detectType(item) === "patch" || detail?.meta?.type === "patch" || detail?.richDetail?.docType === "patch";
}

function unavailableActionMessage(item = {}, requestedAction = "approve") {
  const actionText = requestedAction === "approve" ? "通过" : "退回/驳回";
  const title = item.title ? `「${item.title}」` : "当前待办";
  return `${title}没有可执行的${actionText}按钮，已阻止真实审批调用`;
}

async function refreshActionsForItem(item = {}, detail = {}, opts = {}, deps = {}) {
  try {
    const customRefresh = deps.refreshActions || opts.refreshActions;
    if (customRefresh) {
      const refreshed = await customRefresh({ item, detail, action: opts.action, opts });
      const actions = Array.isArray(refreshed) ? refreshed : refreshed?.actions;
      return {
        actions: normalizeObservedActions(actions || [], {
          source: refreshed?.source || "refreshActions",
          observedAt: refreshed?.observedAt || new Date().toISOString(),
          requiresRefresh: false,
        }),
      };
    }
    const refreshed = await runBipCli(
      ["workflow", "inboxtask", "list-action"],
      {
        taskId: workflowTaskId(item),
        todoId: itemPrimaryId(item),
        webUrl: item.webUrl || "",
      },
      {
        runBipCli: deps.runBipCli,
        cliPath: deps.bipCliPath,
        existsSync: deps.existsSync,
        env: deps.env,
        timeoutMs: deps.actionRefreshTimeoutMs || ACTION_REFRESH_TIMEOUT_MS,
        spawn: deps.spawn,
      },
    );
    const authorizationIssue = authorizationIssueFromResult(refreshed);
    if (authorizationIssue) {
      const error = new Error(authorizationIssue.userMessage);
      error.code = authorizationIssue.code;
      error.issue = authorizationIssue;
      throw error;
    }
    const hasCliActions = Array.isArray(refreshed?.actions);
    const cliActions = hasCliActions ? refreshed.actions : [];
    if (hasCliActions) {
      return {
        actions: normalizeObservedActions(cliActions, {
          source: refreshed?.source || "workflow.inboxtask.list-action",
          observedAt: refreshed?.observedAt || new Date().toISOString(),
          requiresRefresh: false,
        }),
      };
    }
    const handler = resolveHandler(item);
    const legacyRefreshed = handler.refreshActions
      ? await handler.refreshActions({ action: opts.action, observedAt: new Date().toISOString() }, item, detail)
      : { actions: [] };
    const actions = Array.isArray(legacyRefreshed) ? legacyRefreshed : legacyRefreshed?.actions;
    return {
      actions: normalizeObservedActions(actions || [], {
        source: legacyRefreshed?.source || handler.id || "handler",
        observedAt: legacyRefreshed?.observedAt || new Date().toISOString(),
        requiresRefresh: false,
      }),
    };
  } catch (e) {
    const issue = e?.issue || authorizationIssueFromError(e);
    return {
      error: e.message || String(e),
      actions: [],
      ...(issue ? { code: issue.code, issue } : {}),
    };
  }
}

function strategyFromLegacyDetection(item = {}, detail = {}) {
  const framework = detectApprovalFramework(item, detail);
  if (framework === "mdf" && isPatchItem(item, detail)) return { kind: "patch-save-then-batch" };
  if (framework === "mdf") return { kind: "batch" };
  if (framework === "iform") return { kind: "iform-audit" };
  if (framework === "ynf") return { kind: "unsupported", reason: "YNF 第一阶段仅支持详情与元数据抓取，暂不执行真实审批" };
  return { kind: "unsupported", reason: "无法识别审批单据类型" };
}

function approvalStrategyForItem(item = {}, detail = {}, opts = {}, deps = {}) {
  if (deps.approvalStrategy) return deps.approvalStrategy({ item, detail, action: opts.action, opts });
  const handler = resolveHandler(item);
  if (handler.approvalStrategy) {
    return handler.approvalStrategy({ action: opts.action }, item, detail) || strategyFromLegacyDetection(item, detail);
  }
  return strategyFromLegacyDetection(item, detail);
}

async function executeMdfBatch(items, opts, deps = {}) {
  const pairs = workflowPairs(items);
  const ids = pairs.map((pair) => pair.itemId);
  const taskIds = pairs.map((pair) => pair.taskId);
  const executionIds = pairs.map((pair) => pair.executionId);
  if (pairs.length === 0) {
    return { type: "mdf", ids: [], count: 0, success: false, error: "No valid primary IDs" };
  }

  try {
    const result = await runWorkflowBatch(executionIds, opts, deps);
    const successIds = localSuccessIdsFromResult(result, pairs);
    if (isConfirmedRemoteSuccess(result) && !hasExactSuccessMapping(result, pairs)) {
      return {
        type: "mdf",
        ids,
        taskIds,
        executionIds,
        successIds: [],
        remoteConfirmedIds: successIds,
        count: ids.length,
        result,
        success: false,
        remoteCommitted: true,
        remoteOutcome: "confirmed_committed",
        error: "远端返回成功但无法精确映射全部审批任务",
      };
    }
    return {
      type: "mdf",
      ids,
      taskIds,
      executionIds,
      successIds,
      count: ids.length,
      result,
      success: !hasExplicitFailure(result) && successIds.length === ids.length,
    };
  } catch (e) {
    return approvalFailure({ type: "mdf", ids, count: ids.length }, e);
  }
}

async function executePatchBatch(items, opts, deps = {}) {
  const pairs = workflowPairs(items);
  const ids = pairs.map((pair) => pair.itemId);
  const taskIds = pairs.map((pair) => pair.taskId);
  const executionIds = pairs.map((pair) => pair.executionId);
  if (pairs.length === 0) {
    return { type: "patch", ids: [], count: 0, success: false, error: "No valid primary IDs" };
  }
  try {
    if (opts.action !== "approve") {
      const result = await runWorkflowBatch(executionIds, opts, deps);
      const successIds = localSuccessIdsFromResult(result, pairs);
      if (isConfirmedRemoteSuccess(result) && !hasExactSuccessMapping(result, pairs)) {
        return {
          type: "patch",
          ids,
          taskIds,
          executionIds,
          successIds: [],
          remoteConfirmedIds: successIds,
          count: ids.length,
          result,
          success: false,
          remoteCommitted: true,
          remoteOutcome: "confirmed_committed",
          error: "远端返回成功但无法精确映射全部补丁审批任务",
        };
      }
      return {
        type: "patch",
        ids,
        taskIds,
        executionIds,
        successIds,
        count: ids.length,
        result,
        success: !hasExplicitFailure(result) && successIds.length === ids.length,
      };
    }
    const bills = items.map((item) => ({
      primaryId: itemPrimaryId(item),
      title: item.title,
      taskId: workflowTaskId(item),
      billId: item.billId,
    }));
    const patchResult = await runWorkflowTaskCommand(
      "approve-patch",
      {
        bills: JSON.stringify(bills),
        comment: opts.comment || "同意",
      },
      deps,
      { primaryIds: ids },
    );
    if (hasExplicitFailure(patchResult)) {
      return { type: "patch", ids, count: ids.length, patchResult, success: false, error: `Patch save failed: ${JSON.stringify(patchResult).slice(0, 200)}` };
    }
    const savedIds = Array.isArray(patchResult.primaryIds) && patchResult.primaryIds.length
      ? patchResult.primaryIds.map(String)
      : ids;
    const successIds = localSuccessIdsFromResult(patchResult, pairs);
    if (isConfirmedRemoteSuccess(patchResult) && !hasExactSuccessMapping(patchResult, pairs)) {
      return {
        type: "patch",
        ids,
        taskIds,
        executionIds,
        successIds: [],
        remoteConfirmedIds: successIds,
        count: ids.length,
        patchResult,
        success: false,
        remoteCommitted: true,
        remoteOutcome: "confirmed_committed",
        error: "远端返回成功但无法精确映射全部补丁审批任务",
      };
    }
    return {
      type: "patch",
      ids,
      taskIds,
      executionIds,
      successIds,
      count: ids.length,
      patchResult,
      success: !hasExplicitFailure(patchResult) && successIds.length === savedIds.length,
    };
  } catch (e) {
    return approvalFailure({ type: "patch", ids, count: ids.length }, e);
  }
}

// 并发池：worker 并发执行但结果按输入顺序返回，保证归组/结果顺序稳定、单条失败隔离。
async function mapWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  let cursor = 0;
  const runner = async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(list[index], index);
    }
  };
  const lanes = Math.min(Math.max(1, Number(concurrency) || 1), list.length || 1);
  await Promise.all(Array.from({ length: lanes }, () => runner()));
  return results;
}

// 审批前刷新(list-action)是闸门而非提交数据源(batch 提交只用 taskId/itemId)。
// 该命令为 beta,已出现过"接口有按钮但刷新返回空数组"的确定性缺陷(2026-07-16,
// CLI 内部投影丢失 buttons 字段),因此干净的空结果不视为权威:此时回退到最近一次
// 消息中心同步观测到的按钮快照放行,真正的权限判定交给远端提交结果。
// 刷新报错(超时/鉴权)不回退;非空结果视为权威。APPROVE_INBOX_ACTION_REFRESH_STRICT=1 恢复严格闸门。
function snapshotFallbackActions(item = {}, refreshed = {}, opts = {}) {
  if (process.env.APPROVE_INBOX_ACTION_REFRESH_STRICT === "1") return null;
  if (refreshed.error) return null;
  if (Array.isArray(refreshed.actions) && refreshed.actions.length > 0) return null;
  // 取并集:服务端在记录审批阶段时会清空持久化的 runtimeActions(隐藏处理中条目的按钮),
  // 但 observedActions 保留;两者取并集才能在后台 job 里稳定拿到同步快照。
  const snapshot = normalizeObservedActions(
    [...(Array.isArray(item.runtimeActions) ? item.runtimeActions : []),
      ...(Array.isArray(item.observedActions) ? item.observedActions : [])],
    { source: "sync-snapshot-fallback", requiresRefresh: false },
  );
  return hasRequestedAction(snapshot, opts.action) ? snapshot : null;
}

export async function executeApproval(items = [], opts = {}, deps = {}) {
  if (!APPROVAL_ACTIONS.has(opts.action)) {
    return {
      success: false,
      successIds: [],
      results: [{
        type: "invalid_action",
        action: opts.action ?? null,
        success: false,
        code: "INVALID_APPROVAL_ACTION",
        error: "审批动作必须显式为 approve、reject 或 return",
      }],
    };
  }
  const detailsById = opts.detailsById || new Map();
  const results = [];
  const successIds = new Set();
  const groups = { iform: [], batch: [], patch: [], unsupported: [] };

  // 先并发刷新每条的审批动作（唯一的慢 I/O：CLI list-action，单条 ≤15s），再按原顺序归组。
  // 串行时批量 N 条 ≈ N×15s；并发池压到约 ceil(N/并发)×15s。刷新只读、不碰身份闸门，
  // 危险写回前后的身份复核仍逐命令串行（见 executeMdfBatch / runWorkflowTaskCommand），并发安全。
  // 默认并发保守取 2，避免子进程放大触发远端限流/登录态竞争；可用环境变量覆盖。刷新超时保持不变。
  const REFRESH_CONCURRENCY = Math.max(1, Number(process.env.APPROVE_INBOX_REFRESH_CONCURRENCY || 2));
  const prepared = await mapWithConcurrency(items, REFRESH_CONCURRENCY, async (item) => {
    const id = itemPrimaryId(item);
    const detail = detailsById.get(id) || {};
    const initialStrategy = approvalStrategyForItem(item, detail, opts, deps) || {};
    if (initialStrategy.kind === "unsupported") {
      return { item, id, detail, initialStrategy, unsupported: true };
    }
    reportApprovalPhase(deps, "refresh_actions", { primaryIds: [id] });
    const refreshed = await refreshActionsForItem(item, detail, opts, deps);
    return { item, id, detail, initialStrategy, refreshed };
  });

  for (const prep of prepared) {
    const { item, id, detail, initialStrategy, refreshed } = prep;
    if (prep.unsupported) {
      groups.unsupported.push({ item, strategy: initialStrategy });
      continue;
    }
    if (refreshed.error) {
      results.push({
        type: "action_refresh_failed",
        primaryId: id,
        action: opts.action,
        success: false,
        error: `审批动作刷新失败：${refreshed.error}`,
        ...(refreshed.code ? { code: refreshed.code } : {}),
        ...(refreshed.issue ? { issue: refreshed.issue } : {}),
      });
      continue;
    }
    let effectiveActions = refreshed.actions;
    if (!hasRequestedAction(effectiveActions, opts.action)) {
      const fallbackActions = snapshotFallbackActions(item, refreshed, opts);
      if (fallbackActions) {
        reportApprovalPhase(deps, "refresh_fallback_snapshot", { primaryIds: [id] });
        effectiveActions = fallbackActions;
      } else {
        results.push({
          type: "unavailable",
          primaryId: id,
          action: opts.action,
          success: false,
          error: unavailableActionMessage(item, opts.action),
        });
        continue;
      }
    }
    const executableItem = { ...item, runtimeActions: effectiveActions, observedActions: effectiveActions };
    const strategy = approvalStrategyForItem(executableItem, detail, opts, deps) || initialStrategy;
    if (strategy.kind === "patch-save-then-batch") {
      groups.patch.push(executableItem);
    } else if (strategy.kind === "batch") {
      groups.batch.push(executableItem);
    } else if (strategy.kind === "iform-audit" || strategy.kind === "iform-assign-then-audit") {
      groups.iform.push(executableItem);
    } else {
      groups.unsupported.push({ item: executableItem, strategy });
    }
  }

  if (groups.iform.length > 0) {
    for (const item of groups.iform) {
      const id = itemPrimaryId(item);
      try {
        const command = opts.action === "approve" ? "approve-iform" : "reject-iform";
        const input = opts.action === "approve"
          ? {
              webUrl: item.webUrl || "",
              comment: opts.comment || "同意",
              ...(Object.keys(opts.fieldAssignments || {}).length > 0
                ? { fieldAssignments: JSON.stringify(opts.fieldAssignments) }
                : {}),
            }
          : {
              webUrl: item.webUrl || "",
              comment: opts.comment || "不同意",
              rejectTarget: String(opts.rejectTarget || "-1"),
              selectedByRejecter: String(opts.selectedByRejecter ?? "0"),
            };
        const result = await runWorkflowTaskCommand(command, input, deps, { primaryIds: [id] });
        const success = isConfirmedRemoteSuccess(result) && hasExactSuccessMapping(result, [{
          itemId: id,
          taskId: workflowTaskId(item),
          executionId: id,
        }]);
        if (success) successIds.add(id);
        results.push({
          type: "iform",
          primaryId: id,
          action: opts.action,
          result,
          success,
          ...(!success && isConfirmedRemoteSuccess(result)
            ? {
                remoteCommitted: true,
                remoteOutcome: "confirmed_committed",
                error: "远端返回成功但未提供可精确映射的审批结果",
              }
            : {}),
        });
      } catch (e) {
        results.push(approvalFailure({ type: "iform", primaryId: id, action: opts.action }, e));
      }
    }
  }

  if (groups.batch.length > 0) {
    try {
      const result = await executeMdfBatch(groups.batch, opts, deps);
      for (const id of result.successIds || []) successIds.add(id);
      results.push(result);
    } catch (e) {
      results.push({ type: "mdf", ids: groups.batch.map(itemPrimaryId), count: groups.batch.length, success: false, error: e.message || String(e) });
    }
  }

  if (groups.patch.length > 0) {
    try {
      const result = await executePatchBatch(groups.patch, opts, deps);
      for (const id of result.successIds || []) successIds.add(id);
      results.push(result);
    } catch (e) {
      results.push({ type: "patch", ids: groups.patch.map(itemPrimaryId), count: groups.patch.length, success: false, error: e.message || String(e) });
    }
  }

  for (const { item, strategy } of groups.unsupported) {
    const framework = detectApprovalFramework(item, detailsById.get(itemPrimaryId(item)) || {});
    results.push({
      type: framework === "ynf" ? "ynf" : "unknown",
      primaryId: itemPrimaryId(item),
      success: false,
      error: strategy?.reason || "无法识别审批单据类型",
    });
  }

  return {
    success: results.length > 0 && results.every((result) => result.success),
    successIds: [...successIds],
    results,
  };
}
