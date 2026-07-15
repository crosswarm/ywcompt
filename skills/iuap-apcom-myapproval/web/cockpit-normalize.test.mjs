import test from "node:test";
import assert from "node:assert/strict";
import { buildCockpitData } from "./cockpit-normalize.mjs";

const baseItem = (over = {}) => ({
  id: "t1",
  title: "采购合同A",
  docType: "采购合同",
  submitter: "张三",
  riskLevel: "medium",
  advice: "caution",
  status: "pending",
  smartTags: [{ label: "超预算", kind: "risk" }],
  runtimeActions: [{ kind: "approve", label: "同意" }],
  dueAt: "2026-07-01T08:00:00Z",
  submittedAt: "2026-06-28T09:00:00Z",
  receivedAt: "2026-06-28T10:00:00Z",
  receivedAtSource: "workflow.task.createTime",
  receivedAtSourceLabel: "流程任务创建时间",
  ...over,
});

const inbox = (items, over = {}) => ({
  items,
  summary: { lastSyncAt: "2026-06-30T10:00:00Z" },
  summaries: { pending: { typeDistribution: [{ type: "采购合同" }] } },
  ...over,
});

test("空数据:businessType 正确、messages 空、state empty、不抛", () => {
  const out = buildCockpitData({ items: [] });
  assert.equal(out.businessType, "approval-message-center");
  assert.equal(out.skillId, "iuap-apcom-myapproval");
  assert.deepEqual(out.skillAliases, ["iuap-apcom-approveinbox", "approve-inbox"]);
  assert.deepEqual(out.messages, []);
  assert.equal(out.state, "empty");
  assert.equal(out.todoStats.todo, 0);
  assert.equal(out.link.url, "/?embed=cockpit-drawer");
  assert.equal(out.link.contentType, "iframe");
});

test("单条 pending:核心字段映射对齐宿主 renderMessageCenterItems", () => {
  const out = buildCockpitData(inbox([baseItem()]));
  const m = out.messages[0];
  assert.equal(m.todoId, "t1");
  assert.equal(m.title, "采购合同A");
  assert.equal(m.priority, "medium");
  assert.equal(m.status, "warning"); // caution → warning
  assert.equal(m.source, "采购合同");
  assert.equal(m.owner, "张三");
  assert.equal(m.submittedAt, "2026-06-28T09:00:00Z");
  assert.equal(m.receivedAt, "2026-06-28T10:00:00.000Z");
  assert.equal(m.receivedAtSource, "workflow.task.createTime");
  assert.ok(m.content);
});

test("驾驶舱 source 和 content 优先使用 serviceName", () => {
  const out = buildCockpitData(inbox([baseItem({
    serviceCode: "GZTACT045",
    serviceName: "权限申请单",
    docType: "GZTACT045",
  })]));

  assert.equal(out.messages[0].source, "权限申请单");
  assert.match(out.messages[0].content, /^权限申请单/);
  assert.doesNotMatch(out.messages[0].content, /GZTACT045/);
});

test("advice → status 三态映射", () => {
  const out = buildCockpitData(inbox([
    baseItem({ id: "a", advice: "approve" }),
    baseItem({ id: "c", advice: "caution" }),
    baseItem({ id: "r", advice: "reject" }),
  ]));
  const map = Object.fromEntries(out.messages.map((m) => [m.todoId, m.status]));
  assert.equal(map.a, "passed");
  assert.equal(map.c, "warning");
  assert.equal(map.r, "risk");
});

test("reject 且未给 riskLevel → priority 经 inferRiskLevel 补成 high", () => {
  const out = buildCockpitData(inbox([baseItem({ id: "r", advice: "reject", riskLevel: undefined })]));
  assert.equal(out.messages[0].priority, "high");
});

test("crossTenant 条目过滤,不进 messages", () => {
  const out = buildCockpitData(inbox([baseItem({ id: "x", crossTenant: true })]));
  assert.equal(out.messages.length, 0);
});

test("done 状态过滤,只保留 pending", () => {
  const out = buildCockpitData(inbox([baseItem({ id: "d", status: "done" })]));
  assert.equal(out.messages.length, 0);
});

test("limit 截断到上限", () => {
  const items = Array.from({ length: 8 }, (_, i) => baseItem({ id: "t" + i }));
  const out = buildCockpitData(inbox(items), { limit: 5 });
  assert.equal(out.messages.length, 5);
});

test("排序:high 排在 medium 之前", () => {
  const out = buildCockpitData(inbox([
    baseItem({ id: "m", riskLevel: "medium" }),
    baseItem({ id: "h", riskLevel: "high" }),
  ]));
  assert.equal(out.messages[0].todoId, "h");
});

test("同风险且无截止时间时按到手时间倒序，空值置后", () => {
  const out = buildCockpitData(inbox([
    baseItem({ id: "missing", dueAt: null, receivedAt: null }),
    baseItem({ id: "old", dueAt: null, receivedAt: "2026-06-28T10:00:00Z" }),
    baseItem({ id: "new", dueAt: null, receivedAt: "2026-06-28T11:00:00Z" }),
  ]));
  assert.deepEqual(out.messages.map((item) => item.todoId), ["new", "old", "missing"]);
});

test("todoStats 聚合:todo/urgent/highRisk/done/actionable", () => {
  const out = buildCockpitData(inbox([
    baseItem({ id: "h", riskLevel: "high", runtimeActions: [{ kind: "approve", label: "同意" }] }),
    baseItem({ id: "m", riskLevel: "medium", runtimeActions: [] }),
    baseItem({ id: "d", status: "done" }),
  ]));
  assert.equal(out.todoStats.todo, 2);
  assert.equal(out.todoStats.urgent, 1);
  assert.equal(out.todoStats.highRisk, 1);
  assert.equal(out.todoStats.done, 1);
  assert.equal(out.todoStats.actionable, 1); // 仅 h 有 runtimeActions
});

test("syncedAt 来自 summary.lastSyncAt,并写入 queryMeta", () => {
  const out = buildCockpitData(inbox([baseItem()]));
  assert.equal(out.syncedAt, "2026-06-30T10:00:00Z");
  assert.equal(out.queryMeta.syncedAt, "2026-06-30T10:00:00Z");
  assert.equal(out.queryMeta.status, "todo");
});

test("messages[].actions 来自 runtimeActions,label 保留", () => {
  const out = buildCockpitData(inbox([baseItem()]));
  assert.ok(out.messages[0].actions.length >= 1);
  assert.equal(out.messages[0].actions[0].label, "同意");
});

test("highlights 含待办总数与重要事项", () => {
  const out = buildCockpitData(inbox([
    baseItem({ id: "h", riskLevel: "high" }),
    baseItem({ id: "m", riskLevel: "medium" }),
  ]));
  const byLabel = Object.fromEntries(out.highlights.map((h) => [h.label, h.value]));
  assert.equal(byLabel["待办"], 2);
  assert.equal(byLabel["重要"], 1);
});

test("固定生成驾驶舱详情 iframe link", () => {
  const out = buildCockpitData(inbox([baseItem()]), {
    centerUrl: "http://localhost:3891/?returnTo=http%3A%2F%2Flocalhost%3A5663",
  });
  assert.equal(out.link.url, "http://localhost:3891/?embed=cockpit-drawer");
  assert.equal(out.link.interaction, "drawer");
  assert.equal(out.link.targetType, "service");
  assert.equal(out.link.allowFullscreen, true);
});
