import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { executeApproval } from "./approval-executor.mjs";

const OLD_PROXY = process.env.APPROVE_INBOX_PROXY;

function cliDeps(resultByCall = []) {
  const calls = [];
  const authCalls = [];
  return {
    calls,
    authCalls,
    approvalTransport: "cli",
    bipCliPath: "/fake/iuap-apcom-cli/scripts/bip-cli.js",
    approvePatchesScript: "/fake/approve-patches.mjs",
    existsSync: () => true,
    async getBrowserAuth() {
      authCalls.push(true);
      return {};
    },
    async runNodeScript(scriptPath, args) {
      calls.push({ scriptPath, args });
      const next = resultByCall.shift();
      if (next instanceof Error) throw next;
      return next ?? { success: true };
    },
  };
}

describe("approval-executor", () => {
  beforeEach(() => {
    process.env.APPROVE_INBOX_PROXY = "http://localhost:65530";
  });

  afterEach(() => {
    if (OLD_PROXY == null) delete process.env.APPROVE_INBOX_PROXY;
    else process.env.APPROVE_INBOX_PROXY = OLD_PROXY;
  });

  it("executes MDF approve through iuap-apcom-cli batch-approve", async () => {
    const deps = cliDeps([{ success: true }]);
    const r = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(r.success, true);
    assert.deepEqual(r.successIds, ["m1"]);
    assert.equal(deps.calls[0].scriptPath, "/fake/iuap-apcom-cli/scripts/bip-cli.js");
    assert.deepEqual(deps.calls[0].args, [
      "workflow",
      "task",
      "batch-approve",
      "--primary-ids",
      JSON.stringify(["m1"]),
      "--content",
      "同意",
      "--format",
      "json",
    ]);
  });

  it("executes MDF approve through YonClaw proxy session by default", async () => {
    const calls = [];
    const r = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      {
        detectProxy: async () => "http://yonclaw-proxy.test",
        fetch: async (url, init) => {
          calls.push({ url: String(url), body: JSON.parse(init.body) });
          return { ok: true, status: 200, text: async () => JSON.stringify({ flag: 0 }) };
        },
      },
    );

    assert.equal(r.success, true);
    assert.deepEqual(r.successIds, ["m1"]);
    assert.equal(calls[0].url, "http://yonclaw-proxy.test/iuap-apcom-messagecenter/todocenter/rest/client/patch/batch/async/action");
    assert.deepEqual(calls[0].body, { primaryIds: ["m1"], callBackExecType: "agree", content: "同意" });
    assert.equal(r.results[0].result._transport, "yonclaw-proxy");
  });

  it("executes MDF reject through YonClaw proxy session", async () => {
    const calls = [];
    const r = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "return", comment: "退回修改", detailsById: new Map() },
      {
        detectProxy: async () => "http://yonclaw-proxy.test",
        fetch: async (url, init) => {
          calls.push({ url: String(url), body: JSON.parse(init.body) });
          return { ok: true, status: 200, text: async () => JSON.stringify({ flag: 0 }) };
        },
      },
    );

    assert.equal(r.success, true);
    assert.deepEqual(r.successIds, ["m1"]);
    assert.equal(calls[0].body.callBackExecType, "reject");
    assert.equal(calls[0].body.content, "退回修改");
  });

  it("reports YonClaw proxy approval failure without local success", async () => {
    const r = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      {
        detectProxy: async () => "http://yonclaw-proxy.test",
        fetch: async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ flag: 1, message: "bad request" }) }),
      },
    );

    assert.equal(r.success, false);
    assert.deepEqual(r.successIds, []);
    assert.equal(r.results[0].type, "mdf");
    assert.match(JSON.stringify(r.results[0].result), /bad request/);
  });

  it("executes MDF reject through iuap-apcom-cli batch-reject and maps task ids back to local ids", async () => {
    const deps = cliDeps([{ results: [{ primaryId: "m1", success: true }] }]);
    const r = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "reject", comment: "不同意", detailsById: new Map() },
      deps,
    );

    assert.equal(r.success, true);
    assert.deepEqual(r.successIds, ["m1"]);
    assert.deepEqual(deps.calls[0].args, [
      "workflow",
      "task",
      "batch-reject",
      "--primary-ids",
      JSON.stringify(["m1"]),
      "--content",
      "不同意",
      "--format",
      "json",
    ]);
  });

  it("does not return success ids when MDF CLI reports failure", async () => {
    const deps = cliDeps([{ success: false, message: "boom" }]);
    const r = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(r.success, false);
    assert.deepEqual(r.successIds, []);
    assert.equal(r.results[0].type, "mdf");
  });

  it("keeps partial CLI successes and marks batch unsuccessful", async () => {
    const deps = cliDeps([{
      results: [
        { primaryId: "m1", success: true },
        { primaryId: "m2", success: false, error: "failed" },
      ],
    }]);
    const r = await executeApproval(
      [
        { id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" },
        { id: "m2", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/2?taskId=task-2" },
      ],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(r.success, false);
    assert.deepEqual(r.successIds, ["m1"]);
  });

  it("reports missing iuap-apcom-cli path without local success", async () => {
    const r = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      { approvalTransport: "cli", bipCliPath: "/missing/bip-cli.js", existsSync: () => false },
    );

    assert.equal(r.success, false);
    assert.deepEqual(r.successIds, []);
    assert.match(r.results[0].error, /未找到 iuap-apcom-cli/);
  });

  it("does not call CLI when the item has no matching runtime action", async () => {
    const deps = cliDeps([{ success: true }]);
    const r = await executeApproval(
      [{
        id: "m1",
        title: "退回制单待办",
        runtimeActions: [],
        webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1",
      }],
      { action: "reject", comment: "不同意", detailsById: new Map() },
      deps,
    );

    assert.equal(r.success, false);
    assert.deepEqual(r.successIds, []);
    assert.equal(deps.calls.length, 0);
    assert.equal(r.results[0].type, "unavailable");
    assert.match(r.results[0].error, /没有可执行/);
  });

  it("trusts refreshed actions before execution", async () => {
    const deps = cliDeps([{ success: true }]);
    deps.refreshActions = async () => ({ actions: [] });
    const r = await executeApproval(
      [{
        id: "m1",
        runtimeActions: [{ action: "approve", callBackExecType: "agree" }],
        webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1",
      }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(r.success, false);
    assert.deepEqual(r.successIds, []);
    assert.equal(deps.calls.length, 0);
    assert.equal(r.results[0].type, "unavailable");
  });

  it("blocks approval when action refresh fails", async () => {
    const deps = cliDeps([{ success: true }]);
    deps.refreshActions = async () => {
      throw new Error("workflow context expired");
    };
    const r = await executeApproval(
      [{
        id: "m1",
        runtimeActions: [{ action: "approve", callBackExecType: "agree" }],
        webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1",
      }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(r.success, false);
    assert.deepEqual(r.successIds, []);
    assert.equal(deps.calls.length, 0);
    assert.equal(r.results[0].type, "action_refresh_failed");
    assert.match(r.results[0].error, /workflow context expired/);
  });

  it("reports workflow auth failure before calling batch CLI", async () => {
    const deps = cliDeps([{ success: true }]);
    deps.getBrowserAuth = async () => {
      throw new Error("BIP browser session is not logged in");
    };
    const r = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(r.success, false);
    assert.deepEqual(r.successIds, []);
    assert.equal(deps.calls.length, 0);
    assert.match(r.results[0].error, /iuap-apcom-cli 登录态不可用/);
  });

  it("runs patch save before batch-approve for patch MDF items", async () => {
    const deps = cliDeps([
      { successCount: 1, failCount: 0, primaryIds: ["p1"], bills: [{ primaryId: "p1", success: true }] },
      { success: true },
    ]);
    const r = await executeApproval(
      [{
        id: "p1",
        title: "紧急补丁审批单",
        taskId: "task-1",
        billId: "bill-1",
        webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/CJJBDYJZSP/1?taskId=task-1",
      }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(r.success, true);
    assert.equal(deps.calls[0].scriptPath, "/fake/approve-patches.mjs");
    assert.equal(deps.calls[1].scriptPath, "/fake/iuap-apcom-cli/scripts/bip-cli.js");
    assert.deepEqual(deps.calls[1].args.slice(0, 5), ["workflow", "task", "batch-approve", "--primary-ids", JSON.stringify(["p1"])]);
    assert.deepEqual(r.successIds, ["p1"]);
  });

  it("executes patch reject through batch-reject without patch save", async () => {
    const deps = cliDeps([{ success: true }]);
    const r = await executeApproval(
      [{
        id: "p1",
        title: "紧急补丁审批单",
        taskId: "task-1",
        billId: "bill-1",
        webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/CJJBDYJZSP/1?taskId=task-1",
      }],
      { action: "return", comment: "退回修改", detailsById: new Map() },
      deps,
    );

    assert.equal(r.success, true);
    assert.equal(deps.calls.length, 1);
    assert.equal(deps.calls[0].scriptPath, "/fake/iuap-apcom-cli/scripts/bip-cli.js");
    assert.deepEqual(deps.calls[0].args.slice(0, 5), ["workflow", "task", "batch-reject", "--primary-ids", JSON.stringify(["p1"])]);
    assert.deepEqual(r.successIds, ["p1"]);
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

  it("reports iForm auth failure without moving ids", async () => {
    const item = {
      id: "i1",
      webUrl:
        "https://c1.yonyoucloud.com/yonbip-ec-iform/index?formId=f1&formInstanceId=bo1&taskId=t1&processDefinitionId=p1",
    };
    const r = await executeApproval(
      [item],
      { action: "approve", comment: "同意", mode: "direct", detailsById: new Map() },
      { getBrowserAuth: async () => { throw new Error("BIP browser session is not logged in"); } },
    );

    assert.equal(r.success, false);
    assert.deepEqual(r.successIds, []);
    assert.match(r.results[0].error, /not logged in/);
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
