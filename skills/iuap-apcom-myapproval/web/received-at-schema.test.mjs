import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const schema = JSON.parse(readFileSync(new URL("../../../docs/jsonSchema/approve-inbox.schema.json", import.meta.url), "utf8"));
const itemProperties = schema.properties.items.items.properties;

test("receivedAt schema 明确字段、来源和降级语义", () => {
  assert.deepEqual(itemProperties.receivedAt.type, ["string", "null"]);
  assert.ok(itemProperties.receivedAtSource.enum.includes("workflow.task.createTime"));
  assert.ok(itemProperties.receivedAtSource.enum.includes("unavailable"));
  assert.ok(itemProperties.receivedAtSemantics.enum.includes("message-timestamp"));
  assert.equal(itemProperties.receivedAtSourceLabel.type, "string");
});

test("排序契约新增 receivedAt 且保留 submittedAt 兼容项", () => {
  const values = schema.properties.viewSettings.properties.defaultSort.enum;
  assert.ok(values.includes("received-desc"));
  assert.ok(values.includes("received-asc"));
  assert.ok(values.includes("submitted-desc"));
  assert.ok(values.includes("submitted-asc"));
});
