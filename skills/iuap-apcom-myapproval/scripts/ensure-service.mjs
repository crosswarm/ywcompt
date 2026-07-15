#!/usr/bin/env node

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";

import { resolveRuntimeContext } from "./runtime-context.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(SCRIPT_DIR, "..");
const DEFAULT_PORT = 3891;
const SERVICE_PROTOCOL_VERSION = 5;
const STATUS_TIMEOUT_MS = 800;
const CLI_HEALTH_TIMEOUT_MS = 20_000;
const START_WAIT_MS = 30_000;
const SHUTDOWN_WAIT_MS = 5000;
const MANAGED_AUTH_ENV = "YONCLAW_REQ_PROXY_BASE_URL";
const BLOCKED_CHILD_AUTH_ENV = Object.freeze([
  "APPROVE_INBOX_SKIP_CLI_AUTH_CHECK",
  "APPROVE_INBOX_PROXY",
  "APPROVE_INBOX_BIP_CLI",
  "BIP_CLI_PATH",
  "IUAP_APCOM_CLI_DIR",
  "BIP_CLI_SETTINGS",
  "BIP_PLATFORM_VERSION",
  "BROWSER_RELAY_PROXY_BASE_URL",
  "BROWSER_RELAY_PROXY_SESSION_ID",
  "EDGE_HTTP_PROXY_URL",
  "YONYOU_BRIDGE_TOKEN",
  "YONCODE_VER",
]);
const MANAGED_CHILD_ENV_ALLOWLIST = Object.freeze([
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  MANAGED_AUTH_ENV,
  "YONCLAW_PYTHON_BIN",
  "YONCLAW_MANAGED_PYTHON",
  "OPENCLAW_PINNED_WRITE_PYTHON",
]);

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function normalizedProxyBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function identityPayload(value = {}) {
  if (!value || typeof value !== "object") return {};
  return value.serviceIdentity || value.identity || value;
}

function proxyContextFingerprint(value = {}) {
  const identity = identityPayload(value);
  return String(
    identity.proxyContext?.fingerprint
      || identity.proxyContextFingerprint
      || "",
  );
}

export function buildExpectedServiceIdentity(ctx = {}, env = process.env) {
  const proxyBaseUrl = normalizedProxyBaseUrl(env?.[MANAGED_AUTH_ENV]);
  const authMode = proxyBaseUrl ? "managed-yonwork" : "unavailable";
  const profileBasis = resolve(ctx.profileDir || ctx.skillDir || SKILL_DIR);
  const profileKey = sha256(`profile\0${profileBasis}`);
  const proxyFingerprint = proxyBaseUrl ? sha256(`yonclaw-proxy:${proxyBaseUrl}`) : "";
  const port = readPort(ctx.port || portFromUrl(ctx.serverUrl), DEFAULT_PORT);
  const serviceInstanceKey = sha256(JSON.stringify({
    skillId: ctx.skillId || "iuap-apcom-myapproval",
    profileKey,
    port,
    protocolVersion: SERVICE_PROTOCOL_VERSION,
    authMode,
    proxyContextFingerprint: proxyFingerprint,
  }));
  return {
    skillId: ctx.skillId || "iuap-apcom-myapproval",
    serviceInstanceKey,
    profileKey,
    port,
    protocolVersion: SERVICE_PROTOCOL_VERSION,
    authMode,
    proxyContext: { fingerprint: proxyFingerprint },
  };
}

export function serviceIdentityMatches(expected, actual) {
  const left = identityPayload(expected);
  const right = identityPayload(actual);
  return Boolean(
    left.skillId
      && left.skillId === right.skillId
      && left.serviceInstanceKey
      && left.serviceInstanceKey === right.serviceInstanceKey
      && left.profileKey
      && left.profileKey === right.profileKey
      && left.authMode
      && left.authMode === right.authMode
      && proxyContextFingerprint(left)
      && proxyContextFingerprint(left) === proxyContextFingerprint(right),
  );
}

export function isCliHealthReady(health, expectedIdentity) {
  const body = health?.body && typeof health.body === "object" ? health.body : health;
  if (!body || (body.ready !== true && body.cli?.ready !== true)) return false;
  const echoedIdentity = body.serviceIdentity || body.identity || body.cli?.serviceIdentity || body.cli?.identity;
  return !echoedIdentity || serviceIdentityMatches(expectedIdentity, echoedIdentity);
}

