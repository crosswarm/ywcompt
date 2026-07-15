import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveBipCliPath } from "./browser-auth.mjs";

// 模块名沿用历史实现术语。正式运行依赖已安装的 iuap-apcom-cli Skill；
// APPROVE_INBOX_BIP_CLI / BIP_CLI_PATH 仅作为本地开发、调试和测试覆盖入口。

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TIMEOUT_MS = 120_000;

function normalizeCommandPath(commandPath = []) {
  if (Array.isArray(commandPath)) return commandPath.map(String).filter(Boolean);
  return String(commandPath).split(/\s+/).filter(Boolean);
}

export function resolveApproveInboxBipCliPath(options = {}) {
  const cliPath = options.cliPath || process.env.APPROVE_INBOX_BIP_CLI || process.env.BIP_CLI_PATH || resolveBipCliPath(__dirname);
  const exists = options.existsSync || existsSync;
  if (!cliPath || !exists(cliPath)) {
    throw new Error(`未找到 iuap-apcom-cli 的 bip-cli.js: ${cliPath || "empty"}`);
  }
  return cliPath;
}

export async function runBipCli(commandPath, input = {}, options = {}) {
  if (options.runBipCli) return options.runBipCli(commandPath, input, options);
  const cliPath = resolveApproveInboxBipCliPath(options);
  const args = [
    ...normalizeCommandPath(commandPath),
    "--input",
    "-",
    "--format",
    "json",
  ];
  if (options.dangerous) args.push("--yes");

  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const child = (options.spawn || spawn)(process.execPath, [cliPath, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...(options.env || {}) },
  });

  const stdout = [];
  const stderr = [];
  child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  child.stdin?.end(`${JSON.stringify(input || {})}\n`);

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`iuap-apcom-cli timeout after ${timeoutMs}ms: ${normalizeCommandPath(commandPath).join(" ")}`));
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString("utf-8").trim();
      const err = Buffer.concat(stderr).toString("utf-8").trim();
      if (code !== 0) {
        reject(new Error(err || out || `iuap-apcom-cli exited with code ${code}`));
        return;
      }
      if (!out) {
        resolve({ success: true });
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error(`iuap-apcom-cli returned non-JSON: ${out.slice(0, 200)}`));
      }
    });
  });
}

export function isBipCliFailure(result) {
  return result?.success === false || result?.error || result?.errcode || result?.flag === 1 || result?.code >= 400;
}
