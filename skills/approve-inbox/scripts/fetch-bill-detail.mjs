#!/usr/bin/env node
/**
 * fetch-bill-detail.mjs — 按 webUrl 抓取 BIP 单据明细字段（补 R7：单据业务字段缺失）
 *
 * 解决「拿不到单据元数据/字段导致无法分析」：列表/待办只有元信息，本脚本顺着每条
 * 待办的 webUrl 去抓单据本身的业务字段（金额、物料、预算、明细等），供 agent 实质分析。
 *
 * 链路（标准 MDF 单据，移植自参考实现 sync-inbox.mjs）：
 *   parseWebUrl → generateADT → getTplId → bill/detail
 * iform 单据：getFormData。
 *
 * 认证 cookie 可插拔（对应两种取数方式，R9 都试）：
 *   方式1（yonclaw 取数增强）：环境变量 APPROVE_INBOX_COOKIE / APPROVE_INBOX_XSRF 注入
 *   方式2（skill 端二次抓取）：CDP 从已登录浏览器提取（端口 9222/50541…）
 *
 * 用法：
 *   node fetch-bill-detail.mjs --url "<webUrl>"            # 抓一条，输出字段 JSON
 *   APPROVE_INBOX_COOKIE="k=v; ..." node fetch-bill-detail.mjs --url "<webUrl>"
 *   echo '{"webUrl":"..."}' | node fetch-bill-detail.mjs   # 从 stdin 读 item
 */

// YonClaw BIP 代理（自动注入登录态凭据）优先；否则直连 BIP
// 在调用时读 env（不在模块加载时固化）：server 长驻进程下 YonClaw 代理端口动态变化，
// 模块缓存会让加载时取的值变陈旧 → 必须每次调用现取。
function proxyUrl() {
  return process.env.APPROVE_INBOX_PROXY || "";
}
function baseUrl() {
  return proxyUrl() || process.env.APPROVE_INBOX_BASE || "https://c1.yonyoucloud.com";
}

// billnum 前缀（第一个 _ 之前）→ 微服务映射（移植参考实现，可按需扩展）
const MICROSERVICE_MAP = {
  znbzbx: "yonbip-fi-expsrbsm",
  hrtm: "yonbip-hr-tm",
  pu: "yonbip-scm-pu",
  st: "yonbip-scm-pu",
};
const DEFAULT_MICROSERVICE = "iuap-yonbuilder-runtime";

/** 由 billnum 前缀选择微服务 */
export function pickMicroservice(billnum) {
  const prefix = String(billnum || "").split("_")[0];
  return MICROSERVICE_MAP[prefix] || DEFAULT_MICROSERVICE;
}

// ── 取数 profile（analysis/fetch-profiles.json）─────────────
import { readFileSync as _readFileSync, existsSync as _existsSync } from "node:fs";
import { join as _join, dirname as _dirname } from "node:path";
import { fileURLToPath as _fileURLToPath } from "node:url";
import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const _here = _dirname(_fileURLToPath(import.meta.url));
const FETCH_PROFILES_PATH = _join(_here, "..", "analysis", "fetch-profiles.json");

let _fetchProfilesCache;
/** 读取并缓存 fetch-profiles.json 的 profiles 字典；缺失返回 {} */
export function loadFetchProfiles() {
  if (_fetchProfilesCache) return _fetchProfilesCache;
  try {
    if (_existsSync(FETCH_PROFILES_PATH)) {
      const j = JSON.parse(_readFileSync(FETCH_PROFILES_PATH, "utf-8"));
      _fetchProfilesCache = j.profiles || {};
    } else {
      _fetchProfilesCache = {};
    }
  } catch {
    _fetchProfilesCache = {};
  }
  return _fetchProfilesCache;
}

/**
 * 取某 billnum 的取数 profile（纯查表，不做网络）。
 * 仅返回可用于抓取的 profile（有 endpoint），unverified/无 endpoint 返回 null。
 * @param {string} billnum
 * @param {object} [profiles] 可注入测试用字典
 * @returns {{microservice?:string, endpoint:string, serviceCode?:string, extra?:object}|null}
 */
export function getFetchProfile(billnum, profiles) {
  const dict = profiles || loadFetchProfiles();
  const p = dict[billnum];
  if (p && p.endpoint) return p;
  return null;
}

/**
 * 解析待办 webUrl，提取抓取所需参数（纯函数，可单测）。
 * 识别三类：
 *  - voucher：/mdf-node/meta/[Vv]oucher/<billnum>/<id>?domainKey=&taskId=&tenantId=
 *  - iform：含 formId/pkBo（走 getFormData）
 *  - unsupported：任务通知 / 外部域（ting.diwork 等）
 * @param {string} webUrl
 * @returns {{kind:'voucher'|'iform'|'unsupported', billnum?, billId?, busiObj?, businessKey?, domainKey?, taskId?, tenantId?, appSource?, formId?, formInstanceId?}}
 */
export function buildBusinessKey({ billnum = "", billId = "", busiObj = "" } = {}) {
  const obj = String(busiObj || "").trim() || String(billnum || "").trim();
  const id = String(billId || "").trim();
  return obj && id ? `${obj}_${id}` : "";
}