export function buildServerEnv(sourceEnv = process.env, ctx = {}, port = DEFAULT_PORT, instance = {}) {
  const env = {};
  for (const name of MANAGED_CHILD_ENV_ALLOWLIST) {
    if (sourceEnv?.[name] != null && sourceEnv[name] !== "") env[name] = sourceEnv[name];
  }
  for (const [name, value] of Object.entries(sourceEnv || {})) {
    if (/^LC_[A-Z_]+$/.test(name) && value != null && value !== "") env[name] = value;
  }
  for (const name of BLOCKED_CHILD_AUTH_ENV) delete env[name];
  const proxyBaseUrl = normalizedProxyBaseUrl(sourceEnv?.[MANAGED_AUTH_ENV]);
  if (proxyBaseUrl) env[MANAGED_AUTH_ENV] = proxyBaseUrl;
  else delete env[MANAGED_AUTH_ENV];
  const identity = buildExpectedServiceIdentity(ctx, env);
  const managedPython = [
    sourceEnv.YONCLAW_PYTHON_BIN,
    sourceEnv.YONCLAW_MANAGED_PYTHON,
    sourceEnv.OPENCLAW_PINNED_WRITE_PYTHON,
    ctx.profileDir && join(
      ctx.profileDir,
      "userData",
      "runtime",
      "python",
      "3.12",
      "venv",
      "bin",
      process.platform === "win32" ? "python.exe" : "python",
    ),
  ].find((candidate) => candidate && (candidate === sourceEnv.YONCLAW_PYTHON_BIN || existsSync(candidate)));
  const profileUserData = ctx.profileDir ? join(ctx.profileDir, "userData") : "";
  const openclawConfigDir = profileUserData ? join(profileUserData, "runtime", "openclaw") : "";
  return {
    ...env,
    PORT: String(port),
    APPROVE_INBOX_PORT: String(port),
    APPROVE_INBOX_DATA: ctx.dataDir,
    APPROVE_INBOX_SKILL_DIR: ctx.skillDir,
    APPROVE_INBOX_PROFILE_DIR: ctx.profileDir || "",
    APPROVE_INBOX_AUTH_MODE: identity.authMode,
    APPROVE_INBOX_PROFILE_KEY: identity.profileKey,
    APPROVE_INBOX_SERVICE_INSTANCE_KEY: identity.serviceInstanceKey,
    APPROVE_INBOX_PROXY_CONTEXT_FINGERPRINT: identity.proxyContext.fingerprint,
    APPROVE_INBOX_INSTANCE_ID: instance.instanceId || "",
    APPROVE_INBOX_INSTANCE_TOKEN: instance.instanceToken || "",
    ...(profileUserData ? { HOME: profileUserData } : {}),
    ...(openclawConfigDir ? {
      CLAWHUB_WORKDIR: profileUserData,
      OPENCLAW_CONFIG_DIR: openclawConfigDir,
      OPENCLAW_CONFIG_PATH: join(openclawConfigDir, "openclaw.runtime.json"),
      OPENCLAW_EMBEDDED_IN: "YonWork",
    } : {}),
    ...(managedPython ? { YONCLAW_PYTHON_BIN: managedPython } : {}),
  };
}

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

export function serviceControlFilePath(port = DEFAULT_PORT) {
  return join(tmpdir(), `iuap-apcom-myapproval-${port}.control.json`);
}

function serviceLockFilePath(port = DEFAULT_PORT) {
  return join(tmpdir(), `iuap-apcom-myapproval-${port}.lock`);
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function acquireServiceLock(port) {
  const file = serviceLockFilePath(port);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(file, "wx", 0o600);
      writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
      return () => {
        try { closeSync(fd); } catch { /* already closed */ }
        try { if (existsSync(file)) unlinkSync(file); } catch { /* best-effort cleanup */ }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let holder = null;
      try { holder = JSON.parse(readFileSync(file, "utf8")); } catch { /* stale or malformed */ }
      if (processIsAlive(Number(holder?.pid))) return null;
      try { unlinkSync(file); } catch { return null; }
    }
  }
  return null;
}

function readServiceControl(port) {
  const file = serviceControlFilePath(port);
  if (!existsSync(file)) return null;
  try {
    const record = JSON.parse(readFileSync(file, "utf8"));
    return record && typeof record === "object" ? record : null;
  } catch {
    return null;
  }
}

