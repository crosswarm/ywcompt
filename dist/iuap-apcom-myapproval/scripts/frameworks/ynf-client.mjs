import { randomUUID } from "node:crypto";

import { billDetailToFields, buildBusinessKey } from "../fetch-bill-detail.mjs";
import { localizeFields } from "../../analysis/profile-loader.js";

const DEFAULT_YNF_SERVICE = "iuap-yonbuilder-runtime";
const UNIFORM_YNF_SERVICE = "mdf-node/uniform";

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
  const busiObj = params.get("busiObj") || "";
  const domainKey = params.get("domainKey") || "";
  const taskId = params.get("taskId") || todo.businessKey || "";
  if (!billNo || !billId || !domainKey) return null;
  return {
    domainKey,
    billId,
    feV: params.get("feV") || "6",
    terminalType: params.get("terminalType") || "1",
    businessStepCode: params.get("businessStepCode") || "",
    busiObj: busiObj || billNo,
    businessKey: buildBusinessKey({ billnum: params.get("billNo") || pathBillNo || billNo, billId, busiObj }),
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
  const enumData = root?.enumData || {};
  function enumOptions(enumType) {
    if (!enumType || !enumData) return undefined;
    const raw = enumData[enumType];
    if (Array.isArray(raw)) {
      return raw
        .map((option) => {
          const value = option.value ?? option.id ?? option.code ?? option.key;
          const label = option.name ?? option.label ?? option.caption ?? option.text ?? option.title;
          if (value == null || label == null) return null;
          return { value: String(value), label: String(label) };
        })
        .filter(Boolean);
    }
    if (raw && typeof raw === "object") {
      return Object.entries(raw).map(([value, label]) => ({ value: String(value), label: String(label?.name || label?.label || label) }));
    }
    return undefined;
  }
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const field = node.storeField || node.field || node.alias || node.code || "";
    const caption = node.caption || node.title || node.label || "";
    if (field && caption && field !== caption) {
      const enumType = node.enumType || fields[field]?.enumType;
      fields[field] = {
        ...(fields[field] || {}),
        fieldId: field,
        label: caption,
        controlType: node.controlType || node.compType || fields[field]?.controlType,
        dataType: node.bizType || fields[field]?.dataType,
        required: typeof node.required === "boolean" ? node.required : fields[field]?.required,
        visible: typeof node.visible === "boolean" ? node.visible : fields[field]?.visible,
        enumType,
        refCode: node.refCode || fields[field]?.refCode,
        refType: node.cRefType || node.refEntityUri || fields[field]?.refType,
        dataSourceAlias: node.dataSourceAlias || fields[field]?.dataSourceAlias,
        options: enumOptions(enumType) || fields[field]?.options,
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
  try {
    if (!ctx.fetchBillFields) {
      return { error: "ynf_document_client_missing", businessKey: params.businessKey, billDetail: null, fields: [], attachments: [], fieldLabels: {}, fieldMetadata: {} };
    }
    const fetched = await ctx.fetchBillFields(todo, ctx.creds);
    if (fetched.error) {
      return { error: fetched.error, businessKey: fetched.businessKey || params.businessKey, detail: fetched.detail, billDetail: null, fields: [], attachments: [], fieldLabels: fetched.fieldLabels || {}, fieldMetadata: fetched.fieldMetadata || {} };
    }
    const detail = fetched.billDetail || fetched.raw || {};
    const fields = Array.isArray(fetched.fields) ? fetched.fields : billDetailToFields(detail);
    let fieldLabels = fetched.fieldLabels || {};
    let fieldMetadata = fetched.fieldMetadata || {};
    ({ labels: fieldLabels, metadata: fieldMetadata } = labelsFromFields(fields, fieldLabels, fieldMetadata));
    return {
      billDetail: detail,
      fields,
      attachments: fetched.attachments || [],
      fieldLabels,
      fieldMetadata,
      businessKey: fetched.businessKey || params.businessKey,
    };
  } catch (e) {
    return { error: "ynf_detail_failed", businessKey: params.businessKey, detail: e.message || String(e), billDetail: null, fields: [], attachments: [], fieldLabels: {}, fieldMetadata: {} };
  }
}
