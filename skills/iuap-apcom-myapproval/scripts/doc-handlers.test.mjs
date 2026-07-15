import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { detectFramework, fetchDetailForTodo, resetUserHandlersForTest, resolveHandler } from "./doc-handlers/index.mjs";

describe("doc-handlers", () => {
  it("detects MDF, iForm, and YNF URLs", () => {
    assert.equal(detectFramework({ webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1" }), "mdf");
    assert.equal(detectFramework({ webUrl: "https://c1.yonyoucloud.com/yonbip-ec-iform/index?formId=f&formInstanceId=i" }), "iform");
    assert.equal(detectFramework({ webUrl: "https://c1.yonyoucloud.com/mdf-node/fragment/x?apptype=ynf" }), "ynf");
  });

  it("resolves generic handler fallback", () => {
    resetUserHandlersForTest();
    assert.equal(resolveHandler({ webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1" }).id, "generic.mdf");
  });

  it("resolves specialized handlers before generic fallbacks", () => {
    resetUserHandlersForTest();
    assert.equal(resolveHandler({
      title: "紧急补丁审批单",
      webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/CJJBDYJZSP/1",
    }).id, "patch.mdf");
    assert.equal(resolveHandler({
      title: "云产品后台数据处理申请",
      formId: "73176167895d4880b47a1dd9ed4ad790",
      webUrl: "https://c1.yonyoucloud.com/yonbip-ec-iform/index?formId=73176167895d4880b47a1dd9ed4ad790&formInstanceId=i",
    }).id, "data-request.iform");
    assert.equal(resolveHandler({
      title: "BIP上线申请单",
      webUrl: "https://c1.yonyoucloud.com/yonbip-ec-iform/index?formId=f&formInstanceId=i",
    }).id, "online.iform");
    assert.equal(resolveHandler({
      title: "后端微服务申请单",
      webUrl: "https://c1.yonyoucloud.com/mdf-node/fragment/x?apptype=ynf&tplid=PNDPFYG7AW5AAAS",
    }).id, "backend-service.ynf");
  });

  it("fetchDetailForTodo creates richDetail from injected MDF framework", async () => {
    const result = await fetchDetailForTodo(
      {
        frameworks: {
          mdf: {
            async fetchMdfBillDetail() {
              return {
                billDetail: { amount: 100 },
                fields: [{ key: "amount", name: "合同金额", value: 100 }],
                attachments: [],
                fieldLabels: { amount: "合同金额" },
                fieldMetadata: { amount: { label: "合同金额" } },
                businessKey: "pu_applyorder_1",
              };
            },
          },
        },
      },
      {
        id: "p1",
        title: "采购",
        webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1",
        runtimeActions: [],
        observedActions: [{ action: "approve", callBackExecType: "agree" }],
      },
    );
    assert.equal(result.meta.framework, "mdf");
    assert.equal(result.richDetail.normalized.fields[0].label, "合同金额");
    assert.equal(result.richDetail.normalized.fields[0].displayValue, "100");
    assert.equal(result.businessKey, "pu_applyorder_1");
    assert.equal(result.richDetail.meta.businessKey, "pu_applyorder_1");
    assert.deepEqual(result.richDetail.observedActions.map((action) => action.action), ["approve"]);
  });

  it("handlers do not promote stored snapshots when no live action refresher exists", async () => {
    resetUserHandlersForTest();
    const handler = resolveHandler({ webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1" });
    assert.equal(handler.approvalStrategy().kind, "batch");
    const refreshed = await handler.refreshActions(
      { observedAt: "2026-06-26T00:00:00.000Z" },
      { runtimeActions: [{ action: "approve", callBackExecType: "agree", label: "同意" }] },
      {},
    );
    assert.deepEqual(refreshed.actions, []);
  });
});
