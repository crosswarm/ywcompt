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
import { localizeFields } from "../analysis/profile-loader.js";

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
  if (CANONICAL_LABELS.has(s.trim())) {
    const found = CANONICAL_TAGS.find((tag) => tag.label === s.trim());
    return { label: found.label, kind: found.kind };
  }
  const pool = advice === "approve" || severityOrKind === "advice" || severityOrKind === "passed"
    ? [...CANONICAL_TAGS.filter((tag) => tag.kind === "advice"), ...CANONICAL_TAGS.filter((tag) => tag.kind !== "advice")]
    : CANONICAL_TAGS;
  const matched = pool.find((tag) => tag.re.test(s));
  if (matched) {
    const severe = severityOrKind === "risk" || (severityOrKind !== "advice" && matched.kind === "risk");
    return { label: matched.label, kind: severe ? "risk" : matched.kind };
  }
  if (advice === "approve" || severityOrKind === "advice" || severityOrKind === "passed") return { label: "预算内", kind: "advice" };
  if (severityOrKind === "risk") return { label: "高风险", kind: "risk" };
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
function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  return uniqueTags(
    tags
      .filter((t) => t && t.kind !== "info")
      .map((t) => canonicalTag(t.label, t.kind))
      .filter(Boolean),
  );
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

/** pending 默认行操作；done 无操作 */
function defaultActions(status) {
  if (status === "done") return [];
  return [
    { action: "approve", label: "通过", enabled: true },
    { action: "reject", label: "驳回", enabled: true },
  ];
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
  const status = raw.status || opts.status || "pending";
  // 租户标注：crossTenant = 单据租户 ≠ 当前代理租户（无 currentTenantId 则不判定，避免误过滤）
  const tenantId = raw.tenantId || null;
  const tenantName = raw.tenantName || null;
  const crossTenant = !!(tenantId && opts.currentTenantId && tenantId !== opts.currentTenantId);
  const runtimeActions = crossTenant
    ? []
    : (Array.isArray(raw.runtimeActions) ? raw.runtimeActions : defaultActions(status));
  const attachmentCount = Number(raw.attachmentCount || raw.content?.attachments?.length || raw.attachments?.length || 0);
  const hasAttachments = !!(raw.hasAttachments || attachmentCount > 0);

  if (isV3Item(raw)) {
    return {
      id: raw.id,
      title: raw.title || "",
      docType: raw.docType,
      riskLevel: raw.riskLevel,
      status,
      submittedAt: raw.submittedAt,
      submitter: raw.submitter || raw.commitUserName,
      advice: raw.advice,
      smartTags: cleanTags(raw.smartTags),
      runtimeActions,
      hasAttachments,
      attachmentCount,
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

  return {
    id,
    title: raw.title || summary.title || "",
    docType: raw.docType || summary.typeLabel || raw.type,
    riskLevel: raw.riskLevel || inferRiskLevel(advice, raw.type),
    status,
    submittedAt: raw.submittedAt || raw.commitTime || summary.commitTime,
    submitter: raw.submitter || raw.commitUserName || summary.applicant,
    advice,
    smartTags: cleanTags(raw.smartTags),
    runtimeActions,
    hasAttachments,
    attachmentCount,
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
 * @returns {{advice:string, riskLevel:string, smartTags:Array<{label:string,kind:string}>}|null}
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
  return { advice, riskLevel: inferRiskLevel(advice), smartTags: tags };
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
    const items = state.items.map((i) => normalizeListItem(i, { currentTenantId })).filter(Boolean);
    const reviewSummary = state.reviewSummary || computeSummary(items, "done");
    return {
      businessType: "approve-inbox",
      summary: state.summary || buildSummary(items, state.lastSyncAt),
      viewSettings: state.viewSettings || { defaultTabId: "all-todo" },
      items,
      reviewSummary,
      summaries: {
        pending: computeSummary(items, "pending"),
        done: state.reviewSummary && state.reviewSummary.scope !== "pending" ? state.reviewSummary : computeSummary(items, "done"),
      },
      meta: state.meta || null,
    };
  }

  const pending = (state.inbox || []).map((i) => normalizeListItem(i, { status: "pending" })).filter(Boolean);
  const done = (state.done || []).map((i) => normalizeListItem(i, { status: "done" })).filter(Boolean);
  const items = [...pending, ...done];

  return {
    businessType: "approve-inbox",
    summary: {
      total: items.length,
      pendingCount: pending.length,
      doneCount: done.length,
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
    const t = i.docType || "其他";
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
    const approvedCount = subset.filter((i) => i.advice === "approve").length;
    const rejectedCount = subset.filter((i) => i.advice === "reject").length;
    const returnedCount = subset.filter((i) => i.advice === "return").length;
    const rate = Math.round((approvedCount / subset.length) * 100);
    const analysis =
      `共处理 ${subset.length} 件，通过 ${approvedCount} 件、驳回 ${rejectedCount} 件，通过率 ${rate}%。` +
      (riskDistribution.high ? `其中高风险 ${riskDistribution.high} 件需重点复核。` : "整体风险可控。") +
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
    `待办 ${subset.length} 件，` +
    (riskDistribution.high ? `高风险 ${riskDistribution.high} 件需重点处理，` : "") +
    `需关注 ${attentionCount} 件。` +
    (top ? `单据类型以「${top.type}」最多（${top.count} 件）。` : "");
  return {
    scope: "pending",
    period: "待办速览",
    total: subset.length,
    attentionCount,
    riskDistribution,
    typeDistribution,
    highlights: [
      { label: "高风险", value: `${riskDistribution.high}` },
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
    fields,
    attachments: realAtts,
    enriched: fields.length > 0,
    // 跨租户 / 取数失败原因 / 分析失败原因（供前端区分四态文案，不再 blank）
    crossTenant: !!fallbackItem.crossTenant,
    tenantName: fallbackItem.tenantName || null,
    unavailableReason: rawDetail.content?.unavailableReason || null,
    analysisError: rawDetail.analysisError || rawDetail.content?.analysisError || null,
    unsupportedType: fallbackItem.voucher === false,
    // analyzed = 真实「完整」分析已生成（带 summary 的字段/规则分析）。
    // 旧模板残缺分析({field,value} 无 summary)判 false → 前端提示「分析未完成」+ 可重新分析。
    analyzed: isCompleteAnalysis(rawDetail.analysis) || isCompleteAnalysis(rawDetail),
  };

  // 已是 v3 详情
  if (rawDetail.conclusion && rawDetail.conclusion.advice) {
    const base = pick5(rawDetail);
    return {
      id: rawDetail.id || fallbackItem.id,
      title: rawDetail.title || fallbackItem.title || "审批单据详情",
      ...base,
      ...extra,
      source: rawDetail.source || "skill",
    };
  }

  // 参考详情
  const id = rawDetail.id || rawDetail.primaryId || fallbackItem.id;
  const title =
    fallbackItem.title || rawDetail.title || rawDetail.billDetail?.title || "审批单据详情";
  const parsed = parseAnalysis(rawDetail.analysis);
  if (!parsed) return { ...fallbackDetail({ id, title }), ...extra };

  return {
    id,
    title,
    conclusion: parsed.conclusion,
    overallAnalysis: parsed.overallAnalysis,
    fieldAnalysis: parsed.fieldAnalysis,
    ruleAnalysis: parsed.ruleAnalysis,
    attachmentAnalysis: parsed.attachmentAnalysis,
    ...extra,
    source: "skill",
  };
}
