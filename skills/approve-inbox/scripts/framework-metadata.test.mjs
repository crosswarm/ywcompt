import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { extractIformFieldMetadata } from "./frameworks/iform-client.mjs";
import { extractYnfFieldMetadata, extractYnfParams } from "./frameworks/ynf-client.mjs";

describe("framework metadata extractors", () => {
  it("extracts iForm billVue field labels, options, sections, and process auth", () => {
    const meta = extractIformFieldMetadata(
      {
        formComponents: [
          {
            title: "领域模块信息",
            componentKey: "Panel",
            children: [
              {
                fieldId: "product",
                title: "上线产品",
                componentKey: "Select",
                required: true,
                options: [{ selectionId: "p1", name: "打印管理" }],
              },
            ],
          },
        ],
      },
      {
        processauthinfo: {
          approveUserTask: [{ fieldid: "product", auth: 0 }],
        },
      },
    );
    assert.equal(meta.product.label, "上线产品");
    assert.equal(meta.product.controlType, "Select");
    assert.equal(meta.product.section, "领域模块信息");
    assert.equal(meta.product.required, true);
    assert.equal(meta.product.editable, false);
    assert.deepEqual(meta.product.options, [{ value: "p1", label: "打印管理" }]);
  });

  it("extracts YNF tplAndMeta enum options", () => {
    const meta = extractYnfFieldMetadata({
      data: {
        meta: {
          enumData: {
            eces_boolean: [
              { value: "0", name: "否" },
              { value: "1", name: "是" },
            ],
          },
          children: [
            {
              fieldsArr: [{ field: "NocRadio2sj", caption: "是否涉及脚本", bizType: "singleOption" }],
              children: [{ storeField: "NocRadio2sj", caption: "是否涉及脚本", controlType: "Enumerate", enumType: "eces_boolean" }],
            },
          ],
        },
      },
    });
    assert.equal(meta.NocRadio2sj.label, "是否涉及脚本");
    assert.equal(meta.NocRadio2sj.enumType, "eces_boolean");
    assert.deepEqual(meta.NocRadio2sj.options, [
      { value: "0", label: "否" },
      { value: "1", label: "是" },
    ]);
  });

  it("extracts YNF businessKey from non-empty busiObj query", () => {
    const params = extractYnfParams({
      webUrl:
        "https://c1.yonyoucloud.com/mdf-node/fragment/pathBillNo?apptype=ynf&domainKey=yonbip&billId=2500000000000000001&billNo=origin_bill&busiObj=override_bill",
    });
    assert.equal(params.businessKey, "override_bill_2500000000000000001");
  });
});
