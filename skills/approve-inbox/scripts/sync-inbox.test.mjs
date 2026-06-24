/**
 * sync-inbox.test.mjs — 待办列表 → v3 inbox 映射的纯函数测试（零依赖 node:test）
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { docTypeFromTodo, mapTodoToItem, buildInboxData, mergePreservedDoneItems, decodeAdtSub } from "./sync-inbox.mjs";

// 待办样本（结构取自 messagecenter todo query；值全部为脱敏假数据）
const TODO = {
  tenantId: "tenantdemo",
  userId: "user-demo-0001",
  primaryId: "demo000111aabbccddeeff01",
  appId: "1082",
  businessKey: "demo-task-0001",
  businessData: { originalProcessStartTime: "1780390022402", taskName: "普通环节1" },
  webUrl:
    "https://example.test/mdf-node/meta/voucher/pu_applyorder/2500000000000000001?domainKey=upu&taskId=demo-task-0001&appSource=PU&taskFlag=todo&tenantId=tenantdemo&serviceCode=pu_applyorderlist&adt=wf",
  content: "发起人：张三\t\n发起时间：06-02 16:47\t\n发起人部门：示例部门",
  title: "请购单审批-DEMO-000150",
  doneStatus: 0,
  commitTsLong: 1780390022402,
  commitUserName: "张三",
  tenantId: "tenantdemo",
  tenantInfo: { tenantId: "tenantdemo", tenantName: "示例租户" },
  serviceCode: "pu_applyorderlist",
  buttons: [
    { name: { text: "同意", zh_CN: "同意" }, callBackExecType: "agree", action: "request,control", buttonIndex: 2 },
    { name: { text: "退回", zh_CN: "退回" }, callBackExecType: "reject", action: "request,control", buttonIndex: 1 },
  ],
  // %E8%AF%B7%E8%B4%AD%E5%8D%95 = 请购单
  serviceIcon: "https://file-cdn.example.test/x/%E8%AF%B7%E8%B4%AD%E5%8D%95.svg",
};

// ── docTypeFromTodo ───────────────────────────────────────
test("docTypeFromTodo: 从 serviceIcon 文件名解码出单据类型名", () => {
  assert.equal(docTypeFromTodo(TODO), "请购单");
});

test("docTypeFromTodo: 无 icon 时回退 serviceCode 去 list 后缀", () => {
  assert.equal(docTypeFromTodo({ serviceCode: "pu_applyorderlist" }), "pu_applyorder");
});

test("docTypeFromTodo: 都没有时给兜底名", () => {
  assert.equal(docTypeFromTodo({}), "审批单");
});

test("docTypeFromTodo: icon 非中文（无意义）时回退 serviceCode", () => {
  assert.equal(
    docTypeFromTodo({ serviceCode: "st_purinrecordlist", serviceIcon: "https://x/icon.svg" }),
    "st_purinrecord",
  );
});

// ── mapTodoToItem ─────────────────────────────────────────
test("mapTodoToItem: 映射核心字段", () => {
  const it = mapTodoToItem(TODO);
  assert.equal(it.id, "demo000111aabbccddeeff01");
  assert.equal(it.primaryId, "demo000111aabbccddeeff01");
  assert.equal(it.taskId, "demo-task-0001");
  assert.equal(it.title, "请购单审批-DEMO-000150");
  assert.equal(it.docType, "请购单");
  assert.equal(it.status, "pending");
  assert.equal(it.submitter, "张三");
  assert.equal(it.submittedAt, new Date(1780390022402).toISOString());
  assert.ok(it.webUrl.includes("/voucher/pu_applyorder/2500000000000000001"));
});

test("mapTodoToItem: id 与 webUrl 雪花 id 全程保持字符串（不丢精度）", () => {
  const it = mapTodoToItem(TODO);
  assert.equal(typeof it.id, "string");
  // 19 位雪花 id 超过 Number.MAX_SAFE_INTEGER，必须以字符串保留在 URL 中
  assert.ok(it.webUrl.includes("2500000000000000001"));
});

test("mapTodoToItem: pending 根据原始 buttons 生成动作", () => {
  const it = mapTodoToItem(TODO);
  assert.equal(it.status, "pending");
  assert.deepEqual(
    it.runtimeActions.map((a) => a.action),
    ["approve", "return"],
  );
  assert.deepEqual(
    it.runtimeActions.map((a) => a.callBackExecType),
    ["agree", "reject"],
  );
});

test("mapTodoToItem: 无 buttons 的通知类待办不生成审批动作", () => {
  const it = mapTodoToItem({ ...TODO, buttons: [] });
  assert.equal(it.status, "pending");
  assert.deepEqual(it.runtimeActions, []);
});

test("mapTodoToItem: done(doneStatus!=0) 无操作按钮", () => {
  const it = mapTodoToItem({ ...TODO, doneStatus: 1 });
  assert.equal(it.status, "done");
  assert.deepEqual(it.runtimeActions, []);
});

test("mapTodoToItem: 不带 riskLevel（留给分析回填，走 normalize 推断分支）", () => {
  const it = mapTodoToItem(TODO);
  assert.equal(it.riskLevel, undefined);
});

// ── buildInboxData ────────────────────────────────────────
test("buildInboxData: 产出 v3 ApproveInboxData 结构 + 计数", () => {
  const data = buildInboxData([TODO, { ...TODO, primaryId: "x2", doneStatus: 1 }], {
    lastSyncAt: "2026-06-17T00:00:00Z",
  });
  assert.equal(data.businessType, "approve-inbox");
  assert.equal(data.items.length, 2);
  assert.equal(data.summary.total, 2);
  assert.equal(data.summary.pendingCount, 1);
  assert.equal(data.summary.doneCount, 1);
  assert.equal(data.summary.lastSyncAt, "2026-06-17T00:00:00Z");
  assert.equal(data.viewSettings.defaultTabId, "all-todo");
});

test("buildInboxData: 空列表不报错", () => {
  const data = buildInboxData([], {});
  assert.equal(data.items.length, 0);
  assert.equal(data.summary.total, 0);
});

test("mergePreservedDoneItems: 同步后保留本地已完成但待办接口已消失的单据", () => {
  const data = buildInboxData([TODO], { lastSyncAt: "2026-06-17T00:00:00Z" });
  const merged = mergePreservedDoneItems(data, {
    businessType: "approve-inbox",
    items: [
      { id: TODO.primaryId, title: "仍在待办", status: "pending" },
      {
        id: "done-local-001",
        title: "刚审批完成的单据",
        status: "done",
        completedAction: "reject",
        runtimeActions: [{ action: "approve" }],
      },
    ],
  });

  const doneItem = merged.items.find((item) => item.id === "done-local-001");
  assert.equal(doneItem.status, "done");
  assert.equal(doneItem.completedAction, "reject");
  assert.deepEqual(doneItem.runtimeActions, []);
  assert.equal(merged.summary.total, 2);
  assert.equal(merged.summary.pendingCount, 1);
  assert.equal(merged.summary.doneCount, 1);
});

test("mergePreservedDoneItems: 当前同步结果已有同 ID 时不重复追加本地已办", () => {
  const data = buildInboxData([TODO], { lastSyncAt: "2026-06-17T00:00:00Z" });
  const merged = mergePreservedDoneItems(data, {
    businessType: "approve-inbox",
    items: [{ id: TODO.primaryId, title: "旧已办", status: "done" }],
  });

  assert.equal(merged.items.filter((item) => item.id === TODO.primaryId).length, 1);
  assert.equal(merged.summary.total, 1);
  assert.equal(merged.summary.pendingCount, 1);
  assert.equal(merged.summary.doneCount, 0);
});

// ── 租户字段（跨租户标注） ────────────────────────────────
test("mapTodoToItem: 映射 tenantId + tenantName", () => {
  const it = mapTodoToItem(TODO);
  assert.equal(it.tenantId, "tenantdemo");
  assert.equal(it.tenantName, "示例租户");
});

test("mapTodoToItem: 无 tenantInfo 时 tenantName 为 null", () => {
  const it = mapTodoToItem({ ...TODO, tenantInfo: undefined });
  assert.equal(it.tenantId, "tenantdemo");
  assert.equal(it.tenantName, null);
});

test("buildInboxData: 传 currentTenant 写 meta", () => {
  const data = buildInboxData([TODO], { lastSyncAt: "2026-06-17T00:00:00Z", currentTenant: { id: "tenantdemo", name: "示例租户" } });
  assert.equal(data.meta.currentTenantId, "tenantdemo");
  assert.equal(data.meta.currentTenantName, "示例租户");
});

test("buildInboxData: 跨租户待办不保留真实审批动作", () => {
  const data = buildInboxData([
    TODO,
    {
      ...TODO,
      primaryId: "cross-tenant-demo",
      tenantId: "otherTenant",
      tenantInfo: { tenantId: "otherTenant", tenantName: "其他租户" },
    },
  ], { lastSyncAt: "2026-06-17T00:00:00Z", currentTenant: { id: "tenantdemo", name: "示例租户" } });
  assert.equal(data.items.find((i) => i.id === "demo000111aabbccddeeff01").runtimeActions.length, 2);
  assert.deepEqual(data.items.find((i) => i.id === "cross-tenant-demo").runtimeActions, []);
});

test("buildInboxData: 无 currentTenant 时不写 meta（前端回退不过滤）", () => {
  const data = buildInboxData([TODO], { lastSyncAt: "x" });
  assert.equal(data.meta, undefined);
});

// ── decodeAdtSub ──────────────────────────────────────────
test("decodeAdtSub: 从 JWT 解出 sub", () => {
  const payload = Buffer.from(JSON.stringify({ sub: "demotenant01", aud: "x" })).toString("base64");
  const adt = `h.${payload}.sig`;
  assert.equal(decodeAdtSub(adt), "demotenant01");
});

test("decodeAdtSub: 非法输入返回 null", () => {
  assert.equal(decodeAdtSub(null), null);
  assert.equal(decodeAdtSub("notajwt"), null);
  assert.equal(decodeAdtSub(""), null);
});
