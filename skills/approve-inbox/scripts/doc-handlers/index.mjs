import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { detectType } from "../bill-utils.mjs";
import * as mdfClient from "../frameworks/mdf-client.mjs";
import * as iformClient from "../frameworks/iform-client.mjs";
import * as ynfClient from "../frameworks/ynf-client.mjs";
import { createRichDetail } from "../detail-rich/index.mjs";
import { buildBaseSummary, createExtensionApi, fieldsFromObject } from "./extension-api.mjs";

export function detectFramework(todo = {}) {
  const webUrl = todo.webUrl || "";
  const formId = todo.formId || "";
  let params = new URLSearchParams();
  try {
    params = new URL(webUrl).searchParams;
  } catch {
    params = new URLSearchParams(webUrl.split("?").slice(1).join("?"));
  }

  if (params.get("apptype") === "ynf" || webUrl.includes("/mdf-node/fragment/")) return "ynf";
  if (webUrl.toLowerCase().includes("/mdf-node/meta/voucher/") || formId.includes(".")) return "mdf";
  if (
    (params.has("formId") && params.has("formInstanceId")) ||
    (params.has("pkBo") && params.has("pkBoins")) ||
    webUrl.includes("yonbip-ec-iform")
  ) {
    return "iform";
  }
  return "unknown";
}

function frameworkMatches(todo, framework) {
  return framework === "unknown" || detectFramework(todo) === framework;
}

function getFrameworks(ctx = {}) {
  return {
    mdf: ctx.frameworks?.mdf || mdfClient,
    iform: ctx.frameworks?.iform || iformClient,
    ynf: ctx.frameworks?.ynf || ynfClient,
  };
}

function buildSummary(todo, handler, detailResult = {}) {
  const richFields = detailResult.richDetail?.normalized?.fields || [];
  const summary = buildBaseSummary(todo, handler);
  const fields = richFields.length
    ? richFields.slice(0, 80).map((field) => ({ fieldId: field.fieldId, label: field.label, value: field.displayValue }))
    : fieldsFromObject(detailResult.billDetail || detailResult.iformData?.head || {}, detailResult.fieldLabels || {});
  if (fields.length) summary.iformFields = fields;
  return summary;
}

async function fetchMdfDetail(ctx, todo) {
  const result = await getFrameworks(ctx).mdf.fetchMdfBillDetail(ctx, todo);
  return {
    billDetail: result.billDetail,
    iformData: null,
    fields: result.fields || [],
    attachments: result.attachments || [],
    fieldLabels: result.fieldLabels || {},
    fieldMetadata: result.fieldMetadata || {},
    detailKind: result.billDetail ? "mdf" : null,
    error: result.error,
    detail: result.detail,
  };
}

async function fetchIformDetail(ctx, todo) {
  const result = await getFrameworks(ctx).iform.fetchIformData(ctx, todo);
  return {
    billDetail: null,
    iformData: result.iformData,
    fields: result.fields || [],
    attachments: result.attachments || [],
    fieldLabels: result.fieldLabels || {},
    fieldMetadata: result.fieldMetadata || {},
    detailKind: result.iformData ? "iform" : null,
    error: result.error,
    detail: result.detail,
  };
}

async function fetchYnfDetail(ctx, todo) {
  const result = await getFrameworks(ctx).ynf.fetchYnfBillDetail(ctx, todo);
  return {
    billDetail: result.billDetail,
    iformData: null,
    fields: result.fields || [],
    attachments: result.attachments || [],
    fieldLabels: result.fieldLabels || {},
    fieldMetadata: result.fieldMetadata || {},
    detailKind: result.billDetail ? "ynf" : null,
    error: result.error,
    detail: result.detail,
  };
}

const patchMdfHandler = {
  id: "patch.mdf",
  docType: "patch",
  framework: "mdf",
  typeLabel: "紧急补丁",
  analysisPolicy: { enabled: true, attachments: true },
  match(todo) {
    return detectType(todo) === "patch" && frameworkMatches(todo, "mdf");
  },
  async fetchDetail(ctx, todo) {
    return fetchMdfDetail(ctx, todo);
  },
  summarize(ctx, todo, detailResult) {
    return buildSummary(todo, this, detailResult);
  },
};

