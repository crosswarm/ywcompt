import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatDisplayValue } from "./display-format.mjs";

describe("统一风险等级文案", () => {
  it("按既定口径显示高、中、低风险", () => {
    assert.equal(formatDisplayValue("high", { format: "risk" }), "重要");
    assert.equal(formatDisplayValue("medium", { format: "risk" }), "需关注");
    assert.equal(formatDisplayValue("low", { format: "risk" }), "建议通过");
  });
});

describe("AI建议展示", () => {
  it("优先展示列表提炼后的行动建议", () => {
    assert.equal(
      formatDisplayValue("caution", { format: "advice" }, { aiSuggestion: "核实金额差异后再处理" }),
      "核实金额差异后再处理",
    );
  });

  it("没有具体建议时展示分析状态，不重复风险文案", () => {
    assert.equal(formatDisplayValue("caution", { format: "advice" }), "待AI分析");
    assert.equal(formatDisplayValue("caution", { format: "advice" }, { analysisStatus: "running" }), "AI分析中");
  });
});
