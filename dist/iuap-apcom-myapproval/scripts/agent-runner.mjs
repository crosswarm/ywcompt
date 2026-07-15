#!/usr/bin/env node
/**
 * agent-runner.mjs — Agent 调用抽象层
 *
 * 封装本地 claude CLI 的非交互式调用，对外暴露 runAgent() 和 buildAnalysisPrompt()。
 * Agent 输出要求：5 段结构化 JSON，对齐 docs/spec/approve-inbox-component.md §6
 * 和 docs/jsonSchema/approve-inbox.schema.json。
 *
 * 输出 JSON 结构：
 * {
 *   "conclusion": { "advice": "approve|caution|reject", "label": "建议通过|需关注|建议拒绝" },
 *   "overallAnalysis": "<40字以内总体分析>",
 *   "fieldAnalysis": [ { "name", "value", "summary", "severity": "risk|warning|passed" } ],
 *   "ruleAnalysis":  [ { "ruleName", "severity", "summary", "evidence"（必填）, "suggestion" } ],
 *   "attachmentAnalysis": [ { "name", "fileType", "severity", "summary", "findings": [] } ]
 * }
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// ── 文件处理 ──────────────────────────────────────────────

const TEXT_EXTENSIONS = new Set([
  ".md", ".txt", ".csv", ".json", ".xml", ".yaml", ".yml",
  ".js", ".ts", ".mjs", ".cjs", ".py", ".java", ".rb", ".go", ".rs",
  ".sql", ".sh", ".bash", ".zsh", ".css", ".html", ".vue",
  ".log", ".ini", ".cfg", ".conf", ".env", ".toml",
]);

function fileExt(filename) {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return ext.startsWith(".") ? ext : "";
}

function isTextFile(filename) {
  const ext = fileExt(filename);
  return TEXT_EXTENSIONS.has(ext);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 读取附件内容，构建嵌入 prompt 的文本。
 * 文本文件读前 1 万字；二进制文件仅列元信息。
 * @param {string[]} files
 * @returns {string}
 */
