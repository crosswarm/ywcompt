/**
 * sync-inbox.test.mjs — 待办列表 → v3 inbox 映射的纯函数测试（零依赖 node:test）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyResolvedServiceIdentities, docTypeFromTodo, mapTodoToItem, buildInboxData, mergePreservedDoneItems, mergePreservedReceivedAt, decodeAdtSub, isReturnedToDrafterTodo, syncInbox } from "./sync-inbox.mjs";

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

const TEST_IDENTITY = Object.freeze({
  profileKey: "a".repeat(64),
  userKey: "b".repeat(64),
  tenantKey: "c".repeat(64),
  dataScopeKey: "d".repeat(64),
  identityEpoch: 1,
});

function verifiedSession(listResult, identity = TEST_IDENTITY) {
  return {
    identity,
    rawIdentity: { userId: "test-user-id", tenantId: listResult.currentTenantId || "tenantdemo", environment: "test" },
    listResult,
  };
}

// ── docTypeFromTodo ───────────────────────────────────────
test("docTypeFromTodo: 从 serviceIcon 文件名解码出单据类型名", () => {
  assert.equal(docTypeFromTodo(TODO), "请购单");
});

test("docTypeFromTodo: 采购订单标题优先于流程动作名", () => {
  assert.equal(
    docTypeFromTodo({
      title: "采购订单000352",
      serviceCode: "st_purchaseorderlist",
      serviceIcon: "https://file-cdn.example.test/x/%E9%87%87%E8%B4%AD%E4%B8%8B%E5%8D%95.svg",
    }),
    "采购订单",
  );
});

test("docTypeFromTodo: 无可靠名称时不再静态翻译 serviceCode", () => {
  assert.equal(docTypeFromTodo({ serviceCode: "pu_applyorderlist" }), "审批单");
});

test("docTypeFromTodo: 未知 serviceCode 不得回退技术码", () => {
  assert.equal(docTypeFromTodo({ serviceCode: "unknownbilllist" }), "审批单");
});

test("docTypeFromTodo: 都没有时给兜底名", () => {
  assert.equal(docTypeFromTodo({}), "审批单");
});

test("docTypeFromTodo: icon 非中文且无可靠名称时安全兜底", () => {
  assert.equal(
    docTypeFromTodo({ serviceCode: "st_purinrecordlist", serviceIcon: "https://x/icon.svg" }),
    "审批单",
  );
});

// ── mapTodoToItem ─────────────────────────────────────────
test("mapTodoToItem: 映射核心字段", () => {
  const it = mapTodoToItem(TODO);
  assert.equal(it.id, "demo000111aabbccddeeff01");
  assert.equal(it.primaryId, "demo000111aabbccddeeff01");
  assert.equal(it.taskId, "demo-task-0001");
  assert.equal(it.workflowBusinessKey, "demo-task-0001");
  assert.equal(it.title, "请购单审批-DEMO-000150");
  assert.equal(it.docType, "请购单");
  assert.equal(it.status, "pending");
  assert.equal(it.submitter, "张三");
  assert.equal(it.submittedAt, new Date(1780390022402).toISOString());
  assert.equal(it.receivedAt, null);
  assert.equal(it.receivedAtSource, "unavailable");
  assert.ok(it.webUrl.includes("/voucher/pu_applyorder/2500000000000000001"));
});

test("mapTodoToItem: serviceName 成为业务显示名，serviceCode 成为稳定 key", () => {
  const item = mapTodoToItem({
    ...TODO,
    title: "权限申请单卡片",
    serviceCode: "GZTACT045",
    serviceIcon: "",
  }, {
    serviceResolution: {
      serviceCode: "GZTACT045",
      serviceName: "权限申请单",
      serviceNameSource: "iuap-apcom-cli.auth.permission.apply",
    },
  });

  assert.equal(item.serviceCode, "GZTACT045");
  assert.equal(item.serviceName, "权限申请单");
  assert.equal(item.serviceNameSource, "iuap-apcom-cli.auth.permission.apply");
  assert.equal(item.docType, "权限申请单");
  assert.equal(item.displayKey, "GZTACT045");
  assert.equal(item.displayLabel, "权限申请单");
});

test("mapTodoToItem: workflow task 时间优先，提交时间仍独立保留", () => {
  const it = mapTodoToItem({
    ...TODO,
    workflowTaskCreateTime: "2026-07-15T08:00:00Z",
    createTsLong: Date.parse("2026-07-15T09:00:00Z"),
    msgTsLong: Date.parse("2026-07-15T10:00:00Z"),
  });

  assert.equal(it.receivedAt, "2026-07-15T08:00:00.000Z");
  assert.equal(it.receivedAtSource, "workflow.task.createTime");
  assert.equal(it.receivedAtSemantics, "task-created");
  assert.equal(it.submittedAt, new Date(TODO.commitTsLong).toISOString());
});

test("mapTodoToItem: 没有 workflow 时降级到消息中心创建时间并标明近似", () => {
  const it = mapTodoToItem({ ...TODO, createTsLong: Date.parse("2026-07-15T09:00:00Z") });

  assert.equal(it.receivedAt, "2026-07-15T09:00:00.000Z");
  assert.equal(it.receivedAtSource, "message-center.createTsLong");
  assert.equal(it.receivedAtSemantics, "message-created");
  assert.match(it.receivedAtSourceLabel, /近似/);
});

test("mapTodoToItem: createTime 和 msgTsLong 是显式的后续降级层", () => {
  const fromCreateTime = mapTodoToItem({ ...TODO, createTime: "2026-07-15T09:00:00Z" });
  const fromMessageTime = mapTodoToItem({ ...TODO, msgTsLong: Date.parse("2026-07-15T10:00:00Z") });

  assert.equal(fromCreateTime.receivedAtSource, "message-center.createTime");
  assert.equal(fromMessageTime.receivedAtSource, "message-center.msgTsLong");
  assert.match(fromMessageTime.receivedAtSourceLabel, /弱近似/);
});

test("mapTodoToItem: 提交时间和同步观察时间不冒充到手时间", () => {
  const it = mapTodoToItem({ ...TODO, createTsLong: undefined, msgTsLong: undefined }, { observedAt: "2026-07-15T12:00:00Z" });
  assert.equal(it.receivedAt, null);
  assert.equal(it.receivedAtSource, "unavailable");
  assert.equal(it.submittedAt, new Date(TODO.commitTsLong).toISOString());
});

test("mapTodoToItem: 只有消息创建时间时 receivedAt 有值而 submittedAt 为空", () => {
  const it = mapTodoToItem({
    ...TODO,
    commitTsLong: undefined,
    commitTime: undefined,
    createTsLong: Date.parse("2026-07-15T09:00:00Z"),
  });
  assert.equal(it.receivedAt, "2026-07-15T09:00:00.000Z");
  assert.equal(it.submittedAt, null);
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
    it.observedActions.map((a) => a.action),
    ["approve", "return"],
  );
  assert.deepEqual(
    it.runtimeActions.map((a) => a.action),
    ["approve", "return"],
  );
  assert.deepEqual(
    it.runtimeActions.map((a) => a.callBackExecType),
    ["agree", "reject"],
  );
  assert.equal(it.runtimeActions[0].kind, "workflow");
  assert.equal(it.runtimeActions[0].source, "todo.buttons");
  assert.equal(it.runtimeActions[0].requiresRefresh, true);
});

test("mapTodoToItem: YPD/YNF 保留观测按钮但不暴露可执行动作", () => {
  const it = mapTodoToItem({
    ...TODO,
    webUrl: "https://example.test/mdf-node/fragment/auto_auth_apply_v2?apptype=ynf&taskId=ynf-task-1",
  });

  assert.equal(it.framework, "ynf");
  assert.equal(it.handlerId, "generic.ynf");
  assert.deepEqual(it.observedActions.map((action) => action.action), ["approve", "return"]);
  assert.deepEqual(it.runtimeActions, []);
});

test("mapTodoToItem: 未知框架保留观测按钮但不暴露可执行动作", () => {
  const it = mapTodoToItem({
    ...TODO,
    webUrl: "https://example.test/unsupported/document?id=1",
  });

  assert.equal(it.framework, "unknown");
  assert.equal(it.handlerId, "generic.unknown");
  assert.deepEqual(it.observedActions.map((action) => action.action), ["approve", "return"]);
  assert.deepEqual(it.runtimeActions, []);
});

test("mapTodoToItem: iForm 继续暴露消息中心返回的可执行动作", () => {
  const it = mapTodoToItem({
    ...TODO,
    webUrl: "https://example.test/yonbip-ec-iform/runtime?formId=demo.form&formInstanceId=iform-1",
  });

  assert.equal(it.framework, "iform");
  assert.deepEqual(it.runtimeActions.map((action) => action.action), ["approve", "return"]);
});

test("mapTodoToItem: 无 buttons 的通知类待办不生成审批动作", () => {
  const it = mapTodoToItem({ ...TODO, buttons: [] });
  assert.equal(it.status, "pending");
  assert.deepEqual(it.observedActions, []);
  assert.deepEqual(it.runtimeActions, []);
});

test("mapTodoToItem: done(doneStatus!=0) 无操作按钮", () => {
  const it = mapTodoToItem({ ...TODO, doneStatus: 1 });
  assert.equal(it.status, "done");
  assert.equal(it.observedActions.length, 2);
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

test("buildInboxData: 退回制单待办归入已办且无操作按钮", () => {
  const returned = {
    ...TODO,
    primaryId: "returned-to-drafter",
    title: "退回制单待办",
    buttons: [],
  };
  assert.equal(isReturnedToDrafterTodo(returned), true);
  const data = buildInboxData([TODO, returned], { lastSyncAt: "2026-06-17T00:00:00Z" });
  const returnedItem = data.items.find((item) => item.id === "returned-to-drafter");
  assert.equal(data.items.length, 2);
  assert.equal(returnedItem.status, "done");
  assert.equal(returnedItem.completedAction, "return");
  assert.equal(returnedItem.completionSource, "todo.returned-to-drafter");
  assert.deepEqual(returnedItem.runtimeActions, []);
  assert.equal(data.summary.pendingCount, 1);
  assert.equal(data.summary.doneCount, 1);
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

test("applyResolvedServiceIdentities: 回填历史已办并清除技术码显示", () => {
  const data = {
    businessType: "approve-inbox",
    items: [{
      id: "done-1",
      title: "权限申请单卡片",
      status: "done",
      serviceCode: "GZTACT045",
      docType: "GZTACT045",
      displayKey: "审批单",
      displayLabel: "GZTACT045",
    }],
  };
  applyResolvedServiceIdentities(data, {
    bySourceCode: new Map([["GZTACT045", {
      serviceCode: "GZTACT045",
      serviceName: "权限申请单",
      serviceNameSource: "iuap-apcom-cli.auth.permission.apply",
    }]]),
    provider: "iuap-apcom-cli.auth.permission.apply",
    resolvedCount: 1,
    unresolvedCount: 0,
  });

  assert.equal(data.items[0].serviceName, "权限申请单");
  assert.equal(data.items[0].docType, "权限申请单");
  assert.equal(data.items[0].displayKey, "GZTACT045");
  assert.equal(data.items[0].displayLabel, "权限申请单");
  assert.equal(data.meta.serviceResolution.resolvedCount, 1);
});

test("applyResolvedServiceIdentities: 旧解析器 provider 迁移为 iuap-apcom-cli", () => {
  const data = { businessType: "approve-inbox", items: [] };
  applyResolvedServiceIdentities(data, {
    provider: "bip-cli.auth.permission.apply",
    resolvedCount: 0,
    unresolvedCount: 0,
  });

  assert.equal(
    data.meta.serviceResolution.provider,
    "iuap-apcom-cli.auth.permission.apply",
  );
});

test("applyResolvedServiceIdentities: 未解析历史技术名称会原子清理派生字段", () => {
  const data = {
    businessType: "approve-inbox",
    items: [{
      id: "done-technical",
      status: "done",
      title: "待审批任务",
      serviceCode: "unknownbill",
      serviceName: "unknownbill",
      serviceNameSource: "iuap-apcom-cli.auth.permission.apply",
      docType: "unknownbill",
      docTypeName: "unknownbill",
      displayLabel: "unknownbill",
    }],
  };

  applyResolvedServiceIdentities(data, {
    bySourceCode: new Map([["unknownbill", { serviceCode: "unknownbill", serviceName: "" }]]),
    unresolvedCount: 1,
  });

  assert.equal(data.items[0].serviceName, undefined);
  assert.equal(data.items[0].serviceNameSource, undefined);
  assert.equal(data.items[0].docTypeName, undefined);
  assert.equal(data.items[0].docType, "审批单");
  assert.equal(data.items[0].displayLabel, "审批单");
});

test("mergePreservedReceivedAt: 同 taskId 保留历史 workflow 强来源", () => {
  const data = buildInboxData([{ ...TODO, createTsLong: Date.parse("2026-07-15T09:00:00Z") }]);
  mergePreservedReceivedAt(data, {
    businessType: "approve-inbox",
    items: [{
      id: TODO.primaryId,
      taskId: TODO.businessKey,
      receivedAt: "2026-07-15T08:00:00.000Z",
      receivedAtSource: "workflow.task.createTime",
      receivedAtSemantics: "task-created",
      receivedAtSourceLabel: "流程任务创建时间",
    }],
  });

  assert.equal(data.items[0].receivedAt, "2026-07-15T08:00:00.000Z");
  assert.equal(data.items[0].receivedAtSource, "workflow.task.createTime");
});

test("mergePreservedReceivedAt: 新 taskId 不继承旧任务时间", () => {
  const data = buildInboxData([{ ...TODO, businessKey: "new-task", createTsLong: Date.parse("2026-07-15T09:00:00Z") }]);
  mergePreservedReceivedAt(data, {
    businessType: "approve-inbox",
    items: [{
      id: TODO.primaryId,
      taskId: TODO.businessKey,
      receivedAt: "2026-07-15T08:00:00.000Z",
      receivedAtSource: "workflow.task.createTime",
      receivedAtSemantics: "task-created",
      receivedAtSourceLabel: "流程任务创建时间",
    }],
  });

  assert.equal(data.items[0].receivedAt, "2026-07-15T09:00:00.000Z");
  assert.equal(data.items[0].receivedAtSource, "message-center.createTsLong");
});

test("mergePreservedReceivedAt: 兼容 legacy inbox/done 状态", () => {
  const data = buildInboxData([{ ...TODO, createTsLong: Date.parse("2026-07-15T09:00:00Z") }]);
  mergePreservedReceivedAt(data, {
    inbox: [{
      id: TODO.primaryId,
      taskId: TODO.businessKey,
      receivedAt: "2026-07-15T08:00:00.000Z",
      receivedAtSource: "workflow.task.createTime",
      receivedAtSemantics: "task-created",
      receivedAtSourceLabel: "流程任务创建时间",
    }],
    done: [],
  });

  assert.equal(data.items[0].receivedAt, "2026-07-15T08:00:00.000Z");
  assert.equal(data.items[0].receivedAtSource, "workflow.task.createTime");
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
  const crossTenantItem = data.items.find((i) => i.id === "cross-tenant-demo");
  assert.equal(crossTenantItem.observedActions.length, 2);
  assert.deepEqual(crossTenantItem.runtimeActions, []);
});

test("buildInboxData: 有 currentTenant 时 summary 使用当前租户口径并保留 rawSummary", () => {
  const data = buildInboxData([
    TODO,
    {
      ...TODO,
      primaryId: "cross-tenant-demo",
      tenantId: "otherTenant",
      tenantInfo: { tenantId: "otherTenant", tenantName: "其他租户" },
    },
  ], { lastSyncAt: "2026-06-17T00:00:00Z", currentTenant: { id: "tenantdemo", name: "示例租户" } });

  assert.equal(data.summary.total, 1);
  assert.equal(data.summary.pendingCount, 1);
  assert.equal(data.meta.rawSummary.total, 2);
  assert.equal(data.meta.rawSummary.pendingCount, 2);
  assert.equal(data.meta.rawSummary.crossTenantCount, 1);
});

test("buildInboxData: 无 currentTenant 时不写 meta（前端回退不过滤）", () => {
  const data = buildInboxData([TODO], { lastSyncAt: "x" });
  assert.equal(data.meta, undefined);
});

test("syncInbox: dry-run 仍解析服务名称但不写盘，并返回统计", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "approve-service-sync-"));
  const calls = [];
  const report = await syncInbox({
    data: dataDir,
    dryRun: true,
    verifiedSession: verifiedSession({
      currentTenantId: "tenantdemo",
      items: [{
        ...TODO,
        title: "权限申请单卡片",
        serviceCode: "GZTACT045",
        serviceIcon: "",
      }],
    }),
    runBipCli: async (command, input) => {
      calls.push({ command, input });
      if (command.join(" ") === "auth permission apply") {
        return { serviceCode: "GZTACT045", serviceName: "权限申请单" };
      }
      throw new Error(`unexpected command: ${command.join(" ")}`);
    },
  });

  assert.equal(report.written, false);
  assert.equal(report.serviceResolved, 1);
  assert.equal(report.serviceUnresolved, 0);
  assert.equal(calls.filter((call) => call.command.join(" ") === "auth permission apply").length, 1);
  assert.equal(existsSync(join(dataDir, "inbox.json")), false);
});

test("syncInbox: 服务解析只包含当前待办与保留已办，不查询已消失 pending", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "approve-service-history-"));
  const scopedDir = join(
    dataDir,
    "scopes",
    TEST_IDENTITY.profileKey,
    TEST_IDENTITY.userKey,
    TEST_IDENTITY.tenantKey,
    TEST_IDENTITY.dataScopeKey,
  );
  mkdirSync(scopedDir, { recursive: true });
  writeFileSync(join(scopedDir, "inbox.json"), JSON.stringify({
    businessType: "approve-inbox",
    meta: { identity: TEST_IDENTITY },
    items: [
      { id: "old-pending", status: "pending", serviceCode: "obsolete_pending" },
      { id: "kept-done", status: "done", serviceCode: "kept_done" },
    ],
  }));
  const queriedServices = [];

  const report = await syncInbox({
    data: dataDir,
    dryRun: true,
    verifiedSession: verifiedSession({
      currentTenantId: "tenantdemo",
      items: [{ ...TODO, serviceCode: "current_todo", serviceIcon: "" }],
    }),
    runBipCli: async (command, input) => {
      if (command.join(" ") === "auth permission apply") {
        queriedServices.push(input.service);
        return { serviceCode: input.service, serviceName: `业务-${input.service}` };
      }
      throw new Error(`unexpected command: ${command.join(" ")}`);
    },
  });

  assert.deepEqual(queriedServices.sort(), ["current_todo", "kept_done"]);
  assert.equal(report.serviceResolved, 2);
  assert.equal(report.serviceUnresolved, 0);
});

test("syncInbox: 只向当前 Profile/用户/租户 scope 原子写入并记录脱敏身份", async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "approve-identity-scope-"));
  const identity = {
    profileKey: "1".repeat(64),
    userKey: "2".repeat(64),
    tenantKey: "3".repeat(64),
    dataScopeKey: "4".repeat(64),
    identityEpoch: 3,
  };
  const report = await syncInbox({
    data: dataRoot,
    verifiedSession: {
      identity,
      rawIdentity: { userId: "user-secret", tenantId: "tenantdemo", environment: "managed" },
      listResult: { currentTenantId: "tenantdemo", items: [TODO] },
    },
    revalidateBeforeCommit: async () => ({ identity }),
    runBipCli: async (command, input) => {
      if (command.join(" ") === "auth permission apply") {
        return { serviceCode: input.service, serviceName: "请购单" };
      }
      throw new Error(`unexpected command: ${command.join(" ")}`);
    },
  });

  const expectedDir = join(
    dataRoot,
    "scopes",
    identity.profileKey,
    identity.userKey,
    identity.tenantKey,
    identity.dataScopeKey,
  );
  assert.equal(report.dataDir, expectedDir);
  assert.equal(report.inbox, join(expectedDir, "inbox.json"));
  const raw = readFileSync(report.inbox, "utf-8");
  const state = JSON.parse(raw);
  assert.deepEqual(state.meta.identity, identity);
  assert.deepEqual(
    JSON.parse(readFileSync(join(expectedDir, "identity.json"), "utf-8")),
    identity,
  );
  assert.equal(typeof state.meta.snapshotId, "string");
  assert.ok(state.meta.snapshotId.length > 10);
  assert.doesNotMatch(raw, /user-secret/);
});

test("syncInbox: 成功提交新快照时清理当前 scope 既有 JSON 缓存中的身份字段", async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "approve-identity-cache-scrub-"));
  const scopedDir = join(
    dataRoot,
    "scopes",
    TEST_IDENTITY.profileKey,
    TEST_IDENTITY.userKey,
    TEST_IDENTITY.tenantKey,
    TEST_IDENTITY.dataScopeKey,
  );
  const detailsDir = join(scopedDir, "details");
  mkdirSync(detailsDir, { recursive: true });
  const detailFile = join(detailsDir, `${TODO.primaryId}.json`);
  writeFileSync(detailFile, JSON.stringify({
    id: TODO.primaryId,
    billDetail: {
      creator: "user-secret",
      modifier: "modifier-secret",
      freeChId: { ytenantId: "tenantdemo" },
      businessValue: "keep-me",
    },
  }), "utf-8");
  const session = verifiedSession({ currentTenantId: "tenantdemo", items: [TODO] });

  const report = await syncInbox({
    data: dataRoot,
    verifiedSession: session,
    revalidateBeforeCommit: async () => session,
  });

  assert.equal(report.success, true);
  const sanitizedDetail = JSON.parse(readFileSync(detailFile, "utf-8"));
  assert.equal(sanitizedDetail.billDetail.creator, undefined);
  assert.equal(sanitizedDetail.billDetail.modifier, undefined);
  assert.deepEqual(sanitizedDetail.billDetail.freeChId, {});
  assert.equal(sanitizedDetail.billDetail.businessValue, "keep-me");
});

test("syncInbox: 当前租户 scope 不保存其他租户返回的待办", async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "approve-tenant-filter-"));
  const otherTenantTodo = {
    ...TODO,
    primaryId: "other-tenant-item",
    tenantId: "other-tenant",
    tenantInfo: { tenantId: "other-tenant", tenantName: "其他租户" },
  };
  const session = verifiedSession({
    currentTenantId: "tenantdemo",
    items: [TODO, otherTenantTodo],
  });
  const report = await syncInbox({
    data: dataRoot,
    verifiedSession: session,
    revalidateBeforeCommit: async () => session,
  });

  assert.equal(report.success, true);
  const raw = readFileSync(report.inbox, "utf-8");
  const state = JSON.parse(raw);
  assert.deepEqual(state.items.map((item) => item.id), [TODO.primaryId]);
  assert.equal(state.meta.currentTenantId, undefined);
  assert.equal(state.meta.currentTenantName, undefined);
  assert.equal(state.meta.currentTenantKey, TEST_IDENTITY.tenantKey);
  assert.equal(state.items[0].tenantId, undefined);
  assert.equal(state.items[0].tenantName, undefined);
  assert.equal(state.items[0].tenantKey, TEST_IDENTITY.tenantKey);
  assert.doesNotMatch(raw, /tenantdemo|other-tenant|其他租户|示例租户/);
});

test("syncInbox: 新快照不复用旧详情的 AI 建议、风险或标签", async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "approve-stale-detail-badges-"));
  const scopedDir = join(
    dataRoot,
    "scopes",
    TEST_IDENTITY.profileKey,
    TEST_IDENTITY.userKey,
    TEST_IDENTITY.tenantKey,
    TEST_IDENTITY.dataScopeKey,
  );
  const detailsDir = join(scopedDir, "details");
  mkdirSync(detailsDir, { recursive: true });
  writeFileSync(join(detailsDir, `${TODO.primaryId}.json`), JSON.stringify({
    id: TODO.primaryId,
    analysis: {
      conclusion: { advice: "reject", label: "拒绝" },
      risks: [{ level: "high", summary: "旧快照风险" }],
    },
    compositeAdvice: { advice: "reject", riskLevel: "high" },
    _approveInbox: {
      scopeKey: TEST_IDENTITY.dataScopeKey,
      snapshotId: "previous-snapshot",
    },
  }), "utf-8");

  const session = verifiedSession({ currentTenantId: "tenantdemo", items: [TODO] });
  const report = await syncInbox({
    data: dataRoot,
    verifiedSession: session,
    revalidateBeforeCommit: async () => session,
  });

  assert.equal(report.success, true);
  const state = JSON.parse(readFileSync(report.inbox, "utf-8"));
  assert.notEqual(state.meta.snapshotId, "previous-snapshot");
  assert.equal(state.items[0].advice, undefined);
  assert.equal(state.items[0].aiSuggestion, undefined);
  assert.equal(state.items[0].riskLevel, undefined);
  assert.equal(state.items[0].smartTags, undefined);
});

test("syncInbox: tenantId 缺失的待办不会进入当前租户 scope", async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "approve-tenant-missing-"));
  const session = verifiedSession({
    currentTenantId: "tenantdemo",
    items: [{ ...TODO, primaryId: "tenant-unknown", tenantId: null, tenantInfo: null }],
  });
  const report = await syncInbox({
    data: dataRoot,
    verifiedSession: session,
    revalidateBeforeCommit: async () => session,
  });

  assert.equal(report.success, true);
  const state = JSON.parse(readFileSync(report.inbox, "utf-8"));
  assert.deepEqual(state.items, []);
});

test("syncInbox: 传入 verifiedSession 但缺少提交前复核时拒绝落盘", async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "approve-revalidate-required-"));
  const report = await syncInbox({
    data: dataRoot,
    verifiedSession: verifiedSession({ currentTenantId: "tenantdemo", items: [TODO] }),
  });

  assert.equal(report.success, false);
  assert.equal(report.issue.code, "IDENTITY_REVALIDATION_REQUIRED");
  assert.equal(report.written, false);
  assert.equal(existsSync(join(
    dataRoot,
    "scopes",
    TEST_IDENTITY.profileKey,
    TEST_IDENTITY.userKey,
    TEST_IDENTITY.tenantKey,
    TEST_IDENTITY.dataScopeKey,
    "inbox.json",
  )), false);
});

test("syncInbox: A→B→A 后 scope 相同但 identityEpoch 变化时拒绝晚到结果落盘", async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "approve-identity-aba-"));
  const startedIdentity = { ...TEST_IDENTITY, identityEpoch: 7 };
  const report = await syncInbox({
    data: dataRoot,
    verifiedSession: verifiedSession(
      { currentTenantId: "tenantdemo", items: [TODO] },
      startedIdentity,
    ),
    revalidateBeforeCommit: async () => ({
      identity: { ...startedIdentity, identityEpoch: 9 },
    }),
  });

  assert.equal(report.success, false);
  assert.equal(report.issue.code, "IDENTITY_CHANGED_DURING_SYNC");
  assert.equal(report.written, false);
  assert.equal(existsSync(join(
    dataRoot,
    "scopes",
    startedIdentity.profileKey,
    startedIdentity.userKey,
    startedIdentity.tenantKey,
    startedIdentity.dataScopeKey,
    "inbox.json",
  )), false);
});

test("syncInbox: 提交前校验器未返回 identityEpoch 时按稳定 scope 允许落盘", async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "approve-identity-no-epoch-"));
  const startedIdentity = { ...TEST_IDENTITY, identityEpoch: 7 };
  const report = await syncInbox({
    data: dataRoot,
    verifiedSession: verifiedSession(
      { currentTenantId: "tenantdemo", items: [TODO] },
      startedIdentity,
    ),
    revalidateBeforeCommit: async () => ({
      identity: {
        profileKey: startedIdentity.profileKey,
        userKey: startedIdentity.userKey,
        tenantKey: startedIdentity.tenantKey,
        dataScopeKey: startedIdentity.dataScopeKey,
      },
    }),
  });

  assert.equal(report.success, true);
  assert.equal(existsSync(report.inbox), true);
});

test("syncInbox: 计算期间审批更新状态时以字节级 CAS 拒绝晚到同步覆盖", async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "approve-sync-cas-"));
  const scopedDir = join(
    dataRoot,
    "scopes",
    TEST_IDENTITY.profileKey,
    TEST_IDENTITY.userKey,
    TEST_IDENTITY.tenantKey,
    TEST_IDENTITY.dataScopeKey,
  );
  mkdirSync(scopedDir, { recursive: true });
  const inboxFile = join(scopedDir, "inbox.json");
  const initialState = {
    businessType: "approve-inbox",
    meta: { identity: TEST_IDENTITY, snapshotId: "before-approval" },
    summary: { total: 1, pendingCount: 1, doneCount: 0 },
    items: [{ id: TODO.primaryId, status: "pending", tenantId: "tenantdemo" }],
  };
  writeFileSync(inboxFile, JSON.stringify(initialState, null, 2), "utf-8");
  const approvedState = {
    ...initialState,
    meta: { ...initialState.meta, snapshotId: "approved-snapshot" },
    summary: { total: 1, pendingCount: 0, doneCount: 1 },
    items: [{ ...initialState.items[0], status: "done" }],
  };
  const approvedRaw = `${JSON.stringify(approvedState, null, 2)}\n`;

  const report = await syncInbox({
    data: dataRoot,
    verifiedSession: verifiedSession({ currentTenantId: "tenantdemo", items: [TODO] }),
    revalidateBeforeCommit: async () => ({ identity: TEST_IDENTITY }),
    runBipCli: async (command, input) => {
      if (command.join(" ") === "auth permission apply") {
        writeFileSync(inboxFile, approvedRaw, "utf-8");
        return { serviceCode: input.service, serviceName: "请购单" };
      }
      throw new Error(`unexpected command: ${command.join(" ")}`);
    },
  });

  assert.equal(report.success, false);
  assert.equal(report.issue.code, "STALE_STATE_SNAPSHOT");
  assert.equal(report.written, false);
  assert.equal(readFileSync(inboxFile, "utf-8"), approvedRaw);
});

test("syncInbox: 身份验证 401 时不创建 scope 且不改动已有缓存", async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "approve-identity-401-"));
  mkdirSync(join(dataRoot, "scopes", "old", "old", "old"), { recursive: true });
  const existingFile = join(dataRoot, "scopes", "old", "old", "old", "inbox.json");
  writeFileSync(existingFile, "{\"owner\":\"old\"}\n", "utf-8");
  const before = readFileSync(existingFile, "utf-8");
  const error = Object.assign(new Error("HTTP 401"), {
    code: "AUTH_REQUIRED_IN_YONWORK",
    issue: { code: "AUTH_REQUIRED_IN_YONWORK", userMessage: "请重新登录" },
  });

  const report = await syncInbox({
    data: dataRoot,
    verifyIdentity: async () => { throw error; },
  });

  assert.equal(report.success, false);
  assert.equal(report.issue.code, "AUTH_REQUIRED_IN_YONWORK");
  assert.equal(readFileSync(existingFile, "utf-8"), before);
  assert.equal(existsSync(join(dataRoot, "inbox.json")), false);
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
