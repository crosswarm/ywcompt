import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

test("原始单据链接显式新窗口打开，不占用驾驶舱窗口", () => {
  assert.match(html, /data-original-detail-url="1"/);
  assert.match(html, /const cockpitEmbed = document\.documentElement\.classList\.contains\('is-cockpit-embed'\);/);
  assert.match(
    html,
    /window\.open\(originalLink\.href,\s*'_blank',\s*'noopener,noreferrer'\);/s
  );
});

test("智能待办不再渲染右下角问答入口", () => {
  assert.match(html, /function renderYonClawChat\(\) \{\s*return '';\s*\}/);
  assert.doesNotMatch(html, /id="btnYonClawOpen"/);
});

test("企业规则无有效结果时不渲染详情区块", () => {
  assert.match(html, /if \(status !== 'success'\) return '';/);
  assert.match(html, /if \(!resultDesc && !summaryDesc\) return '';/);
  assert.doesNotMatch(html, /智能审核系统规则暂未返回可用结果。/);
});

test("列表和详情顶部都提示可通过 YonWork 定制", () => {
  assert.match(html, /可在 YonWork 对话中定制智能待办列表、详情页面与智能审核规则/);
  assert.match(html, /yc-approve-inbox-customization-hint/g);
  assert.match(html, /可在 YonWork 对话中定制智能待办列表、详情页面与智能审核规则[\s\S]*<header class="yc-approve-inbox-header"/);
  assert.match(html, /<header class="yc-approve-inbox-detail-header"[\s\S]*yc-approve-inbox-customization-hint/);
});

test("详情分析区使用面向用户的新名称", () => {
  assert.match(html, />信息分析</);
  assert.match(html, />个人规则（可定制）</);
  assert.match(html, />企业规则</);
  assert.doesNotMatch(html, />单据字段分析</);
  assert.doesNotMatch(html, />用户级规则分析</);
  assert.doesNotMatch(html, />系统预置规则</);
});

test("列表使用行动型 AI 建议和统一风险文案", () => {
  assert.match(html, /const RISK_LABEL = \{ high: '重要', medium: '需关注', low: '建议通过' \}/);
  assert.match(html, /renderAdvice\(item\)/);
  assert.match(html, /item\.aiSuggestion/);
  assert.doesNotMatch(html, /const RISK_LABEL = \{ high: '高风险'/);
});

test("列表和详情区分到手时间、来源和提交时间", () => {
  assert.match(html, /\{ id: 'receivedAt', label: '到手时间', path: 'receivedAt'/);
  assert.match(html, /receivedAtSourceLabel/);
  assert.match(html, /到手时间不可用/);
  assert.match(html, /\{ id: 'submittedAt', label: '提交时间', path: 'submittedAt'/);
  assert.match(html, /sortByReceivedAt\(filterItems/);
  assert.match(html, /Number\.isNaN\(at\)/);
  assert.match(html, /yc-mail-head-receivedAt/);
});

test("列表始终显示简洁的重新分析按钮", () => {
  assert.match(html, /id="btnReanalyzePending" title="重新分析"/);
  assert.match(html, /icon\('bot'\) \+ '重新分析<\/button>'/);
  assert.doesNotMatch(html, /if \(pendingAnalysis > 0\)/);
  assert.doesNotMatch(html, /重新分析未完成/);
});
