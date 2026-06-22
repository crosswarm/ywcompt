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
              };
            },
          },
        },
      },
      { id: "p1", title: "采购", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1" },
    );
    assert.equal(result.meta.framework, "mdf");
    assert.equal(result.richDetail.normalized.fields[0].label, "合同金额");
    assert.equal(result.richDetail.normalized.fields[0].displayValue, "100");
  });
});
