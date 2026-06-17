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

/** 清洗智能标签：剔除 kind='info' 的元信息标签（如提交人，已由列表 meta 行展示） */
function cleanTags(tags) {
  return Array.isArray(tags) ? tags.filter((t) => t && t.kind !== "info") : [];
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
  if (Array.isArray(obj.fieldAnalysis)) out.fieldAnalysis = obj.fieldAnalysis;
  if (Array.isArray(obj.ruleAnalysis)) out.ruleAnalysis = obj.ruleAnalysis;
  if (Array.isArray(obj.attachmentAnalysis)) out.attachmentAnalysis = obj.attachmentAnalysis;
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
      runtimeActions: Array.isArray(raw.runtimeActions) ? raw.runtimeActions : defaultActions(status),
      tenantId,
      tenantName,
      crossTenant,
      voucher: (raw.webUrl || "").includes("/voucher/"),
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
    runtimeActions: Array.isArray(raw.runtimeActions) ? raw.runtimeActions : defaultActions(status),
    tenantId,
    tenantName,
    crossTenant,
    voucher: (raw.webUrl || "").includes("/voucher/"),
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
  const tags = [];
  for (const r of parsed.ruleAnalysis || []) {
    if (r && (r.severity === "risk" || r.severity === "warning")) {
      tags.push({ label: String(r.summary || r.ruleName || "").slice(0, 16), kind: r.severity === "risk" ? "risk" : "rule" });
    }
  }
  for (const f of parsed.fieldAnalysis || []) {
    if (f && (f.severity === "risk" || f.severity === "warning")) {
      tags.push({ label: String(f.name || "").slice(0, 16), kind: f.severity === "risk" ? "risk" : "rule" });
    }
  }
  return { advice, riskLevel: inferRiskLevel(advice), smartTags: tags.filter((t) => t.label).slice(0, 4) };
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
    overallAnalysis: "暂无 AI 分析结果，请先运行同步与分析（POST /api/sync）。",
    fieldAnalysis: [],
    ruleAnalysis: [],
    attachmentAnalysis: [],
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
  const realFields = Array.isArray(rawDetail.content?.fields) ? rawDetail.content.fields : [];
  const realAtts = Array.isArray(rawDetail.content?.attachments) ? rawDetail.content.attachments : [];
  const extra = {
    fields: realFields,
    attachments: realAtts,
    enriched: realFields.length > 0,
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
