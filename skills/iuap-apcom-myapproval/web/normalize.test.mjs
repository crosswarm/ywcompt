/**
 * normalize.test.mjs — normalize.mjs 单元测试（node:test，零依赖）
 *
 * 运行：node --test skills/iuap-apcom-myapproval/web/
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
  deriveListAiSuggestion,
  deriveSystemRuleAdvice,
  buildCompositeAdvice,
  isCompleteAnalysis,
  isReturnedToDrafterItem,
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

describe("receivedAt normalize", () => {
  it("保留 receivedAt 来源与语义，并与 submittedAt 分开", () => {
    const item = normalizeListItem({
      id: "received-1",
      title: "测试待办",
      riskLevel: "low",
      receivedAt: "2026-07-15T08:00:00.000Z",
      receivedAtSource: "workflow.task.createTime",
      receivedAtSemantics: "task-created",
      receivedAtSourceLabel: "流程任务创建时间",
      submittedAt: "2026-07-14T08:00:00.000Z",
    });

    assert.equal(item.receivedAt, "2026-07-15T08:00:00.000Z");
    assert.equal(item.receivedAtSource, "workflow.task.createTime");
    assert.equal(item.receivedAtSourceLabel, "流程任务创建时间");
    assert.equal(item.submittedAt, "2026-07-14T08:00:00.000Z");
  });

  it("真实同步 reference 分支也保留 receivedAt 完整元数据", () => {
    const item = normalizeListItem({
      primaryId: "received-reference",
      title: "真实同步待办",
      receivedAt: "2026-07-15T09:00:00.000Z",
      receivedAtSource: "message-center.createTsLong",
      receivedAtSemantics: "message-created",
      receivedAtSourceLabel: "消息中心待办创建时间（近似）",
      submittedAt: "2026-07-14T08:00:00.000Z",
    });
    assert.equal(item.receivedAt, "2026-07-15T09:00:00.000Z");
    assert.equal(item.receivedAtSource, "message-center.createTsLong");
    assert.equal(item.receivedAtSemantics, "message-created");
    assert.match(item.receivedAtSourceLabel, /近似/);
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
  it("serviceName 覆盖旧 docType，并以 serviceCode 作为稳定 displayKey", () => {
    const item = normalizeListItem({
      id: "service-1",
      title: "权限申请单卡片",
      docType: "GZTACT045",
      serviceCode: "GZTACT045",
      serviceName: "权限申请单",
      serviceNameSource: "iuap-apcom-cli.auth.permission.apply",
      riskLevel: "medium",
    });

    assert.equal(item.serviceCode, "GZTACT045");
    assert.equal(item.serviceName, "权限申请单");
    assert.equal(item.docType, "权限申请单");
    assert.equal(item.displayKey, "GZTACT045");
    assert.equal(item.displayLabel, "权限申请单");
  });

  it("旧 bip-cli 来源在读时迁移为 iuap-apcom-cli 正式来源", () => {
    const item = normalizeListItem({
      id: "service-legacy-source",
      title: "权限申请单卡片",
      serviceCode: "GZTACT045",
      serviceName: "权限申请单",
      serviceNameSource: "bip-cli.auth.permission.apply",
      riskLevel: "medium",
    });

    assert.equal(
      item.serviceNameSource,
      "iuap-apcom-cli.auth.permission.apply",
    );
  });

  it("serviceName 覆盖旧的技术码 displayKey/displayLabel", () => {
    const item = normalizeListItem({
      id: "service-stale-display",
      title: "权限申请单卡片",
      docType: "GZTACT045",
      serviceCode: "GZTACT045",
      serviceName: "权限申请单",
      displayKey: "审批单",
      displayLabel: "GZTACT045",
      riskLevel: "medium",
    });

    assert.equal(item.displayKey, "GZTACT045");
    assert.equal(item.displayLabel, "权限申请单");
  });

  it("技术码 serviceName 不得作为业务显示名", () => {
    const item = normalizeListItem({
      id: "service-technical-name",
      title: "待审批任务",
      serviceCode: "unknownbill",
      serviceName: "unknownbill",
      docType: "unknownbill",
      riskLevel: "medium",
    });

    assert.equal(item.serviceName, null);
    assert.equal(item.docType, "审批单");
    assert.equal(item.displayKey, "unknownbill");
    assert.equal(item.displayLabel, "审批单");
  });

  it("旧 docTypeName 和 serviceNameSource 不得绕过技术码清理", () => {
    const item = normalizeListItem({
      id: "service-technical-derived",
      title: "待审批任务",
      serviceCode: "unknownbill",
      serviceName: "unknownbill",
      serviceNameSource: "iuap-apcom-cli.auth.permission.apply",
      docType: "unknownbill",
      docTypeName: "unknownbill",
      displayLabel: "unknownbill",
      riskLevel: "medium",
    });

    assert.equal(item.serviceName, null);
    assert.equal(item.serviceNameSource, null);
    assert.equal(item.docTypeName, "审批单");
    assert.equal(item.displayLabel, "审批单");
  });

  it("保留合法单词型英文业务名称", () => {
    const item = normalizeListItem({
      id: "service-english-name",
      title: "CRM approval",
      serviceCode: "crm_salesforce",
      serviceName: "Salesforce",
      serviceNameSource: "todo",
      docType: "审批单",
      riskLevel: "medium",
    });

    assert.equal(item.serviceName, "Salesforce");
    assert.equal(item.docType, "Salesforce");
    assert.equal(item.displayLabel, "Salesforce");
  });

  it("旧数据没有 serviceName 时继续使用 docType", () => {
    const item = normalizeListItem({
      id: "legacy-1",
      title: "旧待办",
      docType: "请购单",
      riskLevel: "medium",
    });

    assert.equal(item.serviceName, null);
    assert.equal(item.docType, "请购单");
  });

  it("v3 列表项原样透传 + 补默认 actions", () => {
    const r = normalizeListItem({ id: "a", title: "t", riskLevel: "high" });
    assert.equal(r.id, "a");
    assert.equal(r.riskLevel, "high");
    assert.equal(r.status, "pending");
    assert.equal(r.runtimeActions.length, 2);
  });

  it("v3 列表项会把流程动作名规范为单据名称", () => {
    const r = normalizeListItem({ id: "po1", title: "采购订单000352", docType: "采购下单", riskLevel: "high" });
    assert.equal(r.docType, "采购订单");
  });

  it("approve 旧列表项不会保留风险类 smartTag", () => {
    const r = normalizeListItem({
      id: "ok1",
      title: "请购单002228",
      riskLevel: "low",
      advice: "approve",
      smartTags: [{ label: "审批权限", kind: "risk" }],
    });
    assert.deepEqual(r.smartTags, [{ label: "预算内", kind: "advice" }]);
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

  it("附件标记：支持 content.attachments 派生", () => {
    const r = normalizeListItem({
      id: "att-1",
      title: "有附件单据",
      riskLevel: "medium",
      content: {
        attachments: [{ fileName: "说明.docx" }],
      },
    });
    assert.equal(r.hasAttachments, true);
    assert.equal(r.attachmentCount, 1);
  });

  it("透传 dueAt/deadline 类截止时间字段供驾驶舱 widget 展示", () => {
    assert.equal(
      normalizeListItem({ id: "due-1", title: "x", riskLevel: "medium", dueAt: "2026-06-29T10:00:00Z" }).dueAt,
      "2026-06-29T10:00:00Z",
    );
    assert.equal(
      normalizeListItem({ id: "due-2", title: "x", riskLevel: "medium", deadline: "2026-06-30T10:00:00Z" }).dueAt,
      "2026-06-30T10:00:00Z",
    );
  });

  it("原始单据 URL：webUrl 映射，v3 originalUrl 保留，不安全协议过滤", () => {
    const fromWebUrl = normalizeListItem({
      primaryId: "p4",
      title: "请购单",
      webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1",
    });
    assert.equal(fromWebUrl.originalUrl, "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1");

    const fromV3 = normalizeListItem({
      id: "p5",
      title: "请购单",
      riskLevel: "low",
      originalUrl: "https://c1.yonyoucloud.com/yonbip-ec-iform/index?formId=f&formInstanceId=i",
    });
    assert.equal(fromV3.originalUrl, "https://c1.yonyoucloud.com/yonbip-ec-iform/index?formId=f&formInstanceId=i");

    const unsafe = normalizeListItem({
      id: "p6",
      title: "异常链接",
      riskLevel: "medium",
      originalUrl: "javascript:alert(1)",
    });
    assert.equal(unsafe.originalUrl, undefined);
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

  it("已是 v3 data 时退回制单待办归入已办", () => {
    const r = normalizeInbox({
      businessType: "approve-inbox",
      items: [
        { id: "a", title: "请购单审批", riskLevel: "medium" },
        { id: "b", title: "退回制单待办", riskLevel: "medium", runtimeActions: [] },
      ],
    });
    assert.equal(isReturnedToDrafterItem({ title: "退回制单待办" }), true);
    assert.deepEqual(r.items.map((item) => item.id), ["a", "b"]);
    assert.equal(r.items.find((item) => item.id === "b").status, "done");
    assert.equal(r.items.find((item) => item.id === "b").completedAction, "return");
    assert.equal(r.items.find((item) => item.id === "b").completionSource, "todo.returned-to-drafter");
    assert.equal(r.summary.pendingCount, 1);
    assert.equal(r.summary.doneCount, 1);
    assert.equal(r.summaries.done.returnedCount, 1);
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
      businessKey: "pu_applyorder_1",
      originalUrl: "https://c1.yonyoucloud.com/detail/a",
      conclusion: { advice: "approve", label: "建议通过" },
      overallAnalysis: "ok",
      fieldAnalysis: [{ name: "f", summary: "s" }],
    };
    const r = normalizeDetail(d);
    assert.equal(r.conclusion.advice, "approve");
    assert.equal(r.businessKey, "pu_applyorder_1");
    assert.equal(r.originalUrl, "https://c1.yonyoucloud.com/detail/a");
    assert.equal(r.source, "skill");
    assert.equal(r.fieldAnalysis.length, 1);
    assert.equal(Array.isArray(r.ruleAnalysis), true);
  });

  it("参考详情 + 5 段 analysis", () => {
    const raw = {
      primaryId: "p1",
      richDetail: { businessKey: "CJJBDYJZSP_1", meta: { businessKey: "CJJBDYJZSP_1" }, normalized: { fields: [] } },
      billDetail: { title: "采购合同" },
      analysisMeta: { personalRuleIds: ["purchase-large-amount"], analyzedAt: "2026-07-14T00:00:00.000Z" },
      analysis: {
        conclusion: { advice: "reject", label: "建议拒绝" },
        overallAnalysis: "超预算",
        ruleAnalysis: [{ ruleName: "双签", severity: "risk", summary: "x", evidence: "y" }],
      },
    };
    const r = normalizeDetail(raw, { id: "p1", title: "采购合同" });
    assert.equal(r.id, "p1");
    assert.equal(r.title, "采购合同");
    assert.equal(r.businessKey, "CJJBDYJZSP_1");
    assert.equal(r.conclusion.advice, "reject");
    assert.equal(r.ruleAnalysis.length, 1);
    assert.deepEqual(r.analysisMeta.personalRuleIds, ["purchase-large-amount"]);
    assert.equal(r.source, "skill");
  });

  it("无 analysis → fallback（caution + 提示）", () => {
    const r = normalizeDetail({ primaryId: "p2" }, { id: "p2", title: "无分析单" });
    assert.equal(r.conclusion.advice, "caution");
    assert.equal(r.source, "fallback");
    assert.equal(r.overallAnalysis, "内容还在分析中，请稍候或重新点击上方的同步按钮。");
    assert.ok(!r.overallAnalysis.includes("/api/"));
  });

  it("真实附件元信息会透传，即使附件正文尚未分析", () => {
    const r = normalizeDetail(
      {
        id: "att-2",
        title: "请购单",
        content: {
          attachments: [
            { fileName: "请购单_增强说明版.docx", fileType: "docx", size: 44582, error: "download_url_missing" },
          ],
        },
        analysis: {
          conclusion: { advice: "caution" },
          ruleAnalysis: [{ ruleName: "附件完整性", summary: "已识别附件，待解析正文", severity: "warning" }],
          attachmentAnalysis: [],
        },
      },
      { id: "att-2", title: "请购单" },
    );
    assert.equal(r.attachments.length, 1);
    assert.equal(r.attachments[0].fileName, "请购单_增强说明版.docx");
    assert.equal(r.attachmentAnalysis.length, 0);
  });

  it("rawDetail 为空 → fallback", () => {
    const r = normalizeDetail(null, { id: "z", title: "Z", originalUrl: "https://c1.yonyoucloud.com/detail/z" });
    assert.equal(r.source, "fallback");
    assert.equal(r.title, "Z");
    assert.equal(r.originalUrl, "https://c1.yonyoucloud.com/detail/z");
  });

  it("fallbackDetail 过滤不安全原始 URL", () => {
    const r = fallbackDetail({ id: "bad", title: "Bad", originalUrl: "javascript:alert(1)" });
    assert.equal(r.originalUrl, undefined);
  });
});

describe("fallbackDetail()", () => {
  it("生成 caution 兜底详情", () => {
    const r = fallbackDetail({ id: "a", title: "T" });
    assert.equal(r.conclusion.advice, "caution");
    assert.equal(r.source, "fallback");
    assert.equal(r.fieldAnalysis.length, 0);
    assert.equal(r.overallAnalysis, "内容还在分析中，请稍候或重新点击上方的同步按钮。");
    assert.ok(!r.overallAnalysis.includes("/api/"));
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
    assert.equal(s.attentionCount, 1); // 仅 id2（medium+caution，去重一项）；id1 high-reject 与 id3 low-approve 不算
    assert.equal(s.typeDistribution[0].type, "采购");
    assert.equal(s.analysis, "待办 3 项，重要 1 项需重点处理，需关注 1 项。单据类型以「采购」最多（2 项）。");
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
    assert.equal(b.aiSuggestion, "x");
  });

  it("reject → high，approve → low", () => {
    assert.equal(deriveItemBadges({ conclusion: { advice: "reject" } }).riskLevel, "high");
    assert.equal(deriveItemBadges({ conclusion: { advice: "approve" } }).riskLevel, "low");
  });

  it("smartTags 收敛为固定短标签（跳过 passed），最多 2 个", () => {
    const b = deriveItemBadges(analysis);
    assert.ok(b.smartTags.length >= 1 && b.smartTags.length <= 2);
    assert.ok(b.smartTags.every((t) => t.kind === "risk" || t.kind === "rule"));
    assert.ok(b.smartTags.some((t) => ["审批权限", "超预算", "金额异常"].includes(t.label)));
    assert.ok(!b.smartTags.some((t) => t.label === "供应商")); // passed 不计
    assert.ok(!b.smartTags.some((t) => /beyondBudget|无法判断|合同金额.{6,}/.test(t.label)));
  });

  it("approve 单据保留 1 个正向短标签", () => {
    const b = deriveItemBadges({
      conclusion: { advice: "approve" },
      overallAnalysis: "金额合规、票据齐全、预算内，建议通过。",
      fieldAnalysis: [{ name: "合同金额", severity: "passed", summary: "预算内" }],
    });
    assert.equal(b.smartTags.length, 1);
    assert.equal(b.smartTags[0].kind, "advice");
  });

  it("approve 通过项提到无需双签时不派生审批权限风险标签", () => {
    const b = deriveItemBadges({
      conclusion: { advice: "approve" },
      overallAnalysis: "小额请购，预算未超，无显著风险，建议通过。",
      ruleAnalysis: [
        {
          ruleName: "大额采购双签",
          severity: "passed",
          summary: "金额极小，无需双签。",
          evidence: "total Ori Sum = 12.43",
          suggestion: "无。",
        },
      ],
    });
    assert.equal(b.smartTags.length, 1);
    assert.equal(b.smartTags[0].kind, "advice");
    assert.notEqual(b.smartTags[0].label, "审批权限");
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

describe("deriveListAiSuggestion()", () => {
  it("优先使用有实质内容的总体分析", () => {
    const suggestion = deriveListAiSuggestion({
      analysis: {
        conclusion: { advice: "caution" },
        overallAnalysis: "发票金额与申请金额不符，建议核实差额后再付款。",
        ruleAnalysis: [
          { ruleName: "付款一致性", severity: "risk", suggestion: "退回补充发票" },
        ],
      },
    });
    assert.equal(suggestion, "发票金额与申请金额不符，建议核实差额后再付款。");
  });

  it("总体分析仅有等级文案时使用最高严重度规则建议", () => {
    const suggestion = deriveListAiSuggestion({
      analysis: {
        conclusion: { advice: "caution" },
        overallAnalysis: "需关注",
        ruleAnalysis: [
          { ruleName: "附件完整性", severity: "warning", summary: "报价附件缺失", suggestion: "补充报价附件" },
          { ruleName: "审批权限", severity: "risk", summary: "当前审批人权限不足", suggestion: "补充有权限审批人后再提交" },
        ],
      },
    });
    assert.equal(suggestion, "审批权限：补充有权限审批人后再提交");
  });

  it("没有总体或重要规则时使用智能审核摘要", () => {
    const suggestion = deriveListAiSuggestion({
      analysis: { conclusion: { advice: "caution" }, overallAnalysis: "建议拒绝" },
      systemRuleAudit: {
        status: "success",
        AISummaryResultDesc: "合同金额超审批额度，建议补充上级会签。",
      },
    });
    assert.equal(suggestion, "合同金额超审批额度，建议补充上级会签。");
  });

  it("没有有效分析时展示明确的分析状态，不回退风险等级文案", () => {
    assert.equal(deriveListAiSuggestion(), "待AI分析");
    assert.equal(deriveListAiSuggestion({ analysisStatus: "running" }), "AI分析中");
    assert.equal(deriveListAiSuggestion({ analysisStatus: "failed" }), "AI分析失败");
  });
});

describe("系统预置规则综合建议", () => {
  it("从智能审核摘要推导建议", () => {
    assert.equal(deriveSystemRuleAdvice({ status: "success", resultDesc: "高风险，请拒绝" }).advice, "reject");
    assert.equal(deriveSystemRuleAdvice({ status: "success", resultDesc: "本识别为中风险，请重点核查" }).advice, "caution");
    assert.equal(deriveSystemRuleAdvice({ status: "success", resultDesc: "低风险，可通过" }).advice, "approve");
    assert.equal(deriveSystemRuleAdvice({ status: "not_found", message: "暂无结果" }), null);
  });

  it("系统拒绝 + 用户通过：最终以系统拒绝为准", () => {
    const composite = buildCompositeAdvice({
      systemRuleAudit: { status: "success", resultDesc: "高风险，请拒绝" },
      analysis: { conclusion: { advice: "approve" }, fieldAnalysis: [{ name: "金额", summary: "预算内" }] },
    });
    assert.equal(composite.advice, "reject");
    assert.equal(composite.source, "system");
    assert.equal(composite.conflict, true);
    assert.match(composite.summary, /用户级规则存在不同提示/);
  });

  it("系统通过 + 用户风险：最终以系统通过为准", () => {
    const composite = buildCompositeAdvice({
      systemRuleAudit: { status: "success", resultDesc: "低风险，可通过" },
      analysis: { conclusion: { advice: "reject" }, ruleAnalysis: [{ ruleName: "本地规则", summary: "风险" }] },
    });
    assert.equal(composite.advice, "approve");
    assert.equal(composite.source, "system");
    assert.equal(composite.userAdvice, "reject");
  });

  it("系统需关注 + 用户通过：最终以系统需关注为准", () => {
    const composite = buildCompositeAdvice({
      systemRuleAudit: { status: "success", resultDesc: "需核实后处理" },
      analysis: { conclusion: { advice: "approve" }, fieldAnalysis: [{ name: "金额", summary: "预算内" }] },
    });
    assert.equal(composite.advice, "caution");
    assert.equal(composite.source, "system");
  });

  it("系统无结果时回退用户级规则建议", () => {
    const composite = buildCompositeAdvice({
      systemRuleAudit: { status: "not_found", message: "未查询到审核结果" },
      analysis: { conclusion: { advice: "reject" }, ruleAnalysis: [{ ruleName: "本地规则", summary: "风险" }] },
    });
    assert.equal(composite.advice, "reject");
    assert.equal(composite.source, "user");
    assert.equal(composite.summary, "");
    assert.doesNotMatch(composite.summary, /智能审核结果暂不可用/);
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
    const it = normalizeListItem({ ...mkItem("B"), runtimeActions: [{ action: "approve", enabled: true }] }, { currentTenantId: "A" });
    assert.equal(it.crossTenant, true);
    assert.deepEqual(it.runtimeActions, []);
  });

  it("无 currentTenantId → 不判定为跨租户（避免误过滤）", () => {
    const it = normalizeListItem(mkItem("B"), {});
    assert.equal(it.crossTenant, false);
  });

  it("v3 项（带 riskLevel）也透传租户字段", () => {
    const it = normalizeListItem({ id: "x", title: "t", riskLevel: "medium", status: "pending", advice: "caution", docType: "采购", tenantId: "B", tenantName: "云领", runtimeActions: [{ action: "approve", enabled: true }] }, { currentTenantId: "A" });
    assert.equal(it.crossTenant, true);
    assert.equal(it.tenantName, "云领");
    assert.deepEqual(it.runtimeActions, []);
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
    assert.deepEqual(data.items.find((i) => i.id === "2").runtimeActions, []);
    assert.equal(data.meta.currentTenantId, "A");
  });

  it("normalizeInbox 用当前租户口径重算 summary 与 pending summaries", () => {
    const data = normalizeInbox({
      businessType: "approve-inbox",
      summary: { total: 2, pendingCount: 2, doneCount: 0, lastSyncAt: "2026-07-03T00:00:00.000Z" },
      meta: { currentTenantId: "A", currentTenantName: "本租户" },
      items: [
        { id: "1", title: "本", docType: "请购单", status: "pending", tenantId: "A", riskLevel: "medium", advice: "caution" },
        { id: "2", title: "外", docType: "审批单", status: "pending", tenantId: "B", tenantName: "云领", riskLevel: "high", advice: "reject" },
      ],
    });

    assert.equal(data.summary.total, 1);
    assert.equal(data.summary.pendingCount, 1);
    assert.equal(data.summaries.pending.total, 1);
    assert.match(data.summaries.pending.analysis, /待办 1 项/);
    assert.equal(data.meta.rawSummary.total, 2);
    assert.equal(data.meta.rawSummary.crossTenantCount, 1);
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

  it("normalizeDetail 会本地化旧 content.fields，并清洗对象值", () => {
    const d = normalizeDetail(
      {
        id: "3",
        content: {
          fields: [
            { key: "supplier_name", value: { name: "华为技术有限公司" } },
            { key: "unknownField", value: "abc" },
            { key: "empty", value: "" },
          ],
        },
        analysis: {
          conclusion: { advice: "approve" },
          fieldAnalysis: [{ field: "supplier_name", value: { name: "华为技术有限公司" }, summary: { text: "资质齐全" }, severity: "passed" }],
        },
      },
      { id: "3", title: "字段测试" },
    );
    assert.equal(d.fields[0].name, "供应商");
    assert.equal(d.fields[0].value, "华为技术有限公司");
    assert.equal(d.fields[1].name, "unknown Field");
    assert.equal(d.fieldAnalysis[0].name, "供应商");
    assert.equal(d.fieldAnalysis[0].value, "华为技术有限公司");
    assert.equal(d.fieldAnalysis[0].summary, "资质齐全");
  });

  it("normalizeDetail 优先读取 richDetail.normalized.fields", () => {
    const d = normalizeDetail(
      {
        id: "rich-1",
        content: {
          fields: [{ key: "beyondBudget", name: "旧字段名", value: "旧值" }],
        },
        richDetail: {
          fieldLabels: { beyondBudget: "是否超预算" },
          normalized: {
            fields: [
              { fieldId: "beyondBudget", label: "是否超预算", displayValue: "否", section: "预算" },
            ],
            byId: { beyondBudget: 0 },
          },
          meta: { fields: { beyondBudget: { label: "是否超预算", section: "预算" } } },
        },
        analysis: {
          conclusion: { advice: "approve" },
          fieldAnalysis: [{ name: "beyondBudget", value: "否", summary: "预算内", severity: "passed" }],
        },
      },
      { id: "rich-1", title: "rich" },
    );
    assert.equal(d.fields[0].name, "是否超预算");
    assert.equal(d.fields[0].value, "否");
    assert.equal(d.fields[0].dim, "预算");
  });

  it("normalizeDetail 会清洗 richDetail 里的技术字段标签", () => {
    const d = normalizeDetail(
      {
        id: "rich-2",
        richDetail: {
          normalized: {
            fields: [
              { fieldId: "supplier", label: "supplier", displayValue: "华为技术有限公司" },
              { fieldId: "total_currency_moneyDigit", label: "total Currency Money Digit", displayValue: "2" },
            ],
          },
          meta: {
            fields: {
              supplier: { label: "supplier" },
              total_currency_moneyDigit: { label: "total Currency Money Digit" },
            },
          },
        },
        analysis: {
          conclusion: { advice: "approve" },
          fieldAnalysis: [{ name: "supplier", value: "华为技术有限公司", summary: "资质齐全", severity: "passed" }],
        },
      },
      { id: "rich-2", title: "rich" },
    );
    assert.equal(d.fields[0].name, "供应商ID");
    assert.equal(d.fields[1].name, "金额小数位");
  });

  it("normalizeDetail 会本地化字段分析里的技术字段名", () => {
    const d = normalizeDetail(
      {
        id: "4",
        content: {
          fields: [
            { key: "beyondBudget", value: "0" },
            { key: "total_currency_moneyDigit", value: 2 },
          ],
        },
        analysis: {
          conclusion: { advice: "caution" },
          fieldAnalysis: [
            { name: "beyondBudget", value: "0", summary: "未超预算，但仍需核对预算科目", severity: "warning" },
            { field: "total_currency_moneyDigit", value: 2, summary: "金额精度正常", severity: "passed" },
            { name: "supplier", value: "s1", summary: "供应商需核对", severity: "warning" },
          ],
        },
      },
      { id: "4", title: "字段名测试" },
    );
    assert.equal(d.fields[0].name, "是否超预算");
    assert.equal(d.fields[1].name, "金额小数位");
    assert.equal(d.fieldAnalysis[0].name, "是否超预算");
    assert.equal(d.fieldAnalysis[1].name, "金额小数位");
    assert.equal(d.fieldAnalysis[2].name, "供应商ID");
  });
});
