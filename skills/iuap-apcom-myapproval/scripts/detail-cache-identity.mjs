import { createHash } from "node:crypto";

const TRANSIENT_QUERY_KEYS = new Set([
  "_",
  "accesstoken",
  "adt",
  "authorization",
  "authcode",
  "cachebust",
  "currenttenantid",
  "exp",
  "expires",
  "jsessionid",
  "nonce",
  "random",
  "refreshtoken",
  "rnd",
  "sessionid",
  "sid",
  "sign",
  "signature",
  "t",
  "tenantid",
  "ticket",
  "timestamp",
  "token",
  "ts",
  "userid",
  "yhtuserid",
]);

const DETAIL_TOP_LEVEL_KEYS = [
  "id",
  "primaryId",
  "title",
  "type",
  "docType",
  "businessKey",
  "framework",
  "handlerId",
  "content",
  "normalized",
  "richDetail",
  "billDetail",
  "iformData",
  "fieldLabels",
  "fieldMetadata",
  "attachmentCount",
  "hasAttachments",
];

const DETAIL_IGNORED_KEYS = new Set([
  "_approveinbox",
  "advice",
  "aisuggestion",
  "analysis",
  "analysiserror",
  "analysismeta",
  "analyzedat",
  "fetchedat",
  "fielddisplayplan",
  "generatedat",
  "lastseenat",
  "observedactions",
  "risklevel",
  "runtimeactions",
  "smarttags",
  "syncedat",
  "synchedat",
]);

function cleanText(value) {
  return value == null ? "" : String(value).trim();
}

function normalizedKey(value) {
  return cleanText(value).replace(/[_-]/g, "").toLowerCase();
}

function isAbsoluteUrl(value) {
  return /^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(value);
}

function looksLikeUrl(value) {
  return isAbsoluteUrl(value) || value.startsWith("/") || value.startsWith("./") || value.startsWith("../");
}

/**
 * Normalize a document URL for cache identity purposes.
 *
 * Stable business parameters (for example taskId and serviceCode) are retained,
 * while identity/authentication and cache-busting parameters are removed.
 */
export function normalizeDetailIdentityUrl(value) {
  const raw = cleanText(value);
  if (!raw) return "";

  const absolute = isAbsoluteUrl(raw);
  try {
    const url = absolute ? new URL(raw) : new URL(raw, "https://detail-cache.invalid");
    url.hash = "";

    const entries = [];
    for (const [key, entryValue] of url.searchParams.entries()) {
      if (TRANSIENT_QUERY_KEYS.has(normalizedKey(key))) continue;
      entries.push([key, entryValue]);
    }
    entries.sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      normalizedKey(leftKey).localeCompare(normalizedKey(rightKey), "en")
      || leftKey.localeCompare(rightKey, "en")
      || leftValue.localeCompare(rightValue, "en"));
    url.search = "";
    for (const [key, entryValue] of entries) url.searchParams.append(key, entryValue);

    if (absolute) return url.toString();
    return `${url.pathname}${url.search}`;
  } catch {
    // Invalid URLs are still deterministic. Fragments are never part of the
    // document identity because they only affect client-side navigation.
    return raw.split("#", 1)[0];
  }
}

function canonicalValue(value, { normalizeUrls = false, ignoredKeys = null } = {}) {
  if (value == null || typeof value === "boolean" || typeof value === "string") {
    if (normalizeUrls && typeof value === "string" && looksLikeUrl(value)) {
      return normalizeDetailIdentityUrl(value);
    }
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalValue(entry, { normalizeUrls, ignoredKeys }));
  }
  if (typeof value !== "object") return String(value);

  const result = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right, "en"))) {
    if (ignoredKeys?.has(normalizedKey(key))) continue;
    const entry = value[key];
    if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") continue;
    result[key] = canonicalValue(entry, { normalizeUrls, ignoredKeys });
  }
  return result;
}

