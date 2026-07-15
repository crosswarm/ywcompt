import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const skill = readFileSync(new URL("./SKILL.md", import.meta.url), "utf8");

test("YonWork customization contract covers list, detail, and personal rules end to end", () => {
  assert.match(skill, /GET \/api\/table-config/);
  assert.match(skill, /POST \/api\/table-config/);
  assert.match(skill, /GET \/api\/detail-card-config/);
  assert.match(skill, /POST \/api\/detail-card-config/);
  assert.match(skill, /GET \/api\/personal-rules-config/);
  assert.match(skill, /POST \/api\/personal-rules-config/);
  assert.match(skill, /GET \/api\/sync-status/);
  assert.match(skill, /lastResult\.success=true/);
  assert.match(skill, /GET \/api\/ui-config\/diagnostics/);
  assert.match(skill, /页面刷新|重新获取相应配置/);
});
