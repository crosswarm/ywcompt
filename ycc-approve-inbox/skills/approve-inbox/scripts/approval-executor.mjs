import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { detectType } from "./bill-utils.mjs";
import { getBrowserAuth, resolveBipCliPath } from "./browser-auth.mjs";
import { detectProxy } from "./enrich-details.mjs";
import { getCookies, parseWebUrl } from "./fetch-bill-detail.mjs";
import { hasExplicitFailure, isStrictApiSuccess, itemPrimaryId } from "./approval-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPROVE_PATCHES_SCRIPT = join(__dirname, "approve-patches.mjs");
const SCRIPT_TIMEOUT_MS = 180_000;

function proxyUrl() {
  return process.env.APPROVE_INBOX_PROXY || "";
}

function baseUrl() {
  return proxyUrl() || process.env.APPROVE_INBOX_BASE || "https://c1.yonyoucloud.com";
}

function formEncode(obj) {
  return Object.entries(obj)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(typeof value === "object" ? JSON.stringify(value) : value ?? "")}`)
    .join("&");
}

function parseWorkflowParams(webUrl = "") {
  let params;
  try {
    params = new URL(webUrl).searchParams;
  } catch {
    params = new URLSearchParams(webUrl.split("?").slice(1).join("?"));
  }
  return {
    processInstanceId: params.get("processInstanceId") || params.get("processInstId"),
    processDefinitionId: params.get("processDefinitionId") || params.get("processDefId"),
    activityId: params.get("activityId"),
    formId: params.get("formId") || params.get("pkBo"),
    formInstanceId: params.get("formInstanceId") || params.get("pkBoins"),
    tenantId: params.get("tenantId"),
    taskId: params.get("taskId") || params.get("id"),
  };
}

function buildHeaders(creds = {}) {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    Referer: "https://c1.yonyoucloud.com/",
    Origin: "https://c1.yonyoucloud.com",
  };
  if (creds.cookieStr) headers.Cookie = creds.cookieStr;
  if (creds.xsrfToken) headers["X-XSRF-TOKEN"] = creds.xsrfToken;
  if (creds.yhtToken) headers.yhtToken = creds.yhtToken;
  return headers;
}

async function safeJson(resp) {
  const text = await resp.text();
  if (!text.trim()) {
    return { success: false, _httpStatus: resp.status, error: `Empty response (HTTP ${resp.status})` };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, _httpStatus: resp.status, error: `Non-JSON response (HTTP ${resp.status}): ${text.slice(0, 200)}` };
  }
}

function formatDateTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const SKIP_IFORM_HEAD_FIELDS = new Set(["dr", "sysversion", "pk_temp", "pk_procdef", "pk_procdefins", "status", "version"]);
const SKIP_IFORM_BODY_FIELDS = new Set(["dr", "version", "ytenant_id", "createuser", "pk_sub_bo", "subFormId", "dept"]);

function buildIformDatas(iformData, formInstanceId, fieldAssignments = {}) {
  const head = {};
  const keyFeature = {};
  if (formInstanceId) {
    head.pk_boins = formInstanceId;
    keyFeature.pk_boins = formInstanceId;
  }
  for (const [fieldId, val] of Object.entries(iformData?.head || {})) {
    if (SKIP_IFORM_HEAD_FIELDS.has(fieldId)) continue;
    if (val && typeof val === "object") {
      head[fieldId] = val.pk ?? val.value ?? val.name;
      keyFeature[fieldId] = val.name ?? val.value ?? val.pk;
    } else if (val != null) {
      head[fieldId] = val;
      keyFeature[fieldId] = val;
    }
  }
  for (const [fieldId, val] of Object.entries(fieldAssignments || {})) {
    if (val && typeof val === "object") {
      head[fieldId] = val.pk ?? val.value ?? val.name;
      keyFeature[fieldId] = val.name ?? val.value ?? val.pk;
    } else {
      head[fieldId] = val;
      keyFeature[fieldId] = val;
    }
  }
  const now = formatDateTime(new Date());
  head.modifydate = now;
  keyFeature.modifydate = now;

  const body = {};
  const rows = iformData?.body?.bodys;
  if (Array.isArray(rows)) {
    for (const [idx, row] of rows.entries()) {
      const bodyRow = {};
      for (const [fieldId, val] of Object.entries(row || {})) {
        if (SKIP_IFORM_BODY_FIELDS.has(fieldId)) continue;
        if (val && typeof val === "object" && val.pk !== undefined) bodyRow[fieldId] = val.pk;
        else if (val != null && typeof val !== "object") bodyRow[fieldId] = String(val);
      }
      body[`row${idx}`] = bodyRow;
    }
  }
  return { head, keyFeature, body, subShowValues: {} };
}

async function resolveAuth(deps = {}) {
  if (deps.getBrowserAuth) return deps.getBrowserAuth();
  if (!deps.getCookies) {
    try {
      return await getBrowserAuth({ log: deps.log });
    } catch {
      // Fall through to the legacy YonClaw proxy/cookie helper below.
    }
  }
  if (!proxyUrl()) {
    const detected = deps.detectProxy ? await deps.detectProxy() : await detectProxy();
    if (detected) process.env.APPROVE_INBOX_PROXY = detected;
  }
  const creds = deps.getCookies ? await deps.getCookies() : await getCookies();
  if (!creds || (!creds.cookieStr && !creds.proxy && !proxyUrl())) {
    throw new Error("未取到 YonBIP 登录态或 YonClaw 代理");
  }
  return creds;
}

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

async function readJsonResponse(resp, label = "Workflow API") {
  const status = Number(resp?.status || 0);
  const ok = resp?.ok !== false && (!status || status < 400);
  const text = typeof resp?.text === "function"
    ? await resp.text()
    : (typeof resp?.json === "function" ? JSON.stringify(await resp.json()) : "");
  if (!String(text || "").trim()) {
    return { success: false, _httpStatus: status, error: `${label} returned empty response (HTTP ${status || "unknown"})` };
  }
  try {
    const json = JSON.parse(text);
    if (!ok) return { ...json, success: false, _httpStatus: status };
    return { ...json, _httpStatus: status || 200 };
  } catch {
    return {
      success: false,
      _httpStatus: status,
      error: `${label} returned non-JSON response (HTTP ${status || "unknown"}): ${String(text).replace(/\s+/g, " ").slice(0, 200)}`,
    };
  }
}

async function runNodeScript(scriptPath, args = [], deps = {}) {
  if (deps.runNodeScript) return deps.runNodeScript(scriptPath, args);
  const exists = deps.existsSync || existsSync;
  if (!exists(scriptPath)) {
    throw new Error(`脚本不存在: ${scriptPath}`);
  }
  const exec = deps.execFile || execFile;
  return new Promise((resolve, reject) => {
    exec(
      process.execPath,
      [scriptPath, ...args],
      { timeout: deps.scriptTimeoutMs || SCRIPT_TIMEOUT_MS, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
      (err, stdout = "", stderr = "") => {
        const text = String(stdout || "").trim();
        if (err) {
          if (text) {
            try {
              resolve(JSON.parse(text));
              return;
            } catch {
              // fall through to process-level error
            }
          }
          reject(new Error(stderr.trim() || err.message));
          return;
        }
        if (!text) {
          resolve({ success: true });
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error(`脚本返回非 JSON: ${text.slice(0, 200)}`));
        }
      },
    );
  });
}

function resolveCliPath(deps = {}) {
  const cliPath = deps.bipCliPath || resolveBipCliPath(__dirname);
  const exists = deps.existsSync || existsSync;
  if (!cliPath || !exists(cliPath)) {
    throw new Error(`未找到 iuap-apcom-cli 的 bip-cli.js: ${cliPath || "empty"}`);
  }
  return cliPath;
}

async function ensureWorkflowCliAuth(cliPath, deps = {}) {
  if (deps.skipWorkflowAuthCheck || process.env.APPROVE_INBOX_SKIP_CLI_AUTH_CHECK === "1") return;
  const getAuth = deps.getBrowserAuth || ((options) => getBrowserAuth(options));
  try {
    await getAuth({ cliPath, log: deps.log });
  } catch (e) {
    const message = e?.message || String(e);
    throw new Error(`iuap-apcom-cli 登录态不可用：${message}。请先在 YonClaw/yonbrowser 完成登录并刷新凭证后重试。`);
  }
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

function workflowCallbackForAction(action) {
  return action === "approve" ? "agree" : "reject";
}

async function resolveYonclawProxy(deps = {}) {
  if (deps.workflowProxy) return deps.workflowProxy;
  const detector = deps.detectProxy || detectProxy;
  const detected = await detector(process.env.APPROVE_INBOX_PROXY || "");
  if (detected) {
    process.env.APPROVE_INBOX_PROXY = detected;
    return detected;
  }
  return "";
}

async function runWorkflowBatchViaYonclawSession(taskIds, opts, deps = {}) {
  const proxy = await resolveYonclawProxy(deps);
  if (!proxy) {
    throw new Error("未探测到 YonClaw BIP 代理，无法使用 YonClaw 会话执行审批");
  }
  const fetchImpl = deps.fetch || fetch;
  const resp = await fetchImpl(
    `${proxy}/iuap-apcom-messagecenter/todocenter/rest/client/patch/batch/async/action`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        primaryIds: taskIds,
        callBackExecType: workflowCallbackForAction(opts.action),
        content: opts.comment || (opts.action === "approve" ? "同意" : "不同意"),
      }),
      signal: AbortSignal.timeout(deps.workflowTimeoutMs || 60_000),
    },
  );
  const result = await readJsonResponse(resp, "YonClaw workflow approval API");
  return { ...result, _transport: "yonclaw-proxy", _proxy: proxy };
}

async function runWorkflowBatch(taskIds, opts, deps = {}) {
  const transport = deps.approvalTransport || process.env.APPROVE_INBOX_APPROVAL_TRANSPORT || "yonclaw";
  if (transport !== "cli") {
    return runWorkflowBatchViaYonclawSession(taskIds, opts, deps);
  }
  const cliPath = resolveCliPath(deps);
  await ensureWorkflowCliAuth(cliPath, deps);
  return runNodeScript(
    cliPath,
    [
      "workflow",
      "task",
      workflowCommandForAction(opts.action),
      "--primary-ids",
      JSON.stringify(taskIds),
      "--content",
      opts.comment || (opts.action === "approve" ? "同意" : "不同意"),
      "--format",
      "json",
    ],
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

function actionMatches(requestedAction, runtimeAction = {}) {
  if (!runtimeAction || runtimeAction.enabled === false) return false;
  const action = String(runtimeAction.action || "").toLowerCase();
  const callback = String(runtimeAction.callBackExecType || "").toLowerCase();
  if (requestedAction === "approve") return action === "approve" || callback === "agree";
  return action === "reject" || action === "return" || callback === "reject";
}

function isApprovalActionAvailable(item = {}, requestedAction = "approve") {
  if (!Array.isArray(item.runtimeActions)) return true;
  return item.runtimeActions.some((runtimeAction) => actionMatches(requestedAction, runtimeAction));
}

function unavailableActionMessage(item = {}, requestedAction = "approve") {
  const actionText = requestedAction === "approve" ? "通过" : "退回/驳回";
  const title = item.title ? `「${item.title}」` : "当前待办";
  return `${title}没有可执行的${actionText}按钮，已阻止真实审批调用`;
}

async function callIformApprove(item, detail, opts, creds, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const params = parseWorkflowParams(item.webUrl || "");
  if (!params.taskId) throw new Error("iForm 审批缺少 taskId");
  if (!params.processDefinitionId) throw new Error("iForm 审批缺少 processDefinitionId");

  const headers = buildHeaders(creds);
  const qs = new URLSearchParams({ _ts: Date.now().toString() });

  if (opts.mode === "tempsave" || Object.keys(opts.fieldAssignments || {}).length > 0) {
    if (!detail?.iformData) throw new Error("tempsave 模式需要详情中的 iformData");
    const loadQs = new URLSearchParams({
      pk_bo: params.formId || "",
      pk_boins: params.formInstanceId || "",
      tenantId: params.tenantId || "",
    });
    let pkTemp = detail.iformData?.head?.pk_temp?.value || detail.iformData?.head?.pk_temp;
    try {
      const loadResp = await fetchImpl(`${baseUrl()}/yonbip-ec-iform/iform_ctr/bill_ctr/loadDataJson?${loadQs}`, { headers: buildHeaders(creds) });
      const loadJson = await loadResp.json();
      const loadData = typeof loadJson.data === "string" ? JSON.parse(loadJson.data) : loadJson.data;
      pkTemp = loadData?.head?.pk_temp?.value || loadData?.head?.pk_temp || pkTemp;
    } catch {
      // pk_temp from saved detail is still usable in many iForm flows.
    }
    if (!pkTemp) throw new Error("iForm tempsave 缺少 pk_temp");
    const datas = buildIformDatas(detail.iformData, params.formInstanceId, opts.fieldAssignments);
    const processKey = String(params.processDefinitionId || "").split(":")[0];
    const saveBody = formEncode({
      datas: JSON.stringify(datas),
      pk_bo: params.formId,
      pk_boins: params.formInstanceId,
      pk_temp: pkTemp,
      currentActivity: params.activityId || "",
      currentModifyDate: formatDateTime(new Date()),
      isVerifyData: "true",
      processKey,
      saveType: "1",
    });
    await fetchImpl(`${baseUrl()}/yonbip-ec-iform/iform_ctr/bill_ctr/tempsaveData?${new URLSearchParams({ _ts: Date.now().toString(), tenantId: params.tenantId || "" })}`, {
      method: "POST",
      headers,
      body: saveBody,
    });
    const auditBody = formEncode({
      instanceId: params.processInstanceId || "",
      taskId: params.taskId,
      processId: params.processDefinitionId,
      comment: opts.comment,
      datas: JSON.stringify(datas),
      currentActivity: params.activityId || "",
      param_copyTo: "[]",
      param: "{}",
    });
    return safeJson(await fetchImpl(`${baseUrl()}/yonbip-ec-iform/wf_ctr/audit?${new URLSearchParams({ _ts: Date.now().toString(), tenantId: params.tenantId || "" })}`, {
      method: "POST",
      headers,
      body: auditBody,
    }));
  }

  const body = formEncode({
    taskId: params.taskId,
    processId: params.processDefinitionId,
    comment: opts.comment,
  });
  return safeJson(await fetchImpl(`${baseUrl()}/yonbip-ec-iform/wf_ctr/audit?${qs}`, { method: "POST", headers, body }));
}

async function callIformReject(item, opts, creds, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const params = parseWorkflowParams(item.webUrl || "");
  for (const [key, value] of Object.entries({
    taskId: params.taskId,
    processDefinitionId: params.processDefinitionId,
    activityId: params.activityId,
    formId: params.formId,
    formInstanceId: params.formInstanceId,
    processInstanceId: params.processInstanceId,
  })) {
    if (!value) throw new Error(`iForm 退回缺少 ${key}`);
  }
  const body = formEncode({
    actionCode: "reject",
    pk_workflownote: params.taskId,
    currentActivity: params.activityId,
    processId: params.processDefinitionId,
    docCheck: "true",
    taskId: params.taskId,
    pk_bo: params.formId,
    pk_boins: params.formInstanceId,
    comment: opts.comment,
    param: JSON.stringify({
      processInstanceId: params.processInstanceId,
      param_note: opts.comment,
      param_reject_activity: opts.rejectTarget || "-1",
      selectedByRejecter: String(opts.selectedByRejecter ?? "0"),
      rejectSelectedByActivity: "",
    }),
  });
  return safeJson(await fetchImpl(`${baseUrl()}/yonbip-ec-iform/wf_ctr/doAction?${new URLSearchParams({ _ts: Date.now().toString() })}`, {
    method: "POST",
    headers: buildHeaders(creds),
    body,
  }));
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
    const patchResult = await runNodeScript(
      deps.approvePatchesScript || APPROVE_PATCHES_SCRIPT,
      ["--bills", JSON.stringify(bills)],
      deps,
    );
    if (hasExplicitFailure(patchResult)) {
      return { type: "patch", ids, count: ids.length, patchResult, success: false, error: `Patch save failed: ${JSON.stringify(patchResult).slice(0, 200)}` };
    }
    const savedIds = Array.isArray(patchResult.primaryIds) && patchResult.primaryIds.length
      ? patchResult.primaryIds.map(String)
      : ids;
    const approveExecutionIds = savedIds.map((id) => pairs.find((pair) => pair.itemId === id)?.executionId || id);
    const approveResult = await runWorkflowBatch(approveExecutionIds, opts, deps);
    const successIds = localSuccessIdsFromResult(approveResult, pairs);
    return {
      type: "patch",
      ids,
      taskIds,
      executionIds,
      successIds,
      count: ids.length,
      patchResult,
      approveResult,
      success: !hasExplicitFailure(approveResult) && successIds.length === savedIds.length,
    };
  } catch (e) {
    return { type: "patch", ids, count: ids.length, success: false, error: e.message || String(e) };
  }
}

export async function executeApproval(items = [], opts = {}, deps = {}) {
  const detailsById = opts.detailsById || new Map();
  const results = [];
  const successIds = new Set();
  const groups = { iform: [], mdf: [], patch: [], ynf: [], unknown: [] };

  for (const item of items) {
    const id = itemPrimaryId(item);
    if (!isApprovalActionAvailable(item, opts.action)) {
      results.push({
        type: "unavailable",
        primaryId: id,
        action: opts.action,
        success: false,
        error: unavailableActionMessage(item, opts.action),
      });
      continue;
    }
    const detail = detailsById.get(id) || {};
    const framework = detectApprovalFramework(item, detail);
    if (framework === "mdf" && isPatchItem(item, detail)) {
      groups.patch.push(item);
    } else {
      (groups[framework] || groups.unknown).push(item);
    }
  }

  let creds = null;
  if (groups.iform.length > 0) {
    try {
      creds = await resolveAuth(deps);
    } catch (e) {
      for (const item of groups.iform) {
        results.push({ type: "iform", primaryId: itemPrimaryId(item), success: false, error: e.message || String(e) });
      }
    }
  }

  if (creds) {
    for (const item of groups.iform) {
      const id = itemPrimaryId(item);
      try {
        const detail = detailsById.get(id) || {};
        const result = opts.action === "approve"
          ? await callIformApprove(item, detail, opts, creds, deps)
          : await callIformReject(item, opts, creds, deps);
        const success = isStrictApiSuccess(result);
        if (success) successIds.add(id);
        results.push({ type: "iform", primaryId: id, action: opts.action, result, success });
      } catch (e) {
        results.push({ type: "iform", primaryId: id, action: opts.action, success: false, error: e.message || String(e) });
      }
    }
  }

  if (groups.mdf.length > 0) {
    try {
      const result = await executeMdfBatch(groups.mdf, opts, deps);
      for (const id of result.successIds || []) successIds.add(id);
      results.push(result);
    } catch (e) {
      results.push({ type: "mdf", ids: groups.mdf.map(itemPrimaryId), count: groups.mdf.length, success: false, error: e.message || String(e) });
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

  for (const item of groups.ynf) {
    results.push({ type: "ynf", primaryId: itemPrimaryId(item), success: false, error: "YNF 第一阶段仅支持详情与元数据抓取，暂不执行真实审批" });
  }
  for (const item of groups.unknown) {
    results.push({ type: "unknown", primaryId: itemPrimaryId(item), success: false, error: "无法识别审批单据类型" });
  }

  return {
    success: results.length > 0 && results.every((result) => result.success),
    successIds: [...successIds],
    results,
  };
}
