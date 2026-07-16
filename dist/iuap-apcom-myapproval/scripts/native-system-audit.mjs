/**
 * 查询原生智能审核规则树。
 *
 * 该端点尚未进入 iuap-apcom-cli 的签名路由表，因此通过 YonWork 托管
 * Python 中的 yonbip_skill_utils.requests 访问固定路由，继续复用当前
 * Profile 的代理认证上下文，不接收任意 URL。
 */

import { spawn } from "node:child_process";

export const NATIVE_SYSTEM_AUDIT_ROUTE = "/yonbip-mid-sscia/cloudAudit/queryCloudAuditResult";
const DEFAULT_TIMEOUT_MS = 30_000;

const PYTHON_PROGRAM = String.raw`
import json
import sys
from yonbip_skill_utils import requests

request = json.load(sys.stdin)
response = requests.post(
    url=request["url"],
    json=request["body"],
    skill_info={},
)
try:
    body = response.json()
except Exception:
    body = {"__nonJsonBody": response.text}
print(json.dumps({"httpStatus": response.status_code, "body": body}, ensure_ascii=False))
`;

function cleanText(value) {
  return String(value || "").trim();
}

export function nativeSystemAuditBusinessKey(value) {
  const key = cleanText(value);
  if (/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(key)) return key.replace(":", "_");
  return key;
}

export function buildNativeSystemAuditRequest({ businessKey } = {}) {
  return {
    url: NATIVE_SYSTEM_AUDIT_ROUTE,
    body: { businessKey: nativeSystemAuditBusinessKey(businessKey) },
  };
}

function normalizeAuditItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    auditItemId: cleanText(item?.auditItemId),
    detailResultId: cleanText(item?.detailResultId),
    type: cleanText(item?.type),
    resultDesc: cleanText(item?.resultDesc),
    pass: item?.pass === true,
  })).filter((item) => item.auditItemId || item.resultDesc);
}

function normalizeAuditPoints(points) {
  if (!Array.isArray(points)) return [];
  return points.map((point) => ({
    auditPointId: cleanText(point?.auditPointId),
    auditPointResultId: cleanText(point?.auditPointResultId),
    name: cleanText(point?.name),
    artificial: point?.artificial === true,
    pass: point?.pass === true,
    controlMode: point?.controlMode ?? null,
    status: point?.status ?? null,
    items: normalizeAuditItems(point?.items),
  })).filter((point) => point.auditPointId || point.name || point.items.length > 0);
}

export function normalizeNativeSystemAuditResponse(result, { fetchedAt = new Date().toISOString() } = {}) {
  const httpStatus = Number(result?.httpStatus || 0) || null;
  const payload = result?.body;
  if (!payload || typeof payload !== "object" || Object.hasOwn(payload, "__nonJsonBody")) {
    return {
      status: "error",
      reason: "non_json_response",
      message: "原生智能审核接口返回了非 JSON 数据",
      detailMsg: cleanText(payload?.__nonJsonBody),
      httpStatus,
      fetchedAt,
    };
  }
  if (httpStatus && (httpStatus < 200 || httpStatus >= 300)) {
    return {
      status: "error",
      reason: "http_error",
      message: cleanText(payload?.message) || `原生智能审核接口返回 HTTP ${httpStatus}`,
      detailMsg: cleanText(payload?.detailMsg),
      code: payload?.code ?? null,
      httpStatus,
      fetchedAt,
    };
  }

  const data = payload?.data;
  if (payload?.code !== 200 || !data || typeof data !== "object") {
    return {
      status: "error",
      reason: "request_failed",
      message: cleanText(payload?.message) || "原生智能审核接口请求失败",
      detailMsg: cleanText(payload?.detailMsg),
      code: payload?.code ?? null,
      httpStatus,
      fetchedAt,
    };
  }
  if (Number(data.licenseEnable) === 0) {
    return {
      status: "disabled",
      reason: "license_disabled",
      message: "当前租户未启用智能审核",
      code: payload.code,
      httpStatus,
      fetchedAt,
    };
  }

  const categories = Array.isArray(data.categories)
    ? data.categories.map((category) => ({
        categoryId: cleanText(category?.categoryId),
        name: cleanText(category?.name),
        iaPoints: normalizeAuditPoints(category?.iaPoints),
      })).filter((category) => category.categoryId || category.name || category.iaPoints.length > 0)
    : [];
  const resultDesc = cleanText(data.resultDesc);
  if (data.auditEmpty === true && !resultDesc && categories.length === 0) {
    return {
      status: "not_found",
      reason: cleanText(data?.riskCheck?.emptyReason) || "no_result",
      message: "暂未查询到智能审核结果",
      code: payload.code,
      httpStatus,
      fetchedAt,
    };
  }

  return {
    status: "success",
    source: "native-system-rules",
    code: payload.code,
    message: cleanText(payload.message),
    httpStatus,
    resultId: cleanText(data.resultId),
    queryId: cleanText(data.queryId),
    resultDesc,
    AISummaryResultDesc: cleanText(data.AISummaryResultDesc || data.aiSummaryResultDesc),
    categories,
    runtimeStatus: data.runtimeStatus ?? null,
    resultState: data.resultState ?? null,
    controlMode: data.controlMode ?? null,
    businessPart: cleanText(data.businessPart),
    startTime: cleanText(data.startTime),
    completedTime: cleanText(data.completedTime),
    taskComplete: data.taskComplete === true,
    licenseEnable: data.licenseEnable ?? null,
    fetchedAt,
  };
}

function runManagedPython(request, options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  const pythonPath = cleanText(
    options.pythonPath
      || env.YONCLAW_PYTHON_BIN
      || env.YONCLAW_MANAGED_PYTHON
      || env.OPENCLAW_PINNED_WRITE_PYTHON,
  );
  if (!pythonPath) return Promise.reject(new Error("缺少 YonWork 托管 Python 路径"));

  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = (options.spawn || spawn)(pythonPath, ["-c", PYTHON_PROGRAM], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handler(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(reject, new Error(`原生智能审核请求超时（${timeoutMs}ms）`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code) => {
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const errorText = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        finish(reject, new Error(errorText || output || `托管 Python 退出码 ${code}`));
        return;
      }
      try {
        finish(resolve, JSON.parse(output));
      } catch {
        finish(reject, new Error(`托管 Python 返回非 JSON：${output.slice(0, 200)}`));
      }
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

export async function queryNativeSystemAudit(context = {}, options = {}) {
  const fetchedAt = new Date().toISOString();
  const request = buildNativeSystemAuditRequest(context);
  if (!request.body.businessKey) {
    return {
      status: "skipped",
      reason: "missing_business_key",
      message: "缺少 businessKey，无法查询原生智能审核结果",
      fetchedAt,
    };
  }
  try {
    const runner = options.runPython || runManagedPython;
    const result = await runner(request, options);
    return normalizeNativeSystemAuditResponse(result, { fetchedAt });
  } catch (error) {
    return {
      status: "error",
      reason: /Python 路径/.test(String(error?.message || error)) ? "missing_python" : "request_failed",
      message: cleanText(error?.message || error),
      fetchedAt,
    };
  }
}
