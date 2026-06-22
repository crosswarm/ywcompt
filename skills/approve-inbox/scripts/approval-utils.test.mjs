import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  findStateItems,
  moveItemsToDone,
  normalizeApprovalBody,
} from "./approval-utils.mjs";

describe("approval-utils", () => {
  it("normalizeApprovalBody accepts ids and defaults approve comment", () => {
    const r = normalizeApprovalBody({ ids: ["a", "a", "b"] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.ids, ["a", "b"]);
    assert.equal(r.action, "approve");
    assert.equal(r.comment, "同意");
  });

  it("normalizeApprovalBody rejects invalid ids", () => {
    const r = normalizeApprovalBody({ ids: ["bad id"] });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  });

  it("findStateItems and moveItemsToDone support v3 state.items", () => {
    const state = {
      businessType: "approve-inbox",
      summary: { total: 2, pendingCount: 2, doneCount: 0 },
      items: [
        { id: "a", title: "A", status: "pending", runtimeActions: [{ action: "approve" }] },
        { id: "b", title: "B", status: "pending", runtimeActions: [{ action: "approve" }] },
      ],
    };
    assert.equal(findStateItems(state, ["a"]).length, 1);
    const moved = moveItemsToDone(state, new Set(["a"]), "approve", "2026-06-22T00:00:00.000Z");
    assert.equal(moved, 1);
    assert.equal(state.items[0].status, "done");
    assert.deepEqual(state.items[0].runtimeActions, []);
    assert.equal(state.summary.pendingCount, 1);
    assert.equal(state.summary.doneCount, 1);
  });

  it("moveItemsToDone supports legacy inbox/done state", () => {
    const state = { inbox: [{ primaryId: "a", title: "A" }], done: [] };
    const moved = moveItemsToDone(state, new Set(["a"]), "reject", "2026-06-22T00:00:00.000Z");
    assert.equal(moved, 1);
    assert.equal(state.inbox.length, 0);
    assert.equal(state.done[0].completedAction, "reject");
  });
});
