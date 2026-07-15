import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveBipCliPath } from "./browser-auth.mjs";

// 模块名沿用历史实现术语。正式运行依赖已安装的 iuap-apcom-cli Skill；
// APPROVE_INBOX_BIP_CLI / BIP_CLI_PATH 仅作为本地开发、调试和测试覆盖入口。

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TIMEOUT_MS = 120_000;
const capabilityCache = new Map();

export const REQUIRED_BIP_CLI_COMMANDS = Object.freeze([
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

function normalizeCommandPath(commandPath = []) {
  if (Array.isArray(commandPath)) return commandPath.map(String).filter(Boolean);
  return String(commandPath).split(/\s+/).filter(Boolean);
}

export function resolveApproveInboxBipCliPath(options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  const exists = options.existsSync || existsSync;
  const cliPath = options.cliPath
    || env.APPROVE_INBOX_BIP_CLI
    || env.BIP_CLI_PATH
    || resolveBipCliPath({ scriptDir: __dirname, env, exists });
  if (cliPath && !isAbsolute(cliPath)) {
    throw new Error(`iuap-apcom-cli CLI 路径必须是绝对路径：${cliPath}`);
  }
  if (!cliPath || !exists(cliPath)) {
    throw new Error(`未找到 iuap-apcom-cli 的 bip-cli.js: ${cliPath || "empty"}`);
  }
  return cliPath;
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
    throw new Error(`iuap-apcom-cli 启动失败：${error.message}；CLI 路径：${cliPath}`, { cause: error });
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
      finish(reject, new Error(`iuap-apcom-cli 启动失败：${error.message}；CLI 路径：${cliPath}`, { cause: error }));
    });

    child.on("close", (code) => {
      const out = Buffer.concat(stdout).toString("utf-8").trim();
      const err = Buffer.concat(stderr).toString("utf-8").trim();
      if (code !== 0) {
        finish(reject, new Error(err || out || `iuap-apcom-cli exited with code ${code}`));
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
  const { cliPath } = await assertBipCliCommandCapability(commandPath, options);
  const args = [
    ...normalizeCommandPath(commandPath),
    "--input",
    "-",
    "--format",
    "json",
  ];
  if (options.dangerous) args.push("--yes");

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
