import { randomUUID } from "node:crypto";

import { billDetailToFields, getCookies } from "../fetch-bill-detail.mjs";
import { localizeFields } from "../../analysis/profile-loader.js";

const DEFAULT_YNF_SERVICE = "iuap-yonbuilder-runtime";
const UNIFORM_YNF_SERVICE = "mdf-node/uniform";

function baseUrl() {
  return process.env.APPROVE_INBOX_PROXY || process.env.APPROVE_INBOX_BASE || "https://c1.yonyoucloud.com";
}

function appendIfPresent(qs, key, value, { allowEmpty = false } = {}) {
  if (value == null) return;
  if (!allowEmpty && value === "") return;
  qs.set(key, String(value));
}

export function extractYnfParams(todo = {}) {
  const webUrl = todo.webUrl || "";
  if (!webUrl) return null;
  let urlObj;
  try {
    urlObj = new URL(webUrl);
  } catch {
    return null;
  }
  const params = urlObj.searchParams;
  const pathParts = urlObj.pathname.split("/");
  const fragmentIdx = pathParts.findIndex((part) => part.toLowerCase() === "fragment");
  const pathBillNo = fragmentIdx >= 0 ? pathParts[fragmentIdx + 1] : "";
  const billNo = params.get("billNo") || params.get("busiObj") || pathBillNo || "";
  const billId = params.get("billId") || params.get("id") || "";
  const domainKey = params.get("domainKey") || "";
  const taskId = params.get("taskId") || todo.businessKey || "";
  if (!billNo || !billId || !domainKey) return null;
  return {
    domainKey,
    billId,
    feV: params.get("feV") || "6",
    terminalType: params.get("terminalType") || "1",
    businessStepCode: params.get("businessStepCode") || "",
    busiObj: params.get("busiObj") || billNo,
    tenantId: params.get("tenantId") || "",
    fromMcWorkflow: params.get("from_mc_workflow") || "1",
    serviceCode: params.get("serviceCode") || "",
    apptype: params.get("apptype") || "ynf",
    taskId,
    adt: params.get("adt") || "wf",
    urlActualBuildSource: params.get("url_actual_build_source") || "",
    fragmentId: params.get("fragmentId") || `ynf_fragment_${randomUUID()}`,
    billNo,
  };
}

export function extractTplId(json) {
  if (!json) return null;
  if (typeof json.data === "string" || typeof json.data === "number") return String(json.data);
  return json.data?.tplid || json.data?.tplId || json.data?.id || json.tplid || json.tplId || null;
}

export function extractYnfFieldMetadata(tplAndMetaJson) {
  const fields = {};
  const root = tplAndMetaJson?.data?.meta || tplAndMetaJson?.meta || tplAndMetaJson;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const field = node.storeField || node.field || node.alias || node.code || "";
    const caption = node.caption || node.title || node.label || "";
    if (field && caption && field !== caption) {
      fields[field] = {
        ...(fields[field] || {}),
        fieldId: field,
        label: caption,
        controlType: node.controlType || node.compType || fields[field]?.controlType,
        dataType: node.bizType || fields[field]?.dataType,
        required: typeof node.required === "boolean" ? node.required : fields[field]?.required,
        visible: typeof node.visible === "boolean" ? node.visible : fields[field]?.visible,
        enumType: node.enumType || fields[field]?.enumType,
        refCode: node.refCode || fields[field]?.refCode,
        refType: node.cRefType || node.refEntityUri || fields[field]?.refType,
        dataSourceAlias: node.dataSourceAlias || fields[field]?.dataSourceAlias,
      };
    }
    for (const key of ["children", "fields", "fieldsArr", "items", "controls", "layoutDetail"]) {
      if (node[key]) visit(node[key]);
    }
  }
  visit(root);
  return fields;
}

export function extractYnfFieldLabels(tplAndMetaJson) {
  const metadata = extractYnfFieldMetadata(tplAndMetaJson);
  return Object.fromEntries(Object.entries(metadata).filter(([, meta]) => meta?.label).map(([fieldId, meta]) => [fieldId, meta.label]));
}

function buildHeaders(params, creds = {}) {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "Domain-Key": params.domainKey,
  };
  if (creds.cookieStr) headers.Cookie = creds.cookieStr;
  if (creds.xsrfToken) headers["X-XSRF-TOKEN"] = creds.xsrfToken;
  return headers;
}

function buildCommonQuery(params) {
  const qs = new URLSearchParams();
  appendIfPresent(qs, "domainKey", params.domainKey);
  appendIfPresent(qs, "billId", params.billId);
  appendIfPresent(qs, "feV", params.feV);
  appendIfPresent(qs, "terminalType", params.terminalType);
  appendIfPresent(qs, "businessStepCode", params.businessStepCode, { allowEmpty: true });
  appendIfPresent(qs, "busiObj", params.busiObj);
  appendIfPresent(qs, "tenantId", params.tenantId);
  appendIfPresent(qs, "from_mc_workflow", params.fromMcWorkflow);
  appendIfPresent(qs, "serviceCode", params.serviceCode);
  appendIfPresent(qs, "apptype", params.apptype);
  appendIfPresent(qs, "taskId", params.taskId);
  appendIfPresent(qs, "adt", params.adt);
  appendIfPresent(qs, "url_actual_build_source", params.urlActualBuildSource);
  appendIfPresent(qs, "fragmentId", params.fragmentId);
  appendIfPresent(qs, "billNo", params.billNo);
  return qs;
}

