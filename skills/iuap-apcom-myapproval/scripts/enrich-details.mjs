#!/usr/bin/env node
/**
 * enrich-details.mjs — 单据字段抓取 + AI 分析 + 写回 details（R7 完整闭环）
 *
 * 串起：读 inbox.json → fetchBillFields(块A) → selectProfile+localizeFields(块B)
 *       → buildAnalysisPrompt(块C) → runAgent(claude -p) → 写回 details/<id>.json
 *       的 content(中文化字段) + analysis(5段)。
 *
 * 凭据：YonBIP 业务取数统一经 iuap-apcom-cli；实际认证通道由 bip-cli 的统一 HTTP 管线选择。
 *
 * CLI：
 *   --limit N      最多处理 N 条（默认 5）
 *   --id <id>      只处理指定单据
 *   --no-analyze   只抓字段，不调 claude
 *   --force        已有 analysis 也重跑（默认跳过）
 *   --dry-run      只打印将处理什么，不写回
 *   --data <dir>   指定 data 目录（默认 skill 内 data/；可指 YonWork 真实 data）
 *   --pending-only 仅处理待办（个人规则变更后的批量重分析使用）
 *   --proxy <url>  兼容旧参数；业务取数不再直接使用代理 URL
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(HERE, "..");
const REQUIRED_RICH_DETAIL_SCHEMA_VERSION = 3;

// ── 参数 ──────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { limit: 5, id: null, analyze: true, force: false, dryRun: false, pendingOnly: false, data: null, proxy: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--limit") a.limit = Number(argv[++i]);
    else if (x === "--id") a.id = argv[++i];
    else if (x === "--no-analyze") a.analyze = false;
    else if (x === "--force") a.force = true;
    else if (x === "--dry-run") a.dryRun = true;
    else if (x === "--pending-only") a.pendingOnly = true;
    else if (x === "--data") a.data = argv[++i];
    else if (x === "--proxy") a.proxy = argv[++i];
  }
  return a;
}

// ── 代理端口自动探测 ──────────────────────────────────────
// YonClaw/YonWork BIP 代理端口动态变化，固定列表不够 → 动态扫描实际监听端口（lsof）+ 验活。
// 此为最终方案，无 MCP 依赖。
const CANDIDATE_PORTS = [53565, 58671, 53784, 29179, 3211, 18666];

/** 用 lsof 列出 YonClaw/YonWork/openclaw 进程的 LISTEN 端口（失败返回 []） */
async function listYonclawPorts() {
  try {
    const { execSync } = await import("node:child_process");
    const out = execSync(
      "lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -Ei 'yonclaw|yonwork|openclaw' | grep -oE ':[0-9]+' | tr -d ':' | sort -u",
      { encoding: "utf-8", timeout: 8000 }
    );
    return [...new Set(out.split("\n").map((x) => Number(x.trim())).filter((n) => n >= 1024 && n <= 65535))];
  } catch {
    return [];
  }
}

/** 单端口探测：generateADT 返回 yonclawProxyError/code 即认定为 BIP 代理 */
async function probeProxyPort(port) {
  const probe = "/iuap-yonbuilder-runtime/bill/generateADT?domainKey=x&terminalType=1&billNo=x&id=1";
  try {
    const r = await fetch(`http://localhost:${port}${probe}`, { signal: AbortSignal.timeout(2000) });
    const t = await r.text();
    return t.includes("yonclawProxyError") || /"code"\s*:/.test(t);
  } catch {
    return false;
  }
}

/** 从代理 URL 取端口号 */
function portOf(url) {
  const m = String(url || "").match(/:(\d+)\b/);
  return m ? Number(m[1]) : 0;
}

/**
 * 探测 YonWork BIP 代理：env/缓存优先但需「验活」（端口动态变化，陈旧即丢弃重扫）。
 * 顺序：显式 envProxy（验活）> process.env 缓存（验活）> 固定候选 > 动态扫描 YonWork/YonClaw 监听端口。
 */
