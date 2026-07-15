import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { executeApproval } from "./approval-executor.mjs";

const OLD_PROXY = process.env.APPROVE_INBOX_PROXY;

function cliDeps(resultByCall = []) {
  const calls = [];
  return {
    calls,
    bipCliPath: "/fake/iuap-apcom-cli/scripts/bip-cli.js",
    existsSync: () => true,
    async runBipCli(commandPath, input, options) {
      calls.push({ commandPath, input, options });
      if (commandPath[2] === "list-action") {
        return {
          actions: [
            { action: "approve", label: "同意", enabled: true },
            { action: "return", label: "退回", enabled: true },
            { action: "reject", label: "驳回", enabled: true },
          ],
        };
      }
      const next = resultByCall.shift();
      if (next instanceof Error) throw next;
      return next ?? { success: true };
    },
  };
}

function writeCalls(deps) {
  return deps.calls.filter((call) => call.commandPath[2] !== "list-action");
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
    const writes = writeCalls(deps);
    assert.deepEqual(writes[0].commandPath, ["workflow", "task", "batch-approve"]);
    assert.deepEqual(writes[0].input, { primaryIds: JSON.stringify(["m1"]), content: "同意" });
    assert.equal(writes[0].options.dangerous, true);
  });

  it("executes MDF approve through iuap-apcom-cli by default", async () => {
    const deps = cliDeps([{ flag: 0 }]);
    const r = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(r.success, true);
    assert.deepEqual(r.successIds, ["m1"]);
    assert.deepEqual(writeCalls(deps)[0].commandPath, ["workflow", "task", "batch-approve"]);
  });

  it("executes MDF reject through iuap-apcom-cli by default", async () => {
    const deps = cliDeps([{ flag: 0 }]);
    const r = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "return", comment: "退回修改", detailsById: new Map() },
      deps,
    );

    assert.equal(r.success, true);
    assert.deepEqual(r.successIds, ["m1"]);
    const writes = writeCalls(deps);
    assert.deepEqual(writes[0].commandPath, ["workflow", "task", "batch-reject"]);
    assert.equal(writes[0].input.content, "退回修改");
  });

  it("reports iuap-apcom-cli approval failure without local success", async () => {
    const deps = cliDeps([{ flag: 1, message: "bad request" }]);
    const r = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
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
    const writes = writeCalls(deps);
    assert.deepEqual(writes[0].commandPath, ["workflow", "task", "batch-reject"]);
    assert.deepEqual(writes[0].input, { primaryIds: JSON.stringify(["m1"]), content: "不同意" });
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
      { bipCliPath: "/missing/bip-cli.js", existsSync: () => false },
    );

    assert.equal(r.success, false);
    assert.deepEqual(r.successIds, []);
    assert.match(r.results[0].error, /未找到 iuap-apcom-cli/);
  });

  it("does not call CLI when the item has no matching runtime action", async () => {
    const deps = cliDeps([{ success: true }]);
    deps.refreshActions = async () => ({ actions: [] });
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

  it("reports workflow command failure without moving ids", async () => {
    const deps = cliDeps([new Error("BIP browser session is not logged in")]);
    const r = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(r.success, false);
    assert.deepEqual(r.successIds, []);
    assert.equal(writeCalls(deps).length, 1);
    assert.match(r.results[0].error, /not logged in/);
  });

  it("executes patch approve through workflow inboxtask approve-patch", async () => {
    const deps = cliDeps([
      { successCount: 1, failCount: 0, primaryIds: ["p1"], bills: [{ primaryId: "p1", success: true }] },
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
    const writes = writeCalls(deps);
    assert.deepEqual(writes[0].commandPath, ["workflow", "inboxtask", "approve-patch"]);
    assert.equal(writes[0].input.bills, JSON.stringify([{ primaryId: "p1", title: "紧急补丁审批单", taskId: "task-1", billId: "bill-1" }]));
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
    const writes = writeCalls(deps);
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].commandPath, ["workflow", "task", "batch-reject"]);
    assert.equal(writes[0].input.primaryIds, JSON.stringify(["p1"]));
    assert.deepEqual(r.successIds, ["p1"]);
  });

  it("executes iForm approve through workflow inboxtask approve-iform", async () => {
    const deps = cliDeps([{ success: true }]);
    const item = {
      id: "i1",
      webUrl:
        "https://c1.yonyoucloud.com/yonbip-ec-iform/index?formId=f1&formInstanceId=bo1&taskId=t1&processDefinitionId=p1",
    };
    const r = await executeApproval(
      [item],
      { action: "approve", comment: "同意", mode: "direct", detailsById: new Map() },
      deps,
    );

    assert.equal(r.success, true);
    assert.deepEqual(r.successIds, ["i1"]);
    const writes = writeCalls(deps);
    assert.deepEqual(writes[0].commandPath, ["workflow", "inboxtask", "approve-iform"]);
    assert.equal(writes[0].input.webUrl, item.webUrl);
  });

  it("reports iForm command failure without moving ids", async () => {
    const item = {
      id: "i1",
      webUrl:
        "https://c1.yonyoucloud.com/yonbip-ec-iform/index?formId=f1&formInstanceId=bo1&taskId=t1&processDefinitionId=p1",
    };
    const deps = cliDeps([new Error("BIP browser session is not logged in")]);
    const r = await executeApproval(
      [item],
      { action: "approve", comment: "同意", mode: "direct", detailsById: new Map() },
      deps,
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