export function parseWebUrl(webUrl) {
  if (!webUrl || typeof webUrl !== "string") return { kind: "unsupported" };
  let u;
  try {
    u = new URL(webUrl);
  } catch {
    return { kind: "unsupported" };
  }

  // 外部域 / 非 mdf 单据
  if (!u.hostname.includes("yonyoucloud.com")) return { kind: "unsupported" };
  const p = u.pathname.toLowerCase();
  const sp = u.searchParams;

  // voucher 型
  const parts = u.pathname.split("/");
  const vIdx = parts.findIndex((x) => x.toLowerCase() === "voucher");
  if (p.includes("/mdf-node/") && vIdx >= 0 && vIdx + 2 < parts.length) {
    const billnum = parts[vIdx + 1];
    const billId = parts[vIdx + 2];
    const busiObj = sp.get("busiObj") || "";
    if (billnum && billId) {
      return {
        kind: "voucher",
        billnum,
        billId,
        busiObj,
        businessKey: buildBusinessKey({ billnum, billId, busiObj }),
        domainKey: sp.get("domainKey") || "",
        taskId: sp.get("taskId") || "",
        tenantId: sp.get("tenantId") || "",
        appSource: sp.get("appSource") || "",
        taskFlag: sp.get("taskFlag") || "todo",
        businessStepCode: sp.get("businessStepCode") || "",
        serviceCode: sp.get("serviceCode") || "",
      };
    }
  }

  // iform 型
  const formId = sp.get("formId") || sp.get("pkBo");
  const formInstanceId = sp.get("formInstanceId") || sp.get("pkBoins");
  if (formId && formInstanceId) {
    const billnum = sp.get("billnum") || sp.get("billNo") || "";
    const billId = sp.get("billId") || sp.get("id") || formInstanceId;
    const busiObj = sp.get("busiObj") || "";
    return {
      kind: "iform",
      formId,
      formInstanceId,
      busiObj,
      businessKey: buildBusinessKey({ billnum, billId, busiObj }),
      taskId: sp.get("taskId") || "",
      tenantId: sp.get("tenantId") || "",
    };
  }

  return { kind: "unsupported" };
}

/**
 * 把 bill/detail 返回的 data 拍平成业务字段列表（用于 agent fieldAnalysis 输入）。
 * 取标量字段，也兼容常见参照对象（name/displayName/value/code），避免 UI 显示 [object Object]。
 * @param {object} data bill/detail 的 data
 * @returns {Array<{key:string, value:string}>}
 */
export function billDetailToFields(data) {
  if (!data || typeof data !== "object") return [];
  // bill/detail 的字段常在 data 顶层或 data.data / data.head 下
  const src = data.head || data.data || data;
  const SYS = new Set([
    "id", "pubts", "createTime", "modifyTime", "_status", "ts", "dr",
    "creator", "modifier", "tenantid", "tenant_id", "isWfControlled",
    "verifystate", "_mddFormulaExecuteFlag",
  ]);
  const displayValue = (v) => {
    if (v == null) return "";
    if (typeof v === "string") return v.trim();
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (Array.isArray(v)) {
      return v
        .map(displayValue)
        .filter(Boolean)
        .join("、");
    }
    if (typeof v === "object") {
      for (const k of ["name", "displayName", "label", "title", "text", "value", "code"]) {
        if (v[k] != null && String(v[k]).trim()) return String(v[k]).trim();
      }
    }
    return "";
  };
  const out = [];
  for (const [k, v] of Object.entries(src)) {
    if (SYS.has(k)) continue;
    if (v == null) continue;
    const value = displayValue(v);
    if (!value) continue;
    out.push({ key: k, value });
  }
  return out;
}

/**
 * 从单据详情 data 提取附件元数据（纯函数，可测）。
 * 兼容 MDF/iform 常见模式：某字段值是 JSON 数组字符串，元素含 (url|filePath) + (name|fileName)。
 * 单据类型间附件字段名不固定，故全量扫描 head/data/顶层。
 * @param {object} data report|bill/detail 返回的 data
 * @returns {Array<{fileName,fileType,size,url,fid}>}
 */
