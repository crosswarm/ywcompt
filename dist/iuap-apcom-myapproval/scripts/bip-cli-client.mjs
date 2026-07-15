import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveBipCliPath } from "./browser-auth.mjs";

// 模块名沿用历史实现术语。正式运行依赖已安装的 iuap-apcom-cli Skill；
// APPROVE_INBOX_BIP_CLI / BIP_CLI_PATH 仅作为本地开发、调试和测试覆盖入口。

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TIMEOUT_MS = 120_000;
const capabilityCache = new Map();
const MANAGED_RUNTIME_MODE = "managed-yonwork";
const APPROVE_INBOX_SKILL_DIR_NAMES = ["iuap-apcom-myapproval", "approve-inbox", "iuap-apcom-approveinbox"];

export const REQUIRED_BIP_CLI_COMMANDS = Object.freeze([
  "whoami",
  "workflow inboxtask list-inbox",
  "workflow inboxtask get-document",
  "workflow inboxtask list-action",
  "workflow inboxtask approve-iform",
  "workflow inboxtask reject-iform",
  "workflow inboxtask approve-patch",
  "workflow inboxtask get-intelligent-result",
  "workflow task batch-approve",
  "workflow task batch-reject",
  "auth permission apply",
]);

function profileSiblingCliFromApproveInboxPath(inputPath) {
  if (!inputPath) return null;
  const normalized = resolve(String(inputPath));
  for (const skillDirName of APPROVE_INBOX_SKILL_DIR_NAMES) {
    const marker = `${sep}skills${sep}${skillDirName}`;
    const index = normalized.indexOf(marker);
    if (index >= 0) {
      return join(normalized.slice(0, index), "skills", "iuap-apcom-cli", "scripts", "bip-cli.js");
    }
  }
  return null;
}

function resolveManagedProfileCliPath(options, env, exists) {
  const candidates = [
    options.profileDir
      ? join(resolve(options.profileDir), "userData", "runtime", "openclaw", "skills", "iuap-apcom-cli", "scripts", "bip-cli.js")
      : null,
    env.APPROVE_INBOX_PROFILE_DIR
      ? join(resolve(env.APPROVE_INBOX_PROFILE_DIR), "userData", "runtime", "openclaw", "skills", "iuap-apcom-cli", "scripts", "bip-cli.js")
      : null,
    profileSiblingCliFromApproveInboxPath(options.skillDir),
    profileSiblingCliFromApproveInboxPath(env.APPROVE_INBOX_SKILL_DIR),
    profileSiblingCliFromApproveInboxPath(options.argvPath || process.argv[1]),
    profileSiblingCliFromApproveInboxPath(__dirname),
    // dataDir can point at a migrated scope or legacy root, so it is only a compatibility fallback.
    profileSiblingCliFromApproveInboxPath(options.dataDir),
    profileSiblingCliFromApproveInboxPath(env.APPROVE_INBOX_DATA),
  ].filter(Boolean);
  const unique = [...new Set(candidates)];
  return unique.find((candidate) => exists(candidate)) || unique[0] || null;
}

function normalizeCommandPath(commandPath = []) {
  if (Array.isArray(commandPath)) return commandPath.map(String).filter(Boolean);
  return String(commandPath).split(/\s+/).filter(Boolean);
}

function isLocalCliRejectionText(value) {
  return /(?:^|\n)error:\s*(?:unknown option|unknown command|too many arguments|required option|missing required argument)|依赖能力不兼容|未找到 .*iuap-apcom-cli|CLI 路径必须是绝对路径|iuap-apcom-cli 启动失败/i.test(String(value || ""));
}

function markRemoteRequestNotStarted(error) {
  if (error && typeof error === "object") error.remoteRequestStarted = false;
  return error;
}

export function resolveApproveInboxBipCliPath(options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  const exists = options.existsSync || existsSync;
  const runtimeMode = options.runtimeMode
    || env.APPROVE_INBOX_RUNTIME_MODE
    || (env.APPROVE_INBOX_AUTH_MODE === "local-dev" ? "local-dev" : MANAGED_RUNTIME_MODE);
  const cliPath = options.cliPath || (runtimeMode === MANAGED_RUNTIME_MODE
    ? resolveManagedProfileCliPath(options, env, exists)
    : (
        env.APPROVE_INBOX_BIP_CLI
        || env.BIP_CLI_PATH
        || resolveBipCliPath({ scriptDir: __dirname, env, exists })
      ));
  if (cliPath && !isAbsolute(cliPath)) {
    throw new Error(`iuap-apcom-cli CLI 路径必须是绝对路径：${cliPath}`);
  }
  if (!cliPath || !exists(cliPath)) {
    const context = runtimeMode === MANAGED_RUNTIME_MODE ? "当前 YonWork Profile sibling" : "本地开发";
    throw new Error(`未找到 ${context} iuap-apcom-cli 的 bip-cli.js: ${cliPath || "empty"}`);
  }
  return cliPath;
}

export function clearBipCliCapabilityCache(cliPath = null) {
  if (!cliPath) {
    capabilityCache.clear();
    return;
  }
  capabilityCache.delete(String(cliPath));
  if (isAbsolute(String(cliPath))) capabilityCache.delete(resolve(String(cliPath)));
}