function commandExists(command) {
  try {
    execFileSync("which", [command], { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function extractOfficeText(filePath, ext) {
  try {
    if (ext === ".xlsx" || ext === ".xlsm") {
      if (!commandExists("python3")) return null;
      const script = `
import sys
try:
    from openpyxl import load_workbook
except Exception:
    sys.exit(2)
path = sys.argv[1]
wb = load_workbook(path, read_only=True, data_only=True)
out = []
for ws in wb.worksheets[:5]:
    out.append("## " + ws.title)
    for row in ws.iter_rows(max_row=80, values_only=True):
        vals = [str(v) for v in row if v is not None and str(v).strip()]
        if vals:
            out.append("\\t".join(vals))
print("\\n".join(out)[:20000])
`;
      return execFileSync("python3", ["-c", script, filePath], { encoding: "utf-8", timeout: 15000, maxBuffer: 512 * 1024 });
    }

    if ([".doc", ".docx", ".xls", ".rtf"].includes(ext) && commandExists("textutil")) {
      return execFileSync("textutil", ["-convert", "txt", "-stdout", filePath], { encoding: "utf-8", timeout: 15000, maxBuffer: 512 * 1024 });
    }

    if (ext === ".pdf" && commandExists("pdftotext")) {
      return execFileSync("pdftotext", ["-layout", filePath, "-"], { encoding: "utf-8", timeout: 15000, maxBuffer: 512 * 1024 });
    }
    if (ext === ".pdf" && commandExists("strings")) {
      return execFileSync("strings", ["-n", "4", filePath], { encoding: "utf-8", timeout: 15000, maxBuffer: 512 * 1024 });
    }
  } catch {
    return null;
  }

  return null;
}

export function buildFileContext(files) {
  if (!files || files.length === 0) return "";

  const parts = ["\n【附件文件】"];
  for (const filePath of files) {
    const name = filePath.split("/").pop();
    try {
      if (!existsSync(filePath)) {
        parts.push(`\n- ${name}：(文件不存在)`);
        continue;
      }
      const size = readFileSync(filePath).length;
      if (isTextFile(name)) {
        const content = readFileSync(filePath, "utf-8").slice(0, 10000);
        parts.push(`\n--- ${name} (${formatSize(size)}) ---\n${content}\n--- ${name} 结束 ---`);
      } else {
        const ext = fileExt(name);
        const extracted = extractOfficeText(filePath, ext);
        if (extracted && extracted.trim()) {
          parts.push(`\n--- ${name} (${formatSize(size)}, 已抽取文本) ---\n${extracted.trim().slice(0, 10000)}\n--- ${name} 结束 ---`);
        } else {
          parts.push(`\n- ${name} (${formatSize(size)}) [二进制文件，未能抽取文本，仅可基于文件名、类型、大小分析]`);
        }
      }
    } catch {
      parts.push(`\n- ${name}：(读取失败)`);
    }
  }
  return parts.join("\n");
}

// ── 主接口 ──────────────────────────────────────────────────

// ── 模型 provider 配置 ────────────────────────────────────
// 默认走用友底层模型（openclaw agent 的同款后端：deepseek-v4-flash，经本机 3211
// open-platform-model，OpenAI 兼容、本地直连无需 token）；失败回退本地 claude CLI。
// env：APPROVE_INBOX_AGENT_PROVIDER=yonyou|claude（默认 yonyou，yonyou 失败自动兜底 claude）
//      APPROVE_INBOX_MODEL_BASE / APPROVE_INBOX_MODEL 可覆盖端点与模型名。
const YONYOU_BASE = () => process.env.APPROVE_INBOX_MODEL_BASE || "http://127.0.0.1:3211/api/open-platform-model/v1";
const YONYOU_MODEL = () => process.env.APPROVE_INBOX_MODEL || "deepseek-v4-flash";

/**
 * 从模型响应抽取正文：兼容标准 JSON（choices[0].message.content）与
 * SSE 流式（多行 data: {delta.content}，累加，忽略 reasoning_content）。
 */
export function extractContent(text) {
  const t = (text || "").trim();
  if (!t) return "";
  try {
    const j = JSON.parse(t);
    const c = j.choices?.[0]?.message?.content;
    if (c) return c;
  } catch {
    // 非标准 JSON，按 SSE 解析
  }
  let acc = "";
  for (const line of t.split("\n")) {
    const m = line.match(/^data:\s*(.+)$/);
    if (!m || m[1].trim() === "[DONE]") continue;
    try {
      const d = JSON.parse(m[1]).choices?.[0]?.delta;
      if (d?.content) acc += d.content;
    } catch {
      // 跳过坏行
    }
  }
  return acc.trim();
}

/** 调用用友底层模型（OpenAI 兼容 chat/completions） */
async function runYonYou(prompt, timeout) {
  const start = Date.now();
  const model = YONYOU_MODEL();
  try {
    const r = await fetch(`${YONYOU_BASE()}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], stream: false, temperature: 0 }),
      signal: AbortSignal.timeout(timeout),
    });
    const text = await r.text();
    const content = extractContent(text);
    if (!r.ok || !content) {
      return { success: false, content: "", agent: "yonyou", duration: Date.now() - start, error: `bad_response(${r.status}): ${text.slice(0, 120)}` };
    }
    return { success: true, content, agent: `yonyou:${model}`, duration: Date.now() - start };
  } catch (e) {
    return { success: false, content: "", agent: "yonyou", duration: Date.now() - start, error: String(e.message || e) };
  }
}

/** 调用本地 claude CLI */
function runClaude(prompt, timeout) {
  const start = Date.now();
  try {
    execSync("which claude", { encoding: "utf-8", stdio: "ignore" });
  } catch {
    return { success: false, content: "", agent: null, duration: Date.now() - start, error: "no_agent_available" };
  }
  try {
    const stdout = execSync(`claude -p ${JSON.stringify(prompt)}`, { encoding: "utf-8", timeout, maxBuffer: 10 * 1024 * 1024 });
    return { success: true, content: stdout.trim(), agent: "claude", duration: Date.now() - start };
  } catch (err) {
    return { success: false, content: "", agent: "claude", duration: Date.now() - start, error: err.message || String(err) };
  }
}

/**
 * 对给定 prompt 进行分析。默认走用友底层模型（deepseek-v4-flash），失败兜底本地 claude。
 * 期望输出 5 段结构化 JSON（见模块顶部注释）。
 *
 * @param {string} prompt - 完整提示词
 * @param {object} [options]
 * @param {string[]} [options.files] - 附件文件路径列表（文本文件读前 1 万字）
 * @param {number} [options.timeout] - 超时时间 ms（默认 120000）
 * @returns {Promise<{ success: boolean, content: string, agent: string|null, duration: number, error?: string }>}
 */
export async function runAgent(prompt, options = {}) {
  const { files, timeout = 120_000 } = options;
  const fileContext = buildFileContext(files);
  const fullPrompt = fileContext
    ? `${prompt}\n\n以下是相关附件文件的内容，请一并分析：\n${fileContext}`
    : prompt;

  const provider = (process.env.APPROVE_INBOX_AGENT_PROVIDER || "yonyou").toLowerCase();
  // yonyou 优先 + claude 兜底；显式 claude 则只用 claude
  const order = provider === "claude" ? ["claude"] : ["yonyou", "claude"];

  let last = null;
  for (const p of order) {
    const r = p === "yonyou" ? await runYonYou(fullPrompt, timeout) : runClaude(fullPrompt, timeout);
    if (r.success) return r;
    last = r;
  }
  return last || { success: false, content: "", agent: null, duration: 0, error: "no_provider" };
}

// ── Prompt 构建 ──────────────────────────────────────────────

// 5 段输出格式约束（profile 模式与通用模式共用）
const OUTPUT_FORMAT = `输出格式：
{
  "conclusion": { "advice": "approve|caution|reject", "label": "建议通过|需关注|建议拒绝" },
  "overallAnalysis": "<40字以内的总体分析>",
  "fieldAnalysis": [
    { "name": "<字段名>", "value": "<字段值>", "summary": "<分析结论>", "severity": "risk|warning|passed" }
  ],
  "ruleAnalysis": [
    { "ruleName": "<规则名>", "severity": "risk|warning|passed", "summary": "<规则结论>", "evidence": "<命中依据，必填，不得为空>", "suggestion": "<改进建议>" }
  ],
  "attachmentAnalysis": [
    { "name": "<附件名>", "fileType": "<文件类型>", "severity": "risk|warning|passed", "summary": "<附件审核结论>", "findings": [{ "name": "<发现项>", "detail": "<详情>" }] }
  ]
}`;

const OUTPUT_REQUIREMENTS = `要求：
- conclusion.advice 必须是 approve / caution / reject 之一
- overallAnalysis 不超过 40 字
- ruleAnalysis 中每条 evidence 必填，不得编造依据
- 无法判断时给 caution，不要强行给出 approve 或 reject
- fieldAnalysis 对每个关键字段给出 severity 评估
- 若有【附件】元信息，即使附件正文未下载或未抽取，也必须为每个附件输出 attachmentAnalysis；summary 需说明“已识别附件，正文未解析/仅基于文件名和元信息判断”，不得编造附件正文内容
- 若提供【附件文件】正文，attachmentAnalysis 必须基于正文给出关键发现
- 若无附件则 attachmentAnalysis 为空数组`;

/** 把 profile（含展开的通用维 + 业务规则 + 关注字段）渲染成 prompt 片段 */
function renderProfileSection(profile, dimensions) {
  if (!profile) return "";
  const parts = [`\n【分析套路 · ${profile.docType || "通用"}】`];
  if (Array.isArray(dimensions) && dimensions.length) {
    parts.push("通用检查维度：");
    for (const d of dimensions) {
      parts.push(`- ${d.name}：${(d.checkpoints || []).join("；")}`);
    }
  }
  if (Array.isArray(profile.businessRules) && profile.businessRules.length) {
    const builtInRules = profile.businessRules.filter((rule) => rule?.source !== "personal");
    const personalRules = profile.businessRules.filter((rule) => rule?.source === "personal");
    if (builtInRules.length) {
      parts.push("内置业务规则（按单据实际情况判断是否命中）：");
      for (const r of builtInRules) {
        parts.push(`- ${r.ruleName}：${r.checkpoint || ""}${r.severityHint ? `（命中倾向 ${r.severityHint}）` : ""}`);
      }
    }
    if (personalRules.length) {
      parts.push("个人定制规则（优先检查）：");
      for (const r of personalRules) {
        parts.push(`- ${r.ruleName}：${r.checkpoint || ""}${r.severityHint ? `（命中倾向 ${r.severityHint}）` : ""}${r.suggestion ? `；建议：${r.suggestion}` : ""}`);
      }
    }
  }
  if (Array.isArray(profile.keyFields) && profile.keyFields.length) {
    parts.push(`重点字段：${profile.keyFields.join("、")}`);
  }
  if (profile.promptHint) parts.push(`提示：${profile.promptHint}`);
  return parts.join("\n");
}

/** 把中文化字段列表渲染成 prompt 片段 */
function renderFields(fields) {
  if (!Array.isArray(fields) || !fields.length) return "";
  return (
    "\n【单据字段（真实抓取）】\n" +
    fields
      .filter((f) => f && f.name && f.value != null && String(f.value).trim())
      .map((f) => `- ${f.name}：${f.value}`)
      .join("\n")
  );
}

/**
 * 构建审批单据分析 prompt，要求 Agent 输出 5 段结构化 JSON。
 * 对齐 docs/spec/approve-inbox-component.md 与 approve-inbox.schema.json。
 *
 * @param {object} item - 列表项（来自 inbox.json）
 * @param {object} detail - 单据详情（来自 details/<id>.json）
 * @param {object} [opts] - profile 驱动选项
 * @param {object} [opts.profile] - 分析 profile（profile-loader.selectProfile 结果）
 * @param {Array}  [opts.dimensions] - 展开的通用维（profile-loader.profileDimensions 结果）
 * @param {Array}  [opts.fields] - 中文化真实字段（profile-loader.localizeFields 结果）
 * @returns {string}
 *
 * 向后兼容：不传 opts 或无 profile 时，退回原通用 prompt（行为不变）。
 */
export function buildAnalysisPrompt(item, detail, opts = {}) {
  const b = detail?.billDetail || {};
  const s = item.summary || {};

  // 表单字段 kv（原通用来源）
  const formFields = (s.iformFields || [])
    .filter((f) => f.label && f.value)
    .map((f) => `- ${f.label}：${f.value}`)
    .join("\n");

  // 附件元信息摘要（文本内容通过 files 选项嵌入）
  const attSummary = item.attachments?.length
    ? `\n【附件】${item.attachments
        .map((a) => {
          const status = a.localPath
            ? "已下载正文"
            : (a.error ? `正文未解析：${a.error}` : "正文未解析");
          const type = a.fileType ? `，类型：${a.fileType}` : "";
          return `\n- ${a.fileName} (${formatSize(a.size || 0)}${type}，${status})`;
        })
        .join("")}`
    : "";

  // 单据核心字段（兼容 patch / iform / other 类型）
  const docFields = [
    `- 标题：${item.title || ""}`,
    `- 类型：${s.typeLabel || item.serviceName || item.docType || item.type || "-"}`,
    `- 申请人：${s.applicant || item.submitter || item.commitUserName || b.applicant || "-"}`,
    `- 部门：${s.department || b.department || "-"}`,
    `- 领域模块：${b.lymk || s.module || "-"}`,
    `- 项目：${b.xmmc || s.project || "-"}`,
    `- 客户：${b.customName || s.customer || "-"}`,
    `- 版本：${b.khbb || s.version || "-"}`,
    `- 紧急程度：${b.jjcd || s.urgency || "-"}`,
    `- 描述：${s.description || b.gy || b.zcwtgy || s.problemDesc || "-"}`,
  ].join("\n");

  // profile 驱动片段（无 profile 则为空，退回原通用 prompt）
  const profileSection = renderProfileSection(opts.profile, opts.dimensions);
  const realFields = renderFields(opts.fields);

  return `你是企业审批分析专家。请分析以下审批单据（含附件），严格按照 JSON 格式输出分析结果，不要输出任何 JSON 以外的内容。

${OUTPUT_FORMAT}

${OUTPUT_REQUIREMENTS}
${profileSection}

【单据信息】
${docFields}
${realFields}
【表单字段】
${formFields || "-"}
${attSummary}`;
}
