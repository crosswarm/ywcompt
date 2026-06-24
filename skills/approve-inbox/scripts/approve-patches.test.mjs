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

  it("saves approval comments and returns successful primary ids", async () => {
    const urls = [];
    const result = await approvePatches(
      [{ primaryId: "p1", taskId: "t1", billId: "b1", title: "补丁" }],
      {
        getAuth: async () => ({ cookieStr: "XSRF-TOKEN=xsrf; yht_access_token=access", xsrfToken: "xsrf" }),
        fetchImpl: async (url, init = {}) => {
          urls.push({ url: String(url), init });
          if (String(url).includes("/bill/detail")) return response(JSON.stringify({ code: 200, data: { bm: "B001" } }));
          return response(JSON.stringify({ code: 200, data: { ok: true } }));
        },
      },
    );

    assert.equal(result.successCount, 1);
    assert.deepEqual(result.primaryIds, ["p1"]);
    assert.equal(urls.length, 2);
    assert.ok(urls[1].url.includes("/bill/save"));
  });
});
