/**
 * md-to-html.test.mjs — 单元测试
 *
 * 用法：node --test scripts/md-to-html.test.mjs
 * 或者：node scripts/md-to-html.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mdToHtml, getAdvice, formatSize } from "./md-to-html.mjs";

// ── getAdvice ──────────────────────────────────────────────

describe("getAdvice()", () => {
  it("返回 null 当输入为 null/undefined", () => {
    assert.equal(getAdvice(null), null);
    assert.equal(getAdvice(undefined), null);
  });

  it("返回 null 当无 ADVICE 标记", () => {
    assert.equal(getAdvice("普通文本"), null);
    assert.equal(getAdvice(""), null);
    assert.equal(getAdvice("建议批准"), null);
  });

  it("识别 APPROVE", () => {
    const r = getAdvice("内容\n[ADVICE:APPROVE]");
    assert.deepEqual(r, { level: "approve", color: "green", label: "建议通过" });
  });

  it("识别 CAUTION", () => {
    const r = getAdvice("[ADVICE:CAUTION]");
    assert.deepEqual(r, { level: "caution", color: "yellow", label: "需关注" });
  });

  it("识别 REJECT", () => {
    const r = getAdvice("分析结束\n[ADVICE:REJECT]");
    assert.deepEqual(r, { level: "reject", color: "red", label: "建议拒绝" });
  });
});

// ── formatSize ─────────────────────────────────────────────

describe("formatSize()", () => {
  it("格式化字节", () => {
    assert.equal(formatSize(0), "0 B");
    assert.equal(formatSize(512), "512 B");
    assert.equal(formatSize(1023), "1023 B");
  });

  it("格式化 KB", () => {
    assert.equal(formatSize(1024), "1.0 KB");
    assert.equal(formatSize(15360), "15.0 KB");
  });

  it("格式化 MB", () => {
    assert.equal(formatSize(1048576), "1.0 MB");
    assert.equal(formatSize(2097152), "2.0 MB");
  });

  it("返回空字符串当输入无效", () => {
    assert.equal(formatSize(null), "");
    assert.equal(formatSize(undefined), "");
  });
});

// ── mdToHtml ───────────────────────────────────────────────

describe("mdToHtml()", () => {
  it("返回空字符串当输入为 null/空", () => {
    assert.equal(mdToHtml(null), "");
    assert.equal(mdToHtml(""), "");
  });

  it("转义 HTML 特殊字符", () => {
    const result = mdToHtml("<script>alert('xss')</script>");
    assert.ok(result.includes("&lt;script&gt;"));
    assert.ok(!result.includes("<script>"));
  });

  it("转换 ## 标题为 h3", () => {
    const result = mdToHtml("## 审批分析");
    assert.ok(result.includes("<h3>审批分析</h3>"));
  });

  it("转换 ### 标题为 h4", () => {
    const result = mdToHtml("### 子标题");
    assert.ok(result.includes("<h4>子标题</h4>"));
  });

  it("转换 # 标题为 h2", () => {
    const result = mdToHtml("# 大标题");
    assert.ok(result.includes("<h2>大标题</h2>"));
  });

  it("转换 **加粗** 为 strong", () => {
    const result = mdToHtml("这是**重要**内容");
    assert.ok(result.includes("<strong>重要</strong>"));
  });

  it("转换 *斜体* 为 em", () => {
    const result = mdToHtml("这是*斜体*");
    assert.ok(result.includes("<em>斜体</em>"));
  });

  it("转换 ***加粗斜体***", () => {
    const result = mdToHtml("***重要***");
    assert.ok(result.includes("<strong><em>重要</em></strong>"));
  });

  it("转换 `行内代码` 为 code", () => {
    const result = mdToHtml("使用 `npm test` 运行");
    assert.ok(result.includes("<code>npm test</code>"));
  });

  it("转换无序列表", () => {
    const result = mdToHtml("- 项目1\n- 项目2");
    assert.ok(result.includes("<ul>"));
    assert.ok(result.includes("<li>项目1</li>"));
    assert.ok(result.includes("<li>项目2</li>"));
  });

  it("普通文本包裹 p 标签", () => {
    const result = mdToHtml("这是一段普通文本");
    assert.equal(result, "<p>这是一段普通文本</p>");
  });

  it("段落之间用 p 分隔", () => {
    const result = mdToHtml("第一段\n\n第二段");
    assert.ok(result.includes("<p>第一段</p>"));
    assert.ok(result.includes("<p>第二段</p>"));
  });

  it("移除 ADVICE 标记并生成内联徽章", () => {
    const result = mdToHtml("分析正文\n[ADVICE:CAUTION]");
    assert.ok(!result.includes("[ADVICE:CAUTION]"), "应移除原始标记");
    assert.ok(result.includes("advice-inline"), "应包含徽章类");
    assert.ok(result.includes("advice-yellow"), "颜色类应正确");
    assert.ok(result.includes("需关注"), "应包含中文标签");
  });

  it("综合场景", () => {
    const input = [
      "## 审批建议",
      "",
      "建议：**补充信息后批准**",
      "",
      "理由：",
      "- 业务合理",
      "- 风险可控",
      "",
      "[ADVICE:APPROVE]",
    ].join("\n");

    const result = mdToHtml(input);
    assert.ok(result.includes("<h3>审批建议</h3>"));
    assert.ok(result.includes("<strong>补充信息后批准</strong>"));
    assert.ok(result.includes("<li>业务合理</li>"));
    assert.ok(result.includes("advice-green"));
    assert.ok(result.includes("建议通过"));
  });
});