function writeServiceControl(port, record) {
  const file = serviceControlFilePath(port);
  writeFileSync(file, JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
}

function removeServiceControl(port, instanceId = "") {
  const file = serviceControlFilePath(port);
  const record = readServiceControl(port);
  if (record && instanceId && record.instanceId !== instanceId) return;
  try { if (existsSync(file)) unlinkSync(file); } catch { /* best-effort cleanup */ }
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
    serviceIdentityUrl: `${base}/api/service-identity`,
    cliHealthUrl: `${base}/api/health/cli`,
  };
}

function requestJson({ method = "GET", port, path = "/api/sync-status", timeoutMs = STATUS_TIMEOUT_MS, body = null }) {
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
    if (payload) req.write(payload);
    req.end();
  });
}

export async function getServiceIdentity({ port, request = requestJson } = {}) {
  const api = await request({ port, path: "/api/service-identity", timeoutMs: STATUS_TIMEOUT_MS });
  const hasHttpResponse = Number.isInteger(api?.status);
  if (api?.ok && api.body && typeof api.body === "object") {
    return {
      reachable: true,
      vacant: false,
      identity: identityPayload(api.body),
      body: api.body,
      status: api.status,
    };
  }
  return {
    reachable: hasHttpResponse,
    vacant: !hasHttpResponse && api?.code === "ECONNREFUSED",
    identity: null,
    body: api?.body || null,
    status: api?.status || null,
    code: api?.code || null,
    error: api?.error || api?.text || `HTTP ${api?.status || "unavailable"}`,
  };
}