export async function detectProxy(envProxy) {
  // 显式/缓存的先验活，死了不复用
  for (const url of [envProxy, process.env.APPROVE_INBOX_PROXY]) {
    const port = portOf(url);
    if (port && (await probeProxyPort(port))) return url;
  }
  const dynamic = await listYonclawPorts();
  const ports = [...new Set([...CANDIDATE_PORTS, ...dynamic])];
  for (const port of ports) {
    if (await probeProxyPort(port)) return `http://localhost:${port}`;
  }
  return null;
}

// ── data 读写 ─────────────────────────────────────────────
function paths(dataDir) {
  const DATA = dataDir || join(SKILL_DIR, "data");
  return { DATA, INBOX: join(DATA, "inbox.json"), DETAILS: join(DATA, "details") };
}

function readInbox(inboxPath) {
  if (!existsSync(inboxPath)) return null;
  try {
    return JSON.parse(readFileSync(inboxPath, "utf-8"));
  } catch {
    return null;
  }
}

function readDetail(detailsDir, id) {
  const f = join(detailsDir, `${id}.json`);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf-8"));
  } catch {
    return null;
  }
}

function writeDetail(detailsDir, id, data) {
  if (!existsSync(detailsDir)) mkdirSync(detailsDir, { recursive: true });
  writeFileSync(join(detailsDir, `${id}.json`), JSON.stringify(data, null, 2), "utf-8");
}

function writeInbox(inboxPath, state) {
  writeFileSync(inboxPath, JSON.stringify(state, null, 2), "utf-8");
}

