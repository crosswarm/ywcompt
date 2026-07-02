import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_REQUIRED_COOKIES = ["XSRF-TOKEN"];
const AUTH_COOKIE_CANDIDATES = ["yht_access_token", "JSESSIONID", "yht_usertoken_diwork"];
const APP_SUPPORT_NAMES = ["yonclaw", "YonWork", "yonwork"];
const APPROVE_INBOX_SKILL_DIR_NAMES = ["iuap-apcom-myapproval", "approve-inbox", "iuap-apcom-approveinbox"];

function bipCliFromSkillDir(skillDir) {
  return join(skillDir, "scripts", "bip-cli.js");
}

function bipCliFromApproveInboxPath(inputPath) {
  if (!inputPath) return null;
  const normalized = resolve(String(inputPath));
  for (const skillDirName of APPROVE_INBOX_SKILL_DIR_NAMES) {
    const marker = `${sep}skills${sep}${skillDirName}`;
    const idx = normalized.indexOf(marker);
    if (idx >= 0) return join(normalized.slice(0, idx), "skills", "iuap-apcom-cli", "scripts", "bip-cli.js");
  }
  return null;
}

function profileRoots(homeDir = homedir()) {
  const roots = APP_SUPPORT_NAMES.map((name) => join(homeDir, "Library", "Application Support", name, "profiles"));
  return [...new Set(roots)].filter((root) => existsSync(root));
}

function runtimeProfileCandidates(homeDir = homedir()) {
  const profileRootsList = profileRoots(homeDir);
  if (profileRootsList.length === 0) return [];
  const candidates = [];
  for (const profileRoot of profileRootsList) {
    let entries = [];
    try {
      entries = readdirSync(profileRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = join(
        profileRoot,
        entry.name,
        "userData",
        "runtime",
        "openclaw",
        "skills",
        "iuap-apcom-cli",
      );
      let mtime = 0;
      try {
        mtime = statSync(skillDir).mtimeMs;
      } catch {
        // Keep the candidate for discoverability, but rank existing runtime dirs first.
      }
      candidates.push({ mtime, path: bipCliFromSkillDir(skillDir) });
    }
  }
  return candidates
    .sort((a, b) => (b.mtime - a.mtime) || a.path.localeCompare(b.path))
    .map((candidate) => candidate.path);
}

export function getBipCliPathCandidates({
  scriptDir = __dirname,
  argvPath = process.argv[1],
  homeDir = homedir(),
  env = process.env,
} = {}) {
  const candidates = [];
  if (env.APPROVE_INBOX_BIP_CLI) candidates.push(env.APPROVE_INBOX_BIP_CLI);
  if (env.BIP_CLI_PATH) candidates.push(env.BIP_CLI_PATH);
  if (env.IUAP_APCOM_CLI_DIR) candidates.push(bipCliFromSkillDir(env.IUAP_APCOM_CLI_DIR));
  candidates.push(bipCliFromApproveInboxPath(env.APPROVE_INBOX_DATA));
  candidates.push(bipCliFromApproveInboxPath(env.APPROVE_INBOX_SKILL_DIR));
  if (argvPath) {
    candidates.push(resolve(dirname(argvPath), "../../iuap-apcom-cli/scripts/bip-cli.js"));
  }
  candidates.push(resolve(scriptDir, "../../iuap-apcom-cli/scripts/bip-cli.js"));
  candidates.push(join(homeDir, ".agents", "skills", "iuap-apcom-cli", "scripts", "bip-cli.js"));
  candidates.push(join(homeDir, ".claude", "skills", "iuap-apcom-cli", "scripts", "bip-cli.js"));
  candidates.push(join(homeDir, ".codex", "skills", "iuap-apcom-cli", "scripts", "bip-cli.js"));
  candidates.push(...runtimeProfileCandidates(homeDir));
  return [...new Set(candidates.filter(Boolean))];
}

export function resolveBipCliPath(scriptDirOrOptions = __dirname, options = {}) {
  let scriptDir = scriptDirOrOptions || __dirname;
  if (scriptDirOrOptions && typeof scriptDirOrOptions === "object") {
    options = scriptDirOrOptions;
    scriptDir = options.scriptDir || __dirname;
  }
  const {
    env = process.env,
    argvPath = process.argv[1],
    homeDir = homedir(),
    exists = existsSync,
  } = options;
  const candidates = getBipCliPathCandidates({ scriptDir, argvPath, homeDir, env });
  return candidates.find((candidate) => exists(candidate)) || candidates[0];
}

export function resolveBipCliSettingsPath(env = process.env) {
  if (env.BIP_CLI_SETTINGS) return env.BIP_CLI_SETTINGS;
  const configHome = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, "bip-cli", "settings.json");
}

export function normalizeBaseUrl(baseUrl = "") {
  if (!baseUrl) return "";
  try {
    const url = new URL(baseUrl);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return String(baseUrl).replace(/\/$/, "");
  }
}

