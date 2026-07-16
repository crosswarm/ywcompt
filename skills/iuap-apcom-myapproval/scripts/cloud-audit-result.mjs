/**
 * cloud-audit-result.mjs — 查询智能审核系统预置规则结果。
 *
 * 该接口结果可能高频变化，调用方应在详情打开/刷新时实时查询，不把它当作
 * enrich 阶段的一次性落盘分析。
 */

import { runBipCli } from "./bip-cli-client.mjs";
import { queryNativeSystemAudit } from "./native-system-audit.mjs";

const DEFAULT_TIMEOUT_MS = 30_000;

function cleanText(value) {
  return String(value || "").trim();
}

export function buildCloudAuditRequestBody({ taskId, businessKey, yhtUserId } = {}) {
  const body = {
    taskId: cleanText(taskId),
    businessKey: cleanText(businessKey),
  };
  const user = cleanText(yhtUserId);
  if (user) body.yhtUserId = user;
  return body;
}

export function cloudAuditRequestReady(body = {}) {
  return !!(cleanText(body.taskId) && cleanText(body.businessKey));
}

export function cloudAuditStatusFromDisplayCode(displayCode) {
  const code = cleanText(displayCode);
  if (code === "036-503-010811") return "not_found";
  if (code === "036-503-010812") return "disabled";
  if (code === "036-503-010813") return "model_error";
  return "error";
}

export function normalizeCloudAuditResponse(payload, { fetchedAt = new Date().toISOString() } = {}) {
  const data = payload?.data;
  if (payload?.code === 200 && data && typeof data === "object") {
    return {
      status: "success",
      code: payload.code,
      message: cleanText(payload.message),
      resultId: cleanText(data.resultId),
      queryId: cleanText(data.queryId),
      resultDesc: cleanText(data.resultDesc),
      AISummaryResultDesc: cleanText(data.AISummaryResultDesc || data.aiSummaryResultDesc),
      fetchedAt,
    };
  }

  return {
    status: cloudAuditStatusFromDisplayCode(payload?.displayCode),
    code: payload?.code ?? null,
    message: cleanText(payload?.message),
    displayCode: cleanText(payload?.displayCode),
    detailMsg: cleanText(payload?.detailMsg),
    level: payload?.level,
    fetchedAt,
  };
}

export async function queryCloudAuditResult(context = {}, options = {}) {
  const fetchedAt = new Date().toISOString();
  const body = buildCloudAuditRequestBody(context);
  if (!cloudAuditRequestReady(body)) {
    return {
      status: "skipped",
      reason: "missing_params",
      message: "缺少 taskId 或 businessKey，无法查询智能审核结果",
      fetchedAt,
    };
  }

  const summaryPromise = (async () => {
    const runner = options.runBipCli || runBipCli;
    try {
      const result = await runner(
        ["workflow", "inboxtask", "get-intelligent-result"],
        body,
        {
          cliPath: options.cliPath,
          env: options.env,
          timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
        },
      );
      const normalized = result?.status
        ? result
        : normalizeCloudAuditResponse(result || {}, { fetchedAt });
      return {
        ...normalized,
        source: normalized.source || "summary",
        fetchedAt: normalized.fetchedAt || fetchedAt,
      };
    } catch (error) {
      const message = error?.message || String(error);
      return {
        status: "error",
        reason: /HTTP\s+404|status\s*404/i.test(message) ? "summary_route_unavailable" : "request_failed",
        message,
        fetchedAt,
      };
    }
  })();

  const nativeRunner = options.queryNativeSystemAudit || queryNativeSystemAudit;
  const [summary, native] = await Promise.all([
    summaryPromise,
    nativeRunner(context, {
      env: options.env,
      pythonPath: options.pythonPath,
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      runPython: options.runPython,
    }),
  ]);

  if (native?.status === "success") {
    return {
      ...native,
      source: summary?.status === "success" ? "native-system-rules+summary" : native.source,
      AISummaryResultDesc: cleanText(summary?.AISummaryResultDesc) || native.AISummaryResultDesc,
      fetchedAt,
    };
  }
  if (summary?.status === "success") {
    return { ...summary, fetchedAt };
  }
  if (native && native.status !== "error" && native.status !== "skipped") {
    return { ...native, fetchedAt };
  }
  if (summary && summary.status !== "error") {
    return { ...summary, fetchedAt };
  }

  return {
    status: "error",
    reason: native?.reason || summary?.reason || "no_audit_result",
    message: native?.message || summary?.message || "智能审核接口未返回结果",
    detailMsg: [summary?.message, native?.message].filter(Boolean).join("；"),
    fetchedAt,
  };
}
