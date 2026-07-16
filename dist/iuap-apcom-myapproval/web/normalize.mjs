/**
 * normalize.mjs — 数据契约转换层（纯函数）
 *
 * 把本地落盘的真实数据（参考 sync-inbox 的 data/inbox.json + data/details/<id>.json）
 * 与 agent-runner 产出的 5 段 JSON 分析，统一转换成 v3 前端契约
 * （ApproveInboxData / ApproveInboxItem / ApproveInboxDetail，见 src/types/approve-inbox.ts）。
 *
 * 设计目标：
 * - 纯函数、无 I/O、无外部依赖（仅复用 scripts/md-to-html.mjs 的 getAdvice），便于单元测试。
 * - 兼容三种分析来源：① 5 段结构化 JSON（agent-runner 新格式）
 *   ② 被 ```json 围栏包裹的 JSON ③ 旧版 Markdown（[ADVICE:*] 标记）。
 * - 输入已是 v3 契约时原样透传（补默认值）。
 */

import { getAdvice } from "../scripts/md-to-html.mjs";
import { canonicalDocTypeName } from "../scripts/doc-type-utils.mjs";
import { localizeFields } from "../analysis/profile-loader.js";
import { resolveReceivedAt } from "../scripts/received-at.mjs";
import { normalizeFieldDisplayPlan } from "../scripts/field-display-plan.mjs";

// ── 小工具 ────────────────────────────────────────────────

