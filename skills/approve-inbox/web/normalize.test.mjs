/**
 * normalize.test.mjs — normalize.mjs 单元测试（node:test，零依赖）
 *
 * 运行：node --test skills/approve-inbox/web/
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  tryParseJson,
  inferRiskLevel,
  parseAnalysis,
  normalizeListItem,
  normalizeInbox,
  normalizeDetail,
  fallbackDetail,
  computeSummary,
  computeReviewSummary,
  deriveItemBadges,
  isCompleteAnalysis,
} from "./normalize.mjs";

describe("tryParseJson()", () => {
  it("解析普通 JSON 字符串", () => {
    assert.deepEqual(tryParseJson('{"a":1}'), { a: 1 });
  });
  it("去除 ```json 围栏后解析", () => {
    assert.deepEqual(tryParseJson('```json\n{"a":2}\n```'), { a: 2 });
  });
  it("去除无语言标记的 ``` 围栏", () => {
    assert.deepEqual(tryParseJson('```\n{"a":3}\n```'), { a: 3 });
  });
  it("对象输入原样返回", () => {
    const o = { x: 1 };
    assert.equal(tryParseJson(o), o);
  });
  it("非法 JSON 返回 null", () => {
    assert.equal(tryParseJson("not json"), null);
  });
  it("null/undefined 返回 null", () => {
    assert.equal(tryParseJson(null), null);
    assert.equal(tryParseJson(undefined), null);
  });
});

describe("inferRiskLevel()", () => {
  it("reject → high", () => assert.equal(inferRiskLevel("reject"), "high"));
  it("approve → low", () => assert.equal(inferRiskLevel("approve"), "low"));
  it("caution → medium", () => assert.equal(inferRiskLevel("caution"), "medium"));
  it("无 advice 的上线单 → high", () => assert.equal(inferRiskLevel(undefined, "online"), "high"));
  it("无 advice 默认 → medium", () => assert.equal(inferRiskLevel(undefined, "other"), "medium"));
});

describe("parseAnalysis()", () => {
  it("5 段对象直接识别", () => {
    const a = {
      conclusion: { advice: "reject", label: "建议拒绝" },
      overallAnalysis: "x",
      fieldAnalysis: [{ name: "f" }],
      ruleAnalysis: [],
      attachmentAnalysis: [],
    };
    const r = parseAnalysis(a);
    assert.equal(r.conclusion.advice, "reject");
    assert.equal(r.fieldAnalysis.length, 1);
  });

  it("缺 label 时按 advice 补默认中文", () => {
    const r = parseAnalysis({ conclusion: { advice: "approve" } });
    assert.equal(r.conclusion.label, "建议通过");
  });

  it("raw 内是 5 段 JSON 字符串", () => {
    const raw = JSON.stringify({ conclusion: { advice: "caution" }, overallAnalysis: "ok" });
    const r = parseAnalysis({ raw });
    assert.equal(r.conclusion.advice, "caution");
    assert.equal(r.overallAnalysis, "ok");
  });

  it("raw 内是围栏包裹的 5 段 JSON", () => {
    const raw = "```json\n" + JSON.stringify({ conclusion: { advice: "reject" } }) + "\n```";
    const r = parseAnalysis({ raw });
    assert.equal(r.conclusion.advice, "reject");
  });

  it("raw 内是 Markdown + [ADVICE:*] → 降级提取", () => {
    const r = parseAnalysis({ raw: "# 分析\n金额偏高。[ADVICE:CAUTION]" });
    assert.equal(r.conclusion.advice, "caution");
    assert.ok(!r.overallAnalysis.includes("[ADVICE"));
    assert.equal(r.fieldAnalysis.length, 0);
  });

  it("纯 JSON 字符串（非 raw 包裹）", () => {
    const r = parseAnalysis(JSON.stringify({ conclusion: { advice: "approve" } }));
    assert.equal(r.conclusion.advice, "approve");
  });

  it("空/无法识别 → null", () => {
    assert.equal(parseAnalysis(null), null);
    assert.equal(parseAnalysis({ raw: "没有任何标记的纯文本" }), null);
  });
});

describe("normalizeListItem()", () => {
  it("v3 列表项原样透传 + 补默认 actions", () => {
    const r = normalizeListItem({ id: "a", title: "t", riskLevel: "high" });
    assert.equal(r.id, "a");
    assert.equal(r.riskLevel, "high");
    assert.equal(r.status, "pending");
    assert.equal(r.runtimeActions.length, 2);
  });

  it("参考格式（primaryId）映射，advice 推断风险", () => {
    const r = normalizeListItem(
      { primaryId: "p1", title: "采购", type: "other", analysis: { conclusion: { advice: "reject" } } },
      { status: "pending" }
    );
    assert.equal(r.id, "p1");
    assert.equal(r.advice, "reject");
    assert.equal(r.riskLevel, "high");
  });

  it("done 状态无行操作", () => {
    const r = normalizeListItem({ primaryId: "p2", title: "x" }, { status: "done" });
    assert.equal(r.status, "done");
    assert.equal(r.runtimeActions.length, 0);
  });

  it("提交人映射：参考 commitUserName → submitter", () => {
    const r = normalizeListItem({ primaryId: "p3", title: "x", commitUserName: "王五" }, { status: "pending" });
    assert.equal(r.submitter, "王五");
  });

  it("提交人映射：v3 透传 submitter", () => {
    const r = normalizeListItem({ id: "a", title: "t", riskLevel: "low", submitter: "李四" });
    assert.equal(r.submitter, "李四");
  });

  it("null 输入 → null", () => {
    assert.equal(normalizeListItem(null), null);
  });
});

describe("normalizeInbox()", () => {
  it("参考 state（inbox/done）→ v3 ApproveInboxData + 计数", () => {
    const state = {
      lastSyncAt: "2026-06-16T00:00:00Z",
      inbox: [{ primaryId: "a", title: "1" }, { primaryId: "b", title: "2" }],
      done: [{ primaryId: "c", title: "3" }],
    };
    const r = normalizeInbox(state);
    assert.equal(r.businessType, "approve-inbox");
    assert.equal(r.items.length, 3);
    assert.equal(r.summary.pendingCount, 2);
    assert.equal(r.summary.doneCount, 1);
    assert.equal(r.summary.lastSyncAt, "2026-06-16T00:00:00Z");
    assert.equal(r.items[2].status, "done");
  });

  it("已是 v3 ApproveInboxData 原样规范化", () => {
    const data = {
      businessType: "approve-inbox",
      items: [{ id: "x", title: "t", riskLevel: "low", status: "pending" }],
    };
    const r = normalizeInbox(data);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].id, "x");
  });

  it("透传 reviewSummary（已办智能总结）", () => {
    const data = {
      businessType: "approve-inbox",
      items: [{ id: "x", title: "t", riskLevel: "low", status: "done" }],
      reviewSummary: { total: 1, approvedCount: 1, analysis: "ok" },
    };
    const r = normalizeInbox(data);
    assert.equal(r.reviewSummary.total, 1);
    assert.equal(r.reviewSummary.analysis, "ok");
  });

  it("null → null", () => {
    assert.equal(normalizeInbox(null), null);
  });
});

describe("normalizeDetail()", () => {
  it("v3 详情原样透传", () => {
    const d = {
      id: "a",
      title: "t",
      conclusion: { advice: "approve", label: "建议通过" },
      overallAnalysis: "ok",
      fieldAnalysis: [{ name: "f", summary: "s" }],
    };
    const r = normalizeDetail(d);
    assert.equal(r.conclusion.advice, "approve");
    assert.equal(r.source, "skill");
    assert.equal(r.fieldAnalysis.length, 1);
    assert.equal(Array.isArray(r.ruleAnalysis), true);
  });

  it("参考详情 + 5 段 analysis", () => {
    const raw = {
      primaryId: "p1",
      billDetail: { title: "采购合同" },
      analysis: {
        conclusion: { advice: "reject", label: "建议拒绝" },
        overallAnalysis: "超预算",
        ruleAnalysis: [{ ruleName: "双签", severity: "risk", summary: "x", evidence: "y" }],
      },
    };
    const r = normalizeDetail(raw, { id: "p1", title: "采购合同" });
    assert.equal(r.id, "p1");
    assert.equal(r.title, "采购合同");
    assert.equal(r.conclusion.advice, "reject");
    assert.equal(r.ruleAnalysis.length, 1);
    assert.equal(r.source, "skill");
  });

  it("无 analysis → fallback（caution + 提示）", () => {
    const r = normalizeDetail({ primaryId: "p2" }, { id: "p2", title: "无分析单" });
    assert.equal(r.conclusion.advice, "caution");
    assert.equal(r.source, "fallback");
    assert.ok(r.overallAnalysis.includes("暂无"));
  });

  it("rawDetail 为空 → fallback", () => {
    const r = normalizeDetail(null, { id: "z", title: "Z" });
    assert.equal(r.source, "fallback");
    assert.equal(r.title, "Z");
  });
});

describe("fallbackDetail()", () => {
  it("生成 caution 兜底详情", () => {
    const r = fallbackDetail({ id: "a", title: "T" });
    assert.equal(r.conclusion.advice, "caution");
    assert.equal(r.source, "fallback");
    assert.equal(r.fieldAnalysis.length, 0);
  });
});

describe("computeSummary()", () => {
  const items = [
    { id: "1", status: "pending", riskLevel: "high", advice: "reject", docType: "采购" },
    { id: "2", status: "pending", riskLevel: "medium", advice: "caution", docType: "采购" },
    { id: "3", status: "pending", riskLevel: "low", advice: "approve", docType: "报销" },
    { id: "4", status: "done", riskLevel: "low", advice: "approve", docType: "合同" },
    { id: "5", status: "done", riskLevel: "high", advice: "reject", docType: "合同" },
  ];

  it("pending 侧：统计待办数/风险/需关注/类型", () => {
    const s = computeSummary(items, "pending");
    assert.equal(s.scope, "pending");
    assert.equal(s.total, 3);
    assert.equal(s.riskDistribution.high, 1);
    assert.equal(s.riskDistribution.medium, 1);
    assert.equal(s.riskDistribution.low, 1);
    assert.equal(s.attentionCount, 1); // 仅 id2（medium+caution，去重一条）；id1 high-reject 与 id3 low-approve 不算
    assert.equal(s.typeDistribution[0].type, "采购");
    assert.ok(s.analysis.includes("待办 3 件"));
  });

  it("done 侧：通过率/驳回/风险", () => {
    const s = computeSummary(items, "done");
    assert.equal(s.scope, "done");
    assert.equal(s.total, 2);
    assert.equal(s.approvedCount, 1);
    assert.equal(s.rejectedCount, 1);
    assert.equal(s.highlights[0].value, "50%");
    assert.equal(s.riskDistribution.high, 1);
  });

  it("空子集返回 undefined", () => {
    assert.equal(computeSummary([], "pending"), undefined);
    assert.equal(computeSummary([{ id: "x", status: "done" }], "pending"), undefined);
  });

  it("computeReviewSummary 等价于 done 侧", () => {
    const a = computeReviewSummary(items);
    const b = computeSummary(items, "done");
    assert.equal(a.total, b.total);
    assert.equal(a.scope, "done");
  });
});

describe("normalizeInbox summaries 双侧输出", () => {
  it("参考 state 输出 summaries.pending/done", () => {
    const state = {
      inbox: [{ primaryId: "a", title: "1", riskLevel: "high", advice: "reject", docType: "采购" }],
      done: [{ primaryId: "b", title: "2", riskLevel: "low", advice: "approve", docType: "合同" }],
    };
    const r = normalizeInbox(state);
    assert.ok(r.summaries);
    assert.equal(r.summaries.pending.total, 1);
    assert.equal(r.summaries.done.total, 1);
    assert.equal(r.summaries.done.approvedCount, 1);
  });

  it("v3 data 也输出 summaries", () => {
    const data = {
      businessType: "approve-inbox",
      items: [
        { id: "x", title: "t", riskLevel: "medium", status: "pending", advice: "caution", docType: "报销" },
      ],
    };
    const r = normalizeInbox(data);
    assert.equal(r.summaries.pending.total, 1);
    assert.equal(r.summaries.done, undefined); // 无已办
  });
});

describe("deriveItemBadges（详情分析 → 列表项徽标）", () => {
  const analysis = {
    conclusion: { advice: "caution", label: "需关注" },
    overallAnalysis: "x",
    fieldAnalysis: [
      { name: "合同金额", severity: "risk", summary: "超预算" },
      { name: "付款周期", severity: "warning", summary: "偏高" },
      { name: "供应商", severity: "passed", summary: "ok" },
    ],
    ruleAnalysis: [{ ruleName: "双签", severity: "risk", summary: "需双签" }],
    attachmentAnalysis: [],
  };

  it("从结论派生 advice + riskLevel", () => {
    const b = deriveItemBadges(analysis);
    assert.equal(b.advice, "caution");
    assert.equal(b.riskLevel, "medium"); // caution → medium
  });

  it("reject → high，approve → low", () => {
    assert.equal(deriveItemBadges({ conclusion: { advice: "reject" } }).riskLevel, "high");
    assert.equal(deriveItemBadges({ conclusion: { advice: "approve" } }).riskLevel, "low");
  });

  it("smartTags 取 risk/warning（跳过 passed），最多 4 个", () => {
    const b = deriveItemBadges(analysis);
    assert.ok(b.smartTags.length >= 2 && b.smartTags.length <= 4);
    assert.ok(b.smartTags.every((t) => t.kind === "risk" || t.kind === "rule"));
    assert.ok(b.smartTags.some((t) => t.label.includes("需双签") || t.label.includes("合同金额")));
    assert.ok(!b.smartTags.some((t) => t.label === "供应商")); // passed 不计
  });

  it("无结论 → null", () => {
    assert.equal(deriveItemBadges(null), null);
    assert.equal(deriveItemBadges({ overallAnalysis: "x" }), null);
  });

  it("接受 JSON 字符串 / {raw} 包裹", () => {
    const b = deriveItemBadges(JSON.stringify(analysis));
    assert.equal(b.advice, "caution");
  });
});

describe("跨租户标注（crossTenant）", () => {
  const mkItem = (tid) => ({ id: "x", title: "t", docType: "请购单", status: "pending", tenantId: tid, tenantName: "租户" + tid });

  it("同租户 → crossTenant false", () => {
    const it = normalizeListItem(mkItem("A"), { currentTenantId: "A" });
    assert.equal(it.crossTenant, false);
    assert.equal(it.tenantId, "A");
    assert.equal(it.tenantName, "租户A");
  });

  it("异租户 → crossTenant true", () => {
    const it = normalizeListItem(mkItem("B"), { currentTenantId: "A" });
    assert.equal(it.crossTenant, true);
  });

  it("无 currentTenantId → 不判定为跨租户（避免误过滤）", () => {
    const it = normalizeListItem(mkItem("B"), {});
    assert.equal(it.crossTenant, false);
  });

  it("v3 项（带 riskLevel）也透传租户字段", () => {
    const it = normalizeListItem({ id: "x", title: "t", riskLevel: "medium", status: "pending", advice: "caution", docType: "采购", tenantId: "B", tenantName: "云领" }, { currentTenantId: "A" });
    assert.equal(it.crossTenant, true);
    assert.equal(it.tenantName, "云领");
  });

  it("normalizeInbox 从 meta.currentTenantId 计算各项 crossTenant", () => {
    const data = normalizeInbox({
      businessType: "approve-inbox",
      meta: { currentTenantId: "A", currentTenantName: "本租户" },
      items: [
        { id: "1", title: "本", docType: "请购单", status: "pending", tenantId: "A" },
        { id: "2", title: "外", docType: "请购单", status: "pending", tenantId: "B", tenantName: "云领" },
      ],
    });
    assert.equal(data.items.find((i) => i.id === "1").crossTenant, false);
    assert.equal(data.items.find((i) => i.id === "2").crossTenant, true);
    assert.equal(data.meta.currentTenantId, "A");
  });

  it("voucher 标志：webUrl 含 /voucher/ → true，否则 false（两个分支都覆盖）", () => {
    const v = normalizeListItem({ id: "x", title: "t", status: "pending", webUrl: "https://x/mdf-node/meta/voucher/pu_applyorder/123" }, {});
    assert.equal(v.voucher, true);
    const nv = normalizeListItem({ id: "y", title: "t", status: "pending", webUrl: "https://x/iform/abc" }, {});
    assert.equal(nv.voucher, false);
    // v3 分支（带 riskLevel）
    const v3 = normalizeListItem({ id: "z", title: "t", riskLevel: "low", status: "pending", advice: "approve", webUrl: "https://x/voucher/st/1" }, {});
    assert.equal(v3.voucher, true);
  });

  it("isCompleteAnalysis：真分析(带summary)=true，旧模板残缺({field,value})=false", () => {
    // 真 enrich 分析
    assert.equal(isCompleteAnalysis({ conclusion: { advice: "approve" }, fieldAnalysis: [{ name: "金额", value: "1", summary: "ok", severity: "passed" }] }), true);
    // 规则分析带 summary 也算
    assert.equal(isCompleteAnalysis({ conclusion: { advice: "caution" }, ruleAnalysis: [{ ruleName: "双签", summary: "需双签" }] }), true);
    // YonClaw 旧模板残缺：fieldAnalysis 是 {field,value} 无 summary
    assert.equal(isCompleteAnalysis({ conclusion: { advice: "caution" }, fieldAnalysis: [{ field: "单据类型", value: "请购单" }], ruleAnalysis: [{ field: "x" }] }), false);
    // 无 conclusion
    assert.equal(isCompleteAnalysis({ fieldAnalysis: [{ summary: "x" }] }), false);
    assert.equal(isCompleteAnalysis(null), false);
  });

  it("normalizeDetail analyzed：残缺分析判 false（提示重新分析）、完整判 true", () => {
    const junk = normalizeDetail({ id: "1", content: { fields: [{ name: "a", value: "1" }] }, analysis: { conclusion: { advice: "caution" }, fieldAnalysis: [{ field: "单据类型", value: "请购单" }] } }, { id: "1" });
    assert.equal(junk.analyzed, false);
    const real = normalizeDetail({ id: "2", content: { fields: [{ name: "a", value: "1" }] }, analysis: { conclusion: { advice: "approve" }, fieldAnalysis: [{ name: "金额", value: "1", summary: "ok", severity: "passed" }] } }, { id: "2" });
    assert.equal(real.analyzed, true);
  });

  it("normalizeDetail 透传 crossTenant/tenantName + unavailableReason/analysisError", () => {
    const d = normalizeDetail(
      { id: "2", content: { fields: [], unavailableReason: "cross_tenant" }, analysisError: null },
      { id: "2", crossTenant: true, tenantName: "云领集团" },
    );
    assert.equal(d.crossTenant, true);
    assert.equal(d.tenantName, "云领集团");
    assert.equal(d.unavailableReason, "cross_tenant");
    assert.equal(d.enriched, false);
  });
});
