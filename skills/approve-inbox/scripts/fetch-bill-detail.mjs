#!/usr/bin/env node
/**
 * fetch-bill-detail.mjs — 按 webUrl 抓取 BIP 单据明细字段（补 R7：单据业务字段缺失）
 *
 * 解决「拿不到单据元数据/字段导致无法分析」：列表/待办只有元信息，本脚本顺着每条
 * 待办的 webUrl 去抓单据本身的业务字段（金额、物料、预算、明细等），供 agent 实质分析。
 *
 * 链路（标准 MDF 单据，移植自参考实现 sync-inbox.mjs）：
 *   parseWebUrl → generateADT → getTplId → bill/detail
 * iform 单据：getFormData。
 *
 * 认证 cookie 可插拔（对应两种取数方式，R9 都试）：
 *   方式1（yonclaw 取数增强）：环境变量 APPROVE_INBOX_COOKIE / APPROVE_INBOX_XSRF 注入
 *   方式2（skill 端二次抓取）：CDP 从已登录浏览器提取（端口 9222/50541…）
 *
 * 用法：
 *   node fetch-bill-detail.mjs --url "<webUrl>"            # 抓一条，输出字段 JSON
 *   APPROVE_INBOX_COOKIE="k=v; ..." node fetch-bill-detail.mjs --url "<webUrl>"
 *   echo '{"webUrl":"..."}' | node fetch-bill-detail.mjs   # 从 stdin 读 item
 */

// YonClaw BIP 代理（自动注入登录态凭据）优先；否则直连 BIP
// 在调用时读 env（不在模块加载时固化）：server 长驻进程下 YonClaw 代理端口动态变化，
// 模块缓存会让加载时取的值变陈旧 → 必须每次调用现取。
function proxyUrl() {
  return process.env.APPROVE_INBOX_PROXY || "";
}
function baseUrl() {
  return proxyUrl() || process.env.APPROVE_INBOX_BASE || "https://c1.yonyoucloud.com";
}

// billnum 前缀（第一个 _ 之前）→ 微服务映射（移植参考实现，可按需扩展）
const MICROSERVICE_MAP = {
  znbzbx: "yonbip-fi-expsrbsm",
  hrtm: "yonbip-hr-tm",
  pu: "yonbip-scm-pu",
};
const DEFAULT_MICROSERVICE = "iuap-yonbuilder-runtime";

/** 由 billnum 前缀选择微服务 */
export function pickMicroservice(billnum) {
  const prefix = String(billnum || "").split("_")[0];
  return MICROSERVICE_MAP[prefix] || DEFAULT_MICROSERVICE;
}

// ── 取数 profile（analysis/fetch-profiles.json）─────────────
import { readFileSync as _readFileSync, existsSync as _existsSync } from "node:fs";
import { join as _join, dirname as _dirname } from "node:path";
import { fileURLToPath as _fileURLToPath } from "node:url";

const _here = _dirname(_fileURLToPath(import.meta.url));
const FETCH_PROFILES_PATH = _join(_here, "..", "analysis", "fetch-profiles.json");

let _fetchProfilesCache;
/** 读取并缓存 fetch-profiles.json 的 profiles 字典；缺失返回 {} */
export function loadFetchProfiles() {
  if (_fetchProfilesCache) return _fetchProfilesCache;
  try {
    if (_existsSync(FETCH_PROFILES_PATH)) {
      const j = JSON.parse(_readFileSync(FETCH_PROFILES_PATH, "utf-8"));
      _fetchProfilesCache = j.profiles || {};
    } else {
      _fetchProfilesCache = {};
    }
  } catch {
    _fetchProfilesCache = {};
  }
  return _fetchProfilesCache;
}

/**
 * 取某 billnum 的取数 profile（纯查表，不做网络）。
 * 仅返回可用于抓取的 profile（有 endpoint），unverified/无 endpoint 返回 null。
 * @param {string} billnum
 * @param {object} [profiles] 可注入测试用字典
 * @returns {{microservice?:string, endpoint:string, serviceCode?:string, extra?:object}|null}
 */
export function getFetchProfile(billnum, profiles) {
  const dict = profiles || loadFetchProfiles();
  const p = dict[billnum];
  if (p && p.endpoint) return p;
  return null;
}