export function extractDetailAttachments(data) {
  if (!data || typeof data !== "object") return [];
  const sources = [data.head, data.data, data].filter((x) => x && typeof x === "object");
  const out = [];
  const seen = new Set();
  for (const src of sources) {
    for (const v of Object.values(src)) {
      let arr = null;
      if (Array.isArray(v)) arr = v;
      else if (typeof v === "string" && v.trim().startsWith("[")) {
        try {
          const p = JSON.parse(v);
          if (Array.isArray(p)) arr = p;
        } catch {
          /* not JSON */
        }
      }
      if (!arr) continue;
      for (const it of arr) {
        if (!it || typeof it !== "object") continue;
        const url = it.url || it.filePath || it.downloadUrl || it.path;
        const fileName = it.name || it.fileName || it.filename;
        if (!url || !fileName) continue;
        const key = `${fileName}|${url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          fileName,
          fileType: it.type || it.fileType || (fileName.includes(".") ? fileName.split(".").pop() : ""),
          size: it.size || it.filesize || it.fileSize || 0,
          url,
          fid: it.fid || it.fileId || it.newFileId || "",
        });
      }
    }
  }
  return out;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function parseJsonObject(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return asObject(parsed);
  } catch {
    return null;
  }
}

function walkObjects(root, visit, depth = 0, seen = new Set()) {
  if (!root || typeof root !== "object" || depth > 8 || seen.has(root)) return;
  seen.add(root);
  if (!Array.isArray(root)) visit(root);
  const values = Array.isArray(root) ? root : Object.values(root);
  for (const value of values) {
    if (value && typeof value === "object") walkObjects(value, visit, depth + 1, seen);
  }
}

/**
 * 从 MDF meta 里提取附件区配置。不同模板字段名略有差异，所以这里只提取最稳定的
 * attachGroupCode/objectName/ndiUri，缺失时由调用方按 billnum/serviceCode 兜底。
 * @param {object} metaData /mdf-node/meta 返回的 data
 * @returns {{attachGroupCode?:string, objectName?:string, ndiUri?:string}}
 */
export function extractMdfAttachmentMeta(metaData) {
  const out = {};
  walkObjects(metaData, (obj) => {
    const style = parseJsonObject(obj.cStyle) || parseJsonObject(obj.style) || asObject(obj.cStyle) || asObject(obj.style);
    if (style?.type === "attachment") {
      out.attachGroupCode ||= obj.cGroupCode || obj.groupCode || style.groupCode || style.attachGroupCode || "";
      out.objectName ||= style.objectName || style.businessType || obj.objectName || "";
    }
    const controlText = [
      obj.cControlType,
      obj.controlType,
      obj.cFieldControlType,
      obj.type,
      style?.type,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (controlText.includes("file")) {
      out.ndiUri ||= obj.cDataSourceName || obj.realDataSourceName || obj.dataSourceName || obj.ndiUri || "";
      out.attachGroupCode ||= obj.cGroupCode || obj.groupCode || "";
    }
  });
  return out;
}

function parseMdfEnumOptions(value) {
  const parsed = parseJsonObject(value) || asObject(value);
  if (!parsed) return undefined;
  return Object.entries(parsed)
    .map(([key, label]) => ({ value: String(key), label: String(label) }))
    .filter((option) => option.value && option.label);
}

function normalizeBoolean(value, fallback = undefined) {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  return fallback;
}

function addFieldIdAlias(set, value) {
  const raw = String(value || "").trim();
  if (!raw) return;
  set.add(raw);
  set.add(raw.replace(/\./g, "__"));
  set.add(raw.replace(/\./g, "_"));
  if (raw.endsWith(".name")) set.add(raw.slice(0, -5));
  if (raw.endsWith("_name")) set.add(raw.slice(0, -5));
  if (raw.endsWith("_$name")) set.add(raw.slice(0, -6));
}

function canonicalMdfFieldId(obj, controlType = "") {
  const candidates = [obj.cFieldName, obj.cItemName, obj.cName, obj.field, obj.name].filter(Boolean).map(String);
  const refLike = /ref|refer/i.test(String(controlType || obj.cControlType || ""));
  const dottedName = candidates.find((value) => value.endsWith(".name"));
  if (dottedName) return dottedName.slice(0, -5).replace(/\./g, "__");
  const primary = String(obj.cItemName || obj.cName || obj.cFieldName || obj.field || obj.name || "").trim();
  if (refLike && primary.endsWith("_name")) return primary.slice(0, -5);
  if (refLike && primary.endsWith("_$name")) return primary.slice(0, -6);
  return primary.replace(/\./g, "__");
}

function mdfFieldAliases(obj, canonicalId) {
  const aliases = new Set();
  for (const value of [canonicalId, obj.cItemName, obj.cName, obj.cFieldName, obj.field, obj.name, obj.cDataSourceName]) {
    addFieldIdAlias(aliases, value);
  }
  aliases.delete(canonicalId);
  return [...aliases];
}

/**
 * 从 MDF `/mdf-node/meta` 返回体提取轻量字段 metadata。
 * 只保存字段级索引，不长期保存完整模板 JSON。
 * @param {object} metaData /mdf-node/meta 返回的 data
 * @returns {Record<string, object>}
 */
export function extractMdfFieldMetadata(metaData) {
  const fields = {};
  function visit(node, inheritedSection = "", depth = 0, seen = new Set()) {
    if (!node || typeof node !== "object" || depth > 10 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const child of node) visit(child, inheritedSection, depth + 1, seen);
      return;
    }
    const section =
      node.cGroupName || node.groupName || node.cGroupTitle || node.groupTitle ||
      node.cGroupCode || node.groupCode || inheritedSection;
    const obj = node;
    const controlType = obj.cControlType || obj.controlType || obj.cFieldControlType || obj.type || "";
    if (/button|toolbar|btn/i.test(String(controlType))) {
      // Keep walking children: some templates put controls under toolbar-like containers.
      for (const value of Object.values(node)) if (value && typeof value === "object") visit(value, section, depth + 1, seen);
      return;
    }
    const fieldId = canonicalMdfFieldId(obj, controlType);
    const label = obj.cShowCaption || obj.cCaption || obj.caption || obj.title || obj.label || "";
    if (fieldId && label && String(fieldId) !== String(label)) {
      const options = parseMdfEnumOptions(obj.cEnumString || obj.enumString || obj.options);
      fields[fieldId] = {
        ...(fields[fieldId] || {}),
        fieldId,
        aliases: [...new Set([...(fields[fieldId]?.aliases || []), ...mdfFieldAliases(obj, fieldId)])],
        label: String(label),
        controlType: controlType || fields[fieldId]?.controlType,
        dataType: obj.cDataType || obj.dataType || fields[fieldId]?.dataType,
        section: section || fields[fieldId]?.section,
        required: normalizeBoolean(obj.bMustSelect ?? obj.required, fields[fieldId]?.required),
        visible: normalizeBoolean(obj.bShowIt, fields[fieldId]?.visible ?? (obj.bHidden == null ? undefined : !normalizeBoolean(obj.bHidden, false))),
        editable: normalizeBoolean(obj.bCanModify ?? obj.editable, fields[fieldId]?.editable),
        enumType: obj.cEnumType || obj.enumType || fields[fieldId]?.enumType,
        refType: obj.cRefType || obj.refType || fields[fieldId]?.refType,
        refCode: obj.cRefCode || obj.refCode || fields[fieldId]?.refCode,
        options: options || fields[fieldId]?.options,
      };
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") visit(value, section, depth + 1, seen);
    }
  }
  visit(metaData);
  return fields;
}

export function extractMdfFieldLabels(metaData) {
  return Object.fromEntries(
    Object.entries(extractMdfFieldMetadata(metaData))
      .map(([fieldId, meta]) => [fieldId, meta.label || fieldId])
      .filter(([, label]) => label),
  );
}

function firstArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;
  for (const key of ["data", "records", "list", "rows", "items", "content", "result"]) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested;
    const deeper = firstArray(nested);
    if (deeper) return deeper;
  }
  return null;
}

function collectFileRows(value, depth = 0, seen = new Set()) {
  if (!value || typeof value !== "object" || depth > 8 || seen.has(value)) return [];
  seen.add(value);
  const rows = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object") {
        rows.push(item);
        rows.push(...collectFileRows(item, depth + 1, seen));
      }
    }
    return rows;
  }
  for (const key of ["data", "records", "list", "rows", "items", "content", "result", "files", "fileList", "attachments", "attachmentList"]) {
    rows.push(...collectFileRows(value[key], depth + 1, seen));
  }
  return rows;
}

function inferFileType(name, explicit = "") {
  if (explicit) return String(explicit).replace(/^\./, "");
  const m = String(name || "").match(/\.([^.]+)$/);
  return m ? m[1] : "";
}

function normalizeMdfFileAttachment(row, opts = {}) {
  if (!row || typeof row !== "object") return null;
  const source = typeof opts === "string" ? opts : opts.source || "mdf-file-api";
  const defaultAuthId = typeof opts === "object" ? opts.defaultAuthId || "" : "";
  const fileRow =
    asObject(row.file) ||
    asObject(row.fileInfo) ||
    asObject(row.fileMeta) ||
    asObject(row.fileDTO) ||
    asObject(row.attachment) ||
    asObject(row.attachmentInfo) ||
    row;
  const fileName =
    fileRow.name ||
    fileRow.fileName ||
    fileRow.filename ||
    fileRow.originalName ||
    fileRow.originName ||
    fileRow.showName ||
    fileRow.realName ||
    fileRow.attachmentName ||
    fileRow.attachName ||
    fileRow.title ||
    "";
  const fid =
    fileRow.fid ||
    fileRow.fileId ||
    fileRow.id ||
    fileRow.newFileId ||
    fileRow.dataId ||
    fileRow.attachmentId ||
    fileRow.attachId ||
    fileRow.uid ||
    "";
  if (!fileName && !fid) return null;
  const directUrl =
    fileRow.downloadUrl ||
    fileRow.downloadURL ||
    fileRow.downLoadUrl ||
    fileRow.url ||
    fileRow.fileUrl ||
    fileRow.previewUrl ||
    fileRow.priveiwUrl ||
    fileRow.bucketUrl ||
    "";
  const expandParams = fileRow.expandParams && typeof fileRow.expandParams === "object" ? fileRow.expandParams : {};
  return {
    fileName: fileName || String(fid),
    fileType: inferFileType(fileName, fileRow.fileType || fileRow.fileExtension || fileRow.fileExt || fileRow.ext || fileRow.suffix || fileRow.type),
    size: fileRow.size || fileRow.fileSize || fileRow.filesize || 0,
    url: directUrl || "",
    storagePath: fileRow.filePath || fileRow.fileKey || fileRow.path || "",
    fid,
    authId: fileRow.authId || row.authId || expandParams.authId || expandParams.serviceCode || defaultAuthId,
    fileSign: fileRow.sign || fileRow.attributes?.sign || "",
    source,
    raw: row,
  };
}

export function normalizeMdfFileAttachments(json, opts = {}) {
  const rows = collectFileRows(json);
  if (!rows.length) rows.push(...(firstArray(json) || []));
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const att = normalizeMdfFileAttachment(row, opts);
    if (!att) continue;
    const key = `${att.fid || ""}|${att.fileName}|${att.storagePath || att.url || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(att);
  }
  return out;
}

function detailValue(detail, keys) {
  const sources = [detail?.head, detail?.data, detail].filter((x) => x && typeof x === "object");
  for (const src of sources) {
    for (const key of keys) {
      if (src[key] != null && String(src[key]).trim()) return String(src[key]).trim();
    }
  }
  return "";
}

function deriveBillName(item, detail, billnum) {
  const explicit = item?.docType || item?.billName || item?.typeLabel || item?.kindLabel || "";
  if (explicit) return explicit;
  const title = item?.title || detailValue(detail, ["billName", "billname", "name"]) || "";
  if (title) return title.replace(/[A-Za-z0-9_-]+$/, "") || title;
  return billnum || "";
}

function mergeAttachments(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const att of list || []) {
      if (!att) continue;
      const key = `${att.fid || ""}|${att.fileName || ""}|${att.url || ""}|${att.storagePath || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(att);
    }
  }
  return out;
}

const FILE_DOWNLOAD_URL_ENDPOINT = "/iuap-apcom-file/rest/fe/file/getDownloadUrlWithFileId";
const FILE_SIGN_CONFIG_ENDPOINT = "/iuap-apcom-file/rest/v1/jssdk/queryConfiguration";
const FILE_DOWNLOAD_DES_KEY_IV = "8ac41c46-c9b3a3dc";
const FILE_SIGN_CONFIG_TTL_MS = 300 * 1000;
let _fileSignConfigCache = null;

function credentialHeaders(creds = {}) {
  const headers = {};
  if (creds.cookieStr) headers.Cookie = creds.cookieStr;
  if (creds.xsrfToken) headers["X-XSRF-TOKEN"] = creds.xsrfToken;
  return headers;
}

function safeJson(resp) {
  return resp.json().catch(() => ({}));
}

function decodeBase64Utf8(value) {
  if (!value || typeof value !== "string") return "";
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return value;
  }
}

function cookieValue(cookieStr, name) {
  if (!cookieStr || !name) return "";
  const found = String(cookieStr)
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!found) return "";
  return found.slice(name.length + 1).replace(/^"|"$/g, "");
}

function defaultFileApiHost() {
  const explicit = process.env.APPROVE_INBOX_FILE_API_HOST || process.env.APPROVE_INBOX_API_HOST || "";
  if (explicit) return explicit.replace(/^https?:\/\//, "").split("/")[0];
  try {
    return new URL(process.env.APPROVE_INBOX_BASE || "https://c1.yonyoucloud.com").host;
  } catch {
    return "c1.yonyoucloud.com";
  }
}

function urlPathOnly(url) {
  try {
    return url.startsWith("http") ? new URL(url).pathname : url.split("?")[0];
  } catch {
    return String(url || "").split("?")[0];
  }
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildIuapFileSignHeaders({
  method = "GET",
  url,
  tenantId,
  userId,
  salt = "",
  timestamp = Date.now(),
  nonce = randomUUID().replace(/-/g, ""),
}) {
  const ts = String(timestamp);
  const path = urlPathOnly(url);
  const signPlain = `${ts}_${nonce}_${tenantId}_${salt || ""}_${userId}_${method.toUpperCase()}_${path}`;
  return {
    "X-IUAP-FILE-Timestamp": ts,
    "X-IUAP-FILE-Nonce": nonce,
    "X-IUAP-FILE-Signature": sha256Hex(signPlain),
  };
}

export function decryptMdfFileDownloadUrl(encrypted) {
  if (!encrypted || typeof encrypted !== "string") return "";
  if (/^https?:\/\//.test(encrypted)) return encrypted;

  const sep = FILE_DOWNLOAD_DES_KEY_IV.lastIndexOf("-");
  const key = FILE_DOWNLOAD_DES_KEY_IV.slice(0, sep);
  const iv = FILE_DOWNLOAD_DES_KEY_IV.slice(sep + 1);
  try {
    const decipher = createDecipheriv("des-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
    decipher.setAutoPadding(true);
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Node 22/OpenSSL 3 usually disables single DES. macOS openssl still supports it.
  }

  const baseArgs = [
    "enc",
    "-d",
    "-des-cbc",
    "-base64",
    "-K",
    Buffer.from(key, "utf8").toString("hex"),
    "-iv",
    Buffer.from(iv, "utf8").toString("hex"),
  ];
  const attempts = [
    baseArgs,
    ["enc", "-provider", "legacy", "-provider", "default", ...baseArgs.slice(1)],
  ];
  let lastErr = "";
  for (const args of attempts) {
    const proc = spawnSync("openssl", args, {
      input: `${encrypted}\n`,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    if (proc.status === 0 && proc.stdout.trim()) return proc.stdout.trim();
    lastErr = proc.stderr || `openssl_${proc.status}`;
  }
  throw new Error(`download_url_decrypt_failed:${lastErr.trim().slice(0, 120)}`);
}

export function clearIuapFileSignConfigCache() {
  _fileSignConfigCache = null;
}

async function getIuapFileSignConfig(creds = {}, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const apiHost = opts.apiHost || defaultFileApiHost();
  const cacheKey = `${baseUrl()}|${apiHost}|${creds.cookieStr ? cookieValue(creds.cookieStr, "tenantid") : "proxy"}`;
  if (_fileSignConfigCache && _fileSignConfigCache.key === cacheKey && Date.now() < _fileSignConfigCache.expiresAt) {
    return _fileSignConfigCache.value;
  }

  const headers = { Accept: "application/json, text/plain, */*", ...credentialHeaders(creds) };
  const [meResp, configResp] = await Promise.all([
    fetchImpl(`${baseUrl()}/iuap-apcom-workbench/me?onlyShayat=false`, { headers }),
    fetchImpl(`${baseUrl()}${FILE_SIGN_CONFIG_ENDPOINT}?${new URLSearchParams({ apiHost })}`, { headers }),
  ]);
  const meJson = await safeJson(meResp);
  const configJson = await safeJson(configResp);
  const data = configJson?.data || {};
  const config = {
    tenantId:
      data["iuap-file-sign-tenantId"] ||
      meJson?.data?.tenantid ||
      meJson?.data?.tenantId ||
      cookieValue(creds.cookieStr, "tenantid") ||
      "",
    userId: data["iuap-file-sign-userId"] || meJson?.data?.userid || meJson?.data?.userId || "",
    salt: decodeBase64Utf8(data["iuap-file-sign-salt"] || ""),
  };
  if (!config.tenantId || !config.userId) throw new Error("file_sign_config_incomplete");
  _fileSignConfigCache = {
    key: cacheKey,
    value: config,
    expiresAt: Date.now() + FILE_SIGN_CONFIG_TTL_MS,
  };
  return config;
}

export async function resolveMdfFileDownloadUrl(att, creds = {}, opts = {}) {
  if (att?.url) return att.url;
  const fileId = att?.fid || att?.fileId || att?.id || att?.raw?.fileId || att?.raw?.id || "";
  if (!fileId) throw new Error("missing_file_id");
  const rawExpand = att?.raw?.expandParams && typeof att.raw.expandParams === "object" ? att.raw.expandParams : {};
  const authId = att?.authId || rawExpand.authId || rawExpand.serviceCode || att?.serviceCode || "";
  if (!authId) throw new Error("missing_auth_id");

  const fetchImpl = opts.fetchImpl || fetch;
  const signConfig = await getIuapFileSignConfig(creds, opts);
  const signHeaders = buildIuapFileSignHeaders({
    method: "GET",
    url: FILE_DOWNLOAD_URL_ENDPOINT,
    tenantId: signConfig.tenantId,
    userId: signConfig.userId,
    salt: signConfig.salt,
  });
  const params = new URLSearchParams({
    authId,
    fileId,
    fileName: "",
    isWaterMark: "false",
    fromDevice: "web",
  });
  const resp = await fetchImpl(`${baseUrl()}${FILE_DOWNLOAD_URL_ENDPOINT}?${params}`, {
    headers: {
      Accept: "application/json, text/plain, */*",
      ...credentialHeaders(creds),
      ...signHeaders,
    },
  });
  const json = await safeJson(resp);
  if (json?.code === 200 && json?.data?.url) return decryptMdfFileDownloadUrl(json.data.url);
  const code = json?.code || resp.status || "unknown";
  const msg = json?.message || json?.msg || resp.statusText || "";
  throw new Error(`download_url_${code}${msg ? `:${String(msg).slice(0, 80)}` : ""}`);
}

/**
 * 下载附件到目标目录（经 YonClaw 代理/凭据；失败不抛，单文件容错）。
 * @param {Array} atts extractDetailAttachments 结果
 * @param {string} destDir 目标目录
 * @param {{cookieStr?:string, xsrfToken?:string}} [creds]
 * @returns {Promise<Array>} 含 localPath 的附件列表（下载失败的 localPath=null）
 */
export async function downloadAttachments(atts, destDir, creds = {}) {
  if (!Array.isArray(atts) || atts.length === 0) return [];
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join, basename } = await import("node:path");
  try {
    mkdirSync(destDir, { recursive: true });
  } catch {
    /* ignore */
  }
  const headers = {};
  if (creds.cookieStr) headers.Cookie = creds.cookieStr;
  if (creds.xsrfToken) headers["X-XSRF-TOKEN"] = creds.xsrfToken;

  const results = [];
  for (const a of atts) {
    const safeName = basename(a.fileName || a.fid || "attachment").replace(/[/\\]/g, "_");
    const localPath = join(destDir, safeName);
    let downloadUrl = a.url || "";
    let resolvedFromFileService = false;
    try {
      if (!downloadUrl) {
        downloadUrl = await resolveMdfFileDownloadUrl(a, creds);
        resolvedFromFileService = true;
      }
      if (!downloadUrl) throw new Error("missing_download_url");
      const u = /^https?:\/\//.test(downloadUrl)
        ? downloadUrl
        : `${baseUrl()}${downloadUrl.startsWith("/") ? "" : "/"}${downloadUrl}`;
      const r = await fetch(u, { headers: resolvedFromFileService ? {} : headers });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        writeFileSync(localPath, buf);
        results.push({ ...a, localPath, size: a.size || buf.length });
      } else {
        results.push({ ...a, localPath: null, error: `http_${r.status}` });
      }
    } catch (e) {
      results.push({ ...a, localPath: null, error: String(e.message || e) });
    }
  }
  return results;
}

// ── cookie 获取（可插拔）──────────────────────────────────

/** 环境变量注入的 cookie（方式1：yonclaw 提供）；无则返回 null */
function cookieFromEnv() {
  const cookieStr = process.env.APPROVE_INBOX_COOKIE;
  if (!cookieStr) return null;
  return { cookieStr, xsrfToken: process.env.APPROVE_INBOX_XSRF || null };
}

/** CDP 从已登录浏览器提取 cookie（方式2；使用 node 内置全局 WebSocket，零依赖） */
async function cookieFromCDP() {
  const ports = [9222, 50541, 9223, 9224, 9225];
  for (const port of ports) {
    try {
      const pages = await (await fetch(`http://localhost:${port}/json/list`)).json();
      const page = pages.find((p) => p.url && p.url.includes("yonyoucloud.com"));
      if (!page) continue;
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      let msgId = 0;
      const send = (method, params) =>
        new Promise((resolve, reject) => {
          const id = ++msgId;
          const onMsg = (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id === id) {
              ws.removeEventListener("message", onMsg);
              resolve(msg.result);
            }
          };
          ws.addEventListener("message", onMsg);
          ws.send(JSON.stringify({ id, method, params }));
          setTimeout(() => reject(new Error("cdp timeout")), 8000);
        });
      await new Promise((r, j) => {
        ws.addEventListener("open", r, { once: true });
        ws.addEventListener("error", j, { once: true });
      });
      const { cookies } = await send("Network.getAllCookies");
      ws.close();
      const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      const xsrf = cookies.find((c) => c.name === "XSRF-TOKEN");
      return { cookieStr, xsrfToken: xsrf?.value || null };
    } catch {
      continue;
    }
  }
  return null;
}