export function cookieMapToString(cookieMap = {}) {
  return Object.entries(cookieMap)
    .filter(([, value]) => value != null && value !== "")
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

export function parseCookieString(cookieStr = "") {
  const cookieMap = {};
  for (const part of String(cookieStr).split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    cookieMap[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return cookieMap;
}

export function findAuthEntry(settings = {}, baseUrl = "") {
  const entries = Array.isArray(settings.auth) ? settings.auth : [];
  if (!entries.length) return null;
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (normalizedBaseUrl) {
    const matched = entries.find((entry) => normalizeBaseUrl(entry?.baseUrl) === normalizedBaseUrl);
    if (matched) return matched;
  }
  return entries
    .filter((entry) => entry && typeof entry === "object")
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0] || null;
}

export function buildAuthFromCookieMap({ cookieMap = {}, baseUrl = "", source = "bip-cli-settings" } = {}) {
  return {
    baseUrl,
    cookieStr: cookieMapToString(cookieMap),
    xsrfToken: cookieMap["XSRF-TOKEN"] || null,
    yhtToken: cookieMap.yht_usertoken_diwork || null,
    tenantId: cookieMap.tenantid || null,
    source,
    cookieCount: Object.keys(cookieMap).length,
  };
}

export function validateAuth(auth, { requiredCookies = DEFAULT_REQUIRED_COOKIES } = {}) {
  if (!auth?.cookieStr) return { ok: false, reason: "missing_cookie_string" };
  const cookieMap = parseCookieString(auth.cookieStr);
  const missingRequired = requiredCookies.filter((name) => !cookieMap[name]);
  if (missingRequired.length) return { ok: false, reason: `missing_required_cookies:${missingRequired.join(",")}` };
  if (!AUTH_COOKIE_CANDIDATES.some((name) => cookieMap[name])) {
    return { ok: false, reason: "missing_auth_cookie" };
  }
  return { ok: true, reason: "ok" };
}

export function loadAuthFromSettings({ settingsPath = resolveBipCliSettingsPath(), baseUrl = "", requiredCookies } = {}) {
  if (!existsSync(settingsPath)) {
    return { auth: null, valid: { ok: false, reason: "settings_not_found" } };
  }
  const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  const entry = findAuthEntry(settings, baseUrl);
  if (!entry?.cookieMap || typeof entry.cookieMap !== "object") {
    return { auth: null, valid: { ok: false, reason: "auth_entry_not_found" } };
  }
  const auth = buildAuthFromCookieMap({
    cookieMap: entry.cookieMap,
    baseUrl: entry.baseUrl || baseUrl,
    source: "bip-cli-settings",
  });
  return { auth, valid: validateAuth(auth, { requiredCookies }) };
}

export function runCliJson(cliPath, args, execFile = execFileSync) {
  const stdout = execFile("node", [cliPath, ...args], {
    encoding: "utf-8",
    timeout: 30_000,
    stderr: "pipe",
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export function getBrowserStatus({ cliPath = resolveBipCliPath(), execFile = execFileSync } = {}) {
  return runCliJson(cliPath, ["yonbrowser", "login", "status", "--format", "json"], execFile);
}

export function fetchBrowserCredentials({ cliPath = resolveBipCliPath(), execFile = execFileSync } = {}) {
  return runCliJson(cliPath, ["yonbrowser", "login", "fetch", "--format", "json"], execFile);
}

export function refreshBrowserCredentials({ cliPath = resolveBipCliPath(), execFile = execFileSync, log = null } = {}) {
  try {
    const result = fetchBrowserCredentials({ cliPath, execFile });
    if (result?.success === false) {
      log?.(`[auth] BIP-CLI login fetch failed: ${result.message || result.error || "unknown error"}`);
    }
    return result;
  } catch (err) {
    log?.(`[auth] BIP-CLI login fetch failed: ${err.message}`);
    throw err;
  }
}

export async function getBrowserAuth({
  cliPath = resolveBipCliPath(),
  settingsPath = resolveBipCliSettingsPath(),
  requiredCookies = DEFAULT_REQUIRED_COOKIES,
  log = null,
  execFile = execFileSync,
} = {}) {
  const status = getBrowserStatus({ cliPath, execFile });
  const statusData = status?.data || {};
  if (status.success === false || statusData.loginValid === false) {
    if (statusData.hasBrowserSession || statusData.port) {
      log?.("[auth] BIP browser status is invalid, refreshing credentials once");
      refreshBrowserCredentials({ cliPath, execFile, log });
    } else {
      throw new Error("BIP browser session is not logged in. Run yonbrowser login open and complete login.");
    }
  }

  const baseUrl = statusData.baseUrl || status?.baseUrl || "";
  let loaded = loadAuthFromSettings({ settingsPath, baseUrl, requiredCookies });
  if (!loaded.valid.ok) {
    log?.(`[auth] BIP-CLI credentials stale (${loaded.valid.reason}), refreshing once`);
    refreshBrowserCredentials({ cliPath, execFile, log });
    loaded = loadAuthFromSettings({ settingsPath, baseUrl, requiredCookies });
  }
  if (!loaded.valid.ok) {
    throw new Error(`BIP-CLI credentials unavailable: ${loaded.valid.reason}`);
  }
  return {
    ...loaded.auth,
    baseUrl: loaded.auth.baseUrl || baseUrl,
    browserPort: statusData.port || null,
    browserPid: statusData.pid || null,
  };
}
