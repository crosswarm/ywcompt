import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const schema = JSON.parse(
  readFileSync(new URL("../../../docs/jsonSchema/approve-inbox.schema.json", import.meta.url), "utf8"),
);

test("serviceNameSource schema 只公开 todo 与 iuap-apcom-cli 正式来源", () => {
  const sourceSchema = schema.properties.items.items.properties.serviceNameSource;
  assert.deepEqual(sourceSchema.type, ["string", "null"]);
  assert.deepEqual(sourceSchema.enum, [
    "todo",
    "iuap-apcom-cli.auth.permission.apply",
    null,
  ]);
});