/** 尝试解析 JSON，支持去除 ```json ... ``` 围栏；失败返回 null */
export function tryParseJson(input) {
  if (input == null) return null;
  if (typeof input === "object") return input;
  if (typeof input !== "string") return null;
  let t = input.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** 去除文本中的 [ADVICE:*] 标记 */
function stripAdvice(raw) {
  return String(raw || "").replace(/\[ADVICE:(?:APPROVE|CAUTION|REJECT)\]/g, "").trim();
}

const CANONICAL_TAGS = [
  { label: "超预算", re: /超.*预算|预算.*超|beyond\s*budget|beyondBudget/i, kind: "risk" },
  { label: "缺金额", re: /无金额|缺少金额|金额字段|金额未知|金额.*无法判断/i, kind: "rule" },
  { label: "缺预算", re: /缺.*预算|无预算|预算科目|预算余额/i, kind: "rule" },
  { label: "缺比价", re: /缺.*比价|无比价|未提供比价|报价.*缺|比价.*不足/i, kind: "rule" },
  { label: "缺供应商", re: /缺.*供应商|无供应商|未指定供应商|未提供供应商/i, kind: "rule" },
  { label: "缺附件", re: /缺.*附件|附件.*缺|发票.*缺|票据.*缺|文件缺失|合同.*缺/i, kind: "rule" },
  { label: "付款风险", re: /付款|预付款|账期|资金风险|资金.*风险/i, kind: "risk" },
  { label: "数量异常", re: /数量|入库|超量|少收|多收/i, kind: "risk" },
  { label: "审批权限", re: /双签|会签|审批权限|权限|授权/i, kind: "risk" },
  { label: "期限异常", re: /期限|逾期|超期|交期|日期|时间/i, kind: "rule" },
  { label: "金额异常", re: /金额|单价|总价|价格|报价|授信|额度/i, kind: "risk" },
  { label: "信息不全", re: /无法判断|信息不全|缺少|未提供|未知|为空|不明确/i, kind: "rule" },
  { label: "预算内", re: /预算内|未超预算|金额合规/i, kind: "advice" },
  { label: "票据齐全", re: /票据齐全|发票齐全|附件齐全/i, kind: "advice" },
  { label: "资质齐全", re: /资质齐全|供应商.*合格|无历史违约/i, kind: "advice" },
  { label: "条款合规", re: /条款合规|合同.*合规|期限合规/i, kind: "advice" },
  { label: "比价充分", re: /比价充分|报价合理|三方比价/i, kind: "advice" },
];

const CANONICAL_LABELS = new Set(CANONICAL_TAGS.map((tag) => tag.label));

function canonicalTag(text, severityOrKind = "rule", advice) {
  const s = String(text || "");
  if (!s.trim()) return null;
  const positiveMode = advice === "approve" || severityOrKind === "advice" || severityOrKind === "passed";
  if (CANONICAL_LABELS.has(s.trim())) {
    const found = CANONICAL_TAGS.find((tag) => tag.label === s.trim());
    if (positiveMode && found.kind !== "advice") return { label: "预算内", kind: "advice" };
    return { label: found.label, kind: found.kind };
  }
  const pool = positiveMode
    ? CANONICAL_TAGS.filter((tag) => tag.kind === "advice")
    : CANONICAL_TAGS;
  const matched = pool.find((tag) => tag.re.test(s));
  if (matched) {
    const severe = severityOrKind === "risk" || (severityOrKind !== "advice" && matched.kind === "risk");
    return { label: matched.label, kind: severe ? "risk" : matched.kind };
  }
  if (advice === "approve" || severityOrKind === "advice" || severityOrKind === "passed") return { label: "预算内", kind: "advice" };
  if (severityOrKind === "risk") return { label: "关键异常", kind: "risk" };
  return { label: "需核实", kind: "rule" };
}

function uniqueTags(tags, limit = 2) {
  const seen = new Set();
  const out = [];
  for (const tag of tags) {
    if (!tag?.label || seen.has(tag.label)) continue;
    seen.add(tag.label);
    out.push(tag);
    if (out.length >= limit) break;
  }
  return out;
}

/** 清洗智能标签：剔除元信息，并把旧的长句/技术字段收敛成固定短标签。 */
function cleanTags(tags, advice) {
  if (!Array.isArray(tags)) return [];
  const cleaned = uniqueTags(
    tags
      .filter((t) => t && t.kind !== "info")
      .map((t) => canonicalTag(t.label, advice === "approve" ? "advice" : t.kind, advice))
      .filter(Boolean),
    advice === "approve" ? 1 : 2,
  );
  if (advice === "approve" && !cleaned.some((tag) => tag.kind === "advice")) {
    return [{ label: "预算内", kind: "advice" }];
  }
  return advice === "approve" ? cleaned.filter((tag) => tag.kind === "advice").slice(0, 1) : cleaned;
}

function humanizeKey(key) {
  const s = String(key || "").trim();
  if (!s) return "未命名字段";
  if (/[\u4e00-\u9fa5]/.test(s)) return s;
  return s
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function displayText(value) {
  if (value == null) return "";
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return "";
    if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
      try {
        return displayText(JSON.parse(s));
      } catch {
        return s;
      }
    }
    return s;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(displayText).filter(Boolean).join("、");
  if (typeof value === "object") {
    for (const k of ["name", "displayName", "label", "title", "text", "value", "code", "id"]) {
      const s = displayText(value[k]);
      if (s) return s;
    }
    return Object.entries(value)
      .slice(0, 4)
      .map(([k, v]) => {
        const sv = displayText(v);
        return sv ? `${humanizeKey(k)}:${sv}` : "";
      })
      .filter(Boolean)
      .join("，");
  }
  return String(value);
}

function normalizeFields(fields) {
  if (!Array.isArray(fields)) return [];
  return localizeFields(fields)
    .map((f) => ({
      key: f.key || f.name,
      name: f.name || humanizeKey(f.key),
      value: displayText(f.value),
      dim: f.dim,
    }))
    .filter((f) => f.name && f.value);
}

function normalizeRichFields(rawDetail) {
  const normalized =
    rawDetail?.richDetail?.normalized?.fields ||
    rawDetail?.normalized?.fields ||
    [];
  if (!Array.isArray(normalized) || normalized.length === 0) return [];
  const fieldLabels = rawDetail?.richDetail?.fieldLabels || rawDetail?.fieldLabels || {};
  const fieldMetadata = rawDetail?.richDetail?.meta?.fields || rawDetail?.fieldMetadata || {};
  return normalized
    .map((f) => {
      const key = f.fieldId || f.key || f.name;
      const meta = key ? fieldMetadata[key] || {} : {};
      return {
        key,
        name: localizeFieldName(key, f.label || f.name || fieldLabels[key] || meta.label || key),
        value: displayText(f.displayValue || f.value),
        dim: f.section || meta.section,
      };
    })
    .filter((f) => f.name && f.value);
}

function isSupportedDetailUrl(webUrl) {
  if (!webUrl || typeof webUrl !== "string") return false;
  let u;
  try {
    u = new URL(webUrl);
  } catch {
    return false;
  }
  const p = u.pathname.toLowerCase();
  const sp = u.searchParams;
  if (p.includes("/voucher/")) return true;
  if (sp.get("apptype") === "ynf" || p.includes("/mdf-node/fragment/")) return true;
  if ((sp.has("formId") && sp.has("formInstanceId")) || (sp.has("pkBo") && sp.has("pkBoins"))) return true;
  return webUrl.includes("yonbip-ec-iform");
}

function normalizeOriginalUrl(...candidates) {
  for (const candidate of candidates) {
    const raw = typeof candidate === "string" ? candidate.trim() : "";
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    } catch {
      // Ignore malformed or relative URLs. Original bill pages must be absolute browser URLs.
    }
  }
  return undefined;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function normalizedBusinessName(value, raw = {}) {
  const businessName = firstText(value);
  if (!businessName) return "";
  const serviceCodes = [
    raw.serviceCode,
    raw.sourceServiceCode,
    raw.summary?.serviceCode,
    raw.summary?.sourceServiceCode,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  if (serviceCodes.includes(businessName.toLowerCase())) return "";
  if (!/[一-龥\s]/.test(businessName)
    && (/[_./:]/.test(businessName) || /\d/.test(businessName))) return "";
  return businessName;
}

function normalizedServiceName(raw = {}) {
  return normalizedBusinessName(firstText(raw.serviceName, raw.summary?.serviceName), raw);
}

const SERVICE_NAME_SOURCE = "iuap-apcom-cli.auth.permission.apply";

function normalizedServiceNameSource(value) {
  const source = firstText(value);
  if (source === "bip-cli.auth.permission.apply") return SERVICE_NAME_SOURCE;
  if (source === SERVICE_NAME_SOURCE || source === "todo") return source;
  return null;
}

function normalizeDisplayKey(raw = {}, { docType = "" } = {}) {
  const explicitDisplayKey = firstText(raw.displayKey, raw.summary?.displayKey);
  const generatedLegacyKeys = new Set([
    raw.docType,
    raw.summary?.docType,
    raw.sourceServiceCode,
    raw.summary?.sourceServiceCode,
    raw.type,
    raw.summary?.typeLabel,
    "审批单",
    "default",
  ].map((value) => String(value || "").trim()).filter(Boolean));
  if (explicitDisplayKey && !generatedLegacyKeys.has(explicitDisplayKey)) return explicitDisplayKey;
  return firstText(
    raw.handlerId,
    raw.sourceKey,
    raw.serviceCode,
    raw.summary?.serviceCode,
    raw.framework && docType ? `${docType}.${raw.framework}` : "",
    docType,
    raw.type,
    "default",
  );
}

function normalizeDisplayLabel(raw = {}, { displayKey = "", docType = "" } = {}) {
  const explicitDisplayLabel = firstText(raw.displayLabel, raw.summary?.displayLabel);
  const generatedLegacyLabels = new Set([
    raw.docType,
    raw.summary?.docType,
    raw.serviceCode,
    raw.sourceServiceCode,
    raw.summary?.serviceCode,
    raw.summary?.sourceServiceCode,
    displayKey,
    "审批单",
    "default",
  ].map((value) => String(value || "").trim()).filter(Boolean));
  const safeExplicitDisplayLabel = normalizedBusinessName(explicitDisplayLabel, raw);
  if (explicitDisplayLabel
    && !generatedLegacyLabels.has(explicitDisplayLabel)
    && safeExplicitDisplayLabel) {
    return safeExplicitDisplayLabel;
  }
  return firstText(
    normalizedServiceName(raw),
    normalizedBusinessName(raw.docTypeName, raw),
    normalizedBusinessName(raw.summary?.docTypeName, raw),
    normalizedBusinessName(raw.summary?.documentTypeName, raw),
    docType,
    displayKey,
  );
}

export function isReturnedToDrafterItem(item = {}) {
  const text = [
    item.title,
    item.content,
    item.summary?.title,
    item.businessData?.taskName,
    item.taskName,
    item.nodeName,
  ].filter(Boolean).join(" ");
  return /(退回|驳回).{0,12}(制单|发起|申请)人?(?:待办)?|退回制单待办/.test(text);
}

function normalizeSeverity(severity) {
  return ["risk", "warning", "passed"].includes(severity) ? severity : undefined;
}

function normalizedAscii(s) {
  return String(s || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isTechnicalFieldName(name, key) {
  const s = String(name || "").trim();
  if (!s || /[\u4e00-\u9fa5]/.test(s)) return false;
  if (key && normalizedAscii(s) === normalizedAscii(key)) return true;
  return /[_A-Z]|Id$|Status$|Budget$|Digit$|^is[A-Z]|^can[A-Z]/.test(s);
}

function localizeFieldName(key, fallback) {
  const visibleFallback = displayText(fallback);
  if (visibleFallback && !isTechnicalFieldName(visibleFallback, key)) return visibleFallback;
  const localized = localizeFields([{ key: key || visibleFallback, value: "__field__" }])[0]?.name;
  return displayText(localized || visibleFallback || humanizeKey(key));
}

function normalizeFieldAnalysis(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((f) => {
      const key = f?.key || f?.field || f?.fieldName || f?.name;
      const value = displayText(f?.value);
      return {
        name: localizeFieldName(key, f?.label || f?.caption || f?.displayName || f?.name),
        value,
        summary: displayText(f?.summary || f?.detail || f?.description) || (value ? "字段值已抓取，等待 AI 重新分析" : "等待 AI 重新分析"),
        severity: normalizeSeverity(f?.severity),
      };
    })
    .filter((f) => f.name);
}

function normalizeRuleAnalysis(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((r) => ({
      ruleName: displayText(r?.ruleName || r?.name || r?.field || "业务规则"),
      severity: normalizeSeverity(r?.severity) || "warning",
      summary: displayText(r?.summary || r?.detail || r?.description),
      evidence: displayText(r?.evidence),
      suggestion: displayText(r?.suggestion),
    }))
    .filter((r) => r.ruleName && r.summary);
}

function normalizeAttachmentAnalysis(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((a) => ({
      name: displayText(a?.name || a?.fileName || a?.filename || "附件"),
      fileType: displayText(a?.fileType || a?.type),
      severity: normalizeSeverity(a?.severity),
      summary: displayText(a?.summary),
      findings: Array.isArray(a?.findings)
        ? a.findings
            .map((fd) => ({
              name: displayText(fd?.name),
              detail: displayText(fd?.detail || fd?.summary || fd?.description || fd),
            }))
            .filter((fd) => fd.detail)
        : [],
    }))
    .filter((a) => a.name);
}

function normalizeSystemRuleAudit(audit) {
  if (!audit || typeof audit !== "object") return null;
  const status = displayText(audit.status || (audit.resultDesc || audit.AISummaryResultDesc ? "success" : ""));
  if (!status) return null;
  return {
    status,
    code: audit.code ?? null,
    message: displayText(audit.message),
    displayCode: displayText(audit.displayCode),
    detailMsg: displayText(audit.detailMsg),
    level: audit.level,
    resultId: displayText(audit.resultId),
    queryId: displayText(audit.queryId),
    resultDesc: displayText(audit.resultDesc),
    AISummaryResultDesc: displayText(audit.AISummaryResultDesc || audit.aiSummaryResultDesc),
    source: displayText(audit.source),
    categories: Array.isArray(audit.categories)
      ? audit.categories.map((category) => ({
          categoryId: displayText(category?.categoryId),
          name: displayText(category?.name),
          iaPoints: Array.isArray(category?.iaPoints)
            ? category.iaPoints.map((point) => ({
                auditPointId: displayText(point?.auditPointId),
                auditPointResultId: displayText(point?.auditPointResultId),
                name: displayText(point?.name),
                artificial: point?.artificial === true,
                pass: point?.pass === true,
                controlMode: point?.controlMode ?? null,
                status: point?.status ?? null,
                items: Array.isArray(point?.items)
                  ? point.items.map((item) => ({
                      auditItemId: displayText(item?.auditItemId),
                      detailResultId: displayText(item?.detailResultId),
                      type: displayText(item?.type),
                      resultDesc: displayText(item?.resultDesc),
                      pass: item?.pass === true,
                    })).filter((item) => item.auditItemId || item.resultDesc)
                  : [],
              })).filter((point) => point.auditPointId || point.name || point.items.length > 0)
            : [],
        })).filter((category) => category.categoryId || category.name || category.iaPoints.length > 0)
      : [],
    runtimeStatus: audit.runtimeStatus ?? null,
    resultState: audit.resultState ?? null,
    controlMode: audit.controlMode ?? null,
    businessPart: displayText(audit.businessPart),
    startTime: displayText(audit.startTime),
    completedTime: displayText(audit.completedTime),
    taskComplete: audit.taskComplete === true,
    licenseEnable: audit.licenseEnable ?? null,
    fetchedAt: displayText(audit.fetchedAt),
    reason: displayText(audit.reason),
    httpStatus: audit.httpStatus,
  };
}

export function deriveSystemRuleAdvice(systemRuleAudit) {
  const audit = normalizeSystemRuleAudit(systemRuleAudit);
  if (!audit || audit.status !== "success") return null;
  const text = `${audit.resultDesc || ""}\n${audit.AISummaryResultDesc || ""}`;
  if (/拒绝|驳回|不通过|高风险|严重|重大风险/.test(text)) {
    return { advice: "reject", label: "建议拒绝", riskLevel: "high" };
  }
  if (/无异常|未发现异常|未见异常/.test(text)) {
    return { advice: "approve", label: "建议通过", riskLevel: "low" };
  }
  if (/需核实|中风险|请重点核查|重点核查|建议复核|人工复核|需关注|异常|存在.{0,12}风险/.test(text)) {
    return { advice: "caution", label: "需关注", riskLevel: "medium" };
  }
  if (/建议通过|可通过|审核通过|低风险|通过/.test(text)) {
    return { advice: "approve", label: "建议通过", riskLevel: "low" };
  }
  return { advice: "caution", label: "需关注", riskLevel: "medium" };
}

function parsedAdvice(analysis) {
  const parsed = parseAnalysis(analysis);
  if (!parsed?.conclusion?.advice) return null;
  return {
    advice: parsed.conclusion.advice,
    label: parsed.conclusion.label || adviceLabel(parsed.conclusion.advice),
    riskLevel: inferRiskLevel(parsed.conclusion.advice),
  };
}

export function buildCompositeAdvice({ systemRuleAudit = null, analysis = null, fallbackConclusion = null } = {}) {
  const systemAudit = normalizeSystemRuleAudit(systemRuleAudit);
  const systemAdvice = deriveSystemRuleAdvice(systemAudit);
  const userAdvice = parsedAdvice(analysis);
  const fallbackAdvice = fallbackConclusion?.advice
    ? {
        advice: fallbackConclusion.advice,
        label: fallbackConclusion.label || adviceLabel(fallbackConclusion.advice),
        riskLevel: inferRiskLevel(fallbackConclusion.advice),
      }
    : null;
  const base = systemAdvice || userAdvice || fallbackAdvice || { advice: "caution", label: "需关注", riskLevel: "medium" };
  const conflict = !!(systemAdvice && userAdvice && systemAdvice.advice !== userAdvice.advice);
  const reasons = [];
  if (systemAdvice) {
    reasons.push("以智能审核结果为准");
    if (systemAudit?.resultDesc) reasons.push(systemAudit.resultDesc);
    if (conflict) reasons.push("用户级规则存在不同提示");
  } else if (!userAdvice) {
    reasons.push("暂无完整智能审核结果，建议人工复核");
  }
  return {
    advice: base.advice,
    label: base.label || adviceLabel(base.advice),
    riskLevel: base.riskLevel || inferRiskLevel(base.advice),
    source: systemAdvice ? "system" : (userAdvice ? "user" : "fallback"),
    summary: reasons.filter(Boolean).join("；"),
    reasons,
    conflict,
    systemAdvice: systemAdvice?.advice || null,
    userAdvice: userAdvice?.advice || null,
    fetchedAt: systemAudit?.fetchedAt || null,
  };
}

function frameworkFromItem(raw = {}) {
  const explicit = String(raw.framework || raw.richDetail?.framework || "").trim().toLowerCase();
  if (["mdf", "iform", "ynf", "unknown"].includes(explicit)) return explicit;

  const handlerId = String(raw.handlerId || "").trim().toLowerCase();
  if (handlerId.endsWith(".ynf")) return "ynf";
  if (handlerId.endsWith(".mdf")) return "mdf";
  if (handlerId.endsWith(".iform")) return "iform";
  if (handlerId === "generic.unknown") return "unknown";

  const webUrl = String(raw.webUrl || raw.mUrl || raw.originalUrl || "");
  let params = new URLSearchParams();
  try {
    params = new URL(webUrl).searchParams;
  } catch {
    params = new URLSearchParams(webUrl.split("?").slice(1).join("?"));
  }
  if (params.get("apptype") === "ynf" || webUrl.includes("/mdf-node/fragment/")) return "ynf";
  if (webUrl.toLowerCase().includes("/mdf-node/meta/voucher/")) return "mdf";
  if (
    (params.has("formId") && params.has("formInstanceId")) ||
    (params.has("pkBo") && params.has("pkBoins")) ||
    webUrl.includes("yonbip-ec-iform")
  ) return "iform";
  return "unknown";
}

function supportsExecutableActions(raw = {}) {
  return ["mdf", "iform"].includes(frameworkFromItem(raw));
}

function normalizeApprovalProcessing(raw = {}) {
  const processing = raw?.approvalProcessing;
  if (!processing || !["processing", "needs_review"].includes(processing.state)) return null;
  return {
    jobId: processing.jobId || null,
    state: processing.state,
    action: processing.action || null,
    submittedAt: processing.submittedAt || null,
    lastCheckedAt: processing.lastCheckedAt || null,
    phase: processing.phase || null,
    phaseStartedAt: processing.phaseStartedAt || null,
    finishedAt: processing.finishedAt || null,
    durationMs: Number.isFinite(Number(processing.durationMs)) ? Number(processing.durationMs) : null,
    remoteOutcome: processing.remoteOutcome || "unknown",
    reasonCode: processing.reasonCode || null,
    issue: processing.issue && typeof processing.issue === "object"
      ? {
          code: processing.issue.code || null,
          userMessage: processing.issue.userMessage || null,
        }
      : null,
  };
}

// ── 推断 ──────────────────────────────────────────────────

/**
 * 由 advice + 单据类型推断风险等级
 * @param {string|undefined} advice  approve | caution | reject
 * @param {string|undefined} type    patch | online | expense | ...
 * @returns {'high'|'medium'|'low'}
 */
export function inferRiskLevel(advice, type) {
  if (advice === "reject") return "high";
  if (advice === "approve") return "low";
  if (advice === "caution") return "medium";
  if (type === "online") return "high";
  return "medium";
}

// ── 分析解析 ──────────────────────────────────────────────

const EMPTY_5 = () => ({
  conclusion: { advice: "caution", label: "需关注" },
  overallAnalysis: "",
  fieldAnalysis: [],
  ruleAnalysis: [],
  attachmentAnalysis: [],
  fieldDisplayPlan: null,
});

/** 从一个对象中挑出 5 段字段并补默认 */
function pick5(obj) {
  const out = EMPTY_5();
  if (obj.conclusion && obj.conclusion.advice) {
    out.conclusion = {
      advice: obj.conclusion.advice,
      label: obj.conclusion.label || adviceLabel(obj.conclusion.advice),
    };
  }
  if (typeof obj.overallAnalysis === "string") out.overallAnalysis = obj.overallAnalysis;
  if (Array.isArray(obj.fieldAnalysis)) out.fieldAnalysis = normalizeFieldAnalysis(obj.fieldAnalysis);
  if (Array.isArray(obj.ruleAnalysis)) out.ruleAnalysis = normalizeRuleAnalysis(obj.ruleAnalysis);
  if (Array.isArray(obj.attachmentAnalysis)) out.attachmentAnalysis = normalizeAttachmentAnalysis(obj.attachmentAnalysis);
  out.fieldDisplayPlan = normalizeFieldDisplayPlan(obj.fieldDisplayPlan, {}, { allowUnresolved: true });
  return out;
}

function adviceLabel(advice) {
  return { approve: "建议通过", caution: "需关注", reject: "建议拒绝" }[advice] || "需关注";
}

/**
 * 解析分析内容为标准 5 段结构；无法识别时返回 null。
 * 接受：5 段对象 / { raw } 包裹 / JSON 字符串 / 围栏 JSON / Markdown([ADVICE:*])。
 * @param {object|string|null} analysis
 * @returns {ReturnType<typeof EMPTY_5>|null}
 */
export function parseAnalysis(analysis) {
  if (!analysis) return null;

  // 字符串：先尝试 JSON，失败则当作 { raw }
  let obj = analysis;
  if (typeof analysis === "string") {
    obj = tryParseJson(analysis) || { raw: analysis };
  }

  // 已是 5 段
  if (obj.conclusion && obj.conclusion.advice) return pick5(obj);

  // { raw: ... }（agent content 或参考 Markdown）
  const raw = obj.raw;
  if (typeof raw === "string") {
    const j = tryParseJson(raw);
    if (j && j.conclusion && j.conclusion.advice) return pick5(j);
    const adv = getAdvice(raw);
    if (adv) {
      const text = stripAdvice(raw);
      return {
        conclusion: { advice: adv.level, label: adv.label },
        overallAnalysis: text.length > 120 ? `${text.slice(0, 120)}…` : text,
        fieldAnalysis: [],
        ruleAnalysis: [],
        attachmentAnalysis: [],
        fieldDisplayPlan: null,
      };
    }
  }

  return null;
}

/**
 * 判断分析是否「完整」（本 skill enrich 产出的真分析），用于 skip 逻辑与 UI analyzed 标志。
 * 真分析的 fieldAnalysis/ruleAnalysis 条目带 summary（{name,value,summary,severity}）；
 * YonClaw 旧模板分析是 {field,value}（无 summary）→ 判为不完整，需重新分析。
 */
export function isCompleteAnalysis(a) {
  if (!a || !a.conclusion || !a.conclusion.advice) return false;
  const fa = Array.isArray(a.fieldAnalysis) ? a.fieldAnalysis : [];
  const ra = Array.isArray(a.ruleAnalysis) ? a.ruleAnalysis : [];
  return fa.some((f) => f && f.summary) || ra.some((r) => r && r.summary);
}

const AI_SUGGESTION_STATUS_LABELS = {
  queued: "等待AI分析",
  running: "AI分析中",
  failed: "AI分析失败",
};

function suggestionText(value) {
  return displayText(value).replace(/\s+/g, " ").trim();
}

function isConcreteSuggestion(value) {
  const text = suggestionText(value);
  if (!text) return false;
  return !/^(?:重要|需关注|建议通过|建议拒绝|高风险|中风险|低风险|通过|拒绝|驳回|可通过|无|无建议|无需处理)[。！!]?$/.test(text);
}

/**
 * 为列表提炼一条可执行的 AI 建议：总体分析 > 最高严重度规则 > 智能审核摘要 > 分析状态。
 * 风险等级文案只由 riskLevel 展示，这里不会回退为「需关注」等等级词。
 */
export function deriveListAiSuggestion({ analysis = null, systemRuleAudit = null, analysisStatus = "" } = {}) {
  const parsed = parseAnalysis(analysis);
  const overall = suggestionText(parsed?.overallAnalysis);
  if (isConcreteSuggestion(overall)) return overall;

  const severityRank = { risk: 3, warning: 2 };
  const rules = (parsed?.ruleAnalysis || [])
    .filter((rule) => rule && severityRank[rule.severity])
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) =>
      severityRank[b.rule.severity] - severityRank[a.rule.severity] ||
      Number(Boolean(b.rule.suggestion)) - Number(Boolean(a.rule.suggestion)) ||
      a.index - b.index
    );
  for (const { rule } of rules) {
    const detail = suggestionText(rule.suggestion || rule.summary);
    if (!isConcreteSuggestion(detail)) continue;
    const name = suggestionText(rule.ruleName);
    return name ? `${name}：${detail}` : detail;
  }

  const systemSummary = suggestionText(normalizeSystemRuleAudit(systemRuleAudit)?.AISummaryResultDesc);
  if (isConcreteSuggestion(systemSummary)) return systemSummary;

  return AI_SUGGESTION_STATUS_LABELS[analysisStatus] || "待AI分析";
}

// ── 列表项 ────────────────────────────────────────────────

/** 判断对象是否已是 v3 列表项 */
function isV3Item(raw) {
  return !!(raw && raw.id && raw.riskLevel && !raw.primaryId);
}

/**
 * 规范化单条列表项 → ApproveInboxItem。
 * @param {object} raw                参考 item 或 v3 item
 * @param {{ status?: 'pending'|'done' }} [opts]
 * @returns {object|null}
 */
export function normalizeListItem(raw, opts = {}) {
  if (!raw) return null;
  const returnedToDrafter = isReturnedToDrafterItem(raw);
  const status = returnedToDrafter ? "done" : (raw.status || opts.status || "pending");
  const originalUrl = normalizeOriginalUrl(raw.originalUrl, raw.webUrl, raw.mUrl);
  // 租户标注：crossTenant = 单据租户 ≠ 当前代理租户（无 currentTenantId 则不判定，避免误过滤）
  const tenantId = raw.tenantId || null;
  const tenantName = raw.tenantName || null;
  const crossTenant = !!(tenantId && opts.currentTenantId && tenantId !== opts.currentTenantId);
  const framework = frameworkFromItem(raw);
  const observedActions = (Array.isArray(raw.observedActions)
    ? raw.observedActions
    : (Array.isArray(raw.runtimeActions) ? raw.runtimeActions : []))
    .map((action) => ({ ...action }));
  const executableCandidates = Array.isArray(raw.runtimeActions)
    ? raw.runtimeActions
    : [];
  const runtimeActions = returnedToDrafter || crossTenant || !supportsExecutableActions(raw)
    ? []
    : executableCandidates.map((action) => ({ ...action }));
  const attachmentCount = Number(raw.attachmentCount || raw.content?.attachments?.length || raw.attachments?.length || 0);
  const hasAttachments = !!(raw.hasAttachments || attachmentCount > 0);
  const dueAt = raw.dueAt || raw.deadline || raw.limitTime || raw.endTime || raw.businessData?.limitTime || null;
  const receivedAt = resolveReceivedAt(raw);

  if (isV3Item(raw)) {
    const serviceName = normalizedServiceName(raw);
    const docType = serviceName || canonicalDocTypeName(raw.docType, raw);
    const displayKey = normalizeDisplayKey(raw, { docType });
    const docTypeName = serviceName
      || normalizedBusinessName(raw.docTypeName, raw)
      || normalizedBusinessName(raw.summary?.docTypeName, raw)
      || normalizedBusinessName(raw.summary?.documentTypeName, raw)
      || docType;
    return {
      id: raw.id,
      primaryId: raw.primaryId || raw.id,
      taskId: raw.taskId || raw.workflowTaskId || raw.summary?.taskId || null,
      workflowBusinessKey: raw.workflowBusinessKey || raw.summary?.workflowBusinessKey || null,
      yhtUserId: raw.yhtUserId || raw.summary?.yhtUserId || null,
      title: raw.title || "",
      serviceCode: firstText(raw.serviceCode, raw.summary?.serviceCode) || null,
      sourceServiceCode: firstText(raw.sourceServiceCode, raw.summary?.sourceServiceCode) || null,
      serviceName: serviceName || null,
      serviceNameSource: serviceName
        ? normalizedServiceNameSource(raw.serviceNameSource || raw.summary?.serviceNameSource)
        : null,
      docType,
      docTypeName,
      displayKey,
      displayLabel: normalizeDisplayLabel(raw, { displayKey, docType }),
      handlerId: raw.handlerId || null,
      framework,
      type: raw.type || null,
      processName: raw.processName || raw.summary?.processName || null,
      appName: raw.appName || raw.app || raw.summary?.appName || raw.summary?.app || null,
      summary: raw.summary || {},
      businessKey: raw.businessKey || raw.richDetail?.businessKey || raw.richDetail?.meta?.businessKey || null,
      originalUrl,
      riskLevel: raw.riskLevel,
      status,
      completedAt: raw.completedAt || (returnedToDrafter ? raw.submittedAt : undefined),
      completedAction: raw.completedAction || raw.approvalAction || (returnedToDrafter ? "return" : undefined),
      approvalAction: raw.approvalAction || raw.completedAction || (returnedToDrafter ? "return" : undefined),
      completionSource: raw.completionSource || (returnedToDrafter ? "todo.returned-to-drafter" : undefined),
      submittedAt: raw.submittedAt,
      ...receivedAt,
      submitter: raw.submitter || raw.commitUserName,
      advice: raw.advice,
      aiSuggestion: raw.aiSuggestion || deriveListAiSuggestion({
        analysis: raw.analysis,
        systemRuleAudit: raw.systemRuleAudit,
        analysisStatus: raw.analysisStatus,
      }),
      smartTags: cleanTags(raw.smartTags, raw.advice),
      runtimeActions,
      observedActions,
      ...(normalizeApprovalProcessing(raw) ? { approvalProcessing: normalizeApprovalProcessing(raw) } : {}),
      hasAttachments,
      attachmentCount,
      dueAt,
      tenantId,
      tenantName,
      crossTenant,
      voucher: isSupportedDetailUrl(raw.webUrl || ""),
    };
  }

  // 参考格式（primaryId）
  const id = raw.id || raw.primaryId;
  const parsed = parseAnalysis(raw.analysis);
  const advice = raw.advice || parsed?.conclusion?.advice;
  const summary = raw.summary || {};
  const serviceName = normalizedServiceName({ ...raw, summary });
  const docType = serviceName || canonicalDocTypeName(raw.docType || summary.typeLabel || raw.type, {
    ...raw,
    title: raw.title || summary.title,
    typeLabel: summary.typeLabel,
  });
  const displayKey = normalizeDisplayKey({ ...raw, summary }, { docType });
  const docTypeName = serviceName
    || normalizedBusinessName(raw.docTypeName, { ...raw, summary })
    || normalizedBusinessName(summary.docTypeName, { ...raw, summary })
    || normalizedBusinessName(summary.documentTypeName, { ...raw, summary })
    || docType;

  return {
    id,
    primaryId: raw.primaryId || id,
    taskId: raw.taskId || raw.workflowTaskId || summary.taskId || null,
    workflowBusinessKey: raw.workflowBusinessKey || summary.workflowBusinessKey || null,
    yhtUserId: raw.yhtUserId || summary.yhtUserId || null,
    title: raw.title || summary.title || "",
    serviceCode: firstText(raw.serviceCode, summary.serviceCode) || null,
    sourceServiceCode: firstText(raw.sourceServiceCode, summary.sourceServiceCode) || null,
    serviceName: serviceName || null,
    serviceNameSource: serviceName
      ? normalizedServiceNameSource(raw.serviceNameSource || summary.serviceNameSource)
      : null,
    docType,
    docTypeName,
    displayKey,
    displayLabel: normalizeDisplayLabel({ ...raw, summary }, { displayKey, docType }),
    handlerId: raw.handlerId || null,
    framework,
    type: raw.type || null,
    processName: raw.processName || summary.processName || null,
    appName: raw.appName || raw.app || summary.appName || summary.app || null,
    summary,
    businessKey: raw.businessKey || summary.businessKey || null,
    originalUrl,
    riskLevel: raw.riskLevel || inferRiskLevel(advice, raw.type),
    status,
    completedAt: raw.completedAt || (returnedToDrafter ? (raw.submittedAt || raw.commitTime || summary.commitTime) : undefined),
    completedAction: raw.completedAction || raw.approvalAction || (returnedToDrafter ? "return" : undefined),
    approvalAction: raw.approvalAction || raw.completedAction || (returnedToDrafter ? "return" : undefined),
    completionSource: raw.completionSource || (returnedToDrafter ? "todo.returned-to-drafter" : undefined),
    submittedAt: raw.submittedAt || raw.commitTime || summary.commitTime,
    ...receivedAt,
    submitter: raw.submitter || raw.commitUserName || summary.applicant,
    advice,
    aiSuggestion: raw.aiSuggestion || deriveListAiSuggestion({
      analysis: raw.analysis,
      systemRuleAudit: raw.systemRuleAudit,
      analysisStatus: raw.analysisStatus,
    }),
    smartTags: cleanTags(raw.smartTags, advice),
    runtimeActions,
    observedActions,
    ...(normalizeApprovalProcessing(raw) ? { approvalProcessing: normalizeApprovalProcessing(raw) } : {}),
    hasAttachments,
    attachmentCount,
    dueAt,
    tenantId,
    tenantName,
    crossTenant,
    voucher: isSupportedDetailUrl(raw.webUrl || ""),
  };
}

/**
 * 从详情分析派生「列表项徽标」：advice + riskLevel + smartTags（纯函数）。
 * 供 enrich 把详情分析结论回填到 inbox 列表项，使列表行显示建议/风险 tag。
 * @param {object|string|null} analysis  详情 analysis（5 段 / {raw} / JSON 串）
 * @returns {{advice:string, aiSuggestion:string, riskLevel:string, smartTags:Array<{label:string,kind:string}>}|null}
 */
export function deriveItemBadges(analysis) {
  const parsed = parseAnalysis(analysis);
  if (!parsed || !parsed.conclusion || !parsed.conclusion.advice) return null;
  const advice = parsed.conclusion.advice;
  const riskTags = [];
  const positiveTags = [];
  for (const r of parsed.ruleAnalysis || []) {
    if (r && (r.severity === "risk" || r.severity === "warning")) {
      riskTags.push(canonicalTag(`${r.ruleName || ""} ${r.summary || ""} ${r.evidence || ""} ${r.suggestion || ""}`, r.severity));
    } else if (r && r.severity === "passed") {
      positiveTags.push(canonicalTag(`${r.ruleName || ""} ${r.summary || ""}`, "advice", advice));
    }
  }
  for (const f of parsed.fieldAnalysis || []) {
    if (f && (f.severity === "risk" || f.severity === "warning")) {
      riskTags.push(canonicalTag(`${f.name || ""} ${f.value || ""} ${f.summary || ""}`, f.severity));
    } else if (f && f.severity === "passed") {
      positiveTags.push(canonicalTag(`${f.name || ""} ${f.summary || ""}`, "advice", advice));
    }
  }
  if (parsed.overallAnalysis) {
    (advice === "approve" ? positiveTags : riskTags).push(canonicalTag(parsed.overallAnalysis, advice === "approve" ? "advice" : "rule", advice));
  }
  const tags = riskTags.filter(Boolean).length
    ? uniqueTags(riskTags.filter(Boolean))
    : uniqueTags(positiveTags.filter(Boolean), advice === "approve" ? 1 : 2);
  if (!tags.length && advice === "approve") tags.push({ label: "预算内", kind: "advice" });
  return {
    advice,
    aiSuggestion: deriveListAiSuggestion({ analysis: parsed }),
    riskLevel: inferRiskLevel(advice),
    smartTags: tags,
  };
}

/**
 * 把参考 state（{lastSyncAt, inbox[], done[]}）或 v3 ApproveInboxData
 * 规范化为 v3 ApproveInboxData。
 * @param {object} state
 * @returns {object} ApproveInboxData
 */
export function normalizeInbox(state) {
  if (!state) return null;

  // 已是 v3 ApproveInboxData
  if (state.businessType === "approve-inbox" && Array.isArray(state.items)) {
    const currentTenantId = state.meta?.currentTenantId || null;
    const items = state.items
      .map((i) => normalizeListItem(i, { currentTenantId }))
      .filter(Boolean);
    const scopedItems = currentTenantId ? items.filter((i) => !i.crossTenant) : items;
    const rawSummary = state.summary || buildSummary(items, state.lastSyncAt);
    const summary = currentTenantId
      ? buildSummary(scopedItems, rawSummary.lastSyncAt || state.lastSyncAt || state.meta?.syncedAt)
      : rawSummary;
    const reviewSummary = currentTenantId
      ? computeSummary(scopedItems, "done")
      : (state.reviewSummary || computeSummary(items, "done"));
    return {
      businessType: "approve-inbox",
      summary,
      viewSettings: state.viewSettings || { defaultTabId: "all-todo" },
      items,
      reviewSummary,
      summaries: {
        pending: computeSummary(scopedItems, "pending"),
        done: reviewSummary && reviewSummary.scope !== "pending" ? reviewSummary : computeSummary(scopedItems, "done"),
      },
      meta: state.meta
        ? {
            ...state.meta,
            rawSummary: state.meta.rawSummary || (currentTenantId ? {
              total: items.length,
              pendingCount: items.filter((i) => i.status !== "done").length,
              doneCount: items.filter((i) => i.status === "done").length,
              crossTenantCount: items.length - scopedItems.length,
            } : undefined),
          }
        : null,
    };
  }

  const inboxItems = (state.inbox || [])
    .map((i) => normalizeListItem(i, { status: "pending" }))
    .filter(Boolean);
  const done = (state.done || [])
    .map((i) => normalizeListItem(i, { status: "done" }))
    .filter(Boolean);
  const items = [...inboxItems, ...done];
  const pending = items.filter((i) => i.status !== "done");
  const doneItems = items.filter((i) => i.status === "done");

  return {
    businessType: "approve-inbox",
    summary: {
      total: items.length,
      pendingCount: pending.length,
      doneCount: doneItems.length,
      lastSyncAt: state.lastSyncAt || null,
    },
    viewSettings: { defaultTabId: "all-todo" },
    items,
    reviewSummary: state.reviewSummary || computeSummary(items, "done"),
    summaries: {
      pending: computeSummary(items, "pending"),
      done: computeSummary(items, "done"),
    },
  };
}

function buildSummary(items, lastSyncAt) {
  const pendingCount = items.filter((i) => i.status !== "done").length;
  return {
    total: items.length,
    pendingCount,
    doneCount: items.length - pendingCount,
    lastSyncAt: lastSyncAt || null,
  };
}

/** 风险分布统计 */
function riskDist(arr) {
  return {
    high: arr.filter((i) => i.riskLevel === "high").length,
    medium: arr.filter((i) => i.riskLevel === "medium").length,
    low: arr.filter((i) => i.riskLevel === "low").length,
  };
}

/** 单据类型分布（降序） */
function typeDist(arr) {
  const m = {};
  for (const i of arr) {
    const t = i.serviceName || i.docType || "其他";
    m[t] = (m[t] || 0) + 1;
  }
  return Object.entries(m)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 从 items 统计生成某侧（待办/已办）智能总结（以数据统计 + 分析为主）。
 * 真实数据 inbox.json 不带 reviewSummary 时由此兜底现算，供「每个 tab 顶部 AI 总结」使用。
 * @param {Array} items 规范化后的列表项
 * @param {'pending'|'done'} scope
 * @returns {object|undefined} ApproveInboxReviewSummary
 */
export function computeSummary(items, scope = "done") {
  const subset = (items || []).filter((i) =>
    scope === "done" ? i.status === "done" : i.status !== "done"
  );
  if (subset.length === 0) return undefined;

  const riskDistribution = riskDist(subset);
  const typeDistribution = typeDist(subset);
  const top = typeDistribution[0];

  if (scope === "done") {
    const actionOf = (i) => i.completedAction || i.approvalAction || i.advice || "";
    const approvedCount = subset.filter((i) => actionOf(i) === "approve").length;
    const rejectedCount = subset.filter((i) => actionOf(i) === "reject").length;
    const returnedCount = subset.filter((i) =>
      actionOf(i) === "return" || i.completionSource === "todo.returned-to-drafter"
    ).length;
    const rate = Math.round((approvedCount / subset.length) * 100);
    const analysis =
      `共处理 ${subset.length} 件，通过 ${approvedCount} 件、驳回 ${rejectedCount} 件、退回 ${returnedCount} 件，通过率 ${rate}%。` +
      (riskDistribution.high ? `其中重要 ${riskDistribution.high} 件需重点复核。` : "整体风险可控。") +
      (top ? `单据类型以「${top.type}」最多（${top.count} 件）。` : "");
    return {
      scope: "done",
      period: "已办总结",
      total: subset.length,
      approvedCount,
      rejectedCount,
      returnedCount,
      riskDistribution,
      typeDistribution,
      highlights: [{ label: "通过率", value: `${rate}%` }],
      analysis,
    };
  }

  // pending
  const attentionCount = subset.filter((i) => i.advice === "caution" || i.riskLevel === "medium").length;
  const analysis =
    `待办 ${subset.length} 项，` +
    (riskDistribution.high ? `重要 ${riskDistribution.high} 项需重点处理，` : "") +
    `需关注 ${attentionCount} 项。` +
    (top ? `单据类型以「${top.type}」最多（${top.count} 项）。` : "");
  return {
    scope: "pending",
    period: "待办速览",
    total: subset.length,
    attentionCount,
    riskDistribution,
    typeDistribution,
    highlights: [
      { label: "重要", value: `${riskDistribution.high}` },
      { label: "需关注", value: `${attentionCount}` },
    ],
    analysis,
  };
}

/**
 * 已办智能总结（向后兼容薄封装）。
 * @param {Array} items
 * @returns {object|undefined}
 */
export function computeReviewSummary(items) {
  return computeSummary(items, "done");
}

// ── 详情 ──────────────────────────────────────────────────

/** 无分析时的兜底详情 */
export function fallbackDetail(fallbackItem = {}) {
  return {
    id: fallbackItem.id,
    title: fallbackItem.title || "审批单据详情",
    businessKey: fallbackItem.businessKey || null,
    originalUrl: normalizeOriginalUrl(fallbackItem.originalUrl, fallbackItem.webUrl, fallbackItem.mUrl),
    conclusion: { advice: "caution", label: "需关注" },
    overallAnalysis: "内容还在分析中，请稍候或重新点击上方的同步按钮。",
    fieldAnalysis: [],
    ruleAnalysis: [],
    attachmentAnalysis: [],
    fields: [],
    attachments: [],
    crossTenant: !!fallbackItem.crossTenant,
    tenantName: fallbackItem.tenantName || null,
    unsupportedType: fallbackItem.voucher === false,
    enriched: false,
    analyzed: false,
    source: "fallback",
  };
}

/**
 * 规范化单据详情 → ApproveInboxDetail（5 段）。
 * @param {object} rawDetail        参考 detail（{billDetail,iformData,analysis}）或 v3 详情
 * @param {object} [fallbackItem]   缺标题/ID 时的兜底来源（列表项）
 * @returns {object} ApproveInboxDetail
 */
export function normalizeDetail(rawDetail, fallbackItem = {}) {
  if (!rawDetail) return fallbackDetail(fallbackItem);

  // 真实单据字段 / 附件（enrich 后写入 content.fields/attachments）
  const realFields = normalizeRichFields(rawDetail);
  const legacyFields = normalizeFields(rawDetail.content?.fields);
  const fields = realFields.length ? realFields : legacyFields;
  const realAtts = Array.isArray(rawDetail.content?.attachments)
    ? rawDetail.content.attachments
    : (Array.isArray(rawDetail.attachments) ? rawDetail.attachments : []);
  const extra = {
    businessKey: rawDetail.businessKey || rawDetail.content?.businessKey || rawDetail.richDetail?.businessKey || rawDetail.richDetail?.meta?.businessKey || null,
    originalUrl: normalizeOriginalUrl(rawDetail.originalUrl, rawDetail.webUrl, rawDetail.mUrl, fallbackItem.originalUrl, fallbackItem.webUrl, fallbackItem.mUrl),
    fields,
    attachments: realAtts,
    enriched: fields.length > 0,
    // 跨租户 / 取数失败原因 / 分析失败原因（供前端区分四态文案，不再 blank）
    crossTenant: !!fallbackItem.crossTenant,
    tenantName: fallbackItem.tenantName || null,
    unavailableReason: rawDetail.content?.unavailableReason || null,
    detailFieldsUnavailable: rawDetail.content?.unavailable === true && fields.length === 0,
    analysisError: rawDetail.analysisError || rawDetail.content?.analysisError || null,
    analysisMeta: rawDetail.analysisMeta || null,
    unsupportedType: fallbackItem.voucher === false,
    // analyzed = 真实「完整」分析已生成（带 summary 的字段/规则分析）。
    // 旧模板残缺分析({field,value} 无 summary)判 false → 前端提示「分析未完成」+ 可重新分析。
    analyzed: isCompleteAnalysis(rawDetail.analysis) || isCompleteAnalysis(rawDetail),
    systemRuleAudit: normalizeSystemRuleAudit(rawDetail.systemRuleAudit),
    compositeAdvice: rawDetail.compositeAdvice || null,
    fieldDisplayPlan: normalizeFieldDisplayPlan(
      rawDetail.fieldDisplayPlan || rawDetail.analysis?.fieldDisplayPlan || rawDetail.displayPlan,
      { fields },
    ),
  };

  // 已是 v3 详情
  if (rawDetail.conclusion && rawDetail.conclusion.advice) {
    const base = pick5(rawDetail);
    const compositeAdvice = extra.compositeAdvice || buildCompositeAdvice({
      systemRuleAudit: extra.systemRuleAudit,
      analysis: rawDetail,
      fallbackConclusion: base.conclusion,
    });
    return {
      id: rawDetail.id || fallbackItem.id,
      title: rawDetail.title || fallbackItem.title || "审批单据详情",
      ...base,
      conclusion: compositeAdvice ? { advice: compositeAdvice.advice, label: compositeAdvice.label } : base.conclusion,
      ...extra,
      compositeAdvice,
      source: rawDetail.source || "skill",
    };
  }

  // 参考详情
  const id = rawDetail.id || rawDetail.primaryId || fallbackItem.id;
  const title =
    fallbackItem.title || rawDetail.title || rawDetail.billDetail?.title || "审批单据详情";
  const parsed = parseAnalysis(rawDetail.analysis);
  if (!parsed) {
    const fallback = { ...fallbackDetail({ id, title }), ...extra };
    const compositeAdvice = buildCompositeAdvice({
      systemRuleAudit: extra.systemRuleAudit,
      fallbackConclusion: fallback.conclusion,
    });
    return {
      ...fallback,
      conclusion: { advice: compositeAdvice.advice, label: compositeAdvice.label },
      compositeAdvice,
    };
  }
  const compositeAdvice = extra.compositeAdvice || buildCompositeAdvice({
    systemRuleAudit: extra.systemRuleAudit,
    analysis: rawDetail.analysis,
    fallbackConclusion: parsed.conclusion,
  });

  return {
    id,
    title,
    conclusion: compositeAdvice ? { advice: compositeAdvice.advice, label: compositeAdvice.label } : parsed.conclusion,
    overallAnalysis: parsed.overallAnalysis,
    fieldAnalysis: parsed.fieldAnalysis,
    ruleAnalysis: parsed.ruleAnalysis,
    attachmentAnalysis: parsed.attachmentAnalysis,
    ...extra,
    compositeAdvice,
    source: "skill",
  };
}
