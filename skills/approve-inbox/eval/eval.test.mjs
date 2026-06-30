/**
 * eval.test.mjs — 把 eval（mock 模式）纳入 node:test，作为确定性回归门禁。
 * mock 模式用 scenario.mock 跑打分器：验证 golden 自洽（每个场景的 mock 应通过其 expect）。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadScenarios, runEval } from "./eval-runner.mjs";

describe("场景库完整性", () => {
  it("加载到 ≥16 个场景", () => {
    const s = loadScenarios();
    assert.ok(s.length >= 16, `实际 ${s.length}`);
  });
  it("每个场景含 id/docType/input/expect/mock", () => {
    for (const sc of loadScenarios()) {
      assert.ok(sc.id, "缺 id");
      assert.ok(sc.docType, `${sc.id} 缺 docType`);
      assert.ok(sc.input, `${sc.id} 缺 input`);
      assert.ok(sc.expect, `${sc.id} 缺 expect`);
      assert.ok(sc.mock, `${sc.id} 缺 mock`);
    }
  });
  it("覆盖主要单据类型", () => {
    const types = new Set(loadScenarios().map((s) => s.docType));
    for (const t of ["采购", "费用报销/出差", "合同", "入库单", "上线申请", "数据申请"]) {
      assert.ok(types.has(t), `缺类型 ${t}`);
    }
  });
});

describe("eval mock 模式（golden 自洽）", () => {
  it("全部场景 mock 通过其 expect（门槛 0.7）", async () => {
    const report = await runEval({ mode: "mock", threshold: 0.7 });
    const failed = report.results.filter((r) => !r.pass);
    assert.equal(
      failed.length,
      0,
      `未自洽场景: ${failed.map((f) => `${f.id}(${f.total}) ${f.issues.join("/")}`).join(" | ")}`
    );
    assert.equal(report.passRate, 1);
  });
});
