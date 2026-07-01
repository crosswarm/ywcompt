import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createRichDetail, getNormalizedField } from "./detail-rich/index.mjs";

describe("detail-rich", () => {
  it("builds normalized fields from MDF bill detail and metadata", () => {
    const detail = createRichDetail({
      primaryId: "p1",
      framework: "mdf",
      billDetail: {
        amount: 1200,
        supplier: { id: "s1", name: "华为技术有限公司" },
        id: "sys",
      },
      fieldLabels: { amount: "合同金额", supplier: "供应商" },
      fieldMetadata: {
        amount: { label: "合同金额", section: "预算", dataType: "number" },
      },
    });
    assert.equal(detail.normalized.fields.length, 2);
    assert.equal(getNormalizedField(detail, { fieldId: "amount" }).label, "合同金额");
    assert.equal(getNormalizedField(detail, { fieldId: "supplier" }).displayValue, "华为技术有限公司");
    assert.equal(detail.normalized.fields.some((field) => field.fieldId === "id"), false);
  });

  it("builds normalized fields from iForm pk/name values", () => {
    const detail = createRichDetail({
      primaryId: "i1",
      framework: "iform",
      iformData: {
        head: {
          dept: { pk: "d1", name: "研发部" },
          pk_temp: { value: "tmp" },
        },
      },
      fieldLabels: { dept: "申请部门" },
    });
    assert.equal(detail.raw.kind, "iform");
    assert.equal(detail.normalized.fields.length, 1);
    assert.equal(detail.normalized.fields[0].label, "申请部门");
    assert.equal(detail.normalized.fields[0].displayValue, "研发部");
  });

  it("uses metadata options to translate enum display values", () => {
    const detail = createRichDetail({
      primaryId: "p2",
      framework: "mdf",
      billDetail: { invoiceType: "1" },
      fieldMetadata: {
        invoiceType: {
          label: "账单情况",
          controlType: "Select",
          enumType: "invoiceType",
          options: [
            { value: "0", label: "无发票" },
            { value: "1", label: "全电票" },
          ],
        },
      },
    });
    assert.equal(getNormalizedField(detail, { fieldId: "invoiceType" }).displayValue, "全电票");
    assert.deepEqual(detail.meta.enums.invoiceType.options, [
      { value: "0", label: "无发票" },
      { value: "1", label: "全电票" },
    ]);
  });

  it("uses metadata aliases to label reference display fields", () => {
    const detail = createRichDetail({
      primaryId: "p3",
      framework: "mdf",
      billDetail: {
        pk_project: "1677028452799610893",
        pk_project_name: "专项活动费",
      },
      fieldMetadata: {
        pk_project: {
          label: "预算项目",
          controlType: "refer",
          aliases: ["pk_project_name", "pk_project.name", "pk_project__name"],
        },
      },
    });
    const field = getNormalizedField(detail, { fieldId: "pk_project" });
    assert.equal(detail.schemaVersion, 3);
    assert.equal(field.label, "预算项目");
    assert.equal(field.displayValue, "专项活动费");
    assert.equal(detail.normalized.fields.some((f) => f.fieldId === "pk_project_name"), false);
  });
});
