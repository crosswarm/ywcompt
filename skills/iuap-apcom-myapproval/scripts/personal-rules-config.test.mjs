import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  applyPersonalRules,
  fieldDisplayPreferences,
  loadPersonalRulesConfig,
  matchingPersonalRules,
} from "./personal-rules-config.mjs";
import { buildAnalysisPrompt } from "./agent-runner.mjs";

describe("personal rules customization", () => {
  const config = {
    version: 1,
    enabled: true,
    rules: [
      {
        id: "purchase-large-amount",
        ruleName: "大额采购复核",
        checkpoint: "采购金额超过 10 万元时必须由部门负责人复核",
        severityHint: "warning",
        match: ["请购", "采购"],
      },
      {
        id: "global-reason",
        ruleName: "事由完整性",
        checkpoint: "审批事由必须明确",
      },
      {
        id: "disabled-rule",
        ruleName: "已停用规则",
        checkpoint: "不应进入分析提示词",
        enabled: false,
      },
    ],
  };

  it("loads a user config and keeps a safe empty default", () => {
    const dir = mkdtempSync(join(tmpdir(), "personal-rules-"));
    const file = join(dir, "personal-rules.config.json");
    assert.deepEqual(loadPersonalRulesConfig({ userConfigFile: file }), {
      version: 1,
      enabled: true,
      rules: [],
      fieldDisplay: {
        enabled: true,
        instructions: "",
        pinnedFields: [],
        collapsedFields: [],
        hiddenFields: [],
      },
    });

    writeFileSync(file, JSON.stringify(config), "utf8");
    assert.equal(loadPersonalRulesConfig({ userConfigFile: file }).rules.length, 3);
  });

  it("matches targeted and global rules but skips disabled rules", () => {
    const rules = matchingPersonalRules(
      { billnum: "pu_applyorder", docType: "请购单", title: "采购申请" },
      config,
    );
    assert.deepEqual(rules.map((rule) => rule.id), ["purchase-large-amount", "global-reason"]);
    assert.ok(rules.every((rule) => rule.source === "personal"));
  });

  it("matches rules by serviceName and serviceCode", () => {
    const serviceConfig = {
      version: 1,
      enabled: true,
      rules: [
        { id: "permission", ruleName: "权限复核", checkpoint: "核对权限范围", match: ["权限申请单"] },
        { id: "service-code", ruleName: "服务编码复核", checkpoint: "核对服务来源", match: ["gztact045"] },
      ],
    };

    const rules = matchingPersonalRules({
      title: "待审批",
      docType: "审批单",
      serviceCode: "GZTACT045",
      serviceName: "权限申请单",
    }, serviceConfig);

    assert.deepEqual(rules.map((rule) => rule.id), ["permission", "service-code"]);
  });

  it("appends matching personal rules without mutating the built-in profile", () => {
    const profile = {
      docType: "采购",
      businessRules: [{ ruleName: "预算匹配", checkpoint: "不得超预算" }],
    };
    const merged = applyPersonalRules(profile, { docType: "请购单" }, config);

    assert.equal(profile.businessRules.length, 1);
    assert.deepEqual(merged.businessRules.map((rule) => rule.ruleName), [
      "预算匹配",
      "大额采购复核",
      "事由完整性",
    ]);

    const prompt = buildAnalysisPrompt(
      { title: "采购申请", docType: "请购单" },
      {},
      { profile: merged, dimensions: [], fields: [] },
    );
    assert.match(prompt, /个人定制规则（优先检查）/);
    assert.match(prompt, /大额采购复核：采购金额超过 10 万元/);
  });

  it("loads field display preferences for Agent display planning", () => {
    const dir = mkdtempSync(join(tmpdir(), "personal-rules-"));
    const file = join(dir, "personal-rules.config.json");
    writeFileSync(file, JSON.stringify({
      version: 1,
      fieldDisplay: {
        instructions: "编码字段默认收起",
        pinnedFields: ["供应商"],
        collapsedFields: ["内部编码"],
        hiddenFields: ["租户ID"],
      },
    }), "utf8");

    const preferences = fieldDisplayPreferences(loadPersonalRulesConfig({ userConfigFile: file }));

    assert.equal(preferences.instructions, "编码字段默认收起");
    assert.deepEqual(preferences.pinnedFields, ["供应商"]);
    assert.deepEqual(preferences.collapsedFields, ["内部编码"]);
    assert.deepEqual(preferences.hiddenFields, ["租户ID"]);
  });
});
