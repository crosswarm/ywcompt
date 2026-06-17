/**
 * scorers.mjs — 审批分析质量打分器（纯函数，确定性，零依赖）
 *
 * 对一次分析输出（5 段对象）按 golden 期望分维度打分，全部确定性可测
 * （不需二次 LLM）。供 eval-runner 与 node:test 复用。
 *
 * 维度与权重：
 *   structure  30%  5 段结构合规（必填字段 / evidence 非空 / advice 合法）
 *   advice     30%  advice == expect.advice
 *   ruleHit    25%  expect.mustHitRules 命中率（ruleName 模糊匹配）
 *   severity   15%  expect.fieldSeverity 关键字段 severity 合理
 */

export const WEIGHTS = { structure: 0.3, advice: 0.3, ruleHit: 0.25, severity: 0.15 };
export const DEFAULT_THRESHOLD = 0.7;

const VALID_ADVICE = new Set(["approve", "caution", "reject"]);
const VALID_SEVERITY = new Set(["risk", "warning", "passed"]);

/** 结构合规分 [0,1]：5 段齐全 + advice 合法 + ruleAnalysis 每条 evidence 非空 */
export function structureScore(analysis) {
  if (!analysis || typeof analysis !== "object") return { score: 0, issues: ["无分析对象"] };
  const issues = [];
  let pts = 0;
  const checks = 5;

  // 1. conclusion.advice 合法
  if (analysis.conclusion && VALID_ADVICE.has(analysis.conclusion.advice)) pts += 1;
  else issues.push("conclusion.advice 缺失或非法");

  // 2. overallAnalysis 非空字符串
  if (typeof analysis.overallAnalysis === "string" && analysis.overallAnalysis.trim()) pts += 1;
  else issues.push("overallAnalysis 缺失");

  // 3. fieldAnalysis 为数组
  if (Array.isArray(analysis.fieldAnalysis)) pts += 1;
  else issues.push("fieldAnalysis 非数组");

  // 4. ruleAnalysis 为数组，且每条 evidence 非空
  if (Array.isArray(analysis.ruleAnalysis)) {
    const bad = analysis.ruleAnalysis.filter((r) => !r || !r.evidence || !String(r.evidence).trim());
    if (bad.length === 0) pts += 1;
    else issues.push(`${bad.length} 条规则 evidence 为空`);
  } else issues.push("ruleAnalysis 非数组");

  // 5. attachmentAnalysis 为数组
  if (Array.isArray(analysis.attachmentAnalysis)) pts += 1;
  else issues.push("attachmentAnalysis 非数组");

  return { score: pts / checks, issues };
}

/** advice 准确度 [0,1]：完全匹配 1，否则 0 */
export function adviceScore(analysis, expect) {
  if (!expect || !expect.advice) return { score: 1, issues: [] }; // 无期望则不扣分
  const got = analysis?.conclusion?.advice;
  if (got === expect.advice) return { score: 1, issues: [] };
  return { score: 0, issues: [`advice 期望 ${expect.advice}，实际 ${got || "无"}`] };
}

/** 归一化规则名（去标点/空格便于模糊匹配） */
function normRule(s) {
  return String(s || "").replace(/[\s·、，,。.()（）]/g, "").toLowerCase();
}

/** 规则命中率 [0,1]：expect.mustHitRules 中被 ruleAnalysis 命中的比例（双向包含模糊匹配） */
export function ruleHitScore(analysis, expect) {
  const must = (expect && expect.mustHitRules) || [];
  if (must.length === 0) return { score: 1, hit: [], missed: [], issues: [] };
  const got = (analysis?.ruleAnalysis || []).map((r) => normRule(r.ruleName));
  const hit = [];
  const missed = [];
  for (const m of must) {
    const nm = normRule(m);
    const found = got.some((g) => g.includes(nm) || nm.includes(g));
    if (found) hit.push(m);
    else missed.push(m);
  }
  return {
    score: hit.length / must.length,
    hit,
    missed,
    issues: missed.length ? [`未命中规则: ${missed.join("、")}`] : [],
  };
}

/** 关键字段 severity 合理性 [0,1]：expect.fieldSeverity 中字段的 severity 匹配比例 */
export function severityScore(analysis, expect) {
  const exp = (expect && expect.fieldSeverity) || {};
  const names = Object.keys(exp);
  if (names.length === 0) return { score: 1, issues: [] };
  const fields = analysis?.fieldAnalysis || [];
  let ok = 0;
  const issues = [];
  for (const name of names) {
    const f = fields.find((x) => normRule(x.name) === normRule(name) || normRule(x.name).includes(normRule(name)));
    if (f && f.severity === exp[name] && VALID_SEVERITY.has(f.severity)) ok += 1;
    else issues.push(`字段「${name}」severity 期望 ${exp[name]}，实际 ${f?.severity || "无"}`);
  }
  return { score: ok / names.length, issues };
}

/**
 * 综合打分。
 * @param {object} analysis 5 段分析对象
 * @param {object} expect golden 期望 { advice, mustHitRules, fieldSeverity, minFields }
 * @param {object} [opts] { threshold }
 * @returns {{ total:number, pass:boolean, dimensions:object, issues:string[] }}
 */
export function scoreAnalysis(analysis, expect = {}, opts = {}) {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const structure = structureScore(analysis);
  const advice = adviceScore(analysis, expect);
  const ruleHit = ruleHitScore(analysis, expect);
  const severity = severityScore(analysis, expect);

  const total =
    structure.score * WEIGHTS.structure +
    advice.score * WEIGHTS.advice +
    ruleHit.score * WEIGHTS.ruleHit +
    severity.score * WEIGHTS.severity;

  // minFields 作为附加硬约束（不达标记 issue，但不单独占权重）
  const issues = [
    ...structure.issues,
    ...advice.issues,
    ...ruleHit.issues,
    ...severity.issues,
  ];
  if (expect.minFields && (analysis?.fieldAnalysis?.length || 0) < expect.minFields) {
    issues.push(`字段分析少于 ${expect.minFields} 条`);
  }

  return {
    total: Math.round(total * 1000) / 1000,
    pass: total >= threshold,
    dimensions: {
      structure: structure.score,
      advice: advice.score,
      ruleHit: ruleHit.score,
      severity: severity.score,
    },
    ruleHitDetail: { hit: ruleHit.hit, missed: ruleHit.missed },
    issues,
  };
}