function stableJson(value, options) {
  return JSON.stringify(canonicalValue(value, options));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function primaryItemUrl(item = {}) {
  return item.webUrl || item.mUrl || item.originalUrl || item.url || "";
}

function firstMatchingValue(left = [], right = [], normalize = cleanText) {
  const leftValues = left.map(normalize).filter(Boolean);
  const rightValues = new Set(right.map(normalize).filter(Boolean));
  return leftValues.some((value) => rightValues.has(value));
}

/**
 * Upgrade a legacy detail only when its workflow identity can be proven.
 * Matching the document id alone is insufficient because workflow tasks can
 * be re-issued with the same business document id.
 */
export function legacyDetailMatchesItem(detail = {}, item = {}) {
  if (!firstMatchingValue([detail.id, detail.primaryId], [item.id, item.primaryId])) return false;
  const businessMatches = firstMatchingValue(
    [detail.businessKey, detail.workflowBusinessKey, detail.content?.businessKey, detail.richDetail?.businessKey, detail.richDetail?.meta?.businessKey],
    [item.businessKey, item.workflowBusinessKey],
  );
  const taskMatches = firstMatchingValue(
    [detail.taskId, detail.workflowTaskId, detail.content?.taskId, detail.richDetail?.taskId, detail.richDetail?.meta?.taskId],
    [item.taskId, item.workflowTaskId],
  );
  const urlMatches = firstMatchingValue(
    [detail.webUrl, detail.mUrl, detail.originalUrl, detail.url],
    [item.webUrl, item.mUrl, item.originalUrl, item.url],
    normalizeDetailIdentityUrl,
  );
  return businessMatches || taskMatches || urlMatches;
}

/**
 * Return the stable revision of a workflow item.
 *
 * This intentionally uses an allow-list. List observation timestamps, runtime
 * actions and AI-derived fields therefore cannot invalidate a valid detail.
 */
export function itemRevision(item = {}) {
  return sha256(stableJson({
    id: cleanText(item.id),
    primaryId: cleanText(item.primaryId),
    taskId: cleanText(item.taskId),
    workflowBusinessKey: cleanText(item.workflowBusinessKey),
    businessKey: cleanText(item.businessKey),
    framework: cleanText(item.framework),
    handlerId: cleanText(item.handlerId),
    serviceCode: cleanText(item.serviceCode),
    sourceServiceCode: cleanText(item.sourceServiceCode),
    url: normalizeDetailIdentityUrl(primaryItemUrl(item)),
  }));
}

function detailProjection(detail = {}) {
  if (!detail || typeof detail !== "object") return detail;
  const projected = {};
  for (const key of DETAIL_TOP_LEVEL_KEYS) {
    if (detail[key] !== undefined) projected[key] = detail[key];
  }
  return projected;
}

/**
 * Hash only source detail content. Fetch timestamps, cache bindings, actions,
 * analysis output and temporary signed URL parameters are ignored.
 */
export function detailContentHash(detail = {}) {
  return sha256(stableJson(detailProjection(detail), {
    normalizeUrls: true,
    ignoredKeys: DETAIL_IGNORED_KEYS,
  }));
}

/**
 * Build the key for a specific analysis result. The optional version/policy
 * values let callers invalidate analysis when the analyzer contract changes
 * without invalidating the fetched detail itself.
 */
export function analysisKey(input, contentHash, analyzerVersion = "", policyVersion = "") {
  const values = input && typeof input === "object"
    ? {
        itemRevision: cleanText(input.itemRevision),
        detailContentHash: cleanText(input.detailContentHash || input.contentHash),
        analyzerVersion: cleanText(input.analyzerVersion || input.analysisVersion),
        policyVersion: cleanText(input.policyVersion),
      }
    : {
        itemRevision: cleanText(input),
        detailContentHash: cleanText(contentHash),
        analyzerVersion: cleanText(analyzerVersion),
        policyVersion: cleanText(policyVersion),
      };
  return sha256(stableJson(values));
}
