import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_VIEW_COLUMNS, parseViewCommand } from "./view-command.mjs";

describe("parseViewCommand()", () => {
  const baseColumns = ["title", "submitter", "receivedAt", "docType", "advice", "riskLevel"];

  it("adds requested business metadata columns", () => {
    const result = parseViewCommand("显示合同金额和供应商", baseColumns, DEFAULT_VIEW_COLUMNS);

    assert.equal(result.status, "ready");
    assert.deepEqual(result.patch.visibleColumnIds, [...baseColumns, "amount", "supplier"]);
    assert.match(result.summary, /显示 金额、供应商/);
  });

  it("hides a requested column but keeps locked title", () => {
    const result = parseViewCommand("隐藏到手时间和标题", baseColumns, DEFAULT_VIEW_COLUMNS);

    assert.equal(result.status, "ready");
    assert.deepEqual(result.patch.visibleColumnIds, ["title", "submitter", "docType", "advice", "riskLevel"]);
  });

  it("默认时间排序解释为到手时间", () => {
    const result = parseViewCommand("按时间排序", baseColumns, DEFAULT_VIEW_COLUMNS);
    assert.equal(result.status, "ready");
    assert.equal(result.patch.sortId, "received-desc");
    assert.match(result.summary, /到手时间/);
  });

  it("parses sort and risk filters", () => {
    const result = parseViewCommand("只看高风险，并按风险排序", baseColumns, DEFAULT_VIEW_COLUMNS);

    assert.equal(result.status, "ready");
    assert.equal(result.patch.focusId, "high");
    assert.equal(result.patch.sortId, "importance-desc");
  });

  it("parses grouping and done scope switches", () => {
    const result = parseViewCommand("切到已办，按类型分组", baseColumns, DEFAULT_VIEW_COLUMNS);

    assert.equal(result.status, "ready");
    assert.equal(result.patch.scopeId, "done");
    assert.equal(result.patch.groupBy, "docType");
  });

  it("returns field candidates for ambiguous display requests", () => {
    const result = parseViewCommand("调整列表字段", baseColumns, DEFAULT_VIEW_COLUMNS);

    assert.equal(result.status, "unknown");
    assert.ok(result.candidates.length > 0);
    assert.ok(result.candidates.every((column) => !column.locked));
  });
});
