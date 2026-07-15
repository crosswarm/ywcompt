/**
 * widget-data.mjs — compact cockpit widget projection for approve-inbox.
 *
 * The full inbox page owns detail analysis and approval actions. This module
 * only turns normalized inbox data into a small, scannable cockpit entrypoint.
 */

const RISK_WEIGHT = { high: 0, medium: 1, low: 2 };
const DEFAULT_LIMIT = 3;
const SKILL_ID = "iuap-apcom-myapproval";
const SKILL_ALIASES = ["iuap-apcom-approval", "iuap-apcom-approveinbox", "approve-inbox"];

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

function asDate(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{10,13}$/.test(value.trim())) {
    const date = new Date(Number(value.trim()));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function riskWeight(item) {
  return RISK_WEIGHT[item?.riskLevel] ?? 3;
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

function isHighPriority(item) {
  return item?.riskLevel === "high" || item?.advice === "reject";
}

function isAttention(item) {
  return item?.riskLevel === "medium" || item?.advice === "caution";
}

function explicitDueAt(item) {
  const due = asDate(item?.dueAt || item?.deadline);
  return due ? due.toISOString() : null;
}

function formatDateHint(iso) {
  const d = asDate(iso);
  if (!d) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `今日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function itemSubtitle(item, dueAt) {
  const parts = [];
  const businessName = item.serviceName || item.docType;
  if (businessName) parts.push(businessName);
  if (item.submitter) parts.push(item.submitter);
  const dueText = dueAt ? `截止 ${formatDateHint(dueAt)}` : "";
  if (dueText) parts.push(dueText);
  return parts.join(" · ");
}

function normalizeLimit(value) {
  const n = Number(value || DEFAULT_LIMIT);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(8, Math.floor(n)));
}

export function buildWidgetData(inboxData, options = {}) {
  const limit = normalizeLimit(options.limit);
  const items = Array.isArray(inboxData?.items) ? inboxData.items : [];
  const pending = items.filter((item) => isPending(item) && !item.crossTenant);
  const dueAts = new Map(pending.map((item) => [item.id, explicitDueAt(item)]));
  const highPriorityCount = pending.filter(isHighPriority).length;
  const attentionCount = pending.filter(isAttention).length;

  const visibleItems = [...pending]
    .sort((a, b) => {
      const byRisk = riskWeight(a) - riskWeight(b);
      if (byRisk !== 0) return byRisk;
      const ad = dueAts.get(a.id) || "";
      const bd = dueAts.get(b.id) || "";
      if (ad || bd) return String(ad || "9999").localeCompare(String(bd || "9999"));
      return compareReceivedAtDesc(a, b);
    })
    .slice(0, limit)
    .map((item) => {
      const dueAt = dueAts.get(item.id) || null;
      return {
        id: item.id,
        title: item.title || "未命名待办",
        subtitle: itemSubtitle(item, dueAt),
        tags: (item.smartTags || []).slice(0, 2),
        riskLevel: item.riskLevel || "medium",
        advice: item.advice || null,
        dueAt,
        receivedAt: asDate(item.receivedAt)?.toISOString() || null,
        receivedAtSource: item.receivedAtSource || "unavailable",
        receivedAtSourceLabel: item.receivedAtSourceLabel || "到手时间不可用",
      };
    });

  const topType = (inboxData?.summaries?.pending?.typeDistribution || [])[0];
  const analysis =
    pending.length === 0
      ? "当前没有待处理事项。"
      : [
          `待办 ${pending.length} 项`,
          highPriorityCount ? `高优先级 ${highPriorityCount} 项` : "",
          attentionCount ? `需关注 ${attentionCount} 项` : "",
          topType ? `主要类型为「${topType.type}」` : "",
        ].filter(Boolean).join("，") + "。";

  return {
    businessType: "approve-inbox-widget",
    skillId: SKILL_ID,
    skillAliases: SKILL_ALIASES,
    summary: {
      pendingCount: pending.length,
      highPriorityCount,
      attentionCount,
      lastSyncAt: inboxData?.summary?.lastSyncAt || null,
    },
    items: visibleItems,
    magicSummary: analysis,
    actions: {
      openCenterUrl: options.centerUrl || "/",
      refreshUrl: options.refreshUrl || "/api/widget/refresh",
    },
    link: widgetLink(options),
    state: pending.length > 0 ? "ready" : "empty",
  };
}