async function runCliProcess(cliPath, args, options = {}, input) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = options.cwd ?? dirname(cliPath);
  if (!isAbsolute(cwd)) {
    throw new Error(`iuap-apcom-cli cwd 必须是绝对路径：${cwd}`);
  }
  const commandLabel = args.join(" ") || "bip-cli.js";
  let child;
  try {
    child = (options.spawn || spawn)(process.execPath, [cliPath, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
      env: { ...process.env, ...(options.env || {}) },
    });
  } catch (error) {
    throw markRemoteRequestNotStarted(
      new Error(`iuap-apcom-cli 启动失败：${error.message}；CLI 路径：${cliPath}`, { cause: error }),
    );
  }

  return await new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handler(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(reject, new Error(`iuap-apcom-cli timeout after ${timeoutMs}ms: ${commandLabel}`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      finish(reject, markRemoteRequestNotStarted(
        new Error(`iuap-apcom-cli 启动失败：${error.message}；CLI 路径：${cliPath}`, { cause: error }),
      ));
    });

    child.on("close", (code) => {
      const out = Buffer.concat(stdout).toString("utf-8").trim();
      const err = Buffer.concat(stderr).toString("utf-8").trim();
      if (code !== 0) {
        const error = new Error(err || out || `iuap-apcom-cli exited with code ${code}`);
        finish(reject, isLocalCliRejectionText(error.message)
          ? markRemoteRequestNotStarted(error)
          : error);
        return;
      }
      finish(resolve, { stdout: out, stderr: err });
    });

    if (input === undefined) child.stdin?.end();
    else child.stdin?.end(`${JSON.stringify(input || {})}\n`);
  });
}

function getCliFingerprint(cliPath, options = {}) {
  const stat = (options.statSync || statSync)(cliPath);
  return `${stat.size}:${stat.mtimeMs}`;
}

async function probeBipCliCapabilities(cliPath, options = {}) {
  let stdout;
  try {
    ({ stdout } = await runCliProcess(cliPath, ["--schema"], options));
  } catch (error) {
    throw new Error(`iuap-apcom-cli 能力探测失败：${error.message}；CLI 路径：${cliPath}`, { cause: error });
  }

  let schema;
  try {
    schema = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`iuap-apcom-cli 能力探测失败：--schema 返回非 JSON；CLI 路径：${cliPath}；输出：${stdout.slice(0, 200)}`, { cause: error });
  }
  if (!Array.isArray(schema)) {
    throw new Error(`iuap-apcom-cli 能力探测失败：--schema 返回值不是数组；CLI 路径：${cliPath}`);
  }
  return new Set(schema
    .map((item) => item?.path)
    .filter((path) => typeof path === "string" && path.trim())
    .map((path) => path.trim()));
}

export async function getBipCliCapabilities(options = {}) {
  const cliPath = resolveApproveInboxBipCliPath(options);
  const fingerprint = getCliFingerprint(cliPath, options);
  const cached = capabilityCache.get(cliPath);
  if (cached?.fingerprint === fingerprint) return await cached.promise;

  const promise = probeBipCliCapabilities(cliPath, options);
  capabilityCache.set(cliPath, { fingerprint, promise });
  try {
    return await promise;
  } catch (error) {
    if (capabilityCache.get(cliPath)?.promise === promise) capabilityCache.delete(cliPath);
    throw error;
  }
}

function incompatibleCliError(cliPath, missingCommands) {
  const commands = missingCommands.map((command) => `"${command}"`).join("、");
  return new Error(
    `iuap-apcom-cli 依赖能力不兼容：缺少命令 ${commands}；实际 CLI 路径：${cliPath}。`
    + "请同步升级同一 profile 下的 iuap-apcom-cli。",
  );
}

export async function assertBipCliCommandCapability(commandPath, options = {}) {
  const cliPath = resolveApproveInboxBipCliPath(options);
  const command = normalizeCommandPath(commandPath).join(" ");
  const capabilities = await getBipCliCapabilities({ ...options, cliPath });
  if (!capabilities.has(command)) throw incompatibleCliError(cliPath, [command]);
  return { cliPath, capabilities };
}

export async function assertRequiredBipCliCapabilities(options = {}) {
  const cliPath = resolveApproveInboxBipCliPath(options);
  const capabilities = await getBipCliCapabilities({ ...options, cliPath });
  const missingCommands = REQUIRED_BIP_CLI_COMMANDS.filter((command) => !capabilities.has(command));
  if (missingCommands.length > 0) throw incompatibleCliError(cliPath, missingCommands);
  return { cliPath, capabilities };
}

export async function runBipCli(commandPath, input = {}, options = {}) {
  if (options.runBipCli) return options.runBipCli(commandPath, input, options);
  let cliPath;
  try {
    ({ cliPath } = await assertBipCliCommandCapability(commandPath, options));
  } catch (error) {
    throw markRemoteRequestNotStarted(error);
  }
  const args = [
    ...normalizeCommandPath(commandPath),
    "--input",
    "-",
    "--format",
    "json",
  ];

  const { stdout } = await runCliProcess(cliPath, args, options, input);
  if (!stdout) return { success: true };
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`iuap-apcom-cli returned non-JSON: ${stdout.slice(0, 200)}`);
  }
}

export function isBipCliFailure(result) {
  return result?.success === false || result?.error || result?.errcode || result?.flag === 1 || result?.code >= 400;
}

// Compatibility surface for callers that already centralize all CLI lifecycle imports here.
// runtime-identity owns the policy; ESM live bindings keep this re-export cycle safe because
// identity verification only invokes runBipCli after both modules have initialized.
export {
  clearBipCliCaches,
  issueFromError,
  verifyManagedCliIdentity,
} from "./runtime-identity.mjs";
