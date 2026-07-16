#!/usr/bin/env node

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import http from "node:http";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(SCRIPT_DIR, "..");
const DEFAULT_PORT = 3891;
const SHUTDOWN_TIMEOUT_MS = 1500;
const STOP_WAIT_MS = 5000;

export function readPort(value, fallback = DEFAULT_PORT) {
  const port = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

function defaultDataDir(env = process.env) {
  return env.APPROVE_INBOX_DATA || join(SKILL_DIR, "data");
}

export function parseArgs(argv = []) {
  const options = {
    command: "status",
    port: readPort(process.env.APPROVE_INBOX_PORT || process.env.PORT, DEFAULT_PORT),
    json: false,
  };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith("-")) {
    options.command = rest.shift();
  }
  while (rest.length > 0) {
    const arg = rest.shift();
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--port") {
      options.port = readPort(rest.shift(), options.port);
    } else if (arg?.startsWith("--port=")) {
      options.port = readPort(arg.slice("--port=".length), options.port);
    } else if (arg === "--help" || arg === "-h") {
      options.command = "help";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!["status", "start", "stop", "restart", "help"].includes(options.command)) {
    throw new Error(`Unknown command: ${options.command}`);
  }
  return options;
}

export function pidFilePath(dataDir, port = DEFAULT_PORT) {
  return join(dataDir, port === DEFAULT_PORT ? "web-server.pid" : `web-server-${port}.pid`);
}

export function buildPidRecord({ pid, port, skillDir = SKILL_DIR, serverPath, startedAt = new Date().toISOString() }) {
  return {
    pid,
    port,
    skillDir: resolve(skillDir),
    serverPath: resolve(serverPath || join(skillDir, "web", "server.mjs")),
    startedAt,
  };
}

export function parsePidFile(text) {
  try {
    const parsed = JSON.parse(text);
    const pid = Number.parseInt(String(parsed.pid || ""), 10);
    const port = readPort(parsed.port, DEFAULT_PORT);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return {
      pid,
      port,
      skillDir: parsed.skillDir ? resolve(String(parsed.skillDir)) : "",
      serverPath: parsed.serverPath ? resolve(String(parsed.serverPath)) : "",
      startedAt: parsed.startedAt || "",
    };
  } catch {
    return null;
  }
}

export function parsePidList(output) {
  return [...new Set(String(output || "")
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0))];
}

function slashPath(value) {
  return String(value || "")
    .replace(/^file:\/\//, "")
    .replace(/\\/g, "/")
    .replace(/^"|"$/g, "");
}

function comparablePath(value) {
  const slashed = slashPath(value);
  return /^[A-Za-z]:\//.test(slashed) ? slashed : slashPath(resolve(slashed));
}

function normalizeCommandText(value) {
  return slashPath(value).replace(/\s+/g, " ").trim();
}

export function isApproveInboxServerCommand(commandLine, {
  serverPath = join(SKILL_DIR, "web", "server.mjs"),
  skillDir = SKILL_DIR,
  pidRecord = null,
} = {}) {
  const command = normalizeCommandText(commandLine);
  if (!command) return false;

  const normalizedServerPath = comparablePath(serverPath);
  if (command.includes(normalizedServerPath)) return true;

  const recordServerPath = pidRecord?.serverPath ? comparablePath(pidRecord.serverPath) : "";
  if (recordServerPath && command.includes(recordServerPath)) return true;

  const recordSkillDir = pidRecord?.skillDir ? comparablePath(pidRecord.skillDir) : "";
  const normalizedSkillDir = comparablePath(skillDir);
  const trustedRelativeCwd = recordSkillDir && recordSkillDir === normalizedSkillDir;
  if (trustedRelativeCwd && /(?:^|\s)(?:\.\/)?web\/server\.mjs(?:\s|$)/.test(command)) {
    return true;
  }

  return false;
}

function execFileText(file, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    execFile(file, args, {
      timeout: options.timeout || 3000,
      windowsHide: true,
      maxBuffer: options.maxBuffer || 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolvePromise(String(stdout || ""));
    });
  });
}

async function getProcessCommandLine(pid, platform = process.platform) {
  if (platform === "win32") {
    const script = [
      "$p = Get-CimInstance Win32_Process -Filter \"ProcessId = " + Number(pid) + "\"",
      "if ($p) { $p.CommandLine }",
    ].join("; ");
    return (await execFileText("powershell.exe", ["-NoProfile", "-Command", script])).trim();
  }
  return (await execFileText("ps", ["-p", String(pid), "-o", "command="])).trim();
}