// ── 单条处理 ──────────────────────────────────────────────
async function enrichOne(item, deps, opts) {
  const {
    fetchBillFields,
    downloadAttachments,
    fetchDetailForTodo,
    selectProfile,
    profileDimensions,
    localizeFields,
    applyPersonalRules,
    fieldDisplayPreferences,
    buildAnalysisPrompt,
    runAgent,
    parseAnalysis,
  } = deps;

  // 1. 通过 doc-handlers 抓字段 + 元数据 + richDetail（MDF/iForm/YNF/用户扩展）。
  const { join } = await import("node:path");
  const itemAttachmentDir = opts._attachBase ? join(opts._attachBase, String(item.id)) : "";
  const fetchCreds = itemAttachmentDir
    ? { ...(opts.creds || {}), downloadAttachments: true, outputDir: itemAttachmentDir }
    : opts.creds;
  const detailResult = await fetchDetailForTodo({ fetchBillFields, creds: fetchCreds }, item);
  const businessKey = detailResult.businessKey || detailResult.richDetail?.businessKey || detailResult.richDetail?.meta?.businessKey || "";
  if (detailResult.error) return { id: item.id, step: "fetch", businessKey, error: detailResult.error, detail: detailResult.detail };
  const rawFields = detailResult.fields || [];
  const rawAtts = detailResult.attachments || [];
  const normalizedFields = detailResult.richDetail?.normalized?.fields || [];

  // 2. 选 profile + 中文化字段（块 B）
  const profile = applyPersonalRules(selectProfile(item), item, opts._personalRulesConfig);
  const personalRuleIds = (profile.businessRules || [])
    .filter((rule) => rule?.source === "personal" && rule?.id)
    .map((rule) => rule.id);
  const fields = normalizedFields.length
    ? normalizedFields.map((f) => ({
        key: f.fieldId,
        name: f.label || f.name || f.fieldId,
        value: f.displayValue || f.value,
        dim: f.section,
      }))
    : localizeFields(rawFields);

  if (opts.dryRun) {
    return { id: item.id, step: "dry-run", profile: profile.docType, fieldCount: fields.length, attachmentCount: rawAtts.length };
  }
  // analyze 默认开（程序化调用 server/scheduler 不传也分析）；仅 --no-analyze 显式关
  if (opts.analyze === false) {
    return {
      id: item.id,
      step: "fields-only",
      profile: profile.docType,
      fieldCount: fields.length,
      fields,
      attachments: rawAtts,
      businessKey,
      richDetail: detailResult.richDetail,
      billDetail: detailResult.billDetail,
      iformData: detailResult.iformData,
      fieldLabels: detailResult.fieldLabels || {},
      fieldMetadata: detailResult.fieldMetadata || {},
      framework: detailResult.meta?.framework,
      handlerId: detailResult.meta?.handlerId,
    };
  }

  // 3. 下载附件（块 4）：经代理凭据自动注入；失败不阻断主分析
  let attachments = [];
  if (rawAtts.length && opts._attachBase) {
    attachments = await downloadAttachments(rawAtts, join(opts._attachBase, String(item.id)), opts.creds || {});
  } else {
    attachments = rawAtts;
  }
  const files = attachments.filter((a) => a.localPath).map((a) => a.localPath);

  // 4. 组装 prompt（块 C）+ 5. 分析（claude -p，含附件文本）
  // 真实字段已抓到即视为 done；claude 分析为「最佳努力」——失败/超时不丢字段，analysis 留空待后续重试
  const prompt = buildAnalysisPrompt(
    { ...item, attachments },
    {},
    {
      profile,
      dimensions: profileDimensions(profile),
      fields,
      displayPreferences: fieldDisplayPreferences(opts._personalRulesConfig),
    }
  );
  let analysis = null, analysisError = null;
  const r = await runAgent(prompt, files.length ? { files } : undefined);
  if (r.success) {
    analysis = parseAnalysis(r.content) || parseAnalysis({ raw: r.content });
    if (!analysis) analysisError = "parse_failed";
  } else {
    analysisError = r.error || "agent_failed";
  }
  return {
    id: item.id,
    step: "done",
    profile: profile.docType,
    fieldCount: fields.length,
    fields,
    attachments,
    analysis,
    fieldDisplayPlan: analysis?.fieldDisplayPlan || null,
    analysisError,
    personalRuleIds,
    businessKey,
    richDetail: detailResult.richDetail,
    billDetail: detailResult.billDetail,
    iformData: detailResult.iformData,
    fieldLabels: detailResult.fieldLabels || {},
    fieldMetadata: detailResult.fieldMetadata || {},
    framework: detailResult.meta?.framework,
    handlerId: detailResult.meta?.handlerId,
  };
}

// ── 跨租户判定 ────────────────────────────────────────────
// 待办跨租户聚合，但代理注入登录态锁单租户，他租户单据取数必「数据未找到」→ 跳过不空转。

/** 当前租户：由 sync-inbox 的 iuap-apcom-cli list-inbox 结果写入 inbox.meta.currentTenantId。 */
async function resolveCurrentTenant(state, _proxy) {
  if (state?.meta?.currentTenantId) return state.meta.currentTenantId;
  return null;
}

/** 单据租户：优先 item.tenantId，回退 webUrl 的 tenantId 参数 */
function itemTenantId(it) {
  if (it.tenantId) return it.tenantId;
  const m = (it.webUrl || "").match(/[?&]tenantId=([^&]+)/);
  return m ? m[1] : null;
}