const expenseMdfHandler = {
  id: "expense.mdf",
  docType: "expense",
  framework: "mdf",
  typeLabel: "报销单",
  analysisPolicy: { enabled: true, attachments: true },
  match(todo) {
    return detectType(todo) === "expense" && frameworkMatches(todo, "mdf");
  },
  async fetchDetail(ctx, todo) {
    return fetchMdfDetail(ctx, todo);
  },
  summarize(ctx, todo, detailResult) {
    return buildSummary(todo, this, detailResult);
  },
};

const dataRequestIformHandler = {
  id: "data-request.iform",
  docType: "data-request",
  framework: "iform",
  typeLabel: "数据处理申请",
  analysisPolicy: { enabled: true, attachments: true },
  match(todo) {
    return detectType(todo) === "data-request" && frameworkMatches(todo, "iform");
  },
  async fetchDetail(ctx, todo) {
    return fetchIformDetail(ctx, todo);
  },
  summarize(ctx, todo, detailResult) {
    return buildSummary(todo, this, detailResult);
  },
};

const onlineIformHandler = {
  id: "online.iform",
  docType: "online",
  framework: "iform",
  typeLabel: "上线申请",
  analysisPolicy: { enabled: true, attachments: true },
  match(todo) {
    return detectType(todo) === "online" && frameworkMatches(todo, "iform");
  },
  async fetchDetail(ctx, todo) {
    return fetchIformDetail(ctx, todo);
  },
  summarize(ctx, todo, detailResult) {
    return buildSummary(todo, this, detailResult);
  },
};

const backendServiceYnfHandler = {
  id: "backend-service.ynf",
  docType: "backend-service",
  framework: "ynf",
  typeLabel: "后端微服务申请",
  analysisPolicy: { enabled: true, attachments: true },
  match(todo) {
    return detectFramework(todo) === "ynf" &&
      ((todo.title || "").includes("后端微服务申请单") || (todo.webUrl || "").includes("PNDPFYG7AW5AAAS"));
  },
  async fetchDetail(ctx, todo) {
    return fetchYnfDetail(ctx, todo);
  },
  summarize(ctx, todo, detailResult) {
    return buildSummary(todo, this, detailResult);
  },
};

const genericMdfHandler = {
  id: "generic.mdf",
  docType: "other",
  framework: "mdf",
  typeLabel: "MDF 单据",
  analysisPolicy: { enabled: true, attachments: true },
  match(todo) {
    return frameworkMatches(todo, "mdf");
  },
  async fetchDetail(ctx, todo) {
    return fetchMdfDetail(ctx, todo);
  },
  summarize(ctx, todo, detailResult) {
    return buildSummary(todo, this, detailResult);
  },
};

const genericIformHandler = {
  id: "generic.iform",
  docType: "other",
  framework: "iform",
  typeLabel: "iForm 单据",
  analysisPolicy: { enabled: true, attachments: true },
  match(todo) {
    return frameworkMatches(todo, "iform");
  },
  async fetchDetail(ctx, todo) {
    return fetchIformDetail(ctx, todo);
  },
  summarize(ctx, todo, detailResult) {
    return buildSummary(todo, this, detailResult);
  },
};

const genericYnfHandler = {
  id: "generic.ynf",
  docType: "other",
  framework: "ynf",
  typeLabel: "YNF 单据",
  analysisPolicy: { enabled: true, attachments: true },
  match(todo) {
    return frameworkMatches(todo, "ynf");
  },
  async fetchDetail(ctx, todo) {
    return fetchYnfDetail(ctx, todo);
  },
  summarize(ctx, todo, detailResult) {
    return buildSummary(todo, this, detailResult);
  },
};

const unknownHandler = {
  id: "generic.unknown",
  docType: "other",
  framework: "unknown",
  typeLabel: "其他",
  analysisPolicy: { enabled: false, attachments: false },
  match() {
    return true;
  },
  async fetchDetail() {
    return { billDetail: null, iformData: null, fields: [], attachments: [], fieldLabels: {}, fieldMetadata: {}, detailKind: null };
  },
  summarize(ctx, todo) {
    return buildBaseSummary(todo, this);
  },
};