export async function getCliHealth({ port, expectedIdentity, request = requestJson } = {}) {
  const api = await request({ port, path: "/api/health/cli", timeoutMs: CLI_HEALTH_TIMEOUT_MS });
  return {
    reachable: Number.isInteger(api?.status),
    ready: Boolean(api?.ok && isCliHealthReady(api.body, expectedIdentity)),
    body: api?.body || null,
    status: api?.status || null,
    code: api?.code || null,
    error: api?.ok ? null : api?.error || api?.text || `HTTP ${api?.status || "unavailable"}`,
  };
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

export async function waitUntilReady({
  port,
  expectedIdentity,
  timeoutMs = START_WAIT_MS,
  startup = null,
  getIdentity = getServiceIdentity,
  getHealth = getCliHealth,
  sleepFn = sleep,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastIdentity = null;
  let lastHealth = null;
  while (Date.now() < deadline) {
    if (startup?.exitState?.settled) {
      return {
        ready: false,
        code: startup.exitState.error?.code || "STARTUP_EXITED",
        error: startup.exitState.error?.message || `service process exited with code ${startup.exitState.code}`,
      };
    }
    lastIdentity = await getIdentity({ port });
    if (lastIdentity.reachable && serviceIdentityMatches(expectedIdentity, lastIdentity.identity)) {
      lastHealth = await getHealth({ port, expectedIdentity });
      if (lastHealth.ready) {
        return {
          ready: true,
          identity: lastIdentity.identity,
          health: lastHealth.body,
        };
      }
    }
    await sleepFn(250);
  }
  return {
    ready: false,
    code: lastIdentity?.reachable && !serviceIdentityMatches(expectedIdentity, lastIdentity.identity)
      ? "PORT_OCCUPIED_BY_UNKNOWN_PROCESS"
      : "CLI_HEALTH_NOT_READY",
    error: lastHealth?.error || lastIdentity?.error || "service CLI health did not become ready",
    identity: lastIdentity?.identity || null,
    health: lastHealth?.body || null,
  };
}

async function shutdownVerifiedService({
  port,
  observedService = null,
  timeoutMs = SHUTDOWN_WAIT_MS,
  request = requestJson,
  getIdentity = getServiceIdentity,
  sleepFn = sleep,
} = {}) {
  const instanceId = String(observedService?.body?.instanceId || "");
  const shutdownProtected = observedService?.body?.shutdownProtected === true;
  if (!instanceId) return { stopped: false, error: "verified service did not expose its instance id" };
  const control = readServiceControl(port);
  if (shutdownProtected && (!control || control.instanceId !== instanceId || !control.instanceToken)) {
    return { stopped: false, error: "verified service shutdown credential is unavailable or mismatched" };
  }
  const shutdown = await request({
    method: "POST",
    port,
    path: "/api/shutdown",
    body: {
      instanceId,
      instanceToken: shutdownProtected ? control.instanceToken : undefined,
    },
    timeoutMs: STATUS_TIMEOUT_MS,
  });
  if (!shutdown?.ok) {
    return {
      stopped: false,
      error: shutdown?.error || shutdown?.text || `HTTP ${shutdown?.status || "unavailable"}`,
    };
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = await getIdentity({ port });
    if (probe.vacant) {
      removeServiceControl(port, instanceId);
      return { stopped: true, method: "api-shutdown" };
    }
    await sleepFn(100);
  }
  return { stopped: false, error: "verified service did not release the port" };
}

function buildPidRecord({ pid, port, skillDir = SKILL_DIR, serverPath, identity, startedAt = new Date().toISOString() }) {
  return {
    pid,
    port,
    skillDir: resolve(skillDir),
    serverPath: resolve(serverPath || join(skillDir, "web", "server.mjs")),
    serviceInstanceKey: identity?.serviceInstanceKey || "",
    profileKey: identity?.profileKey || "",
    startedAt,
  };
}

function startServerProcess({ ctx, port, env = process.env }) {
  const serverPath = join(ctx.skillDir, "web", "server.mjs");
  if (!existsSync(serverPath)) {
    throw new Error(`Web server entry not found: ${serverPath}`);
  }
  mkdirSync(ctx.dataDir, { recursive: true });
  const logDir = join(ctx.dataDir, "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, "web-server.log");
  const logFd = openSync(logPath, "a");
  const identity = buildExpectedServiceIdentity(ctx, env);
  const instanceId = randomBytes(16).toString("hex");
  const instanceToken = randomBytes(32).toString("hex");
  const child = spawn(process.execPath, [serverPath], {
    cwd: ctx.skillDir,
    env: buildServerEnv(env, ctx, port, { instanceId, instanceToken }),
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  const exitState = { settled: false, code: null, signal: null, error: null };
  child.once("error", (error) => {
    exitState.settled = true;
    exitState.error = error;
  });
  child.once("exit", (code, signal) => {
    exitState.settled = true;
    exitState.code = code;
    exitState.signal = signal;
  });
  closeSync(logFd);
  child.unref();
  writeServiceControl(port, {
    skillId: identity.skillId,
    serviceInstanceKey: identity.serviceInstanceKey,
    instanceId,
    instanceToken,
    pid: child.pid,
  });
  writeFileSync(pidFilePath(ctx.dataDir, port), JSON.stringify(buildPidRecord({
    pid: child.pid,
    port,
    skillDir: ctx.skillDir,
    serverPath,
    identity,
  }), null, 2));
  const stop = async () => {
    if (exitState.settled) return { stopped: true, method: "already-exited" };
    try { child.kill("SIGTERM"); } catch { /* process may already be gone */ }
    const deadline = Date.now() + SHUTDOWN_WAIT_MS;
    while (!exitState.settled && Date.now() < deadline) await sleep(100);
    if (!exitState.settled) {
      try { child.kill("SIGKILL"); } catch { /* process may already be gone */ }
      const killDeadline = Date.now() + 1000;
      while (!exitState.settled && Date.now() < killDeadline) await sleep(50);
    }
    return {
      stopped: exitState.settled,
      method: exitState.settled ? "owned-child-signal" : "owned-child-stop-timeout",
    };
  };
  return { pid: child.pid, logPath, exitState, instanceId, stop };
}

async function rollbackStartedService({ started, port, ctx }) {
  if (typeof started?.stop !== "function") {
    return { stopped: false, error: "started process does not expose an owned-child stop handle" };
  }
  const stopped = await started.stop();
  if (!stopped?.stopped) return stopped;
  if (started.instanceId) removeServiceControl(port, started.instanceId);
  const pidFile = pidFilePath(ctx.dataDir, port);
  try {
    const record = existsSync(pidFile) ? JSON.parse(readFileSync(pidFile, "utf8")) : null;
    if (Number(record?.pid) === Number(started.pid)) unlinkSync(pidFile);
  } catch { /* best-effort cleanup after our child has exited */ }
  return stopped;
}

async function ensureServiceUnlocked(options = {}) {
  const env = options.env || process.env;
  const port = readPort(options.port || env.APPROVE_INBOX_PORT || env.PORT, DEFAULT_PORT);
  const ctx = options.runtimeContext || resolveRuntimeContext({
    env,
    port,
    serverUrl: options.serverUrl,
    dataDir: options.dataDir,
    skillDir: options.skillDir || SKILL_DIR,
  });
  const expectedIdentity = buildExpectedServiceIdentity(ctx, env);
  if (expectedIdentity.authMode !== "managed-yonwork" || !expectedIdentity.proxyContext.fingerprint) {
    return {
      success: false,
      code: "HOST_AUTH_CONTEXT_MISSING",
      message: "Missing YONCLAW_REQ_PROXY_BASE_URL; managed YonWork auth is required",
      started: false,
      skillId: ctx.skillId,
      skillDir: ctx.skillDir,
      dataDir: ctx.dataDir,
      expectedIdentity,
      ...serviceUrls(ctx.serverUrl),
    };
  }

  const deps = {
    getServiceIdentity,
    getCliHealth,
    shutdownService: shutdownVerifiedService,
    startServerProcess,
    rollbackStartedService,
    waitUntilReady,
    ...(options.deps || {}),
  };
  const before = await deps.getServiceIdentity({ port, serverUrl: ctx.serverUrl });
  let replaced = false;
  let shutdown = null;

  if (before.reachable) {
    if (before.identity?.skillId !== ctx.skillId) {
      return {
        success: false,
        code: "PORT_OCCUPIED_BY_UNKNOWN_PROCESS",
        message: "Port is occupied by an unverified process; it was not stopped",
        started: false,
        skillId: ctx.skillId,
        expectedIdentity,
        observedIdentity: before.identity || null,
        ...serviceUrls(ctx.serverUrl),
      };
    }

    const health = await deps.getCliHealth({ port, expectedIdentity });
    if (serviceIdentityMatches(expectedIdentity, before.identity) && health.ready) {
      return {
        success: true,
        alreadyRunning: true,
        started: false,
        ready: true,
        skillId: ctx.skillId,
        skillDir: ctx.skillDir,
        dataDir: ctx.dataDir,
        identity: before.identity,
        health: health.body || null,
        ...serviceUrls(ctx.serverUrl),
      };
    }

    shutdown = await deps.shutdownService({
      port,
      expectedIdentity,
      observedIdentity: before.identity,
      observedService: before,
    });
    if (!shutdown?.stopped) {
      return {
        success: false,
        code: "SERVICE_HANDOFF_FAILED",
        message: shutdown?.error || "Verified approve-inbox service could not be stopped",
        started: false,
        skillId: ctx.skillId,
        expectedIdentity,
        observedIdentity: before.identity,
        shutdown,
        ...serviceUrls(ctx.serverUrl),
      };
    }
    replaced = true;
  } else if (!before.vacant) {
    return {
      success: false,
      code: "PORT_OCCUPIED_BY_UNKNOWN_PROCESS",
      message: before.error || "Port state could not be verified; no process was stopped",
      started: false,
      skillId: ctx.skillId,
      expectedIdentity,
      ...serviceUrls(ctx.serverUrl),
    };
  }

  const started = deps.startServerProcess({ ctx, port, env });
  const after = await deps.waitUntilReady({
    port,
    serverUrl: ctx.serverUrl,
    expectedIdentity,
    startup: started,
  });
  const success = after?.ready === true;
  const rollback = success
    ? null
    : await deps.rollbackStartedService({ started, port, ctx });
  return {
    success,
    alreadyRunning: false,
    replaced,
    started: success,
    ready: success,
    skillId: ctx.skillId,
    skillDir: ctx.skillDir,
    dataDir: ctx.dataDir,
    pid: started.pid,
    logPath: started.logPath,
    identity: success ? after.identity || expectedIdentity : null,
    expectedIdentity,
    health: after?.health || null,
    status: after,
    shutdown,
    rollback,
    code: success ? undefined : after?.code || "SERVICE_NOT_READY",
    message: success ? "service_ready" : after?.error || "service_not_ready",
    ...serviceUrls(ctx.serverUrl),
  };
}

export async function ensureService(options = {}) {
  const env = options.env || process.env;
  const port = readPort(options.port || env.APPROVE_INBOX_PORT || env.PORT, DEFAULT_PORT);
  const releaseLock = acquireServiceLock(port);
  if (!releaseLock) {
    return {
      success: false,
      code: "SERVICE_START_LOCKED",
      message: "Another approve-inbox Profile is starting or handing off this port",
      started: false,
      ...serviceUrls(options.serverUrl || `http://localhost:${port}`),
    };
  }
  try {
    return await ensureServiceUnlocked(options);
  } finally {
    releaseLock();
  }
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
