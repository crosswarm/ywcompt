import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadUiConfig } from "./ui-config.mjs";
import { buildTableView, mergeTableConfig } from "./table-view-builder.mjs";
import { buildDetailCardFields } from "./detail-card-builder.mjs";
import { normalizeListItem } from "../web/normalize.mjs";

describe("ui view config", () => {
  it("loads local defaults as table-first and new-tab navigation", () => {
    const config = loadUiConfig({
      defaultConfigFile: new URL("../config/ui.json", import.meta.url),
      userConfigFile: "",
    });
    assert.equal(config.defaultView, "table");
    assert.equal(config.navigation.openExternalBill, "new-tab");
  });

  it("normalizes list items with displayKey/displayLabel for UI config matching", () => {
    const item = normalizeListItem({
      id: "todo-1",
      title: "演示单据",
      riskLevel: "medium",
      docType: "演示类型",
      displayKey: "demo.handler",
      displayLabel: "演示分组",
      businessKey: "demo_1",
    });
    assert.equal(item.displayKey, "demo.handler");
    assert.equal(item.displayLabel, "演示分组");
    assert.equal(item.businessKey, "demo_1");
    assert.equal(item.primaryId, "todo-1");
  });

  it("uses serviceCode as the stable default group key and serviceName as its label", () => {
    const view = buildTableView({
      items: [{
        id: "service-todo",
        title: "权限申请",
        docType: "旧名称",
        serviceCode: "GZTACT045",
        serviceName: "权限申请单",
      }],
      config: { defaultColumns: [{ id: "title", label: "任务", path: "title" }], groups: {} },
      uiConfig: { table: { groupBy: "displayGroup" } },
    });

    assert.equal(view.groups[0].key, "GZTACT045");
    assert.equal(view.groups[0].label, "权限申请单");
    assert.equal(view.groups[0].rows[0].serviceName, "权限申请单");
  });

  it("builds table rows from item.id and group-specific configured columns", () => {
    const config = mergeTableConfig({
      version: 1,
      defaultColumns: [{ id: "title", label: "任务", path: "title" }],
      groups: {
        default: { columns: [{ id: "title", label: "任务", path: "title" }] },
      },
    }, {
      groups: {
        "demo.handler": {
          label: "演示分组",
          columns: [
            { id: "title", label: "任务", path: "title" },
            { id: "supplier", label: "供应商", fieldLabel: "供应商" },
          ],
        },
      },
    });
    const view = buildTableView({
      items: [{
        id: "todo-1",
        title: "采购申请",
        displayKey: "demo.handler",
        displayLabel: "演示分组",
        summary: { iformFields: [{ label: "供应商", value: "用友网络" }] },
      }],
      config,
      uiConfig: { table: { groupBy: "displayGroup" }, navigation: { openExternalBill: "new-tab" } },
    });
    assert.equal(view.groups[0].sourceKey, "demo.handler");
    assert.equal(view.groups[0].rows[0].id, "todo-1");
    assert.equal(view.groups[0].rows[0].cells.supplier, "用友网络");
  });

  it("builds default detail card sections from businessKey and normalized fields", () => {
    const sections = buildDetailCardFields(
      { id: "todo-1", title: "采购申请" },
      {
        businessKey: "pu_applyorder_1",
        normalized: {
          fields: [{ fieldId: "supplier", label: "供应商", value: "用友网络" }],
          byId: { supplier: 0 },
        },
      },
      {
        version: 1,
        groups: {
          default: {
            sections: [{
              id: "basic",
              title: "基本信息",
              fields: [
                { id: "businessKey", label: "业务键", detailPath: "businessKey" },
                { id: "supplier", label: "供应商", fieldId: "supplier" },
              ],
            }],
          },
        },
      },
    );
    assert.equal(sections[0].fields[0].value, "pu_applyorder_1");
    assert.equal(sections[0].fields[1].value, "用友网络");
  });

  it("详情到手时间缺失时明确显示不可用，并保留来源与提交时间", () => {
    const sections = buildDetailCardFields(
      {
        id: "todo-received",
        receivedAt: null,
        receivedAtSourceLabel: "到手时间不可用",
        submittedAt: "2026-07-14T08:00:00Z",
      },
      {},
      {
        groups: {
          default: {
            sections: [{
              id: "basic",
              fields: [
                { id: "receivedAt", label: "到手时间", path: "receivedAt", format: "datetime" },
                { id: "receivedAtSourceLabel", label: "时间来源", path: "receivedAtSourceLabel" },
                { id: "submittedAt", label: "提交时间", path: "submittedAt", format: "datetime" },
              ],
            }],
          },
        },
      },
    );

    assert.equal(sections[0].fields[0].value, "到手时间不可用");
    assert.equal(sections[0].fields[1].value, "到手时间不可用");
    assert.notEqual(sections[0].fields[2].value, "-");
  });
});
