import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const runDir = path.resolve(process.argv[2]);
const runner = process.argv[3];
const plan = JSON.parse(fs.readFileSync(path.join(runDir, 'scenario-plan.json'), 'utf8'));
const active = [...plan.promptScenarios, ...plan.functionalScenarios]
  .filter((scenario) => scenario.scopeStatus !== 'skipped');
const requestedScope = new Set([
  '4.1', '4.2', '4.3', '4.4', '4.5', '4.6',
  '6.1', '6.2', '6.3', '6.4', '6.5', '6.6', '6.7', '6.8'
]);

for (const scenario of active) {
  const safeId = String(scenario.id).replace(/[^a-zA-Z0-9._-]+/g, '-');
  if (requestedScope.has(scenario.id)) continue;
  const input = path.join(runDir, 'inputs', `scope-${safeId}.json`);
  fs.writeFileSync(input, `${JSON.stringify({
    scenarioId: scenario.id,
    status: 'skipped',
    summary: '本轮用户范围仅为 YonWork-only 驾驶舱智能待办与刷新链路；该场景不在请求范围内。',
    requestId: `scope-excluded-${safeId}-20260716`,
    evidenceRefs: ['scenario-plan.json']
  }, null, 2)}\n`);
  const result = spawnSync(process.execPath, [runner, 'record-result',
    '--run-dir', runDir,
    '--mode', 'yonwork-cloud',
    '--input', input
  ], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
