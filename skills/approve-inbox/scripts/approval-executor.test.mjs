import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { executeApproval } from "./approval-executor.mjs";

const OLD_PROXY = process.env.APPROVE_INBOX_PROXY;

describe("approval-executor", () => {
  beforeEach(() => {
    process.env.APPROVE_INBOX_PROXY = "http://localhost:65530";
  });

  afterEach(() => {
    if (OLD_PROXY == null) delete process.env.APPROVE_INBOX_PROXY;
    else process.env.APPROVE_INBOX_PROXY = OLD_PROXY;
  });

  it("executes MDF approve through batch HTTP API and returns success ids", async () => {
    const calls = [];
    const r = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      {
        fetch: async (url, init) => {
          calls.push({ url: String(url), init });
          return { ok: true, status: 200, json: async () => ({ flag: 0 }) };
        },
      },
    );
    assert.equal(r.success, true);
    assert.deepEqual(r.successIds, ["m1"]);
    assert.ok(calls[0].url.includes("/iuap-apcom-messagecenter/todocenter/rest/client/patch/batch/async/action"));
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body.primaryIds, ["m1"]);
    assert.equal(body.callBackExecType, "agree");
  });

  it("does not return success ids when MDF batch API reports failure", async () => {
    const r = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      { fetch: async () => ({ ok: true, status: 200, json: async () => ({ flag: 1, message: "boom" }) }) },
    );
    assert.equal(r.success, false);
    assert.deepEqual(r.successIds, []);
  });

  it("executes iForm approve through audit API", async () => {
    const urls = [];
    const item = {
      id: "i1",
      webUrl:
        "https://c1.yonyoucloud.com/yonbip-ec-iform/index?formId=f1&formInstanceId=bo1&taskId=t1&processDefinitionId=p1",
    };
    const r = await executeApproval(
      [item],
      { action: "approve", comment: "同意", mode: "direct", detailsById: new Map() },
      {
        getCookies: async () => ({ proxy: true, cookieStr: "", xsrfToken: null }),
        fetch: async (url) => {
          urls.push(String(url));
          return { text: async () => JSON.stringify({ success: true }) };
        },
      },
    );
    assert.equal(r.success, true);
    assert.deepEqual(r.successIds, ["i1"]);
    assert.ok(urls.some((url) => url.includes("/yonbip-ec-iform/wf_ctr/audit")));
  });

  it("keeps YNF approval unsupported in phase one", async () => {
    const r = await executeApproval(
      [{ id: "y1", webUrl: "https://c1.yonyoucloud.com/mdf-node/fragment/x?apptype=ynf" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
    );
    assert.equal(r.success, false);
    assert.deepEqual(r.successIds, []);
    assert.equal(r.results[0].type, "ynf");
  });
});
