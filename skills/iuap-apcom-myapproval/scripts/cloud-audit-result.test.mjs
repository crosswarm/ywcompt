import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildCloudAuditRequestBody,
  cloudAuditRequestReady,
  cloudAuditStatusFromDisplayCode,
  normalizeCloudAuditResponse,
  queryCloudAuditResult,
} from "./cloud-audit-result.mjs";

describe("cloud-audit-result", () => {
  it("builds request body with optional yhtUserId", () => {
    assert.deepEqual(
      buildCloudAuditRequestBody({ taskId: "t1", businessKey: "b1", yhtUserId: "u1" }),
      { taskId: "t1", businessKey: "b1", yhtUserId: "u1" },
    );
    assert.deepEqual(
      buildCloudAuditRequestBody({ taskId: "t1", businessKey: "b1" }),
      { taskId: "t1", businessKey: "b1" },
    );
  });

  it("requires taskId and businessKey", () => {
    assert.equal(cloudAuditRequestReady({ taskId: "t1", businessKey: "b1" }), true);
    assert.equal(cloudAuditRequestReady({ taskId: "t1" }), false);
  });

  it("normalizes success response", () => {
    const r = normalizeCloudAuditResponse({
      code: 200,
      message: "操作成功",
      data: {
        resultId: "res-1",
        queryId: "q-1",
        resultDesc: "低风险，可通过",
        AISummaryResultDesc: "未发现异常。",
      },
    }, { fetchedAt: "2026-07-08T00:00:00.000Z" });
    assert.equal(r.status, "success");
    assert.equal(r.resultDesc, "低风险，可通过");
    assert.equal(r.fetchedAt, "2026-07-08T00:00:00.000Z");
  });

  it("maps documented display codes", () => {
    assert.equal(cloudAuditStatusFromDisplayCode("036-503-010811"), "not_found");
    assert.equal(cloudAuditStatusFromDisplayCode("036-503-010812"), "disabled");
    assert.equal(cloudAuditStatusFromDisplayCode("036-503-010813"), "model_error");
  });

  it("queries through workflow inboxtask get-intelligent-result", async () => {
    const calls = [];
    const result = await queryCloudAuditResult(
      { taskId: "task-1", businessKey: "biz-1" },
      {
        runBipCli: async (commandPath, input) => {
          calls.push({ commandPath, input });
          return {
            status: "success",
            resultDesc: "本识别为中风险，请重点核查",
            AISummaryResultDesc: "建议复核后处理",
          };
        },
      },
    );

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].commandPath, ["workflow", "inboxtask", "get-intelligent-result"]);
    assert.deepEqual(calls[0].input, { taskId: "task-1", businessKey: "biz-1" });
    assert.equal(result.status, "success");
  });

  it("returns the CLI error without bypassing iuap-apcom-cli", async () => {
    const result = await queryCloudAuditResult(
      { taskId: "task-1", businessKey: "biz-1" },
      {
        runBipCli: async () => {
          throw new Error("请求失败: BIP 接口返回 HTTP 404 错误。");
        },
      },
    );
    assert.equal(result.status, "error");
    assert.equal(result.reason, "request_failed");
    assert.match(result.message, /HTTP 404/);
  });

  it("degrades only intelligent audit when the sibling CLI route is incompatible", async () => {
    const result = await queryCloudAuditResult(
      { taskId: "task-1", businessKey: "biz-1" },
      {
        runBipCli: async () => {
          throw new Error("iuap-apcom-cli 依赖能力不兼容：缺少智能审核兼容路由");
        },
      },
    );

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "intelligent_audit_cli_incompatible");
    assert.equal(result.message, "");
    assert.match(result.detailMsg, /缺少智能审核兼容路由/);
  });

  it("skips when required params are missing", async () => {
    const r = await queryCloudAuditResult({ taskId: "task-1" }, {
      runBipCli: async () => {
        throw new Error("should_not_call_cli");
      },
    });
    assert.equal(r.status, "skipped");
    assert.equal(r.reason, "missing_params");
  });
});