/**
 * 解析待办 webUrl，提取抓取所需参数（纯函数，可单测）。
 * 识别三类：
 *  - voucher：/mdf-node/meta/[Vv]oucher/<billnum>/<id>?domainKey=&taskId=&tenantId=
 *  - iform：含 formId/pkBo（走 getFormData）
 *  - unsupported：任务通知 / 外部域（ting.diwork 等）
 * @param {string} webUrl
 * @returns {{kind:'voucher'|'iform'|'unsupported', billnum?, billId?, domainKey?, taskId?, tenantId?, appSource?, formId?, formInstanceId?}}
 */
export function parseWebUrl(webUrl) {
  if (!webUrl || typeof webUrl !== "string") return { kind: "unsupported" };
  let u;
  try {
    u = new URL(webUrl);
  } catch {
    return { kind: "unsupported" };
  }

  // 外部域 / 非 mdf 单据
  if (!u.hostname.includes("yonyoucloud.com")) return { kind: "unsupported" };
  const p = u.pathname.toLowerCase();
  const sp = u.searchParams;

  // voucher 型
  const parts = u.pathname.split("/");
  const vIdx = parts.findIndex((x) => x.toLowerCase() === "voucher");
  if (p.includes("/mdf-node/") && vIdx >= 0 && vIdx + 2 < parts.length) {
    const billnum = parts[vIdx + 1];
    const billId = parts[vIdx + 2];
    if (billnum && billId) {
      return {
        kind: "voucher",
        billnum,
        billId,
        domainKey: sp.get("domainKey") || "",
        taskId: sp.get("taskId") || "",
        tenantId: sp.get("tenantId") || "",
        appSource: sp.get("appSource") || "",
        taskFlag: sp.get("taskFlag") || "todo",
        businessStepCode: sp.get("businessStepCode") || "",
      };
    }
  }

  // iform 型
  const formId = sp.get("formId") || sp.get("pkBo");
  const formInstanceId = sp.get("formInstanceId") || sp.get("pkBoins");
  if (formId && formInstanceId) {
    return {
      kind: "iform",
      formId,
      formInstanceId,
      taskId: sp.get("taskId") || "",
      tenantId: sp.get("tenantId") || "",
    };
  }

  return { kind: "unsupported" };
}

/**
 * 把 bill/detail 返回的 data 拍平成业务字段列表（用于 agent fieldAnalysis 输入）。
 * 取标量字段，也兼容常见参照对象（name/displayName/value/code），避免 UI 显示 [object Object]。
 * @param {object} data bill/detail 的 data
 * @returns {Array<{key:string, value:string}>}
 */
export function billDetailToFields(data) {
  if (!data || typeof data !== "object") return [];
  // bill/detail 的字段常在 data 顶层或 data.data / data.head 下
  const src = data.head || data.data || data;
  const SYS = new Set([
    "id", "pubts", "createTime", "modifyTime", "_status", "ts", "dr",
    "creator", "modifier", "tenantid", "tenant_id", "isWfControlled",
    "verifystate", "_mddFormulaExecuteFlag",
  ]);
  const displayValue = (v) => {
    if (v == null) return "";
    if (typeof v === "string") return v.trim();
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (Array.isArray(v)) {
      return v
        .map(displayValue)
        .filter(Boolean)
        .join("、");
    }
    if (typeof v === "object") {
      for (const k of ["name", "displayName", "label", "title", "text", "value", "code"]) {
        if (v[k] != null && String(v[k]).trim()) return String(v[k]).trim();
      }
    }
    return "";
  };
  const out = [];
  for (const [k, v] of Object.entries(src)) {
    if (SYS.has(k)) continue;
    if (v == null) continue;
    const value = displayValue(v);
    if (!value) continue;
    out.push({ key: k, value });
  }
  return out;
}

/**
 * 从单据详情 data 提取附件元数据（纯函数，可测）。
 * 兼容 MDF/iform 常见模式：某字段值是 JSON 数组字符串，元素含 (url|filePath) + (name|fileName)。
 * 单据类型间附件字段名不固定，故全量扫描 head/data/顶层。
 * @param {object} data report|bill/detail 返回的 data
 * @returns {Array<{fileName,fileType,size,url,fid}>}
 */
