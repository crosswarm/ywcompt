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

test("详情同时展示到手时间、来源和提交时间", () => {
  const detail = load("detail-card-view.json");
  const fields = detail.groups.default.sections.flatMap((section) => section.fields || []);
  assert.ok(fields.some((field) => field.id === "receivedAt"));
  assert.ok(fields.some((field) => field.id === "receivedAtSourceLabel"));
  assert.ok(fields.some((field) => field.id === "submittedAt"));
});
