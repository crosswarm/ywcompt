import test from "node:test";
import assert from "node:assert/strict";

import { hasAttachmentAssociation } from "./enrich-details.mjs";

test("recognizes an MDF attachment association token", () => {
  assert.equal(hasAttachmentAssociation({ vattachmentass: "A7dX4dmxi6wvpLCmPHr1X5zp0OKVxMZI" }), true);
});

test("does not mark empty attachment fields as attached", () => {
  assert.equal(hasAttachmentAssociation({ attachmentId: "", fileCount: 0, nested: { attachments: "[]" } }), false);
});
