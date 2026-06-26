/**
 * scorers.test.mjs — 打分器单测（node:test，确定性）
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  structureScore,
  adviceScore,
  ruleHitScore,
  severityScore,
  scoreAnalysis,
  WEIGHTS,
} from "./scorers.mjs";

const goodAnalysis = {
  conclusion: { advice: "reject", label: "建议拒绝" },
  overallAnalysis: "金额超预算，缺比价，建议退回。",
  fieldAnalysis: [{ name: "合同金额", value: "¥1,340,000", summary: "超预算", severity: "risk" }],
  ruleAnalysis: [
    { ruleName: "大额采购双签", severity: "risk", summary: "需双签", evidence: "金额>100万" },
    { ruleName: "比价完整性", severity: "warning", summary: "缺比价", evidence: "仅1家报价" },
  ],
  attachmentAnalysis: [],
};

describe("structureScore()", () => {
  it("合规分析满分", () => {
    assert.equal(structureScore(goodAnalysis).score, 1);
  });
  it("evidence 为空扣分", () => {
    const a = { ...goodAnalysis, ruleAnalysis: [{ ruleName: "x", evidence: "" }] };
    const r = structureScore(a);
    assert.ok(r.score < 1);
    assert.ok(r.issues.some((i) => i.includes("evidence")));
  });
  it("advice 非法扣分", () => {
    const a = { ...goodAnalysis, conclusion: { advice: "yes" } };
    assert.ok(structureScore(a).score < 1);
  });
  it("空对象 0 分", () => {
    assert.equal(structureScore(null).score, 0);
  });
});

describe("adviceScore()", () => {
  it("匹配满分", () => {
    assert.equal(adviceScore(goodAnalysis, { advice: "reject" }).score, 1);
  });
  it("不匹配 0 分", () => {
    assert.equal(adviceScore(goodAnalysis, { advice: "approve" }).score, 0);
  });
  it("无期望不扣分", () => {
    assert.equal(adviceScore(goodAnalysis, {}).score, 1);
  });
});

describe("ruleHitScore()", () => {
  it("全命中满分", () => {
    const r = ruleHitScore(goodAnalysis, { mustHitRules: ["大额采购双签", "比价完整性"] });
    assert.equal(r.score, 1);
    assert.equal(r.missed.length, 0);
  });
  it("部分命中按比例", () => {
    const r = ruleHitScore(goodAnalysis, { mustHitRules: ["大额采购双签", "预付款比例限制"] });
    assert.equal(r.score, 0.5);
    assert.deepEqual(r.missed, ["预付款比例限制"]);
  });
  it("模糊匹配（去标点）", () => {
    const r = ruleHitScore(goodAnalysis, { mustHitRules: ["大额采购·双签"] });
    assert.equal(r.score, 1);
  });
  it("无期望满分", () => {
    assert.equal(ruleHitScore(goodAnalysis, {}).score, 1);
  });
});

describe("severityScore()", () => {
  it("字段 severity 匹配满分", () => {
    const r = severityScore(goodAnalysis, { fieldSeverity: { 合同金额: "risk" } });
    assert.equal(r.score, 1);
  });
  it("severity 不符扣分", () => {
    const r = severityScore(goodAnalysis, { fieldSeverity: { 合同金额: "passed" } });
    assert.equal(r.score, 0);
  });
  it("无期望满分", () => {
    assert.equal(severityScore(goodAnalysis, {}).score, 1);
  });
});

describe("scoreAnalysis()", () => {
  it("理想分析高分通过", () => {
    const r = scoreAnalysis(goodAnalysis, {
      advice: "reject",
      mustHitRules: ["大额采购双签", "比价完整性"],
      fieldSeverity: { 合同金额: "risk" },
      minFields: 1,
    });
    assert.equal(r.total, 1);
    assert.equal(r.pass, true);
    assert.equal(r.issues.length, 0);
  });
  it("advice 错 + 漏规则 → 低分不过", () => {
    const r = scoreAnalysis(goodAnalysis, {
      advice: "approve",
      mustHitRules: ["大额采购双签", "预付款比例限制", "信用额度"],
    });
    assert.ok(r.total < 0.7);
    assert.equal(r.pass, false);
  });
  it("权重之和为 1", () => {
    const sum = WEIGHTS.structure + WEIGHTS.advice + WEIGHTS.ruleHit + WEIGHTS.severity;
    assert.equal(Math.round(sum * 100) / 100, 1);
  });
  it("minFields 不达标记 issue", () => {
    const r = scoreAnalysis(goodAnalysis, { advice: "reject", minFields: 5 });
    assert.ok(r.issues.some((i) => i.includes("字段分析少于")));
  });
  it("dimensions 四维都在 [0,1]", () => {
    const r = scoreAnalysis(goodAnalysis, { advice: "reject" });
    for (const v of Object.values(r.dimensions)) {
      assert.ok(v >= 0 && v <= 1);
    }
  });
});
