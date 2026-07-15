import { test } from "node:test";
import assert from "node:assert/strict";

import {
  sanitizeIdentityBearingUrl,
  sanitizeStoredIdentityData,
} from "./identity-data-sanitizer.mjs";

test("sanitizeIdentityBearingUrl removes identity and auth query parameters only", () => {
  const result = sanitizeIdentityBearingUrl(
    "https://example.test/voucher/1?tenantId=tenant-secret&taskId=task-1&adt=auth-secret&businessKey=biz-1",
  );
  const url = new URL(result);
  assert.equal(url.searchParams.has("tenantId"), false);
  assert.equal(url.searchParams.has("adt"), false);
  assert.equal(url.searchParams.get("taskId"), "task-1");
  assert.equal(url.searchParams.get("businessKey"), "biz-1");
});

test("sanitizeStoredIdentityData recursively removes plaintext identity and credentials", () => {
  const input = {
    tenantId: "tenant-secret",
    tenantName: "Secret tenant",
    tenantKey: "a".repeat(64),
    nested: {
      yhtUserId: "user-secret",
      userId: "generic-secret",
      creator: "creator-secret",
      modifier: "modifier-secret",
      freeChId: { ytenantId: "tenant-secret" },
      webUrl: "https://example.test/x?taskId=t1&currentTenantId=tenant-secret&token=secret",
    },
  };

  const result = sanitizeStoredIdentityData(input);
  assert.equal(result.tenantId, undefined);
  assert.equal(result.tenantName, undefined);
  assert.equal(result.tenantKey, input.tenantKey);
  assert.equal(result.nested.yhtUserId, undefined);
  assert.equal(result.nested.userId, undefined);
  assert.equal(result.nested.creator, undefined);
  assert.equal(result.nested.modifier, undefined);
  assert.deepEqual(result.nested.freeChId, {});
  assert.match(result.nested.webUrl, /taskId=t1/);
  assert.doesNotMatch(JSON.stringify(result), /tenant-secret|user-secret|generic-secret|creator-secret|modifier-secret|token=secret/);
  assert.equal(input.tenantId, "tenant-secret");
});
