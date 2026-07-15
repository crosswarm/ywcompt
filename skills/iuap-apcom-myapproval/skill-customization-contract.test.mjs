import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const skill = readFileSync(new URL("./SKILL.md", import.meta.url), "utf8");

test("正式发布契约声明 iuap-apcom-cli 为必需运行时技能", () => {
  assert.match(
    skill,
    /dependencies:\s*\n\s+skills:\s*\n\s+- name: iuap-apcom-cli\s*\n\s+required: true/,
  );
  assert.match(skill, /正式运行时依赖.*`iuap-apcom-cli`/);
  assert.match(skill, /`bip-cli\.js`.*仅用于本地开发、调试和测试/);
});

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
