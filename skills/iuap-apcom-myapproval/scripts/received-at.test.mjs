import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  RECEIVED_AT_SOURCE,
  resolveReceivedAt,
  strongerReceivedAt,
  toIsoTimestamp,
} from "./received-at.mjs";

describe("received-at contract", () => {
  it("优先使用 workflow task.createTime，并忽略更晚的消息和提交时间", () => {
    const result = resolveReceivedAt({
      workflowTaskCreateTime: "2026-07-15T08:00:00Z",
      createTsLong: Date.parse("2026-07-15T09:00:00Z"),
      msgTsLong: Date.parse("2026-07-15T10:00:00Z"),
      commitTsLong: Date.parse("2026-07-15T11:00:00Z"),
    });

    assert.equal(result.receivedAt, "2026-07-15T08:00:00.000Z");
    assert.equal(result.receivedAtSource, RECEIVED_AT_SOURCE.WORKFLOW_TASK_CREATE_TIME);
    assert.equal(result.receivedAtSemantics, "task-created");
  });

  it("workflow 缺失时按 createTsLong、createTime、msgTsLong 顺序降级", () => {
    assert.equal(
      resolveReceivedAt({ createTsLong: "1784106000000", createTime: "2026-07-15T10:00:00Z", msgTsLong: 1784113200000 }).receivedAtSource,
      RECEIVED_AT_SOURCE.MESSAGE_CENTER_CREATE_TS_LONG,
    );
    assert.equal(
      resolveReceivedAt({ createTime: "2026-07-15T10:00:00Z", msgTsLong: 1784113200000 }).receivedAtSource,
      RECEIVED_AT_SOURCE.MESSAGE_CENTER_CREATE_TIME,
    );
    assert.equal(
      resolveReceivedAt({ msgTsLong: 1784113200000 }).receivedAtSource,
      RECEIVED_AT_SOURCE.MESSAGE_CENTER_MSG_TS_LONG,
    );
  });

  it("高优先级字段非法时继续尝试下一层", () => {
    const result = resolveReceivedAt({
      workflowTaskCreateTime: "invalid",
      createTsLong: "also-invalid",
      createTime: "2026-07-15T10:00:00Z",
    });
    assert.equal(result.receivedAt, "2026-07-15T10:00:00.000Z");
    assert.equal(result.receivedAtSource, RECEIVED_AT_SOURCE.MESSAGE_CENTER_CREATE_TIME);
  });

  it("只有提交时间、同步时间或非法时间时 receivedAt 不可用", () => {
    for (const input of [
      { commitTsLong: 1784113200000 },
      { lastSyncAt: "2026-07-15T11:00:00Z" },
      { observedAt: "2026-07-15T11:00:00Z" },
      { createTsLong: "invalid" },
    ]) {
      const result = resolveReceivedAt(input);
      assert.equal(result.receivedAt, null);
      assert.equal(result.receivedAtSource, RECEIVED_AT_SOURCE.UNAVAILABLE);
    }
  });

  it("兼容毫秒、数字字符串和 ISO，并拒绝非法值", () => {
    assert.equal(toIsoTimestamp(1784106000000), new Date(1784106000000).toISOString());
    assert.equal(toIsoTimestamp("1784106000000"), new Date(1784106000000).toISOString());
    assert.equal(toIsoTimestamp("2026-07-15T08:00:00Z"), "2026-07-15T08:00:00.000Z");
    assert.equal(toIsoTimestamp("not-a-date"), null);
  });

  it("同任务历史强来源不会被临时弱来源覆盖", () => {
    const strong = resolveReceivedAt({ workflowTaskCreateTime: "2026-07-15T08:00:00Z" });
    const weak = resolveReceivedAt({ createTsLong: Date.parse("2026-07-15T09:00:00Z") });
    assert.deepEqual(strongerReceivedAt(weak, strong), strong);
    assert.deepEqual(strongerReceivedAt(strong, weak), strong);
  });
});
