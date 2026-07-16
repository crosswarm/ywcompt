import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  NATIVE_SYSTEM_AUDIT_ROUTE,
  buildNativeSystemAuditRequest,
  normalizeNativeSystemAuditResponse,
  queryNativeSystemAudit,
} from "./native-system-audit.mjs";

describe("native-system-audit", () => {
  it("builds the fixed route request and normalizes colon business keys", () => {
    assert.deepEqual(buildNativeSystemAuditRequest({ businessKey: "znbzbx_expensebill:2585187038089183232" }), {
      url: NATIVE_SYSTEM_AUDIT_ROUTE,
      body: { businessKey: "znbzbx_expensebill_2585187038089183232" },
    });
  });

  it("normalizes native categories, audit points and items", () => {
    const result = normalizeNativeSystemAuditResponse({
      httpStatus: 200,
      body: {
        code: 200,
        message: "操作成功",
        data: {
          auditEmpty: false,
          licenseEnable: 1,
          runtimeStatus: 2,
          resultState: 3,
          resultId: "result-1",
          queryId: "query-1",
          resultDesc: "识别为低风险，可审核通过",
          categories: [{
            categoryId: "category-1",
            name: "业务合规",
            iaPoints: [{
              auditPointId: "point-1",
              name: "0703提测演示",
              pass: true,
              items: [{ auditItemId: "item-1", resultDesc: "提测演示", pass: true }],
            }],
          }],
        },
      },
    }, { fetchedAt: "2026-07-16T00:00:00.000Z" });

    assert.equal(result.status, "success");
    assert.equal(result.resultDesc, "识别为低风险，可审核通过");
    assert.equal(result.categories[0].name, "业务合规");
    assert.equal(result.categories[0].iaPoints[0].name, "0703提测演示");
    assert.equal(result.categories[0].iaPoints[0].items[0].resultDesc, "提测演示");
  });

  it("distinguishes no result, disabled and non-JSON responses", () => {
    assert.equal(normalizeNativeSystemAuditResponse({
      httpStatus: 200,
      body: { code: 200, data: { auditEmpty: true, licenseEnable: 1, categories: [] } },
    }).status, "not_found");
    assert.equal(normalizeNativeSystemAuditResponse({
      httpStatus: 200,
      body: { code: 200, data: { licenseEnable: 0 } },
    }).status, "disabled");
    assert.equal(normalizeNativeSystemAuditResponse({
      httpStatus: 200,
      body: { __nonJsonBody: "not-json" },
    }).reason, "non_json_response");
  });

  it("passes the exact request to the managed runner", async () => {
    const calls = [];
    const result = await queryNativeSystemAudit(
      { businessKey: "znbzbx_expensebill_2585187038089183232" },
      {
        runPython: async (request) => {
          calls.push(request);
          return {
            httpStatus: 200,
            body: {
              code: 200,
              data: { auditEmpty: false, licenseEnable: 1, resultDesc: "低风险，可通过" },
            },
          };
        },
      },
    );
    assert.deepEqual(calls, [{
      url: NATIVE_SYSTEM_AUDIT_ROUTE,
      body: { businessKey: "znbzbx_expensebill_2585187038089183232" },
    }]);
    assert.equal(result.status, "success");
  });

  it("reports runner timeout or execution failures", async () => {
    const result = await queryNativeSystemAudit(
      { businessKey: "znbzbx_expensebill_1" },
      { runPython: async () => { throw new Error("原生智能审核请求超时（10ms）"); } },
    );
    assert.equal(result.status, "error");
    assert.equal(result.reason, "request_failed");
    assert.match(result.message, /超时/);
  });
});
