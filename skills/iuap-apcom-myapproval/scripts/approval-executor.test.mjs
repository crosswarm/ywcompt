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
      if (commandPath[2] === "todo-detail") {
        return {
          todo: {
            route: "workflow-engine",
            availableActions: ["complete", "reject"],
            actionAvailability: {
              complete: { available: true },
              reject: { available: true },
            },
            task: { id: input.taskId, source: "iuap-apcom-auth", processInstanceId: "proc-1" },
          },
          document: {},
        };
      }
      const next = resultByCall.shift();
      if (next instanceof Error) throw next;
      return next ?? { success: true };
    },
  };
}

function writeCalls(deps) {
  return deps.calls.filter((call) => call.commandPath[2] !== "todo-detail");
}

describe("approval-executor", () => {
  beforeEach(() => {
    process.env.APPROVE_INBOX_PROXY = "http://localhost:65530";
  });

  afterEach(() => {
    if (OLD_PROXY == null) delete process.env.APPROVE_INBOX_PROXY;
    else process.env.APPROVE_INBOX_PROXY = OLD_PROXY;
  });

  it("rejects missing or unsupported actions before action refresh or execution", async () => {
    for (const action of [undefined, "archive"]) {
      const deps = cliDeps([{ success: true }]);
      const result = await executeApproval(
        [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
        { action, comment: "同意", detailsById: new Map() },
        deps,
      );

      assert.equal(result.success, false);
      assert.deepEqual(result.successIds, []);
      assert.equal(result.results[0].type, "invalid_action");
      assert.equal(result.results[0].code, "INVALID_APPROVAL_ACTION");
      assert.equal(deps.calls.length, 0);
    }
  });

  it("executes MDF approve through iuap-apcom-cli batch-approve", async () => {
    const deps = cliDeps([{ success: true, successIds: ["m1"] }]);
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

  it("identity-clamps every dangerous command immediately before and after execution", async () => {
    const deps = cliDeps([{ success: true, successIds: ["m1"] }]);
    const events = [];
    const originalRun = deps.runBipCli;
    deps.runBipCli = async (...args) => {
      events.push(args[0].join(" "));
      return originalRun(...args);
    };
    deps.beforeDangerousCommand = async ({ primaryIds }) => events.push(`before:${primaryIds.join(",")}`);
    deps.afterDangerousCommand = async ({ primaryIds }) => events.push(`after:${primaryIds.join(",")}`);

    const result = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(result.success, true);
    assert.deepEqual(events, [
      "workflow task todo-detail",
      "before:m1",
      "workflow task batch-approve",
      "after:m1",
    ]);
  });

  it("does not issue a dangerous command when the identity pre-guard fails", async () => {
    const deps = cliDeps([{ success: true }]);
    deps.beforeDangerousCommand = async () => {
      const error = new Error("identity changed");
      error.code = "IDENTITY_CHANGED_DURING_APPROVAL";
      throw error;
    };

    const result = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(result.success, false);
    assert.equal(result.results[0].code, "IDENTITY_CHANGED_DURING_APPROVAL");
    assert.equal(writeCalls(deps).length, 0);
  });

  it("marks a successful remote result for reconciliation when the post-guard detects a switch", async () => {
    const deps = cliDeps([{ success: true, successIds: ["m1"] }]);
    deps.beforeDangerousCommand = async () => {};
    deps.afterDangerousCommand = async () => {
      const error = new Error("identity changed after command");
      error.code = "IDENTITY_CHANGED_DURING_APPROVAL";
      throw error;
    };

    const result = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(result.success, false);
    assert.equal(result.results[0].remoteCommitted, true);
    assert.equal(result.results[0].code, "IDENTITY_CHANGED_DURING_APPROVAL");
    assert.deepEqual(result.successIds, []);
  });

  it("keeps a thrown dangerous CLI outcome unknown even when the post-guard succeeds", async () => {
    const timeout = new Error("workflow approval timed out");
    timeout.code = "CLI_TIMEOUT";
    const deps = cliDeps([timeout]);
    const afterCalls = [];
    deps.beforeDangerousCommand = async () => {};
    deps.afterDangerousCommand = async (context) => {
      afterCalls.push(context);
    };

    const result = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(result.success, false);
    assert.deepEqual(result.successIds, []);
    assert.equal(result.results[0].code, "APPROVAL_REMOTE_TIMEOUT");
    assert.equal(result.results[0].issue.userMessage, "远端审批请求超时，结果尚未确认，已转为待核对。");
    assert.equal(result.results[0].remoteOutcome, "unknown");
    assert.equal(result.results[0].remoteOutcomeUnknown, true);
    assert.equal(result.results[0].remoteCommitted, undefined);
    assert.equal(result.results[0].completed, undefined);
    assert.equal(afterCalls.length, 1);
    assert.equal(afterCalls[0].remoteOutcomeUnknown, true);
    assert.equal(afterCalls[0].error, timeout);
  });

  it("classifies a local CLI argument rejection as confirmed failed before any remote request", async () => {
    const argumentError = new Error("error: unknown option '--yes'");
    const deps = cliDeps([argumentError]);
    const afterCalls = [];
    deps.beforeDangerousCommand = async () => {};
    deps.afterDangerousCommand = async (context) => afterCalls.push(context);

    const result = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(result.success, false);
    assert.deepEqual(result.successIds, []);
    assert.equal(result.results[0].code, "CLI_REQUEST_REJECTED_BEFORE_SEND");
    assert.equal(result.results[0].remoteOutcome, "confirmed_failed");
    assert.equal(result.results[0].remoteOutcomeUnknown, undefined);
    assert.equal(afterCalls.length, 1);
    assert.equal(afterCalls[0].remoteRequestStarted, false);
  });

  it("classifies a thrown dangerous CLI HTTP 401 without losing the unknown remote outcome", async () => {
    const unauthorized = new Error("HTTP 401 Unauthorized");
    const deps = cliDeps([unauthorized]);
    deps.beforeDangerousCommand = async () => {};
    deps.afterDangerousCommand = async () => {};

    const result = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(result.success, false);
    assert.deepEqual(result.successIds, []);
    assert.equal(result.results[0].code, "AUTH_REQUIRED_IN_YONWORK");
    assert.equal(result.results[0].issue.httpStatus, 401);
    assert.equal(result.results[0].remoteOutcome, "unknown");
    assert.equal(result.results[0].remoteOutcomeUnknown, true);
  });

  it("treats an ambiguous dangerous CLI response as an unknown remote outcome", async () => {
    const deps = cliDeps([{}]);
    const result = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(result.success, false);
    assert.deepEqual(result.successIds, []);
    assert.equal(result.results[0].code, "APPROVAL_REMOTE_OUTCOME_UNKNOWN");
    assert.equal(result.results[0].remoteOutcome, "unknown");
    assert.equal(result.results[0].remoteOutcomeUnknown, true);
  });

  it("classifies an exit-zero dangerous CLI 401 as AUTH_REQUIRED_IN_YONWORK", async () => {
    const deps = cliDeps([{ errcode: 401, message: "unauthorized" }]);
    const result = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(result.success, false);
    assert.deepEqual(result.successIds, []);
    assert.equal(result.results[0].code, "AUTH_REQUIRED_IN_YONWORK");
    assert.equal(result.results[0].issue.httpStatus, 401);
    assert.equal(result.results[0].remoteOutcome, "confirmed_failed");
    assert.equal(result.results[0].remoteOutcomeUnknown, undefined);
  });

  it("classifies a nested exit-zero dangerous CLI 401 as AUTH_REQUIRED_IN_YONWORK", async () => {
    const deps = cliDeps([{ results: [{ errcode: 401, message: "unauthorized" }] }]);
    const result = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(result.success, false);
    assert.deepEqual(result.successIds, []);
    assert.equal(result.results[0].code, "AUTH_REQUIRED_IN_YONWORK");
    assert.equal(result.results[0].issue.httpStatus, 401);
    assert.equal(result.results[0].remoteOutcome, "confirmed_failed");
  });

  it("classifies status 200 plus errcode/code 401 envelopes as AUTH_REQUIRED_IN_YONWORK", async () => {
    for (const envelope of [
      { status: 200, errcode: 401, message: "managed session expired" },
      { status: 200, code: 401, message: "managed session expired" },
    ]) {
      const deps = cliDeps([envelope]);
      const result = await executeApproval(
        [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
        { action: "approve", comment: "同意", detailsById: new Map() },
        deps,
      );

      assert.equal(result.success, false);
      assert.deepEqual(result.successIds, []);
      assert.equal(result.results[0].code, "AUTH_REQUIRED_IN_YONWORK");
      assert.equal(result.results[0].issue.httpStatus, 401);
      assert.equal(result.results[0].remoteOutcome, "confirmed_failed");
    }
  });

  it("executes MDF approve through iuap-apcom-cli by default", async () => {
    const deps = cliDeps([{ flag: 0, successIds: ["m1"] }]);
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
    const deps = cliDeps([{ flag: 0, successIds: ["m1"] }]);
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

  it("does not let top-level primaryIds override failed per-item results", async () => {
    const deps = cliDeps([{
      primaryIds: ["m1", "m2"],
      results: [
        { primaryId: "m1", success: true },
        { primaryId: "m2", success: false, error: "failed" },
      ],
    }]);
    const result = await executeApproval(
      [
        { id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" },
        { id: "m2", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/2?taskId=task-2" },
      ],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(result.success, false);
    assert.deepEqual(result.successIds, ["m1"]);
    assert.equal(result.results[0].remoteCommitted, undefined);
  });

  it("routes an id-less nested batch success to reconciliation instead of marking all items successful", async () => {
    const deps = cliDeps([{ results: [{ success: true }] }]);
    const result = await executeApproval(
      [
        { id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" },
        { id: "m2", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/2?taskId=task-2" },
      ],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(result.success, false);
    assert.deepEqual(result.successIds, []);
    assert.equal(result.results[0].remoteCommitted, true);
    assert.equal(result.results[0].remoteOutcome, "confirmed_committed");
  });

  it("routes a top-level batch success without ids to reconciliation", async () => {
    const deps = cliDeps([{ success: true }]);
    const result = await executeApproval(
      [
        { id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" },
        { id: "m2", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/2?taskId=task-2" },
      ],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(result.success, false);
    assert.deepEqual(result.successIds, []);
    assert.equal(result.results[0].remoteCommitted, true);
    assert.equal(result.results[0].remoteOutcome, "confirmed_committed");
  });

  it("routes a successful batch with an extra unmapped id to reconciliation", async () => {
    const deps = cliDeps([{ success: true, successIds: ["m1", "m2", "other"] }]);
    const result = await executeApproval(
      [
        { id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" },
        { id: "m2", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/2?taskId=task-2" },
      ],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(result.success, false);
    assert.deepEqual(result.successIds, []);
    assert.equal(result.results[0].remoteCommitted, true);
    assert.equal(result.results[0].remoteOutcome, "confirmed_committed");
  });

  it("reports missing iuap-apcom-cli path without local success", async () => {
    const r = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      { bipCliPath: "/missing/bip-cli.js", existsSync: () => false },
    );

    assert.equal(r.success, false);
    assert.deepEqual(r.successIds, []);
    assert.match(r.results[0].error, /未找到.*iuap-apcom-cli/);
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

  it("falls back to snapshot actions when a custom refresh returns a clean empty list", async () => {
    const deps = cliDeps([{ success: true, successIds: ["m1"] }]);
    deps.refreshActions = async () => ({ actions: [] });
    const phases = [];
    deps.onPhase = (event) => phases.push(event.phase);
    const r = await executeApproval(
      [{
        id: "m1",
        runtimeActions: [{ action: "approve", callBackExecType: "agree" }],
        webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1",
      }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(r.success, true);
    assert.deepEqual(r.successIds, ["m1"]);
    const writes = writeCalls(deps);
    assert.deepEqual(writes[0].commandPath, ["workflow", "task", "batch-approve"]);
    assert.ok(phases.includes("refresh_fallback_snapshot"));
  });

  it("falls back to snapshot actions when a refresh result omits the todo block", async () => {
    const calls = [];
    const r = await executeApproval(
      [{
        id: "m1",
        runtimeActions: [{ action: "approve", callBackExecType: "agree" }],
        observedActions: [{ action: "approve", callBackExecType: "agree" }],
        webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1",
      }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      {
        bipCliPath: "/fake/iuap-apcom-cli/scripts/bip-cli.js",
        existsSync: () => true,
        async runBipCli(commandPath) {
          calls.push(commandPath);
          if (commandPath[2] === "todo-detail") return { source: "legacy-todo-detail" };
          return { success: true, successIds: ["m1"] };
        },
      },
    );

    assert.equal(r.success, true);
    assert.deepEqual(r.successIds, ["m1"]);
    assert.deepEqual(calls, [
      ["workflow", "task", "todo-detail"],
      ["workflow", "task", "batch-approve"],
    ]);
  });

  it("falls back to the sync snapshot when todo-detail returns clean empty availableActions", async () => {
    const deps = cliDeps([{ success: true, successIds: ["m1"] }]);
    const originalRun = deps.runBipCli;
    deps.runBipCli = async (commandPath, input, options) => {
      if (commandPath[2] === "todo-detail") {
        deps.calls.push({ commandPath, input, options });
        return { todo: { route: "message-center-fallback", availableActions: [], actionAvailability: {} }, document: {} };
      }
      return originalRun(commandPath, input, options);
    };
    const phases = [];
    deps.onPhase = (event) => phases.push(event.phase);
    const r = await executeApproval(
      [{
        id: "m1",
        runtimeActions: [
          { action: "return", label: "退回", callBackExecType: "reject", enabled: true, source: "todo.buttons" },
        ],
        webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1",
      }],
      { action: "return", comment: "退回处理", detailsById: new Map() },
      deps,
    );

    assert.equal(r.success, true);
    assert.deepEqual(r.successIds, ["m1"]);
    const writes = writeCalls(deps);
    assert.deepEqual(writes[0].commandPath, ["workflow", "task", "batch-reject"]);
    assert.ok(phases.includes("refresh_fallback_snapshot"));
  });

  it("does not fall back when a non-empty refresh lacks the requested action", async () => {
    const deps = cliDeps([{ success: true, successIds: ["m1"] }]);
    deps.runBipCli = async (commandPath, input, options) => {
      deps.calls.push({ commandPath, input, options });
      if (commandPath[2] === "todo-detail") {
        return {
          todo: {
            route: "workflow-engine",
            availableActions: ["complete"],
            actionAvailability: { complete: { available: true } },
          },
          document: {},
        };
      }
      return { success: true, successIds: ["m1"] };
    };
    const r = await executeApproval(
      [{
        id: "m1",
        runtimeActions: [{ action: "return", callBackExecType: "reject", enabled: true }],
        webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1",
      }],
      { action: "return", comment: "退回", detailsById: new Map() },
      deps,
    );

    assert.equal(r.success, false);
    assert.equal(r.results[0].type, "unavailable");
    assert.equal(writeCalls(deps).length, 0);
  });

  it("keeps the strict gate when APPROVE_INBOX_ACTION_REFRESH_STRICT=1", async () => {
    process.env.APPROVE_INBOX_ACTION_REFRESH_STRICT = "1";
    try {
      const deps = cliDeps([{ success: true, successIds: ["m1"] }]);
      deps.refreshActions = async () => ({ actions: [] });
      const r = await executeApproval(
        [{
          id: "m1",
          runtimeActions: [{ action: "approve", callBackExecType: "agree", enabled: true }],
          webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1",
        }],
        { action: "approve", comment: "同意", detailsById: new Map() },
        deps,
      );
      assert.equal(r.success, false);
      assert.equal(r.results[0].type, "unavailable");
      assert.equal(writeCalls(deps).length, 0);
    } finally {
      delete process.env.APPROVE_INBOX_ACTION_REFRESH_STRICT;
    }
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

  it("preserves a todo-detail 401 as AUTH_REQUIRED_IN_YONWORK", async () => {
    const deps = cliDeps([]);
    deps.runBipCli = async (commandPath) => {
      if (commandPath[2] === "todo-detail") throw new Error("获取 secret 失败: HTTP 401");
      return { success: true };
    };
    const result = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(result.success, false);
    assert.equal(result.results[0].code, "AUTH_REQUIRED_IN_YONWORK");
    assert.equal(result.results[0].issue.httpStatus, 401);
    assert.deepEqual(result.successIds, []);
  });

  it("preserves an exit-zero todo-detail 401 as AUTH_REQUIRED_IN_YONWORK", async () => {
    const deps = cliDeps([{ success: true }]);
    deps.runBipCli = async (commandPath) => {
      deps.calls.push({ commandPath });
      if (commandPath[2] === "todo-detail") return { errcode: 401, message: "unauthorized" };
      return { success: true };
    };
    const result = await executeApproval(
      [{ id: "m1", webUrl: "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/1?taskId=task-1" }],
      { action: "approve", comment: "同意", detailsById: new Map() },
      deps,
    );

    assert.equal(result.success, false);
    assert.equal(result.results[0].code, "AUTH_REQUIRED_IN_YONWORK");
    assert.equal(result.results[0].issue.httpStatus, 401);
    assert.deepEqual(result.successIds, []);
    assert.equal(writeCalls(deps).length, 0);
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

  it("executes patch approve through the standard batch channel (patch special-casing removed)", async () => {
    const deps = cliDeps([{ success: true, successIds: ["p1"] }]);
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
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].commandPath, ["workflow", "task", "batch-approve"]);
    assert.equal(writes[0].input.primaryIds, JSON.stringify(["p1"]));
    assert.deepEqual(r.successIds, ["p1"]);
  });

  it("executes patch reject through batch-reject without patch save", async () => {
    const deps = cliDeps([{ success: true, successIds: ["p1"] }]);
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

  it("executes iForm approve through the workflow engine deal command", async () => {
    const deps = cliDeps([{ code: 200, errcode: 0, taskId: "t1", action: "complete" }]);
    const item = {
      id: "i1",
      taskId: "t1",
      source: "iuap-apcom-auth",
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
    assert.deepEqual(writes[0].commandPath, ["workflow", "task", "deal"]);
    assert.deepEqual(writes[0].input, { taskId: "t1", action: "complete", source: "iuap-apcom-auth", message: "同意" });
    assert.equal(writes[0].options.dangerous, true);
  });

  it("executes iForm return through the workflow engine reject command", async () => {
    const deps = cliDeps([{ id: "proc-1", name: "iForm 流程", businessKey: "D1" }]);
    const item = {
      id: "i1",
      taskId: "t1",
      source: "iuap-apcom-auth",
      processInstanceId: "proc-1",
      runtimeActions: [{ action: "return", callBackExecType: "reject", enabled: true }],
      webUrl:
        "https://c1.yonyoucloud.com/yonbip-ec-iform/index?formId=f1&formInstanceId=bo1&taskId=t1&processDefinitionId=p1",
    };
    const r = await executeApproval(
      [item],
      { action: "return", comment: "信息不完整", mode: "direct", detailsById: new Map() },
      deps,
    );

    assert.equal(r.success, true);
    assert.deepEqual(r.successIds, ["i1"]);
    const writes = writeCalls(deps);
    assert.deepEqual(writes[0].commandPath, ["workflow", "task", "reject"]);
    assert.deepEqual(writes[0].input, {
      taskId: "t1",
      processInstanceId: "proc-1",
      action: "rejectToStart",
      source: "iuap-apcom-auth",
      reason: "信息不完整",
    });
  });

  it("falls back to gate engine params when the iForm item lacks source", async () => {
    // item 无 source/processInstanceId → 取闸门 todo-detail 带回的 task.source/processInstanceId。
    const deps = cliDeps([{ code: 200, errcode: 0, taskId: "t1", action: "complete" }]);
    const item = {
      id: "i1",
      taskId: "t1",
      webUrl:
        "https://c1.yonyoucloud.com/yonbip-ec-iform/index?formId=f1&formInstanceId=bo1&taskId=t1&processDefinitionId=p1",
    };
    const r = await executeApproval(
      [item],
      { action: "approve", comment: "同意", mode: "direct", detailsById: new Map() },
      deps,
    );

    assert.equal(r.success, true);
    const writes = writeCalls(deps);
    assert.equal(writes[0].input.source, "iuap-apcom-auth");
  });

  it("fails closed when iForm engine params are missing everywhere", async () => {
    const deps = cliDeps([{ code: 200 }]);
    deps.refreshActions = async () => ({ actions: [{ action: "approve", callBackExecType: "agree", enabled: true }] });
    const item = {
      id: "i1",
      taskId: "t1",
      webUrl:
        "https://c1.yonyoucloud.com/yonbip-ec-iform/index?formId=f1&formInstanceId=bo1&taskId=t1&processDefinitionId=p1",
    };
    const r = await executeApproval(
      [item],
      { action: "approve", comment: "同意", mode: "direct", detailsById: new Map() },
      deps,
    );

    assert.equal(r.success, false);
    assert.deepEqual(r.successIds, []);
    assert.equal(writeCalls(deps).length, 0);
    assert.match(r.results[0].error, /缺少流程引擎参数/);
  });

  it("routes an iForm success without an exact task echo to reconciliation", async () => {
    const deps = cliDeps([{ code: 200, errcode: 0 }]);
    const item = {
      id: "i1",
      taskId: "t1",
      source: "iuap-apcom-auth",
      webUrl:
        "https://c1.yonyoucloud.com/yonbip-ec-iform/index?formId=f1&formInstanceId=bo1&taskId=t1&processDefinitionId=p1",
    };
    const result = await executeApproval(
      [item],
      { action: "approve", comment: "同意", mode: "direct", detailsById: new Map() },
      deps,
    );

    assert.equal(result.success, false);
    assert.deepEqual(result.successIds, []);
    assert.equal(result.results[0].remoteCommitted, true);
    assert.equal(result.results[0].remoteOutcome, "confirmed_committed");
  });

  it("reports iForm command failure without moving ids", async () => {
    const item = {
      id: "i1",
      taskId: "t1",
      source: "iuap-apcom-auth",
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
