import { detectType } from "./bill-utils.mjs";
import { parseWebUrl } from "./fetch-bill-detail.mjs";
import { hasExplicitFailure, isStrictApiSuccess, itemPrimaryId } from "./approval-utils.mjs";
import { runBipCli } from "./bip-cli-client.mjs";
import { resolveHandler } from "./doc-handlers/index.mjs";
import { hasRequestedAction, normalizeObservedActions } from "./observed-actions.mjs";

const SCRIPT_TIMEOUT_MS = 180_000;

function successIdsFromResult(result, fallbackIds = []) {
  const ids = new Set();
  if (Array.isArray(result?.successIds)) {
    for (const id of result.successIds) ids.add(String(id));
  }
  if (Array.isArray(result?.primaryIds)) {
    for (const id of result.primaryIds) ids.add(String(id));
  }
  if (Array.isArray(result?.completed)) {
    for (const id of result.completed) ids.add(String(id));
  }
  const nested = result?.results || result?.bills;
  if (Array.isArray(nested)) {
    for (const row of nested) {
      if (row?.success === true || row?.success === "true") {
        const id = row.primaryId || row.id;
        if (id) ids.add(String(id));
      }
    }
  }
  const wholeBatchSucceeded =
    result?.success === true ||
    result?.success === "true" ||
    result?.flag === 0 ||
    result?.flag === "0" ||
    result?.code === 200;
  if (ids.size === 0 && !hasExplicitFailure(result) && wholeBatchSucceeded) {
    for (const id of fallbackIds) ids.add(String(id));
  }
  return [...ids];
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
  const executionIds = pairs.map((pair) => pair.executionId);
  const successfulExecutionIds = new Set(successIdsFromResult(result, executionIds));
  if (successfulExecutionIds.size === 0) return [];
  return pairs
    .filter((pair) => successfulExecutionIds.has(pair.executionId) || successfulExecutionIds.has(pair.itemId) || successfulExecutionIds.has(pair.taskId))
    .map((pair) => pair.itemId);
}

function workflowCommandForAction(action) {
  return action === "approve" ? "batch-approve" : "batch-reject";
}

async function runWorkflowTaskCommand(command, input, deps = {}) {
  return runBipCli(
    ["workflow", "task", command],
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
}

async function runWorkflowBatch(taskIds, opts, deps = {}) {
  return runWorkflowTaskCommand(
    workflowCommandForAction(opts.action),
    {
      primaryIds: JSON.stringify(taskIds),
      content: opts.comment || (opts.action === "approve" ? "同意" : "不同意"),
    },
    deps,
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
      ["workflow", "task", "action-list"],
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
        timeoutMs: deps.scriptTimeoutMs || SCRIPT_TIMEOUT_MS,
        spawn: deps.spawn,
      },
    );
    const hasCliActions = Array.isArray(refreshed?.actions);
    const cliActions = hasCliActions ? refreshed.actions : [];
    if (hasCliActions) {
      return {
        actions: normalizeObservedActions(cliActions, {
          source: refreshed?.source || "workflow.task.action-list",
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
    return { error: e.message || String(e), actions: [] };
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
    return { type: "mdf", ids, count: ids.length, success: false, error: e.message || String(e) };
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
      "patch-approve",
      {
        bills: JSON.stringify(bills),
        comment: opts.comment || "同意",
      },
      deps,
    );
    if (hasExplicitFailure(patchResult)) {
      return { type: "patch", ids, count: ids.length, patchResult, success: false, error: `Patch save failed: ${JSON.stringify(patchResult).slice(0, 200)}` };
    }
    const savedIds = Array.isArray(patchResult.primaryIds) && patchResult.primaryIds.length
      ? patchResult.primaryIds.map(String)
      : ids;
    const successIds = localSuccessIdsFromResult(patchResult, pairs);
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
    return { type: "patch", ids, count: ids.length, success: false, error: e.message || String(e) };
  }
}

export async function executeApproval(items = [], opts = {}, deps = {}) {
  const detailsById = opts.detailsById || new Map();
  const results = [];
  const successIds = new Set();
  const groups = { iform: [], batch: [], patch: [], unsupported: [] };

  for (const item of items) {
    const id = itemPrimaryId(item);
    const detail = detailsById.get(id) || {};
    const initialStrategy = approvalStrategyForItem(item, detail, opts, deps) || {};
    if (initialStrategy.kind === "unsupported") {
      groups.unsupported.push({ item, strategy: initialStrategy });
      continue;
    }
    const refreshed = await refreshActionsForItem(item, detail, opts, deps);
    if (refreshed.error) {
      results.push({
        type: "action_refresh_failed",
        primaryId: id,
        action: opts.action,
        success: false,
        error: `审批动作刷新失败：${refreshed.error}`,
      });
      continue;
    }
    if (!hasRequestedAction(refreshed.actions, opts.action)) {
      results.push({
        type: "unavailable",
        primaryId: id,
        action: opts.action,
        success: false,
        error: unavailableActionMessage(item, opts.action),
      });
      continue;
    }
    const executableItem = { ...item, runtimeActions: refreshed.actions, observedActions: refreshed.actions };
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
        const command = opts.action === "approve" ? "iform-approve" : "iform-reject";
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
        const result = await runWorkflowTaskCommand(command, input, deps);
        const success = isStrictApiSuccess(result);
        if (success) successIds.add(id);
        results.push({ type: "iform", primaryId: id, action: opts.action, result, success });
      } catch (e) {
        results.push({ type: "iform", primaryId: id, action: opts.action, success: false, error: e.message || String(e) });
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
