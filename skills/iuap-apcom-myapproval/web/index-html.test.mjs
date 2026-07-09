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

test("系统预置规则无有效结果时不渲染详情区块", () => {
  assert.match(html, /if \(status !== 'success'\) return '';/);
  assert.match(html, /if \(!resultDesc && !summaryDesc\) return '';/);
  assert.doesNotMatch(html, /智能审核系统规则暂未返回可用结果。/);
});
