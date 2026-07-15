export const SUPPORTED_FORMATS = new Set(["advice", "datetime", "date", "money", "number", "text", "risk", "tags", "attachment"]);

const RISK_LABELS = {
  high: "重要",
  medium: "需关注",
  low: "建议通过",
};

const ANALYSIS_STATUS_LABELS = {
  queued: "等待AI分析",
  running: "AI分析中",
  failed: "AI分析失败",
};

function pad(value) {
  return String(value).padStart(2, "0");
}

function parseDateValue(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = Math.abs(value) < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return parseDateValue(Number(text));
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateParts(date, { includeTime = false } = {}) {
  const base = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (!includeTime) return base;
  return `${base} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatNumber(value, options = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return new Intl.NumberFormat("en-US", options).format(number);
}

export function formatDisplayValue(value, field = {}, item = {}) {
  const format = field.format || "text";
  if (format === "advice") {
    return item.aiSuggestion || ANALYSIS_STATUS_LABELS[item.analysisStatus] || "待AI分析";
  }
  if (format === "risk") {
    return RISK_LABELS[value] || value || "-";
  }
  if (format === "tags") {
    const tags = Array.isArray(value) ? value : [];
    const text = tags.map((tag) => tag?.label || tag?.name || tag?.value || tag).filter(Boolean).join("、");
    return text || "-";
  }
  if (format === "attachment") {
    const count = Number(value || item.attachmentCount || 0);
    return item.hasAttachments || count > 0 ? String(count || 1) : "-";
  }
  if (value == null || value === "") return "-";
  if (format === "datetime" || format === "date") {
    const date = parseDateValue(value);
    if (!date) return String(value);
    return formatDateParts(date, { includeTime: format === "datetime" });
  }
  if (format === "money") {
    return formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? String(value);
  }
  if (format === "number") {
    return formatNumber(value, { maximumFractionDigits: 20 }) ?? String(value);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
