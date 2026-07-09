#!/usr/bin/env node

import { closeSync, existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import http from "node:http";

import { resolveRuntimeContext } from "./runtime-context.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(SCRIPT_DIR, "..");
const DEFAULT_PORT = 3891;
const STATUS_TIMEOUT_MS = 800;
const START_WAIT_MS = 8000;

export function readPort(value, fallback = DEFAULT_PORT) {
  const port = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

function portFromUrl(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return readPort(url.port, null);
  } catch {
    return null;
  }
}

export function parseArgs(argv = []) {
  const options = {
    format: "json",
    port: readPort(process.env.APPROVE_INBOX_PORT || process.env.PORT, DEFAULT_PORT),
    serverUrl: process.env.APPROVE_INBOX_SERVER_URL || "",
    dataDir: process.env.APPROVE_INBOX_DATA || "",
  };
  let portExplicit = Boolean(process.env.APPROVE_INBOX_PORT || process.env.PORT);
  const rest = [...argv];
  while (rest.length > 0) {
    const arg = rest.shift();
    if (arg === "--format") {
      options.format = rest.shift() || "json";
    } else if (arg === "--port") {
      options.port = readPort(rest.shift(), options.port);
      portExplicit = true;
    } else if (arg?.startsWith("--port=")) {
      options.port = readPort(arg.slice("--port=".length), options.port);
      portExplicit = true;
    } else if (arg === "--server-url") {
      options.serverUrl = rest.shift() || "";
    } else if (arg === "--serverUrl") {
      options.serverUrl = rest.shift() || "";
    } else if (arg === "--data") {
      options.dataDir = rest.shift() || "";
    } else if (arg === "--data-dir") {
      options.dataDir = rest.shift() || "";
    } else if (arg === "--dataDir") {
      options.dataDir = rest.shift() || "";
    } else if (arg === "--skill-dir") {
      options.skillDir = rest.shift() || "";
    } else if (arg === "--skillDir") {
      options.skillDir = rest.shift() || "";
    } else if (arg === "--refresh-url") {
      options.refreshUrl = rest.shift() || "";
    } else if (arg === "--refreshUrl") {
      options.refreshUrl = rest.shift() || "";
    } else if (arg === "--cockpit-data-url") {
      options.cockpitDataUrl = rest.shift() || "";
    } else if (arg === "--cockpitDataUrl") {
      options.cockpitDataUrl = rest.shift() || "";
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!portExplicit) {
    options.port = portFromUrl(options.refreshUrl) || portFromUrl(options.cockpitDataUrl) || options.port;
  }
  return options;
}

export function pidFilePath(dataDir, port = DEFAULT_PORT) {
  return join(dataDir, port === DEFAULT_PORT ? "web-server.pid" : `web-server-${port}.pid`);
}

export function serviceUrls(serverUrl) {
  const base = String(serverUrl || `http://localhost:${DEFAULT_PORT}`).replace(/\/$/, "");
  return {
    serverUrl: base,
    widgetUrl: `${base}/widget/`,
    centerUrl: `${base}/`,
    centerEmbedUrl: `${base}/?embed=cockpit-drawer`,
    refreshUrl: `${base}/api/widget/refresh`,
    cockpitDataUrl: `${base}/api/widget/cockpit`,
    syncStatusUrl: `${base}/api/sync-status`,
  };
}

function requestJson({ port, path = "/api/sync-status", timeoutMs = STATUS_TIMEOUT_MS }) {
  return new Promise((resolvePromise) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method: "GET",
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let body = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = null;
        }
        resolvePromise({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body, text });
      });
    });
    req.on("timeout", () => req.destroy(new Error("request_timeout")));
    req.on("error", (error) => resolvePromise({ ok: false, error: error.message, code: error.code }));
    req.end();
  });
}

export async function getServiceStatus({ port, serverUrl }) {
  const api = await requestJson({ port });
  return {
    running: api.ok,
    port,
    ...serviceUrls(serverUrl || `http://localhost:${port}`),
    apiStatus: api.ok ? api.body : null,
    error: api.ok ? null : api.error || api.text || `HTTP ${api.status || "unavailable"}`,
  };
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitUntilStarted({ port, serverUrl, timeoutMs = START_WAIT_MS }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getServiceStatus({ port, serverUrl });
    if (status.running) return status;
    await sleep(250);
  }
  return getServiceStatus({ port, serverUrl });
}

function buildPidRecord({ pid, port, skillDir = SKILL_DIR, serverPath, startedAt = new Date().toISOString() }) {
  return {
    pid,
    port,
    skillDir: resolve(skillDir),
    serverPath: resolve(serverPath || join(skillDir, "web", "server.mjs")),
    startedAt,
  };
}

function startServerProcess({ ctx, port }) {
  const serverPath = join(ctx.skillDir, "web", "server.mjs");
  if (!existsSync(serverPath)) {
    throw new Error(`Web server entry not found: ${serverPath}`);
  }
  mkdirSync(ctx.dataDir, { recursive: true });
  const logDir = join(ctx.dataDir, "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, "web-server.log");
  const logFd = openSync(logPath, "a");
  const child = spawn(process.execPath, [serverPath], {
    cwd: ctx.skillDir,
    env: {
      ...process.env,
      PORT: String(port),
      APPROVE_INBOX_PORT: String(port),
      APPROVE_INBOX_DATA: ctx.dataDir,
      APPROVE_INBOX_SKILL_DIR: ctx.skillDir,
    },
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  closeSync(logFd);
  child.unref();
  writeFileSync(pidFilePath(ctx.dataDir, port), JSON.stringify(buildPidRecord({
    pid: child.pid,
    port,
    skillDir: ctx.skillDir,
    serverPath,
  }), null, 2));
  return { pid: child.pid, logPath };
}

export async function ensureService(options = {}) {
  const port = readPort(options.port || process.env.APPROVE_INBOX_PORT || process.env.PORT, DEFAULT_PORT);
  const ctx = resolveRuntimeContext({
    port,
    serverUrl: options.serverUrl,
    dataDir: options.dataDir,
    skillDir: options.skillDir || SKILL_DIR,
  });
  const before = await getServiceStatus({ port, serverUrl: ctx.serverUrl });
  if (before.running) {
    return {
      success: true,
      alreadyRunning: true,
      started: false,
      skillId: ctx.skillId,
      skillDir: ctx.skillDir,
      dataDir: ctx.dataDir,
      status: before,
      ...serviceUrls(ctx.serverUrl),
    };
  }
  const started = startServerProcess({ ctx, port });
  const after = await waitUntilStarted({ port, serverUrl: ctx.serverUrl });
  return {
    success: after.running,
    alreadyRunning: false,
    started: after.running,
    skillId: ctx.skillId,
    skillDir: ctx.skillDir,
    dataDir: ctx.dataDir,
    pid: started.pid,
    logPath: started.logPath,
    status: after,
    message: after.running ? "service_ready" : after.error,
    ...serviceUrls(ctx.serverUrl),
  };
}

function printHelp() {
  console.log(`Usage: node <skill-dir>/scripts/ensure-service.mjs [--port 3891] [--data <dir>] [--server-url <url>] [--format json]`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    ensureService(options).then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (!result.success) process.exitCode = 1;
    }).catch((error) => {
      console.error(JSON.stringify({ success: false, error: error.message || String(error) }, null, 2));
      process.exitCode = 1;
    });
  }
}
