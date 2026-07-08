#!/usr/bin/env node
/**
 * eval-runner.mjs — 审批分析质量评估运行器（零依赖）
 *
 * 读 scenarios/*.json（golden fixture）→ 取一次分析输出（三模式）→ scorers 打分 → 报告。
 *
 * 模式：
 *   (默认) replay  读 recordings/<id>.json 回放（离线/CI 零成本零延迟）；缺录制则回退 scenario.mock
 *   --real         真调 claude -p（buildAnalysisPrompt + runAgent），输出存 recordings/<id>.json
 *   --mock         直接用 scenario.mock（纯测打分器，不读 recordings）
 *
 * 其他：
 *   --id <id>      只跑指定场景
 *   --threshold N  通过门槛（默认 0.7）
 *   --json         输出机器可读 JSON（供 node:test / CI 消费）
 *
 * 用法：
 *   node eval/eval-runner.mjs                 # replay 全部
 *   node eval/eval-runner.mjs --real          # 真跑并录制
 *   node eval/eval-runner.mjs --mock --json   # 纯打分器自测
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreAnalysis, DEFAULT_THRESHOLD } from "./scorers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = join(HERE, "scenarios");
const RECORDINGS_DIR = join(HERE, "recordings");

// ── 参数 ──────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { mode: "replay", id: null, threshold: DEFAULT_THRESHOLD, json: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--real") a.mode = "real";
    else if (x === "--mock") a.mode = "mock";
    else if (x === "--json") a.json = true;
    else if (x === "--id") a.id = argv[++i];
    else if (x === "--threshold") a.threshold = Number(argv[++i]);
  }
  return a;
}

// ── 场景加载 ──────────────────────────────────────────────
export function loadScenarios(filterId) {
  const out = [];
  if (!existsSync(SCENARIOS_DIR)) return out;
  for (const f of readdirSync(SCENARIOS_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const sc = JSON.parse(readFileSync(join(SCENARIOS_DIR, f), "utf-8"));
      if (!filterId || sc.id === filterId) out.push(sc);
    } catch {
      /* 跳过坏文件 */
    }
  }
  return out.sort((x, y) => String(x.id).localeCompare(String(y.id)));
}

// ── 取分析输出（三模式）────────────────────────────────────
function readRecording(id) {
  const f = join(RECORDINGS_DIR, `${id}.json`);
  if (existsSync(f)) {
    try {
      return JSON.parse(readFileSync(f, "utf-8"));
    } catch {
      return null;
    }
  }
  return null;
}

function writeRecording(id, analysis) {
  if (!existsSync(RECORDINGS_DIR)) mkdirSync(RECORDINGS_DIR, { recursive: true });
  writeFileSync(join(RECORDINGS_DIR, `${id}.json`), JSON.stringify(analysis, null, 2), "utf-8");
}

/**
 * 取场景的分析输出。
 * @returns {Promise<{analysis:object|null, source:string, error?:string}>}
 */
export async function getAnalysis(scenario, mode) {
  if (mode === "mock") {
    return { analysis: scenario.mock || null, source: "mock", error: scenario.mock ? undefined : "no_mock" };
  }
  if (mode === "replay") {
    const rec = readRecording(scenario.id);
    if (rec) return { analysis: rec, source: "recording" };
    if (scenario.mock) return { analysis: scenario.mock, source: "mock-fallback" };
    return { analysis: null, source: "none", error: "no_recording_no_mock" };
  }
  // real：调 claude -p
  const [{ buildAnalysisPrompt, runAgent }, { selectProfile, profileDimensions, localizeFields }, { parseAnalysis }] =
    await Promise.all([
      import("../scripts/agent-runner.mjs"),
      import("../analysis/profile-loader.js"),
      import("../web/normalize.mjs"),
    ]);
  const item = scenario.input?.item || {};
  const fields = (scenario.input?.fields || []).map((f) => ({ key: f.name, value: f.value }));
  const profile = selectProfile(item);
  const prompt = buildAnalysisPrompt(
    { ...item, attachments: scenario.input?.attachments || [] },
    {},
    { profile, dimensions: profileDimensions(profile), fields: localizeFields(fields, {}) }
  );
  const r = await runAgent(prompt);
  if (!r.success) return { analysis: null, source: "real", error: r.error || "agent_failed" };
  const parsed = parseAnalysis(r.content) || parseAnalysis({ raw: r.content });
  if (parsed) writeRecording(scenario.id, parsed);
  return { analysis: parsed, source: "real", error: parsed ? undefined : "parse_failed" };
}

// ── 主流程 ────────────────────────────────────────────────
export async function runEval(opts = {}) {
  const mode = opts.mode || "replay";
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const scenarios = loadScenarios(opts.id);
  const results = [];
  for (const sc of scenarios) {
    const got = await getAnalysis(sc, mode);
    if (!got.analysis) {
      results.push({ id: sc.id, docType: sc.docType, pass: false, total: 0, source: got.source, error: got.error, issues: [got.error] });
      continue;
    }
    const score = scoreAnalysis(got.analysis, sc.expect, { threshold });
    results.push({
      id: sc.id,
      docType: sc.docType,
      situation: sc.situation,
      source: got.source,
      total: score.total,
      pass: score.pass,
      dimensions: score.dimensions,
      ruleHitDetail: score.ruleHitDetail,
      issues: score.issues,
    });
  }
  const passed = results.filter((r) => r.pass).length;
  return { mode, threshold, total: results.length, passed, passRate: results.length ? passed / results.length : 0, results };
}

// ── 报告渲染 ──────────────────────────────────────────────
function renderReport(report) {
  const lines = [];
  lines.push(`\n审批分析 Eval 报告 — 模式 ${report.mode} | 门槛 ${report.threshold}`);
  lines.push("─".repeat(64));
  for (const r of report.results) {
    const mark = r.pass ? "✓" : "✗";
    const d = r.dimensions
      ? ` [结构${r.dimensions.structure.toFixed(1)} 结论${r.dimensions.advice.toFixed(1)} 规则${r.dimensions.ruleHit.toFixed(1)} 严重度${r.dimensions.severity.toFixed(1)}]`
      : "";
    lines.push(`${mark} ${(r.id + "").padEnd(28)} ${String(r.total).padStart(5)} (${r.source})${d}`);
    if (!r.pass && r.issues?.length) lines.push(`    ⚠ ${r.issues.join("；")}`);
  }
  lines.push("─".repeat(64));
  lines.push(`通过 ${report.passed}/${report.total}（${(report.passRate * 100).toFixed(0)}%）`);
  return lines.join("\n");
}

// ── CLI ───────────────────────────────────────────────────
function isMain() {
  return import.meta.url === `file://${process.argv[1]}`;
}
if (isMain()) {
  const args = parseArgs(process.argv.slice(2));
  runEval(args).then((report) => {
    if (args.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    else process.stdout.write(renderReport(report) + "\n");
    process.exit(report.passed === report.total ? 0 : 1);
  });
}