async function findListeningPids(port, platform = process.platform) {
  if (platform === "win32") {
    const script = [
      `Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen`,
      "Select-Object -ExpandProperty OwningProcess -Unique",
    ].join(" | ");
    return parsePidList(await execFileText("powershell.exe", ["-NoProfile", "-Command", script]));
  }
  return parsePidList(await execFileText("lsof", ["-nP", `-tiTCP:${Number(port)}`, "-sTCP:LISTEN"]));
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function requestJson({ method = "GET", port, path, body = null, timeoutMs = SHUTDOWN_TIMEOUT_MS }) {
  return new Promise((resolvePromise) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method,
      timeout: timeoutMs,
      headers: payload
        ? {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          }
        : {},
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        resolvePromise({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: json, text });
      });
    });
    req.on("timeout", () => req.destroy(new Error("request_timeout")));
    req.on("error", (error) => resolvePromise({ ok: false, error: error.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitUntilStopped(port, timeoutMs = STOP_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await requestJson({ port, path: "/api/service-identity", timeoutMs: 500 });
    if (!status.ok) return true;
    await sleep(250);
  }
  return false;
}

async function waitUntilStarted(port, timeoutMs = STOP_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await requestJson({ port, path: "/api/service-identity", timeoutMs: 500 });
    if (status.ok) return true;
    await sleep(250);
  }
  return false;
}

function readPidRecord(file) {
  if (!existsSync(file)) return null;
  return parsePidFile(readFileSync(file, "utf8"));
}

function removePidFile(file) {
  try {
    if (existsSync(file)) unlinkSync(file);
  } catch {
    // Best effort cleanup.
  }
}

async function stopVerifiedPid(pid, context) {
  let commandLine = "";
  try {
    commandLine = await getProcessCommandLine(pid);
  } catch (error) {
    return {
      stopped: false,
      method: "pid",
      pid,
      reason: `could not inspect process command line: ${error.message}`,
    };
  }
  if (!isApproveInboxServerCommand(commandLine, context)) {
    return {
      stopped: false,
      method: "pid",
      pid,
      reason: "process command line is not the approve-inbox WebServer",
      commandLine,
    };
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    return { stopped: false, method: "pid", pid, reason: error.message, commandLine };
  }

  const deadline = Date.now() + STOP_WAIT_MS;
  while (Date.now() < deadline) {
    if (!processExists(pid)) return { stopped: true, method: "pid", pid, commandLine };
    await sleep(250);
  }
  return { stopped: false, method: "pid", pid, reason: "process did not exit after SIGTERM", commandLine };
}

export async function getStatus({ port, dataDir }) {
  const pidFile = pidFilePath(dataDir, port);
  const api = await requestJson({ port, path: "/api/service-identity", timeoutMs: 800 });
  const pidRecord = readPidRecord(pidFile);
  return {
    running: api.ok,
    port,
    url: `http://127.0.0.1:${port}`,
    pidFile,
    pid: pidRecord?.pid || null,
    apiStatus: api.ok ? api.body : null,
    error: api.ok ? null : api.error || api.text || `HTTP ${api.status || "unavailable"}`,
  };
}

export async function startServer({ port, dataDir, skillDir = SKILL_DIR, env = process.env } = {}) {
  const status = await getStatus({ port, dataDir });
  if (status.running) {
    return { action: "start", started: false, alreadyRunning: true, status };
  }

  const serverPath = join(skillDir, "web", "server.mjs");
  const logDir = join(dataDir, "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, "web-server.log");
  const logFd = openSync(logPath, "a");
  const child = spawn(process.execPath, [serverPath], {
    cwd: skillDir,
    env: {
      ...env,
      PORT: String(port),
      APPROVE_INBOX_PORT: String(port),
      APPROVE_INBOX_DATA: dataDir,
    },
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  closeSync(logFd);
  child.unref();
  const pidFile = pidFilePath(dataDir, port);
  writeFileSync(pidFile, JSON.stringify(buildPidRecord({
    pid: child.pid,
    port,
    skillDir,
    serverPath,
  }), null, 2));
  const ready = await waitUntilStarted(port);
  return { action: "start", started: true, ready, pid: child.pid, pidFile, logPath, url: `http://127.0.0.1:${port}` };
}

export async function stopServer({ port, dataDir, skillDir = SKILL_DIR } = {}) {
  const pidFile = pidFilePath(dataDir, port);
  const serverPath = join(skillDir, "web", "server.mjs");
  const shutdown = await requestJson({ method: "POST", port, path: "/api/shutdown", body: {}, timeoutMs: SHUTDOWN_TIMEOUT_MS });
  if (shutdown.ok) {
    const stopped = await waitUntilStopped(port);
    if (stopped) {
      removePidFile(pidFile);
      return { action: "stop", stopped: true, method: "api-shutdown" };
    }
  }

  const pidRecord = readPidRecord(pidFile);
  if (pidRecord?.pid && processExists(pidRecord.pid)) {
    const result = await stopVerifiedPid(pidRecord.pid, { serverPath, skillDir, pidRecord });
    if (result.stopped) removePidFile(pidFile);
    return { action: "stop", ...result, shutdownError: shutdown.error || shutdown.text || null };
  }
  if (pidRecord?.pid && !processExists(pidRecord.pid)) {
    removePidFile(pidFile);
  }

  let pids = [];
  try {
    pids = await findListeningPids(port);
  } catch (error) {
    return {
      action: "stop",
      stopped: false,
      method: "port-fallback",
      reason: `could not inspect listening process: ${error.message}`,
      shutdownError: shutdown.error || shutdown.text || null,
    };
  }

  if (pids.length === 0) {
    return { action: "stop", stopped: false, alreadyStopped: true, method: "none" };
  }

  const results = [];
  for (const pid of pids) {
    results.push(await stopVerifiedPid(pid, { serverPath, skillDir }));
  }
  const stoppedCount = results.filter((result) => result.stopped).length;
  if (stoppedCount > 0) removePidFile(pidFile);
  return {
    action: "stop",
    stopped: stoppedCount > 0,
    method: "port-fallback",
    results,
    shutdownError: shutdown.error || shutdown.text || null,
  };
}

export async function restartServer(options) {
  const stop = await stopServer(options);
  if (stop.stopped || stop.alreadyStopped) {
    await sleep(500);
    const start = await startServer(options);
    return { action: "restart", stopped: stop, started: start };
  }
  return { action: "restart", stopped: stop, started: null };
}

function formatResult(result) {
  if (result.action === "start") {
    if (result.alreadyRunning) return `WebServer already running at ${result.status.url}`;
    return `WebServer started at ${result.url}\nPID: ${result.pid}\nLog: ${result.logPath}\nReady: ${result.ready ? "yes" : "not confirmed yet"}`;
  }
  if (result.action === "stop") {
    if (result.alreadyStopped) return "WebServer is not running.";
    if (result.stopped) return `WebServer stopped via ${result.method}.`;
    return `WebServer was not stopped: ${result.reason || JSON.stringify(result.results || result)}`;
  }
  if (result.action === "restart") {
    if (!result.started) return `WebServer was not restarted: ${result.stopped.reason || JSON.stringify(result.stopped)}`;
    return `${formatResult(result.stopped)}\n${formatResult(result.started)}`;
  }
  if (Object.hasOwn(result, "running")) {
    return result.running
      ? `WebServer running at ${result.url}${result.pid ? `\nPID file PID: ${result.pid}` : ""}`
      : `WebServer not reachable at ${result.url}${result.pid ? `\nPID file PID: ${result.pid}` : ""}\n${result.error || ""}`.trim();
  }
  return JSON.stringify(result, null, 2);
}

function printHelp() {
  console.log(`Usage: node <skill-dir>/scripts/web-server-control.mjs <command> [--port 3891] [--json]

Commands:
  status   Show whether the WebServer is reachable
  start    Start the WebServer in the background
  stop     Stop via /api/shutdown, then verified pid fallback
  restart  Stop then start
`);
}

function isMainModule(metaUrl) {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(metaUrl);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.command === "help") {
    printHelp();
    return { action: "help" };
  }
  const dataDir = defaultDataDir();
  mkdirSync(dataDir, { recursive: true });
  const commandOptions = { port: options.port, dataDir, skillDir: SKILL_DIR };
  let result;
  if (options.command === "status") result = await getStatus(commandOptions);
  if (options.command === "start") result = await startServer(commandOptions);
  if (options.command === "stop") result = await stopServer(commandOptions);
  if (options.command === "restart") result = await restartServer(commandOptions);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatResult(result));
  if (result?.stopped === false && !result.alreadyStopped) process.exitCode = 1;
  if (result?.action === "restart" && !result.started) process.exitCode = 1;
  return result;
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
}