export const builtinHandlers = [
  patchMdfHandler,
  expenseMdfHandler,
  dataRequestIformHandler,
  onlineIformHandler,
  backendServiceYnfHandler,
  genericMdfHandler,
  genericIformHandler,
  genericYnfHandler,
  unknownHandler,
]
  .map((handler) => ({ ...handler, source: "builtin" }));

let userHandlers = [];
export const handlers = [...builtinHandlers];

function refreshHandlers() {
  handlers.splice(0, handlers.length, ...userHandlers, ...builtinHandlers);
}

function normalizeUserHandler(handler, modulePath) {
  if (!handler || typeof handler !== "object") throw new Error("handler must be an object");
  for (const key of ["id", "docType", "framework", "typeLabel", "match", "fetchDetail", "summarize"]) {
    if (!(key in handler)) throw new Error(`handler missing required property: ${key}`);
  }
  for (const key of ["match", "fetchDetail", "summarize"]) {
    if (typeof handler[key] !== "function") throw new Error(`handler.${key} must be a function`);
  }
  return {
    analysisPolicy: { enabled: true, attachments: true },
    ...handler,
    source: "user",
    modulePath,
  };
}

function collectExportedHandlers(mod) {
  const exported = [];
  if (Array.isArray(mod.handlers)) exported.push(...mod.handlers);
  if (mod.default) exported.push(...(Array.isArray(mod.default) ? mod.default : [mod.default]));
  return exported;
}

export function getUserHandlersDir() {
  return process.env.APPROVE_INBOX_EXTENSIONS_DIR || resolve(process.env.HOME || ".", ".agents", "approve-inbox", "extensions", "handlers");
}

export async function loadUserHandlers({ dir = getUserHandlersDir(), log = () => {} } = {}) {
  userHandlers = [];
  if (!existsSync(dir)) {
    refreshHandlers();
    return [];
  }
  const loaded = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".mjs")) continue;
    const modulePath = join(dir, entry.name);
    try {
      const mod = await import(`${pathToFileURL(modulePath).href}?mtime=${Date.now()}`);
      for (const handler of collectExportedHandlers(mod)) loaded.push(normalizeUserHandler(handler, modulePath));
    } catch (err) {
      log(`[approve-inbox] 用户 handler 加载失败: ${modulePath} - ${err.message || String(err)}`);
    }
  }
  userHandlers = loaded;
  refreshHandlers();
  return loaded;
}

export function resetUserHandlersForTest() {
  userHandlers = [];
  refreshHandlers();
}

export function resolveHandler(todo = {}) {
  return handlers.find((handler) => handler.match(todo, extensionApi)) || unknownHandler;
}

export function resolveTodoMetadata(todo = {}) {
  const handler = resolveHandler(todo);
  const docType = todo.docType || handler.docType || detectType(todo);
  return {
    type: docType,
    docType,
    framework: handler.framework || detectFramework(todo),
    handlerId: handler.id,
    source: handler.source || "builtin",
  };
}

export function resolveAnalysisPolicyForItem(item = {}) {
  const handler = handlers.find((h) => h.id === item.handlerId) || resolveHandler(item);
  return {
    enabled: handler.analysisPolicy?.enabled !== false,
    attachments: handler.analysisPolicy?.attachments === true,
  };
}

const extensionApi = createExtensionApi({ detectFramework });

export async function fetchDetailForTodo(ctx = {}, todo = {}) {
  const handler = resolveHandler(todo);
  const meta = resolveTodoMetadata(todo);
  const detail = await handler.fetchDetail(ctx, todo, extensionApi);
  const result = { handler, meta, ...detail };
  result.richDetail = createRichDetail({
    primaryId: todo.primaryId || todo.id,
    type: meta.type,
    docType: meta.docType,
    framework: meta.framework,
    handlerId: meta.handlerId,
    handlerSource: meta.source,
    fetchedAt: new Date().toISOString(),
    billDetail: result.billDetail,
    iformData: result.iformData,
    fieldLabels: result.fieldLabels,
    fieldMetadata: result.fieldMetadata,
  });
  return result;
}

export function summarizeDetailForTodo(ctx, todo, detailResult = {}) {
  const handler = detailResult.handler || handlers.find((h) => h.id === detailResult.meta?.handlerId) || resolveHandler(todo);
  return handler.summarize(ctx, todo, detailResult, extensionApi);
}