function buildGenerateAdtQuery(params) {
  const qs = new URLSearchParams();
  appendIfPresent(qs, "domainKey", params.domainKey);
  appendIfPresent(qs, "billNo", params.billNo);
  appendIfPresent(qs, "id", params.billId);
  appendIfPresent(qs, "busiObj", params.busiObj);
  appendIfPresent(qs, "from_mc_workflow", params.fromMcWorkflow);
  appendIfPresent(qs, "adt", params.adt);
  appendIfPresent(qs, "billId", params.billId);
  return qs;
}

async function safeJson(resp) {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

function buildDetailBody(params) {
  const billNo = params.billNo;
  return {
    alias: "mainEntity",
    children: [
      { alias: `${billNo}_approvalList` },
      { alias: `${billNo}_approvalTaskList` },
      { alias: `${billNo}_bpmStepList` },
    ],
    main: true,
  };
}

function labelsFromFields(fields = [], labels = {}, metadata = {}) {
  const localized = localizeFields(fields);
  for (const field of localized) {
    const id = field.key || field.name;
    if (!id || labels[id]) continue;
    labels[id] = field.name || id;
    metadata[id] = { ...(metadata[id] || {}), label: field.name || id, visible: true, editable: false };
  }
  return { labels, metadata };
}

export async function fetchYnfBillDetail(ctx = {}, todo = {}) {
  const params = extractYnfParams(todo);
  if (!params) return { error: "ynf_params_missing", billDetail: null, fields: [], attachments: [], fieldLabels: {}, fieldMetadata: {} };

  const fetchImpl = ctx.fetch || fetch;
  const creds = ctx.creds || (await getCookies());
  const headers = buildHeaders(params, creds || {});
  const root = baseUrl();
  const billBase = `${root}/${DEFAULT_YNF_SERVICE}/ypd/bill`;

  try {
    const adtResp = await fetchImpl(`${root}/${UNIFORM_YNF_SERVICE}/ypd/bill/generateADT?${buildGenerateAdtQuery(params)}`, { headers });
    const adtJson = await safeJson(adtResp);
    const adt = adtJson?.data?.ADT;
    if (adt) headers["dynamic-auth-token"] = adt;

    const tplResp = await fetchImpl(`${billBase}/getTplId?${buildCommonQuery(params)}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        billNo: params.billNo,
        businessStepCode: params.businessStepCode,
        tplMode: 0,
        detailId: params.billId,
        terminalType: params.terminalType,
      }),
    });
    const tplid = extractTplId(await safeJson(tplResp));
    if (!tplid) return { error: "ynf_tplid_missing", billDetail: null, fields: [], attachments: [], fieldLabels: {}, fieldMetadata: {} };

    const metaQuery = buildCommonQuery(params);
    metaQuery.set("bilnum", params.billNo);
    const metaResp = await fetchImpl(`${billBase}/tplAndMeta?${metaQuery}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        billNo: params.billNo,
        domainKey: params.domainKey,
        terminalType: params.terminalType,
        businessStepCode: params.businessStepCode,
        busiObj: params.busiObj,
        detailId: params.billId,
      }),
    });
    const metaJson = await safeJson(metaResp);
    let fieldLabels = extractYnfFieldLabels(metaJson);
    let fieldMetadata = extractYnfFieldMetadata(metaJson);

    const detailQuery = buildCommonQuery(params);
    detailQuery.set("tplid", tplid);
    detailQuery.set("mode", "browse");
    detailQuery.set("datasource", "mainEntity");
    detailQuery.set("billnum", params.billNo);
    detailQuery.set("id", params.billId);
    const detailResp = await fetchImpl(`${billBase}/detail?${detailQuery}`, {
      method: "POST",
      headers,
      body: JSON.stringify(buildDetailBody(params)),
    });
    const detailJson = await safeJson(detailResp);
    if (detailJson?.code !== 200 || !detailJson.data) {
      return { error: "ynf_detail_failed", detail: detailJson?.message || detailJson?.msg || detailResp.statusText, billDetail: null, fields: [], attachments: [], fieldLabels, fieldMetadata };
    }

    const fields = billDetailToFields(detailJson.data);
    ({ labels: fieldLabels, metadata: fieldMetadata } = labelsFromFields(fields, fieldLabels, fieldMetadata));
    return {
      billDetail: detailJson.data,
      fields,
      attachments: [],
      fieldLabels,
      fieldMetadata,
    };
  } catch (e) {
    return { error: "ynf_detail_failed", detail: e.message || String(e), billDetail: null, fields: [], attachments: [], fieldLabels: {}, fieldMetadata: {} };
  }
}