export function extractDetailAttachments(data) {
  if (!data || typeof data !== "object") return [];
  const sources = [data.head, data.data, data].filter((x) => x && typeof x === "object");
  const out = [];
  const seen = new Set();
  for (const src of sources) {
    for (const v of Object.values(src)) {
      let arr = null;
      if (Array.isArray(v)) arr = v;
      else if (typeof v === "string" && v.trim().startsWith("[")) {
        try {
          const p = JSON.parse(v);
          if (Array.isArray(p)) arr = p;
        } catch {
          /* not JSON */
        }
      }
      if (!arr) continue;
      for (const it of arr) {
        if (!it || typeof it !== "object") continue;
        const url = it.url || it.filePath || it.downloadUrl || it.path;
        const fileName = it.name || it.fileName || it.filename;
        if (!url || !fileName) continue;
        const key = `${fileName}|${url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          fileName,
          fileType: it.type || it.fileType || (fileName.includes(".") ? fileName.split(".").pop() : ""),
          size: it.size || it.filesize || it.fileSize || 0,
          url,
          fid: it.fid || it.fileId || it.newFileId || "",
        });
      }
    }
  }
  return out;
}

/**
 * 下载附件到目标目录（经 YonClaw 代理/凭据；失败不抛，单文件容错）。
 * @param {Array} atts extractDetailAttachments 结果
 * @param {string} destDir 目标目录
 * @param {{cookieStr?:string, xsrfToken?:string}} [creds]
 * @returns {Promise<Array>} 含 localPath 的附件列表（下载失败的 localPath=null）
 */
export async function downloadAttachments(atts, destDir, creds = {}) {
  if (!Array.isArray(atts) || atts.length === 0) return [];
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join, basename } = await import("node:path");
  try {
    mkdirSync(destDir, { recursive: true });
  } catch {
    /* ignore */
  }
  const headers = {};
  if (creds.cookieStr) headers.Cookie = creds.cookieStr;
  if (creds.xsrfToken) headers["X-XSRF-TOKEN"] = creds.xsrfToken;

  const results = [];
  for (const a of atts) {
    const safeName = basename(a.fileName || a.fid || "attachment").replace(/[/\\]/g, "_");
    const localPath = join(destDir, safeName);
    try {
      const u = /^https?:\/\//.test(a.url) ? a.url : `${baseUrl()}${a.url.startsWith("/") ? "" : "/"}${a.url}`;
      const r = await fetch(u, { headers });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        writeFileSync(localPath, buf);
        results.push({ ...a, localPath, size: a.size || buf.length });
      } else {
        results.push({ ...a, localPath: null, error: `http_${r.status}` });
      }
    } catch (e) {
      results.push({ ...a, localPath: null, error: String(e.message || e) });
    }
  }
  return results;
}

// ── cookie 获取（可插拔）──────────────────────────────────

/** 环境变量注入的 cookie（方式1：yonclaw 提供）；无则返回 null */
function cookieFromEnv() {
  const cookieStr = process.env.APPROVE_INBOX_COOKIE;
  if (!cookieStr) return null;
  return { cookieStr, xsrfToken: process.env.APPROVE_INBOX_XSRF || null };
}

/** CDP 从已登录浏览器提取 cookie（方式2；使用 node 内置全局 WebSocket，零依赖） */
async function cookieFromCDP() {
  const ports = [9222, 50541, 9223, 9224, 9225];
  for (const port of ports) {
    try {
      const pages = await (await fetch(`http://localhost:${port}/json/list`)).json();
      const page = pages.find((p) => p.url && p.url.includes("yonyoucloud.com"));
      if (!page) continue;
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      let msgId = 0;
      const send = (method, params) =>
        new Promise((resolve, reject) => {
          const id = ++msgId;
          const onMsg = (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id === id) {
              ws.removeEventListener("message", onMsg);
              resolve(msg.result);
            }
          };
          ws.addEventListener("message", onMsg);
          ws.send(JSON.stringify({ id, method, params }));
          setTimeout(() => reject(new Error("cdp timeout")), 8000);
        });
      await new Promise((r, j) => {
        ws.addEventListener("open", r, { once: true });
        ws.addEventListener("error", j, { once: true });
      });
      const { cookies } = await send("Network.getAllCookies");
      ws.close();
      const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      const xsrf = cookies.find((c) => c.name === "XSRF-TOKEN");
      return { cookieStr, xsrfToken: xsrf?.value || null };
    } catch {
      continue;
    }
  }
  return null;
}

