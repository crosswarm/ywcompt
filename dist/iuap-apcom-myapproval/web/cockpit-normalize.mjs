/**
 * cockpit-normalize.mjs — approve-inbox v3 → ai-workbench 驾驶舱 business 组件形态。
 *
 * 宿主 BusinessWidget 的 approval-message-center 分支(renderMessageCenterItems)读取
 * messages/todoStats/highlights/queryMeta。本模块把 normalized inbox 数据投影成该形态,
 * 供 GET /api/widget/cockpit 使用。纯函数,无 IO,可单测。
 *
 * 字段对齐宿主渲染器(BusinessWidget.tsx:renderMessageCenterItems):
 *   item.title | item.summary/description/content | item.priority|status|type(色块文案)
 *   | item.source|category · item.owner|assignee · item.submittedAt | item.actions
 */

import { inferRiskLevel } from "./normalize.mjs";

const RISK_WEIGHT = { high: 0, medium: 1, low: 2 };
const ADVICE_STATUS = { approve: "passed", caution: "warning", reject: "risk" };
const DEFAULT_LIMIT = 5;
const ACTION_KIND_WHITELIST = new Set(["approve", "agree", "reject", "return", "assign"]);
const SKILL_ID = "iuap-apcom-myapproval";
const SKILL_ALIASES = ["iuap-apcom-approveinbox", "approve-inbox"];

function asDate(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{10,13}$/.test(value.trim())) {
    const d = new Date(Number(value.trim()));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeLimit(value) {
  const n = Number(value || DEFAULT_LIMIT);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(8, Math.floor(n)));
}

function compareReceivedAtDesc(a, b) {
  const aTime = asDate(a?.receivedAt)?.getTime();
  const bTime = asDate(b?.receivedAt)?.getTime();
  const aMissing = !Number.isFinite(aTime);
  const bMissing = !Number.isFinite(bTime);
  if (aMissing !== bMissing) return aMissing ? 1 : -1;
  if (aMissing) return 0;
  return bTime - aTime;
}

function isPending(item) {
  return item && (item.status === "pending" || !item.status);
}

function isHighRisk(item) {
  return item?.riskLevel === "high" || item?.advice === "reject";
}

function explicitDueAt(item) {
  const d = asDate(item?.dueAt || item?.deadline);
  return d ? d.toISOString() : null;
}

function formatDateHint(iso) {
  const d = asDate(iso);
  if (!d) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `今日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function itemContent(item, dueAt) {
  const parts = [];
  const businessName = item.serviceName || item.docType;
  if (businessName) parts.push(businessName);
  if (item.submitter || item.commitUserName) parts.push(item.submitter || item.commitUserName);
  if (dueAt) parts.push(`截止 ${formatDateHint(dueAt)}`);
  return parts.join(" · ");
}

function toActions(runtimeActions) {
  if (!Array.isArray(runtimeActions)) return [];
  return runtimeActions
    .filter((a) => a && (ACTION_KIND_WHITELIST.has(a.kind) || ACTION_KIND_WHITELIST.has(a.action)))
    .map((a) => ({ label: a.label || a.kind || a.action || "操作", action: a.kind || a.action || "approve" }));
}

function centerEmbedUrl(...candidates) {
  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (!text) continue;
    try {
      const url = new URL(text);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return `${url.origin}/?embed=cockpit-drawer`;
      }
    } catch {
      // 非 URL 值忽略。
    }
  }
  return "/?embed=cockpit-drawer";
}

function widgetLink(options = {}) {
  return {
    enabled: true,
    title: "打开智能待办",
    interaction: "drawer",
    targetType: "service",
    contentType: "iframe",
    url: centerEmbedUrl(options.centerEmbedUrl, options.centerUrl, options.refreshUrl),
    allowFullscreen: true,
  };
}

/**
 * 把 v3 ApproveInboxData 投影成宿主 approval-message-center business 组件数据形态。
 * @param {object} inboxData  normalized ApproveInboxData(items/summary/summaries)
 * @param {object} options    { limit, centerUrl, refreshUrl }
 */
export function buildCockpitData(inboxData, options = {}) {
  const limit = normalizeLimit(options.limit);
  const items = Array.isArray(inboxData?.items) ? inboxData.items : [];

  const allDone = items.filter((item) => item && item.status === "done");
  const pending = items.filter((item) => isPending(item) && !item.crossTenant);
  const dueAts = new Map(pending.map((item) => [item.id, explicitDueAt(item)]));

  const sorted = [...pending].sort((a, b) => {
    const byRisk = (RISK_WEIGHT[a.riskLevel] ?? 3) - (RISK_WEIGHT[b.riskLevel] ?? 3);
    if (byRisk !== 0) return byRisk;
    const ad = dueAts.get(a.id) || "";
    const bd = dueAts.get(b.id) || "";
    if (ad || bd) return String(ad || "9999").localeCompare(String(bd || "9999"));
    return compareReceivedAtDesc(a, b);
  });

  const messages = sorted.slice(0, limit).map((item) => {
    const dueAt = dueAts.get(item.id) || null;
    const actions = toActions(item.runtimeActions);
    return {
      todoId: item.id,
      title: item.title || "未命名待办",
      content: itemContent(item, dueAt),
      priority: item.riskLevel || inferRiskLevel(item.advice) || "medium",
      status: ADVICE_STATUS[item.advice] || "warning",
      source: item.serviceName || item.docType || item.sourceApp || "",
      owner: item.submitter || item.commitUserName || "",
      submittedAt: item.submittedAt || "",
      receivedAt: asDate(item.receivedAt)?.toISOString() || null,
      receivedAtSource: item.receivedAtSource || "unavailable",
      receivedAtSourceLabel: item.receivedAtSourceLabel || "到手时间不可用",
      dueTime: dueAt || "",
      tags: (item.smartTags || []).slice(0, 3),
      actions,
      availableActions: actions.map((a) => a.action),
    };
  });

  const todo = pending.length;
  const highRisk = pending.filter(isHighRisk).length;
  const actionable = pending.filter((item) => Array.isArray(item.runtimeActions) && item.runtimeActions.length > 0).length;

  const todoStats = {
    todo,
    actionable,
    urgent: highRisk,
    done: allDone.length,
    highRisk,
  };

  const highlights = [
    { id: "ai-todo", label: "待办", value: todo, tone: todo > 0 ? "warning" : "passed" },
    { id: "ai-risk", label: "重要", value: highRisk, tone: highRisk > 0 ? "risk" : "passed" },
  ];

  const syncedAt = inboxData?.summary?.lastSyncAt || null;
  const queryMeta = {
    status: "todo",
    filterSummary: "待处理审批(默认仅当前租户)",
    syncedAt,
  };

  return {
    businessType: "approval-message-center",
    skillId: SKILL_ID,
    skillAliases: SKILL_ALIASES,
    messages,
    todoStats,
    highlights,
    queryMeta,
    syncedAt,
    actions: {
      openCenterUrl: options.centerUrl || "/",
      refreshUrl: options.refreshUrl || "/api/widget/refresh",
    },
    link: widgetLink(options),
    state: todo > 0 ? "ready" : "empty",
  };
}
