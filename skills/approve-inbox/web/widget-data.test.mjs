import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildWidgetData } from "./widget-data.mjs";

describe("buildWidgetData", () => {
  it("summarizes and sorts pending todo items for the cockpit widget", () => {
    const data = buildWidgetData({
      businessType: "approve-inbox",
      summary: { lastSyncAt: "2026-06-29T07:00:00.000Z" },
      summaries: { pending: { analysis: "AI 摘要", typeDistribution: [{ type: "请购单", count: 2 }] } },
      items: [
        { id: "low", title: "低风险", status: "pending", riskLevel: "low", submittedAt: "2026-06-29T07:00:00.000Z" },
        { id: "high", title: "高风险", status: "pending", riskLevel: "high", advice: "reject", dueAt: "2026-06-29T12:00:00.000Z", smartTags: [{ label: "超预算", kind: "risk" }] },
        { id: "attention", title: "需关注", status: "pending", riskLevel: "medium", advice: "caution" },
        { id: "done", title: "已办", status: "done", riskLevel: "high" },
        { id: "cross", title: "跨租户", status: "pending", riskLevel: "high", crossTenant: true },
      ],
    }, { limit: 3, centerUrl: "http://localhost:3891/" });

    assert.equal(data.businessType, "approve-inbox-widget");
    assert.equal(data.skillId, "iuap-apcom-myapproval");
    assert.deepEqual(data.skillAliases, ["iuap-apcom-approveinbox", "approve-inbox"]);
    assert.equal(data.summary.pendingCount, 3);
    assert.equal(data.summary.highPriorityCount, 1);
    assert.equal(data.summary.attentionCount, 1);
    assert.equal(Object.hasOwn(data.summary, "dueSoonCount"), false);
    assert.equal(data.items[0].id, "high");
    assert.equal(data.items[0].dueAt, "2026-06-29T12:00:00.000Z");
    assert.equal(data.items[0].tags[0].label, "超预算");
    assert.equal(data.magicSummary, "AI 摘要");
    assert.equal(data.actions.openCenterUrl, "http://localhost:3891/");
    assert.equal(data.link.url, "http://localhost:3891/?embed=cockpit-drawer");
    assert.equal(data.link.contentType, "iframe");
    assert.equal(data.link.allowFullscreen, true);
  });

  it("does not infer due dates from submittedAt", () => {
    const data = buildWidgetData({
      items: [
        { id: "old", title: "旧待办", status: "pending", riskLevel: "medium", submittedAt: "2026-06-28T10:00:00.000Z" },
        { id: "new", title: "新待办", status: "pending", riskLevel: "medium", submittedAt: "2026-06-29T07:00:00.000Z" },
      ],
    }, { limit: 2 });

    assert.equal(data.summary.attentionCount, 2);
    assert.equal(Object.hasOwn(data.summary, "dueSoonCount"), false);
    assert.equal(data.items[0].dueAt, null);
    assert.equal(Object.hasOwn(data.items[0], "dueSoon"), false);
  });

  it("accepts millisecond timestamp strings as explicit due dates", () => {
    const dueAt = String(Date.parse("2026-06-29T11:00:00.000Z"));
    const data = buildWidgetData({
      items: [
        { id: "ts", title: "时间戳待办", status: "pending", riskLevel: "medium", dueAt },
      ],
    });

    assert.equal(data.items[0].dueAt, "2026-06-29T11:00:00.000Z");
  });

  it("returns an empty state when there are no actionable pending items", () => {
    const data = buildWidgetData({ items: [{ id: "done", title: "已办", status: "done", riskLevel: "low" }] });

    assert.equal(data.state, "empty");
    assert.equal(data.summary.pendingCount, 0);
    assert.equal(data.magicSummary, "当前没有待处理事项。");
  });
});