/** 获取 cookie：YonClaw 代理模式无需 cookie（代理注入）；否则 env 优先，再 CDP */
export async function getCookies() {
  if (proxyUrl()) return { cookieStr: "", xsrfToken: null, proxy: true };
  return cookieFromEnv() || (await cookieFromCDP());
}

// ── 抓取：voucher 单据详情（report/detail 优先，bill/detail 兜底）──────

/** 经 uniform 入口取 tplId（domainKey 路由，不用猜微服务） */
async function getTplId(parsed, headers) {
  const { billnum, billId, domainKey } = parsed;
  try {
    const r = await fetch(
      `${baseUrl()}/mdf-node/uniform/billmeta/getTplId?domainKey=${domainKey}&billnum=${billnum}&terminalType=1`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ billno: billnum, terminalType: "1", id: billId, tplmode: 0 }),
      }
    );
    const j = await r.json();
    return j.data?.tplId || "";
  } catch {
    return "";
  }
}

/**
 * 经 getbillcommands 取该单据「详情」动作的权威请求路径（cAction==='detail' 的 cSvcUrl）。
 * 这是标准方法：不同单据 detail 走 /report/detail 还是 /bill/detail 由此确定，避免猜测。
 * @returns {string} cSvcUrl（如 "/report/detail"）；失败返回 ""
 */
export async function getDetailSvcUrl(parsed, ms, serviceCode, headers) {
  const { billnum, taskId, appSource, taskFlag, tenantId, businessStepCode } = parsed;
  const qs = new URLSearchParams({
    terminalType: "1",
    serviceCode,
    targetUrl: "true",
    businessStepCode: businessStepCode || "",
    taskId: taskId || "",
    appSource: appSource || "",
    taskFlag: taskFlag || "todo",
    tenantId: tenantId || "",
    apptype: "mdf",
    from_mc_workflow: "1",
    adt: "wf",
    diworkCode: "undefined",
    billno: billnum,
  }).toString();
  try {
    const r = await fetch(`${baseUrl()}/${ms}/billmeta/getbillcommands?${qs}`, { headers });
    const j = await r.json();
    if (j.code === 200 && Array.isArray(j.data)) {
      const detailCmd = j.data.find((c) => c.cAction === "detail" && c.cSvcUrl);
      return detailCmd?.cSvcUrl || "";
    }
  } catch {
    /* 失败回退候选 */
  }
  return "";
}

/**
 * 取 voucher 单据详情字段。
 * 链路：uniform getTplId → 候选 detail 端点（report/detail 优先；uniform 与微服务都试，自适应）。
 * report/detail 参数对齐真实请求：serviceCode=<billnum>list、adt=wf、apptype=mdf、from_mc_workflow=1，
 * appSource/taskFlag/taskId/tenantId/businessStepCode 取自 webUrl。
 * （经 YonClaw 代理时凭据自动注入，无需 dynamic-auth-token。）
 */
async function fetchVoucherDetail(parsed, cookieStr, xsrfToken) {
  const { billnum, billId, domainKey, taskId, tenantId, appSource, taskFlag, businessStepCode } = parsed;
  const headers = { "Domain-Key": domainKey };
  if (cookieStr) headers.Cookie = cookieStr;
  if (xsrfToken) headers["X-XSRF-TOKEN"] = xsrfToken;

  const tplid = await getTplId(parsed, headers);
  if (!tplid) return { error: "getTplId_failed" };

  const ms = pickMicroservice(billnum);
  // 取数 profile（已实测固化的端点/微服务/serviceCode/额外参数）优先
  const profile = getFetchProfile(billnum);
  const serviceCode = profile?.serviceCode || `${billnum}list`;

  const params = {
    terminalType: "1",
    businessStepCode: businessStepCode || "",
    taskId: taskId || "",
    appSource: appSource || "",
    taskFlag: taskFlag || "todo",
    tenantId: tenantId || "",
    apptype: "mdf",
    from_mc_workflow: "1",
    serviceCode,
    adt: "wf",
    billnum,
    tplid,
    id: billId,
    ...(profile?.extra || {}),
  };
  const qs = new URLSearchParams(params).toString();

  const pms = profile?.microservice || ms;
  const candidates = [];
  // 1) 标准方法：getbillcommands 取 detail 动作的权威 cSvcUrl（report/detail 或 bill/detail）
  const svcUrl = await getDetailSvcUrl(parsed, pms, serviceCode, headers);
  if (svcUrl) candidates.push(`${pms}${svcUrl.startsWith("/") ? "" : "/"}${svcUrl}`);
  // 2) profile 命中的端点
  if (profile?.endpoint) candidates.push(`${pms}/${profile.endpoint}`);
  // 3) 通用自适应兜底
  candidates.push(
    `${ms}/report/detail`,
    `mdf-node/uniform/report/detail`,
    `${ms}/bill/detail`,
    `mdf-node/uniform/bill/detail`
  );

  let lastErr = "";
  const tried = new Set();
  for (const path of candidates) {
    if (tried.has(path)) continue;
    tried.add(path);
    try {
      const r = await fetch(`${baseUrl()}/${path}?${qs}`, { headers });
      const j = await r.json();
      if (j.code === 200 && j.data) return { data: j.data, via: path };
      lastErr = `${j.code}:${(j.message || "").slice(0, 30)}`;
    } catch (e) {
      lastErr = String(e.message || e);
    }
  }
  return { error: "detail_failed", detail: lastErr };
}

