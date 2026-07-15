import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function load(name) {
  return JSON.parse(readFileSync(new URL(`../config/${name}`, import.meta.url), "utf8"));
}

test("列表和卡片默认展示到手时间", () => {
  const table = load("table-view.json");
  const card = load("card-view.json");
  assert.ok(table.defaultColumns.some((field) => field.id === "receivedAt" && field.path === "receivedAt"));
  assert.ok(card.defaultFields.some((field) => field.id === "receivedAt" && field.path === "receivedAt"));
});

test("详情默认配置不硬编码字段，由 Agent 字段展示计划决定内容", () => {
  const detail = load("detail-card-view.json");
  assert.equal(detail.version, 1);
  assert.deepEqual(detail.groups, {});
});
