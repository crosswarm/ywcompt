/**
 * sync-inbox.test.mjs — 待办列表 → v3 inbox 映射的纯函数测试（零依赖 node:test）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
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
    runBipCli: async (command, input) => {
      calls.push({ command, input });
      if (command.join(" ") === "workflow inboxtask list-inbox") {
        return {
          currentTenantId: "tenantdemo",
          items: [{
            ...TODO,
            title: "权限申请单卡片",
            serviceCode: "GZTACT045",
            serviceIcon: "",
          }],
        };
      }
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
  writeFileSync(join(dataDir, "inbox.json"), JSON.stringify({
    businessType: "approve-inbox",
    items: [
      { id: "old-pending", status: "pending", serviceCode: "obsolete_pending" },
      { id: "kept-done", status: "done", serviceCode: "kept_done" },
    ],
  }));
  const queriedServices = [];

  const report = await syncInbox({
    data: dataDir,
    dryRun: true,
    runBipCli: async (command, input) => {
      if (command.join(" ") === "workflow inboxtask list-inbox") {
        return { items: [{ ...TODO, serviceCode: "current_todo", serviceIcon: "" }] };
      }
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