/** 获取 cookie：YonClaw 代理模式无需 cookie（代理注入）；否则 env 优先，再 CDP */
export async function getCookies() {
  if (proxyUrl()) return { cookieStr: "", xsrfToken: null, proxy: true };
  return cookieFromEnv() || (await cookieFromCDP());
}

// ── 抓取：voucher 单据详情（report/detail 优先，bill/detail 兜底）──────

/** 经 uniform 入口取 tpl 信息（domainKey 路由，不用猜微服务） */
async function getTplInfo(parsed, headers) {
  const { billnum, billId, domainKey } = parsed;
  try {
    const r = await fetch(
      `${baseUrl()}/mdf-node/uniform/billmeta/getTplId?domainKey=${domainKey}&billnum=${billnum}&terminalType=1`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ billno: billnum, terminalType: "1", id: billId, tplmode: 0 }),
      }
    );
    const j = await r.json();
    return j.data || {};
  } catch {
    return {};
  }
}

/** 经 uniform 入口取 tplId（domainKey 路由，不用猜微服务） */
async function getTplId(parsed, headers) {
  const info = await getTplInfo(parsed, headers);
  return info.tplId || "";
}

/**
 * 经 getbillcommands 取该单据「详情」动作的权威请求路径（cAction==='detail' 的 cSvcUrl）。
 * 这是标准方法：不同单据 detail 走 /report/detail 还是 /bill/detail 由此确定，避免猜测。
 * @returns {string} cSvcUrl（如 "/report/detail"）；失败返回 ""
 */
