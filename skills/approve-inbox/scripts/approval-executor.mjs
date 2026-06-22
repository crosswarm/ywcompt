import { detectProxy } from "./enrich-details.mjs";
import { getCookies, parseWebUrl } from "./fetch-bill-detail.mjs";
import { hasExplicitFailure, isStrictApiSuccess, itemPrimaryId } from "./approval-utils.mjs";

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
  const ids = items.map(itemPrimaryId).filter(Boolean);
  if (ids.length === 0) {
    return { type: "mdf", ids: [], count: 0, success: false, error: "No valid primary IDs" };
  }
  if (opts.action !== "approve") {
    return {
      type: "mdf",
      ids,
      count: ids.length,
      success: false,
      error: "当前 MDF/普通工作流仅支持真实通过；驳回/退回需走 iForm 或补充专用 CLI 命令",
    };
  }

  // 直接 HTTP 调 BIP 批量审批 API，不 spawn 子进程（避免环境丢失导致 400）
  let proxy = process.env.APPROVE_INBOX_PROXY || "";
  if (!proxy) {
    try {
      const detected = await (deps.detectProxy || detectProxy)();
      if (detected) proxy = detected;
    } catch { /* 继续用 baseUrl */ }
  }
  const apiBase = proxy || process.env.APPROVE_INBOX_BASE || "https://c1.yonyoucloud.com";
  const fetchImpl = deps.fetch || fetch;

  try {
    const body = JSON.stringify({
      primaryIds: ids,
      callBackExecType: "agree",
      content: opts.comment || "同意",
    });
    const resp = await fetchImpl(`${apiBase}/iuap-apcom-messagecenter/todocenter/rest/client/patch/batch/async/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const json = await resp.json();
    if (resp.ok && json.flag === 0) {
      return { type: "mdf", ids, successIds: ids, count: ids.length, result: json, success: true };
    }
    return { type: "mdf", ids, count: ids.length, result: json, success: false, error: `HTTP ${resp.status}: ${JSON.stringify(json).slice(0, 200)}` };
  } catch (e) {
    return { type: "mdf", ids, count: ids.length, success: false, error: e.message || String(e) };
  }
}

export async function executeApproval(items = [], opts = {}, deps = {}) {
  const detailsById = opts.detailsById || new Map();
  const results = [];
  const successIds = new Set();
  const groups = { iform: [], mdf: [], ynf: [], unknown: [] };

  for (const item of items) {
    const id = itemPrimaryId(item);
    const detail = detailsById.get(id) || {};
    const framework = detectApprovalFramework(item, detail);
    (groups[framework] || groups.unknown).push(item);
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
      if (result.success) for (const id of result.successIds || []) successIds.add(id);
      results.push(result);
    } catch (e) {
      results.push({ type: "mdf", ids: groups.mdf.map(itemPrimaryId), count: groups.mdf.length, success: false, error: e.message || String(e) });
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
