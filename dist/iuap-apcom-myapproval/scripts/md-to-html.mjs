/**
 * md-to-html.mjs — Markdown 转 HTML 工具函数
 *
 * 纯函数，无外部依赖，专为单元测试设计。
 */

const ADVICE_LABELS = { APPROVE: "建议通过", CAUTION: "需关注", REJECT: "建议拒绝" };
const ADVICE_COLORS = { APPROVE: "green", CAUTION: "yellow", REJECT: "red" };
const ADVICE_PATTERN = /\[ADVICE:(APPROVE|CAUTION|REJECT)\]/;

/**
 * 从原始文本中提取审批建议等级
 * @param {string|null} raw
 * @returns {{ level: string, color: string, label: string } | null}
 */
export function getAdvice(raw) {
  if (!raw) return null;
  const m = raw.match(ADVICE_PATTERN);
  if (!m) return null;
  const k = m[1];
  return { level: k.toLowerCase(), color: ADVICE_COLORS[k], label: ADVICE_LABELS[k] };
}

/**
 * 将 Markdown 格式的 AI 分析结果渲染为 HTML
 * 支持的语法：标题(#/##/###)、粗体(**)、斜体(*)、行内代码(`)、无序列表(-)
 * @param {string|null} text
 * @returns {string}
 */
export function mdToHtml(text) {
  if (!text) return "";

  // 提取 ADVICE 标记（单独处理，不放入行内处理）
  let adviceHtml = "";
  text = text.replace(ADVICE_PATTERN, (_, k) => {
    adviceHtml = `<span class="advice-inline advice-${ADVICE_COLORS[k]}">● ${ADVICE_LABELS[k]}</span>`;
    return "";
  }).trim();

  // HTML 转义
  text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // 行内格式化
  text = text
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");

  // 逐行处理：标题 / 列表 / 段落
  const out = [];
  let inList = false;
  for (const line of text.split("\n")) {
    const h = line.match(/^(#{1,4})\s+(.+)/);
    if (h) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h${h[1].length + 1}>${h[2]}</h${h[1].length + 1}>`);
    } else if (/^- /.test(line)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${line.slice(2)}</li>`);
    } else if (line.trim() === "") {
      if (inList) { out.push("</ul>"); inList = false; }
    } else {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<p>${line}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  if (adviceHtml) out.push(`<p>${adviceHtml}</p>`);

  return out.join("\n");
}

/**
 * 格式化文件大小
 * @param {number} bytes
 * @returns {string}
 */
export function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