export async function getDetailSvcUrl(parsed, ms, serviceCode, headers) {
  const { billnum, taskId, appSource, taskFlag, tenantId, businessStepCode } = parsed;
  const qs = new URLSearchParams({
    terminalType: "1",
    serviceCode,
    targetUrl: "true",
    businessStepCode: businessStepCode || "",
    taskId: taskId || "",
    appSource: appSource || "",
    taskFlag: taskFlag || "todo",
    tenantId: tenantId || "",
    apptype: "mdf",
    from_mc_workflow: "1",
    adt: "wf",
    diworkCode: "undefined",
    billno: billnum,
  }).toString();
  try {
    const r = await fetch(`${baseUrl()}/${ms}/billmeta/getbillcommands?${qs}`, { headers });
    const j = await r.json();
    if (j.code === 200 && Array.isArray(j.data)) {
      const detailCmd = j.data.find((c) => c.cAction === "detail" && c.cSvcUrl);
      return detailCmd?.cSvcUrl || "";
    }
  } catch {
    /* 失败回退候选 */
  }
  return "";
}

async function fetchMdfTemplateMeta(parsed, tplid, serviceCode, headers) {
  if (!tplid) return null;
  const query = {
    terminalType: "1",
    businessStepCode: parsed.businessStepCode || "",
    taskId: parsed.taskId || "",
    appSource: parsed.appSource || "",
    taskFlag: parsed.taskFlag || "todo",
    tenantId: parsed.tenantId || "",
    apptype: "mdf",
    from_mc_workflow: "1",
    serviceCode,
    adt: "wf",
    billno: parsed.billnum,
  };
  const qs = new URLSearchParams(query).toString();
  const body = {
    billNo: parsed.billnum,
    noCache: false,
    type: "bill",
    query,
    tplid,
    newBillMeta: true,
  };
  try {
    const r = await fetch(`${baseUrl()}/mdf-node/meta?${qs}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (j.code === 200 && j.data) return j.data;
  } catch {
    /* optional metadata fallback */
  }
  return null;
}

export function buildMdfFileParams(parsed, detail, opts = {}) {
  const serviceCode = opts.serviceCode || parsed.serviceCode || `${parsed.billnum}list`;
  const ms = opts.ms || pickMicroservice(parsed.billnum);
  const meta = opts.attachmentMeta || {};
  const tplInfo = opts.tplInfo || {};
  const objectName = meta.objectName || ms;
  const attachGroupCode = meta.attachGroupCode || `${parsed.billnum}_body_attach_base_data`;
  const transType =
    tplInfo.transType ||
    tplInfo.transtype ||
    detailValue(detail, ["transtype", "bustype", "busitype", "transType"]) ||
    "";
  return {
    objectId: parsed.billId,
    objectName,
    businessId: parsed.billId,
    businessType: objectName,
    pageNo: "1",
    pageSize: "20",
    fileName: "",
    groupId: "0",
    oldObjectId: "",
    authId: serviceCode,
    buttonPrefix: `${serviceCode}_${attachGroupCode}`,
    billNo: parsed.billnum,
    dynamicAuthToken: "",
    servicePrefix: transType,
    domainApp: objectName,
    fromDevice: "web",
    ndiUri: meta.ndiUri || "",
    verifyState: detailValue(detail, ["verifystate", "verifyState"]) || "1",
    billCode: detailValue(detail, ["code", "billCode", "billcode"]),
    billId: parsed.billId,
    serviceCode,
    domainKey: parsed.domainKey || "",
    transtype: transType,
    orgId: detailValue(detail, ["org", "orgId", "orgid", "purchaseOrg", "pk_org"]),
    authFix: "",
    authfix: "",
    billName: deriveBillName(opts.item, detail, parsed.billnum),
    billField: "",
    plantype: serviceCode,
    locale: "zh_CN",
    businessStepCode: parsed.businessStepCode || "",
    sbillno: serviceCode,
  };
}

export function buildMdfCommentFileParams(parsed, detail, opts = {}) {
  return {
    ...buildMdfFileParams(parsed, detail, opts),
    objectId: `${parsed.billId}_comment`,
    groupId: "",
  };
}

export function buildMdfTaskFileParams(parsed, detail, opts = {}) {
  const params = buildMdfFileParams(parsed, detail, opts);
  for (const key of ["objectId", "objectName", "businessId", "businessType", "fileName", "groupId", "oldObjectId", "plantype"]) {
    delete params[key];
  }
  return {
    ...params,
    pageNo: "1",
    pageSize: "500",
  };
}

function buildMdfAttachmentHeaders(parsed, opts = {}) {
  const headers = { "Domain-Key": parsed.domainKey || "" };
  if (opts.cookieStr) headers.Cookie = opts.cookieStr;
  if (opts.xsrfToken) headers["X-XSRF-TOKEN"] = opts.xsrfToken;
  return { ...headers, Accept: "application/json, text/plain, */*" };
}

export async function fetchMdfFileAttachments(parsed, detail, opts = {}) {
  if (!parsed?.billnum || !parsed?.billId) return [];
  const headers = buildMdfAttachmentHeaders(parsed, opts);
  const params = buildMdfFileParams(parsed, detail, opts);
  try {
    const r = await fetch(`${baseUrl()}/iuap-apcom-file/rest/fe/file/files?${new URLSearchParams(params)}`, {
      headers,
    });
    const j = await r.json();
    return normalizeMdfFileAttachments(j, { defaultAuthId: params.authId });
  } catch {
    return [];
  }
}

export async function fetchMdfCommentFileAttachments(parsed, detail, opts = {}) {
  if (!parsed?.billnum || !parsed?.billId) return [];
  const headers = buildMdfAttachmentHeaders(parsed, opts);
  const params = buildMdfCommentFileParams(parsed, detail, opts);
  try {
    const r = await fetch(`${baseUrl()}/iuap-apcom-file/rest/fe/file/files?${new URLSearchParams(params)}`, {
      headers,
    });
    const j = await r.json();
    return normalizeMdfFileAttachments(j, { source: "mdf-comment-file-api", defaultAuthId: params.authId });
  } catch {
    return [];
  }
}

export async function fetchMdfTaskFileAttachments(parsed, detail, opts = {}) {
  if (!parsed?.billnum || !parsed?.billId) return [];
  const headers = buildMdfAttachmentHeaders(parsed, opts);
  const params = buildMdfTaskFileParams(parsed, detail, opts);
  const objectName = opts.attachmentMeta?.objectName || opts.ms || pickMicroservice(parsed.billnum);
  const taskService = opts.taskService || process.env.APPROVE_INBOX_TASK_ATTACHMENT_SERVICE || "yonbip-ec-project";
  try {
    const r = await fetch(
      `${baseUrl()}/${taskService}/task/rest/v1/cooperation/suite/${encodeURIComponent(objectName)}/${encodeURIComponent(parsed.billId)}/task/files?${new URLSearchParams(params)}`,
      { headers }
    );
    const j = await r.json();
    return normalizeMdfFileAttachments(j, { source: "mdf-task-file-api", defaultAuthId: params.authId });
  } catch {
    return [];
  }
}

/**
 * 取 voucher 单据详情字段。
 * 链路：uniform getTplId → 候选 detail 端点（report/detail 优先；uniform 与微服务都试，自适应）。
 * report/detail 参数对齐真实请求：serviceCode=<billnum>list、adt=wf、apptype=mdf、from_mc_workflow=1，
 * appSource/taskFlag/taskId/tenantId/businessStepCode 取自 webUrl。
 * （经 YonClaw 代理时凭据自动注入，无需 dynamic-auth-token。）
 */
async function fetchVoucherDetail(parsed, cookieStr, xsrfToken) {
  const { billnum, billId, domainKey, taskId, tenantId, appSource, taskFlag, businessStepCode } = parsed;
  const headers = { "Domain-Key": domainKey };
  if (cookieStr) headers.Cookie = cookieStr;
  if (xsrfToken) headers["X-XSRF-TOKEN"] = xsrfToken;

  const tplInfo = await getTplInfo(parsed, headers);
  const tplid = tplInfo.tplId || "";
  if (!tplid) return { error: "getTplId_failed" };

  const ms = pickMicroservice(billnum);
  // 取数 profile（已实测固化的端点/微服务/serviceCode/额外参数）优先
  const profile = getFetchProfile(billnum);
  const serviceCode = parsed.serviceCode || profile?.serviceCode || `${billnum}list`;
  const pms = profile?.microservice || ms;
  const metaData = await fetchMdfTemplateMeta(parsed, tplid, serviceCode, headers);
  const attachmentMeta = extractMdfAttachmentMeta(metaData);
  const fieldMetadata = extractMdfFieldMetadata(metaData);
  const fieldLabels = Object.fromEntries(
    Object.entries(fieldMetadata)
      .map(([fieldId, meta]) => [fieldId, meta.label || fieldId])
      .filter(([, label]) => label),
  );

  const params = {
    terminalType: "1",
    businessStepCode: businessStepCode || "",
    taskId: taskId || "",
    appSource: appSource || "",
    taskFlag: taskFlag || "todo",
    tenantId: tenantId || "",
    apptype: "mdf",
    from_mc_workflow: "1",
    serviceCode,
    adt: "wf",
    billnum,
    tplid,
    id: billId,
    ...(profile?.extra || {}),
  };
  const qs = new URLSearchParams(params).toString();

  const candidates = [];
  // 1) 标准方法：getbillcommands 取 detail 动作的权威 cSvcUrl（report/detail 或 bill/detail）
  const svcUrl = await getDetailSvcUrl(parsed, pms, serviceCode, headers);
  if (svcUrl) candidates.push(`${pms}${svcUrl.startsWith("/") ? "" : "/"}${svcUrl}`);
  // 2) profile 命中的端点
  if (profile?.endpoint) candidates.push(`${pms}/${profile.endpoint}`);
  // 3) 通用自适应兜底
  candidates.push(
    `${ms}/report/detail`,
    `mdf-node/uniform/report/detail`,
    `${ms}/bill/detail`,
    `mdf-node/uniform/bill/detail`
  );

  let lastErr = "";
  const tried = new Set();
  for (const path of candidates) {
    if (tried.has(path)) continue;
    tried.add(path);
    try {
      const r = await fetch(`${baseUrl()}/${path}?${qs}`, { headers });
      const j = await r.json();
      if (j.code === 200 && j.data) {
        return { data: j.data, via: path, tplInfo, serviceCode, ms: pms, attachmentMeta, fieldLabels, fieldMetadata };
      }
      lastErr = `${j.code}:${(j.message || "").slice(0, 30)}`;
    } catch (e) {
      lastErr = String(e.message || e);
    }
  }
  return { error: "detail_failed", detail: lastErr };
}

// ── 抓取：iform ───────────────────────────────────────────

async function fetchIformData(parsed, cookieStr, xsrfToken) {
  const { formId, formInstanceId, taskId, tenantId } = parsed;
  const qs = new URLSearchParams({
    _ts: String(Date.now()),
    tenantId: tenantId || "",
    pkBo: formId,
    pkBoins: formInstanceId,
    taskId: taskId || "",
  });
  const headers = { Accept: "application/json", Cookie: cookieStr };
  if (xsrfToken) headers["X-XSRF-TOKEN"] = xsrfToken;
  const resp = await fetch(
    `${baseUrl()}/yonbip-ec-iform/iform_ctr/bill_ctr/getFormData?${qs}`,
    { headers }
  );
  const json = await resp.json();
  if (json.code === 200 && json.data) return { data: json.data };
  return { error: "iform_failed", detail: json.message || json.code };
}

/**
 * 抓取一条待办的单据明细字段。
 * @param {{webUrl:string}} item
 * @param {{cookieStr:string, xsrfToken?:string}} [creds] 不传则自动获取
 * @returns {Promise<{kind, fields?, raw?, error?}>}
 */
export async function fetchBillFields(item, creds) {
  const parsed = parseWebUrl(item.webUrl || "");
  if (parsed.kind === "unsupported") return { kind: "unsupported", error: "unsupported_weburl" };

  const c = creds || (await getCookies());
  if (!c || (!c.cookieStr && !c.proxy)) return { kind: parsed.kind, businessKey: parsed.businessKey || "", error: "no_credentials" };

  const r =
    parsed.kind === "voucher"
      ? await fetchVoucherDetail(parsed, c.cookieStr, c.xsrfToken)
      : await fetchIformData(parsed, c.cookieStr, c.xsrfToken);

  if (r.error) return { kind: parsed.kind, businessKey: parsed.businessKey || "", error: r.error, detail: r.detail };
  const attachments =
    parsed.kind === "voucher"
      ? await (async () => {
          const attachmentOpts = {
            item,
            cookieStr: c.cookieStr,
            xsrfToken: c.xsrfToken,
            serviceCode: r.serviceCode,
            ms: r.ms,
            tplInfo: r.tplInfo,
            attachmentMeta: r.attachmentMeta,
          };
          const [standard, comments, tasks] = await Promise.all([
            fetchMdfFileAttachments(parsed, r.data, attachmentOpts),
            fetchMdfCommentFileAttachments(parsed, r.data, attachmentOpts),
            fetchMdfTaskFileAttachments(parsed, r.data, attachmentOpts),
          ]);
          return mergeAttachments(extractDetailAttachments(r.data), standard, comments, tasks);
        })()
      : extractDetailAttachments(r.data);
  return {
    kind: parsed.kind,
    businessKey: parsed.businessKey || "",
    fields: billDetailToFields(r.data),
    attachments,
    raw: r.data,
    fieldLabels: r.fieldLabels || {},
    fieldMetadata: r.fieldMetadata || {},
  };
}

// ── CLI ───────────────────────────────────────────────────

function isMain() {
  return import.meta.url === `file://${process.argv[1]}`;
}

if (isMain()) {
  const argv = process.argv.slice(2);
  const urlIdx = argv.indexOf("--url");
  const url = urlIdx >= 0 ? argv[urlIdx + 1] : null;

  const run = async (item) => {
    const r = await fetchBillFields(item);
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    if (r.error === "no_credentials") {
      process.stderr.write(
        "\n[提示] 未取到登录态。请二选一：\n" +
          "  ① 方式1：设置 APPROVE_INBOX_COOKIE（和 APPROVE_INBOX_XSRF）环境变量（yonclaw 注入）\n" +
          "  ② 方式2：在已登录 BIP 的 Chrome 上开调试端口（--remote-debugging-port=9222）后重试\n"
      );
    }
  };

  if (url) {
    run({ webUrl: url });
  } else {
    // 从 stdin 读 item JSON
    let s = "";
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => {
      try {
        run(JSON.parse(s));
      } catch {
        process.stderr.write("用法：node fetch-bill-detail.mjs --url <webUrl>\n");
        process.exit(1);
      }
    });
  }
}