// ── 抓取：iform ───────────────────────────────────────────

async function fetchIformData(parsed, cookieStr, xsrfToken) {
  const { formId, formInstanceId, taskId, tenantId } = parsed;
  const qs = new URLSearchParams({
    _ts: String(Date.now()),
    tenantId: tenantId || "",
    pkBo: formId,
    pkBoins: formInstanceId,
    taskId: taskId || "",
  });
  const headers = { Accept: "application/json", Cookie: cookieStr };
  if (xsrfToken) headers["X-XSRF-TOKEN"] = xsrfToken;
  const resp = await fetch(
    `${baseUrl()}/yonbip-ec-iform/iform_ctr/bill_ctr/getFormData?${qs}`,
    { headers }
  );
  const json = await resp.json();
  if (json.code === 200 && json.data) return { data: json.data };
  return { error: "iform_failed", detail: json.message || json.code };
}

/**
 * 抓取一条待办的单据明细字段。
 * @param {{webUrl:string}} item
 * @param {{cookieStr:string, xsrfToken?:string}} [creds] 不传则自动获取
 * @returns {Promise<{kind, fields?, raw?, error?}>}
 */
export async function fetchBillFields(item, creds) {
  const parsed = parseWebUrl(item.webUrl || "");
  if (parsed.kind === "unsupported") return { kind: "unsupported", error: "unsupported_weburl" };

  const c = creds || (await getCookies());
  if (!c || (!c.cookieStr && !c.proxy)) return { kind: parsed.kind, error: "no_credentials" };

  const r =
    parsed.kind === "voucher"
      ? await fetchVoucherDetail(parsed, c.cookieStr, c.xsrfToken)
      : await fetchIformData(parsed, c.cookieStr, c.xsrfToken);

  if (r.error) return { kind: parsed.kind, error: r.error, detail: r.detail };
  return {
    kind: parsed.kind,
    fields: billDetailToFields(r.data),
    attachments: extractDetailAttachments(r.data),
    raw: r.data,
  };
}

// ── CLI ───────────────────────────────────────────────────

function isMain() {
  return import.meta.url === `file://${process.argv[1]}`;
}

if (isMain()) {
  const argv = process.argv.slice(2);
  const urlIdx = argv.indexOf("--url");
  const url = urlIdx >= 0 ? argv[urlIdx + 1] : null;

  const run = async (item) => {
    const r = await fetchBillFields(item);
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    if (r.error === "no_credentials") {
      process.stderr.write(
        "\n[提示] 未取到登录态。请二选一：\n" +
          "  ① 方式1：设置 APPROVE_INBOX_COOKIE（和 APPROVE_INBOX_XSRF）环境变量（yonclaw 注入）\n" +
          "  ② 方式2：在已登录 BIP 的 Chrome 上开调试端口（--remote-debugging-port=9222）后重试\n"
      );
    }
  };

  if (url) {
    run({ webUrl: url });
  } else {
    // 从 stdin 读 item JSON
    let s = "";
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => {
      try {
        run(JSON.parse(s));
      } catch {
        process.stderr.write("用法：node fetch-bill-detail.mjs --url <webUrl>\n");
        process.exit(1);
      }
    });
  }
}
