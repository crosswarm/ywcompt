import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { approvePatches, readJsonResponse } from "./approve-patches.mjs";

function response(text, status = 200) {
  return {
    status,
    async text() {
      return text;
    },
  };
}

describe("approve-patches", () => {
  it("returns parsed JSON responses", async () => {
    const result = await readJsonResponse(response('{"code":200}'), "Detail API");
    assert.deepEqual(result, { code: 200 });
  });

  it("reports empty API responses with HTTP status", async () => {
    await assert.rejects(
      readJsonResponse(response("", 401), "Detail API"),
      /Detail API returned empty response \(HTTP 401\)/,
    );
  });

  it("reports non-JSON API responses with a response snippet", async () => {
    await assert.rejects(
      readJsonResponse(response("<html>login expired</html>", 200), "Save API"),
      /Save API returned non-JSON response \(HTTP 200\): <html>login expired<\/html>/,
    );
  });

  it("delegates patch approval to iuap-apcom-cli and returns successful primary ids", async () => {
    const calls = [];
    const result = await approvePatches(
      [{ primaryId: "p1", taskId: "t1", billId: "b1", title: "补丁" }],
      {
        runBipCli: async (commandPath, input, options) => {
          calls.push({ commandPath, input, options });
          return { primaryIds: ["p1"], success: true };
        },
      },
    );

    assert.equal(result.successCount, 1);
    assert.deepEqual(result.primaryIds, ["p1"]);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].commandPath, ["workflow", "inboxtask", "approve-patch"]);
    assert.deepEqual(calls[0].input, {
      bills: JSON.stringify([{ primaryId: "p1", taskId: "t1", billId: "b1", title: "补丁" }]),
      comment: "同意",
    });
    assert.equal(calls[0].options.dangerous, true);
  });
});
