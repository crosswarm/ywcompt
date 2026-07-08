/**
 * agent-runner.test.mjs — buildAnalysisPrompt 单测（纯函数部分，不调 claude）
 * 覆盖：5 段输出约束、向后兼容（无 profile）、profile 驱动（含维度/规则/真实字段）。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAnalysisPrompt, buildFileContext, extractContent } from "./agent-runner.mjs";

const item = { title: "2026年Q3采购合同", docType: "采购", submitter: "王建国" };
const detail = { billDetail: {} };

describe("buildAnalysisPrompt() 通用模式（向后兼容）", () => {
  it("不传 opts 时含 5 段输出格式 + 单据信息", () => {
    const p = buildAnalysisPrompt(item, detail);
    assert.ok(p.includes("conclusion"));
    assert.ok(p.includes("fieldAnalysis"));
    assert.ok(p.includes("ruleAnalysis"));
    assert.ok(p.includes("attachmentAnalysis"));
    assert.ok(p.includes("【单据信息】"));
    assert.ok(p.includes("2026年Q3采购合同"));
  });
  it("无 profile 时不含分析套路片段", () => {
    const p = buildAnalysisPrompt(item, detail);
    assert.ok(!p.includes("【分析套路"));
    assert.ok(!p.includes("【单据字段（真实抓取）】"));
  });
  it("申请人回退到 submitter", () => {
    const p = buildAnalysisPrompt(item, detail);
    assert.ok(p.includes("王建国"));
  });
  it("有附件元信息时要求输出附件分析，不编造正文", () => {
    const p = buildAnalysisPrompt(
      {
        ...item,
        attachments: [
          { fileName: "请购单_增强说明版.docx", fileType: "docx", size: 44582, error: "download_url_missing" },
        ],
      },
      detail,
    );
    assert.ok(p.includes("【附件】"));
    assert.ok(p.includes("请购单_增强说明版.docx"));
    assert.ok(p.includes("正文未解析：download_url_missing"));
    assert.ok(p.includes("有【附件】元信息"));
    assert.ok(p.includes("不得编造附件正文内容"));
  });
});

describe("buildAnalysisPrompt() profile 驱动模式", () => {
  const profile = {
    docType: "采购",
    businessRules: [
      { ruleName: "大额采购双签", checkpoint: "超阈值须双签", severityHint: "risk" },
      { ruleName: "预付款比例限制", checkpoint: "预付≤30%" },
    ],
    keyFields: ["合同金额", "供应商"],
    promptHint: "关注金额超预算",
  };
  const dimensions = [
    { id: "amount-compliance", name: "金额合规", checkpoints: ["金额在权限内", "大额双签"] },
  ];
  const fields = [
    { name: "合同金额", value: "¥1,340,000", key: "total_currency_money" },
    { name: "供应商", value: "华为技术", key: "supplier_name" },
  ];

  it("含分析套路片段（docType + 业务规则 + 重点字段 + 提示）", () => {
    const p = buildAnalysisPrompt(item, detail, { profile, dimensions, fields });
    assert.ok(p.includes("【分析套路 · 采购】"));
    assert.ok(p.includes("大额采购双签"));
    assert.ok(p.includes("预付款比例限制"));
    assert.ok(p.includes("重点字段：合同金额、供应商"));
    assert.ok(p.includes("关注金额超预算"));
  });
  it("含展开的通用维检查点", () => {
    const p = buildAnalysisPrompt(item, detail, { profile, dimensions, fields });
    assert.ok(p.includes("金额合规"));
    assert.ok(p.includes("大额双签"));
  });
  it("含中文化真实字段", () => {
    const p = buildAnalysisPrompt(item, detail, { profile, dimensions, fields });
    assert.ok(p.includes("【单据字段（真实抓取）】"));
    assert.ok(p.includes("合同金额：¥1,340,000"));
    assert.ok(p.includes("供应商：华为技术"));
  });
  it("仍保留 5 段输出约束", () => {
    const p = buildAnalysisPrompt(item, detail, { profile, dimensions, fields });
    assert.ok(p.includes("conclusion"));
    assert.ok(p.includes("evidence"));
  });
  it("空字段值被过滤", () => {
    const p = buildAnalysisPrompt(item, detail, {
      profile,
      fields: [{ name: "空字段", value: "" }, { name: "有值", value: "x" }],
    });
    assert.ok(!p.includes("空字段"));
    assert.ok(p.includes("有值：x"));
  });
});

describe("extractContent() — 兼容用友模型 JSON / SSE 返回", () => {
  it("标准 JSON：取 choices[0].message.content", () => {
    const t = JSON.stringify({ choices: [{ message: { content: '{"conclusion":{}}' } }] });
    assert.equal(extractContent(t), '{"conclusion":{}}');
  });
  it("SSE 流式：累加 delta.content，忽略 reasoning_content", () => {
    const t = [
      'data: {"choices":[{"delta":{"reasoning_content":"想一下"}}]}',
      'data: {"choices":[{"delta":{"content":"{\\"a\\":"}}]}',
      'data: {"choices":[{"delta":{"content":"1}"}}]}',
      "data: [DONE]",
    ].join("\n");
    assert.equal(extractContent(t), '{"a":1}');
  });
  it("空/坏输入返回空串", () => {
    assert.equal(extractContent(""), "");
    assert.equal(extractContent("not json not sse"), "");
    assert.equal(extractContent(null), "");
  });
});

describe("buildFileContext()", () => {
  it("读取文本附件内容并嵌入 prompt 上下文", () => {
    const dir = mkdtempSync(join(tmpdir(), "approve-inbox-agent-"));
    const file = join(dir, "报价说明.txt");
    writeFileSync(file, "供应商A报价1000元，供应商B报价980元", "utf-8");

    const ctx = buildFileContext([file]);

    assert.ok(ctx.includes("【附件文件】"));
    assert.ok(ctx.includes("报价说明.txt"));
    assert.ok(ctx.includes("供应商B报价980元"));
  });

  it("非文本附件无法抽取时保留文件元信息供模型判断", () => {
    const dir = mkdtempSync(join(tmpdir(), "approve-inbox-agent-"));
    const file = join(dir, "扫描件.bin");
    writeFileSync(file, Buffer.from([0, 1, 2, 3]));

    const ctx = buildFileContext([file]);

    assert.ok(ctx.includes("扫描件.bin"));
    assert.ok(ctx.includes("仅可基于文件名、类型、大小分析"));
  });
});