// ── 主流程 ────────────────────────────────────────────────
export async function runEnrich(opts = {}) {
  const { DATA, INBOX, DETAILS } = paths(opts.data);
  const state = readInbox(INBOX);
  if (!state || !Array.isArray(state.items)) {
    return { error: "no_inbox", dataDir: DATA };
  }

  const proxy = opts.proxy || "";

  // 附件下载根目录（data/attachments/<id>/）
  const { join: _join } = await import("node:path");
  opts._attachBase = _join(DATA, "attachments");

  // 动态 import（保证 fetch-bill-detail 读到 PROXY 环境）
  const deps = {
    ...(await import("./fetch-bill-detail.mjs")),
    ...(await import("../analysis/profile-loader.js")),
    ...(await import("./personal-rules-config.mjs")),
    ...(await import("./agent-runner.mjs")),
    ...(await import("../web/normalize.mjs")),
    ...(await import("./doc-handlers/index.mjs")),
  };
  opts._personalRulesConfig = deps.loadPersonalRulesConfig({
    userConfigFile: _join(DATA, "personal-rules.config.json"),
  });
  if (deps.loadUserHandlers) {
    await deps.loadUserHandlers({ log: () => {} });
  }

  // 候选：doc-handlers 支持的真实单据（MDF/iForm/YNF），按 --id / --limit 过滤。
  let items = state.items.filter((it) =>
    it.webUrl &&
    deps.detectFramework(it) !== "unknown" &&
    (!opts.pendingOnly || it.status !== "done")
  );
  if (opts.id) items = items.filter((it) => it.id === opts.id);
  const currentTenant = await resolveCurrentTenant(state, proxy);
  let skippedCrossTenant = 0;
  const toProcess = [];
  for (const it of items) {
    if (toProcess.length >= (opts.limit || 5)) break;
    // 跨租户单据：代理无权取数，跳过不空转（前端按 item.crossTenant 标注「需切换租户」）
    const tid = itemTenantId(it);
    if (currentTenant && tid && tid !== currentTenant) { skippedCrossTenant++; continue; }
    const existing = readDetail(DETAILS, it.id);
    // 完成 = 既有结论分析、又有真实字段。meta-only（有旧分析但无真实字段）需重 enrich 升级，
    // 否则旧的「有分析即跳过」会让调度器永远不去抓这些单据的真实字段。
    const hasRealFields =
      (Array.isArray(existing?.richDetail?.normalized?.fields) && existing.richDetail.normalized.fields.length > 0) ||
      (Array.isArray(existing?.normalized?.fields) && existing.normalized.fields.length > 0) ||
      (Array.isArray(existing?.content?.fields) && existing.content.fields.length > 0);
    const tombstoned = existing?.content?.unavailable === true; // 抓取失败标记，跳过避免反复空转
    // 完成 = 有「完整」分析(带 summary 的字段/规则分析) + 真实字段。
    // 旧模板残缺分析(YonClaw {field,value} 无 summary)不算完成 → 会被重新分析。
    const hasRichDetail = !!existing?.richDetail;
    const richDetailVersion = Number(existing?.richDetail?.schemaVersion || existing?.schemaVersion || 0);
    const needsRichDetailUpgrade = hasRealFields && (!hasRichDetail || richDetailVersion < REQUIRED_RICH_DETAIL_SCHEMA_VERSION);
    const hasFieldDisplayPlan = !!(existing?.fieldDisplayPlan || existing?.analysis?.fieldDisplayPlan);
    const needsFieldDisplayPlan = hasRealFields && !hasFieldDisplayPlan;
    const complete = deps.isCompleteAnalysis(existing?.analysis) && hasRealFields && !needsRichDetailUpgrade && !needsFieldDisplayPlan;
    if (!opts.force && (tombstoned || complete)) continue;
    toProcess.push(it);
  }

  const results = [];
  let inboxDirty = false;
  for (const it of toProcess) {
    const r = await enrichOne(it, deps, opts);
    if ((r.step === "done" || r.step === "fields-only") && !opts.dryRun) {
      const existing = readDetail(DETAILS, it.id) || { id: it.id, title: it.title, docType: it.docType };
      existing.content = {
        businessKey: r.businessKey || existing.businessKey || null,
        fields: r.fields,
        attachments: (r.attachments || []).map((a) => ({
          fileName: a.fileName,
          fileType: a.fileType,
          size: a.size,
          fid: a.fid || null,
          url: a.url || "",
          storagePath: a.storagePath || "",
          source: a.source || "",
          localPath: a.localPath || null,
          error: a.error || null,
        })),
        fetchedAt: new Date().toISOString(),
      };
      existing.richDetail = r.richDetail || null;
      if (r.businessKey) existing.businessKey = r.businessKey;
      existing.normalized = r.richDetail?.normalized || null;
      existing.fieldLabels = r.fieldLabels || {};
      existing.fieldMetadata = r.fieldMetadata || {};
      existing.framework = r.framework || existing.framework || null;
      existing.handlerId = r.handlerId || existing.handlerId || null;
      if (r.billDetail) existing.billDetail = r.billDetail;
      if (r.iformData) existing.iformData = r.iformData;
      // claude 分析最佳努力：成功才覆盖 analysis；失败/超时保留既有，真实字段已落盘
      if (r.analysis) {
        existing.analysis = r.analysis;
        existing.fieldDisplayPlan = r.fieldDisplayPlan || r.analysis.fieldDisplayPlan || existing.fieldDisplayPlan || null;
        existing.analysisMeta = {
          ...(existing.analysisMeta || {}),
          personalRuleIds: r.personalRuleIds || [],
          analyzedAt: new Date().toISOString(),
        };
      }
      // C: 分析失败原因落盘（供前端显示「分析失败，可重试」），成功则清除
      existing.analysisError = r.analysis ? null : (r.analysisError || null);
      writeDetail(DETAILS, it.id, existing);
      // B1: 分析结论回填 inbox 列表项（advice/riskLevel/smartTags），让列表行显示徽标
      if (r.analysis && deps.deriveItemBadges) {
        const badges = deps.deriveItemBadges(r.analysis);
        const item = state.items.find((x) => x.id === it.id);
        if (badges && item) {
          item.advice = badges.advice;
          item.aiSuggestion = badges.aiSuggestion;
          item.riskLevel = badges.riskLevel;
          if (badges.smartTags.length) item.smartTags = badges.smartTags;
          inboxDirty = true;
        }
      }
    } else if (r.step === "fetch" && !opts.dryRun) {
      // B2: 抓取失败（如「当前单据数据未找到」）打 tombstone，调度器后续跳过，不再反复空转
      const existing = readDetail(DETAILS, it.id) || { id: it.id, title: it.title, docType: it.docType };
      const had = existing.content && Array.isArray(existing.content.fields) && existing.content.fields.length > 0;
      if (!had) {
        const reason = /未找到/.test(r.detail || "") ? "not_found" : "fetch_error";
        if (r.businessKey) existing.businessKey = r.businessKey;
        existing.content = { businessKey: r.businessKey || existing.businessKey || null, fields: [], unavailable: true, unavailableReason: reason, fetchError: r.detail || r.error || "fetch_failed", fetchedAt: new Date().toISOString() };
        writeDetail(DETAILS, it.id, existing);
      }
    }
    results.push(r);
  }
  if (inboxDirty && !opts.dryRun) writeInbox(INBOX, state);

  return {
    dataDir: DATA,
    proxy: proxy || null,
    transport: "iuap-apcom-cli",
    currentTenant: currentTenant || null,
    candidates: items.length,
    skippedCrossTenant,
    processed: results.length,
    done: results.filter((r) => r.step === "done").length,
    results,
  };
}

// ── CLI ───────────────────────────────────────────────────
function isMain() {
  // 用 fileURLToPath 解码比对：install 路径含空格(Application Support)时
  // import.meta.url 会编码成 %20，而 `file://${argv[1]}` 不编码 → 直接字符串比会漏判，
  // 导致子进程被 server spawn 时不执行 main（Fix B 空跑）。
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
}
if (isMain()) {
  const opts = parseArgs(process.argv.slice(2));
  runEnrich(opts).then((report) => {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (report.error === "no_inbox") {
      process.stderr.write(`\n[提示] 未找到 inbox.json（${report.dataDir}）。用 --data 指向 YonWork 真实 data 目录。\n`);
    }
  });
}
