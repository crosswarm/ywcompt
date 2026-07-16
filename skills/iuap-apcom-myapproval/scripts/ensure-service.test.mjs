import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildExpectedServiceIdentity,
  buildServerEnv,
  ensureService,
  getCliHealth,
  getServiceIdentity,
  isCliHealthReady,
  parseArgs,
  pidFilePath,
  readPort,
  serviceIdentityMatches,
  serviceUrls,
} from "./ensure-service.mjs";
import { buildRuntimeIdentity } from "./runtime-identity.mjs";

const SKILL_DIR = "/Users/test/Library/Application Support/YonWork/profiles/profile-a/userData/runtime/openclaw/skills/iuap-apcom-myapproval";
const DATA_DIR = `${SKILL_DIR}/data`;
const MANAGED_ENV = {
  PATH: "/usr/bin:/bin",
  HOME: "/Users/test",
  YONCLAW_REQ_PROXY_BASE_URL: "http://127.0.0.1:49001/",
  YONCLAW_PYTHON_BIN: "/managed/python3.12",
};

function runtimeContext(overrides = {}) {
  return {
    skillId: "iuap-apcom-myapproval",
    skillDir: SKILL_DIR,
    dataDir: DATA_DIR,
    profileDir: "/Users/test/Library/Application Support/YonWork/profiles/profile-a",
    serverUrl: "http://localhost:3891",
    ...overrides,
  };
}

function matchingIdentity(overrides = {}) {
  return {
    ...buildExpectedServiceIdentity(runtimeContext(), MANAGED_ENV),
    ...overrides,
  };
}

describe("ensure-service readPort()", () => {
  it("accepts valid ports and falls back for invalid values", () => {
    assert.equal(readPort("3901"), 3901);
    assert.equal(readPort("0"), 3891);
    assert.equal(readPort("70000"), 3891);
    assert.equal(readPort("bad", 4567), 4567);
  });
});

describe("ensure-service parseArgs()", () => {
  it("parses port, data dir, server url, and format", () => {
    assert.deepEqual(parseArgs([
      "--port",
      "3902",
      "--data",
      "/tmp/approve-data",
      "--server-url",
      "http://127.0.0.1:3902/",
      "--format",
      "json",
    ]), {
      format: "json",
      port: 3902,
      serverUrl: "http://127.0.0.1:3902/",
      dataDir: "/tmp/approve-data",
    });
  });

  it("rejects unknown arguments", () => {
    assert.throws(() => parseArgs(["--unknown"]), /Unknown argument/);
  });

  it("accepts host RPC style URL arguments and infers the service port", () => {
    assert.deepEqual(parseArgs([
      "--refresh-url",
      "http://localhost:3903/api/widget/refresh",
      "--cockpit-data-url",
      "http://localhost:3903/api/widget/cockpit",
      "--data-dir",
      "/tmp/approve-data",
      "--skill-dir",
      "/tmp/skill",
    ]), {
      format: "json",
      port: 3903,
      serverUrl: "",
      dataDir: "/tmp/approve-data",
      skillDir: "/tmp/skill",
      refreshUrl: "http://localhost:3903/api/widget/refresh",
      cockpitDataUrl: "http://localhost:3903/api/widget/cockpit",
    });
  });
});

describe("ensure-service URL contract", () => {
  it("returns all cockpit-facing URLs from one server URL", () => {
    assert.deepEqual(serviceUrls("http://localhost:3891/"), {
      serverUrl: "http://localhost:3891",
      widgetUrl: "http://localhost:3891/widget/",
      centerUrl: "http://localhost:3891/",
      centerEmbedUrl: "http://localhost:3891/?embed=cockpit-drawer",
      refreshUrl: "http://localhost:3891/api/widget/refresh",
      cockpitDataUrl: "http://localhost:3891/api/widget/cockpit",
      syncStatusUrl: "http://localhost:3891/api/sync-status",
      serviceIdentityUrl: "http://localhost:3891/api/service-identity",
      cliHealthUrl: "http://localhost:3891/api/health/cli",
    });
  });

  it("uses the same pid file naming as web-server-control", () => {
    assert.equal(pidFilePath("/tmp/data", 3891), "/tmp/data/web-server.pid");
    assert.equal(pidFilePath("/tmp/data", 3901), "/tmp/data/web-server-3901.pid");
  });
});

describe("ensure-service identity contract", () => {
  it("builds stable fingerprints from profile and normalized managed proxy context", () => {
    const first = buildExpectedServiceIdentity(runtimeContext(), MANAGED_ENV);
    const second = buildExpectedServiceIdentity(runtimeContext(), {
      ...MANAGED_ENV,
      YONCLAW_REQ_PROXY_BASE_URL: " http://127.0.0.1:49001 ",
    });

    assert.equal(first.skillId, "iuap-apcom-myapproval");
    assert.equal(first.authMode, "managed-yonwork");
    assert.equal(first.profileKey, buildRuntimeIdentity({
      profileDir: runtimeContext().profileDir,
      userId: "contract-user",
      tenantId: "contract-tenant",
    }).profileKey);
    assert.equal(first.profileKey, second.profileKey);
    assert.equal(first.proxyContext.fingerprint, second.proxyContext.fingerprint);
    assert.equal(first.serviceInstanceKey, second.serviceInstanceKey);
    assert.match(first.profileKey, /^[a-f0-9]{64}$/);
    assert.match(first.proxyContext.fingerprint, /^[a-f0-9]{64}$/);
    assert.match(first.serviceInstanceKey, /^[a-f0-9]{64}$/);
    assert.equal(first.port, 3891);
    assert.equal(first.protocolVersion, 6);
    assert.notEqual(
      first.serviceInstanceKey,
      buildExpectedServiceIdentity(runtimeContext({ serverUrl: "http://localhost:3901" }), MANAGED_ENV).serviceInstanceKey,
    );
    assert.doesNotMatch(JSON.stringify(first), /profile-a|49001/);
  });

  it("requires every identity dimension to match", () => {
    const expected = matchingIdentity();
    assert.equal(serviceIdentityMatches(expected, expected), true);
    assert.equal(serviceIdentityMatches(expected, { ...expected, serviceInstanceKey: "other" }), false);
    assert.equal(serviceIdentityMatches(expected, { ...expected, profileKey: "other" }), false);
    assert.equal(serviceIdentityMatches(expected, { ...expected, authMode: "local" }), false);
    assert.equal(serviceIdentityMatches(expected, {
      ...expected,
      proxyContext: { fingerprint: "other" },
    }), false);
    assert.equal(serviceIdentityMatches(expected, {
      serviceIdentity: {
        ...expected,
        proxyContextFingerprint: expected.proxyContext.fingerprint,
        proxyContext: undefined,
      },
    }), true);
  });

  it("accepts CLI health only when explicitly ready and any echoed identity still matches", () => {
    const expected = matchingIdentity();
    assert.equal(isCliHealthReady({ ready: true }, expected), true);
    assert.equal(isCliHealthReady({ success: true }, expected), false);
    assert.equal(isCliHealthReady({ ready: false }, expected), false);
    assert.equal(isCliHealthReady({
      ready: true,
      serviceIdentity: { ...expected, profileKey: "old-profile" },
    }, expected), false);
  });

  it("probes the dedicated service identity and CLI health endpoints", async () => {
    const expected = matchingIdentity();
    const calls = [];
    const request = async (options) => {
      calls.push(options);
      if (options.path === "/api/service-identity") {
        return { ok: true, status: 200, body: { serviceIdentity: expected } };
      }
      return { ok: true, status: 200, body: { ready: true, serviceIdentity: expected } };
    };

    const identity = await getServiceIdentity({ port: 3891, request });
    const health = await getCliHealth({ port: 3891, expectedIdentity: expected, request });

    assert.equal(identity.reachable, true);
    assert.deepEqual(identity.identity, expected);
    assert.equal(health.ready, true);
    assert.deepEqual(calls.map((call) => call.path), [
      "/api/service-identity",
      "/api/health/cli",
    ]);
    assert.ok(calls[1].timeoutMs >= 20_000, "real three-step CLI health probe needs a managed-runtime budget");
  });

  it("distinguishes a vacant port from a reachable process without the identity contract", async () => {
    const vacant = await getServiceIdentity({
      port: 3891,
      request: async () => ({ ok: false, code: "ECONNREFUSED", error: "connect refused" }),
    });
    const unknown = await getServiceIdentity({
      port: 3891,
      request: async () => ({ ok: false, status: 404, text: "not found" }),
    });

    assert.equal(vacant.vacant, true);
    assert.equal(vacant.reachable, false);
    assert.equal(unknown.vacant, false);
    assert.equal(unknown.reachable, true);
  });
});

describe("ensure-service managed child environment", () => {
  it("passes managed YonWork auth explicitly and removes competing/local credential routes", () => {
    const env = buildServerEnv({
      ...MANAGED_ENV,
      APPROVE_INBOX_SKIP_CLI_AUTH_CHECK: "1",
      APPROVE_INBOX_PROXY: "http://legacy-proxy.test",
      BIP_CLI_SETTINGS: "/tmp/global-settings.json",
      BIP_CLI_PATH: "/tmp/global-bip-cli.js",
      APPROVE_INBOX_BIP_CLI: "/tmp/debug-bip-cli.js",
      IUAP_APCOM_CLI_DIR: "/tmp/debug-cli-skill",
      BROWSER_RELAY_PROXY_BASE_URL: "http://relay.test",
      BROWSER_RELAY_PROXY_SESSION_ID: "session-secret",
      EDGE_HTTP_PROXY_URL: "http://edge.test",
      YONYOU_BRIDGE_TOKEN: "bridge-secret",
      BIP_PLATFORM_VERSION: "test",
      UNKNOWN_GLOBAL_AUTH_FILE: "/tmp/unknown-global-auth.json",
    }, runtimeContext(), 3891, {
      instanceId: "instance-id",
      instanceToken: "instance-token",
    });

    assert.equal(env.YONCLAW_REQ_PROXY_BASE_URL, "http://127.0.0.1:49001");
    assert.equal(env.APPROVE_INBOX_AUTH_MODE, "managed-yonwork");
    assert.equal(env.APPROVE_INBOX_DATA, DATA_DIR);
    assert.equal(env.APPROVE_INBOX_SKILL_DIR, SKILL_DIR);
    assert.equal(env.APPROVE_INBOX_PORT, "3891");
    assert.equal(env.APPROVE_INBOX_INSTANCE_ID, "instance-id");
    assert.equal(env.APPROVE_INBOX_INSTANCE_TOKEN, "instance-token");
    assert.equal(env.YONCLAW_PYTHON_BIN, "/managed/python3.12");
    assert.equal(env.PATH, MANAGED_ENV.PATH);
    assert.equal(env.HOME, `${runtimeContext().profileDir}/userData`);
    assert.equal(env.UNKNOWN_GLOBAL_AUTH_FILE, undefined);
    for (const name of [
      "APPROVE_INBOX_SKIP_CLI_AUTH_CHECK",
      "APPROVE_INBOX_PROXY",
      "BIP_CLI_SETTINGS",
      "BIP_CLI_PATH",
      "APPROVE_INBOX_BIP_CLI",
      "IUAP_APCOM_CLI_DIR",
      "BROWSER_RELAY_PROXY_BASE_URL",
      "BROWSER_RELAY_PROXY_SESSION_ID",
      "EDGE_HTTP_PROXY_URL",
      "YONYOU_BRIDGE_TOKEN",
      "BIP_PLATFORM_VERSION",
    ]) {
      assert.equal(env[name], undefined, `${name} must not reach the managed child`);
    }
  });
});

describe("ensureService fixed-port handoff", () => {
  it("reuses only a matching instance whose CLI health is ready", async () => {
    const expected = matchingIdentity();
    const calls = [];
    const result = await ensureService({
      port: 3891,
      skillDir: SKILL_DIR,
      dataDir: DATA_DIR,
      env: MANAGED_ENV,
      runtimeContext: runtimeContext(),
      deps: {
        getServiceIdentity: async () => ({ reachable: true, identity: expected }),
        getCliHealth: async () => ({ reachable: true, ready: true, body: { ready: true } }),
        shutdownService: async () => { calls.push("shutdown"); return { stopped: true }; },
        startServerProcess: () => { calls.push("start"); return { pid: 1 }; },
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.alreadyRunning, true);
    assert.equal(result.started, false);
    assert.deepEqual(calls, []);
  });

  it("hands off a verified old-profile instance of this skill before starting", async () => {
    const expected = matchingIdentity();
    const oldIdentity = {
      ...expected,
      profileKey: "old-profile-key",
      serviceInstanceKey: "old-instance-key",
    };
    const calls = [];
    let phase = "old";
    const result = await ensureService({
      port: 3891,
      skillDir: SKILL_DIR,
      dataDir: DATA_DIR,
      env: MANAGED_ENV,
      runtimeContext: runtimeContext(),
      deps: {
        getServiceIdentity: async () => phase === "old"
          ? { reachable: true, identity: oldIdentity }
          : { reachable: true, identity: expected },
        getCliHealth: async () => ({ reachable: true, ready: true, body: { ready: true } }),
        shutdownService: async () => {
          calls.push("shutdown");
          phase = "stopped";
          return { stopped: true };
        },
        startServerProcess: () => {
          calls.push("start");
          phase = "new";
          return { pid: 42, logPath: "/tmp/web-server.log" };
        },
        waitUntilReady: async () => ({
          ready: true,
          identity: expected,
          health: { ready: true },
        }),
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.replaced, true);
    assert.equal(result.started, true);
    assert.deepEqual(calls, ["shutdown", "start"]);
  });

  it("restarts a matching but unhealthy instance instead of reusing it", async () => {
    const expected = matchingIdentity();
    const calls = [];
    const result = await ensureService({
      port: 3891,
      skillDir: SKILL_DIR,
      dataDir: DATA_DIR,
      env: MANAGED_ENV,
      runtimeContext: runtimeContext(),
      deps: {
        getServiceIdentity: async () => ({ reachable: true, identity: expected }),
        getCliHealth: async () => ({ reachable: true, ready: false, body: { ready: false } }),
        shutdownService: async () => { calls.push("shutdown"); return { stopped: true }; },
        startServerProcess: () => { calls.push("start"); return { pid: 43 }; },
        waitUntilReady: async () => ({ ready: true, identity: expected, health: { ready: true } }),
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.replaced, true);
    assert.deepEqual(calls, ["shutdown", "start"]);
  });

  it("does not shut down or kill an unknown process occupying the port", async () => {
    const calls = [];
    const result = await ensureService({
      port: 3891,
      skillDir: SKILL_DIR,
      dataDir: DATA_DIR,
      env: MANAGED_ENV,
      runtimeContext: runtimeContext(),
      deps: {
        getServiceIdentity: async () => ({
          reachable: true,
          identity: { skillId: "another-service" },
        }),
        shutdownService: async () => { calls.push("shutdown"); return { stopped: true }; },
        startServerProcess: () => { calls.push("start"); return { pid: 1 }; },
      },
    });

    assert.equal(result.success, false);
    assert.equal(result.code, "PORT_OCCUPIED_BY_UNKNOWN_PROCESS");
    assert.deepEqual(calls, []);
  });

  it("fails before spawning when managed YonWork auth is absent", async () => {
    let started = false;
    const result = await ensureService({
      port: 3891,
      skillDir: SKILL_DIR,
      dataDir: DATA_DIR,
      env: { PATH: "/usr/bin" },
      runtimeContext: runtimeContext(),
      deps: {
        getServiceIdentity: async () => ({ reachable: false, vacant: true, code: "ECONNREFUSED" }),
        startServerProcess: () => { started = true; return { pid: 1 }; },
      },
    });

    assert.equal(result.success, false);
    assert.equal(result.code, "HOST_AUTH_CONTEXT_MISSING");
    assert.equal(started, false);
  });

  it("does not report success when startup loses an EADDRINUSE race", async () => {
    const calls = [];
    const result = await ensureService({
      port: 3891,
      skillDir: SKILL_DIR,
      dataDir: DATA_DIR,
      env: MANAGED_ENV,
      runtimeContext: runtimeContext(),
      deps: {
        getServiceIdentity: async () => ({ reachable: false, vacant: true, code: "ECONNREFUSED" }),
        startServerProcess: () => ({
          pid: 44,
          instanceId: "owned-startup-instance",
          stop: async () => { calls.push("rollback-owned-child"); return { stopped: true }; },
        }),
        waitUntilReady: async () => ({
          ready: false,
          code: "EADDRINUSE",
          error: "listen EADDRINUSE: address already in use :::3891",
        }),
      },
    });

    assert.equal(result.success, false);
    assert.equal(result.started, false);
    assert.equal(result.code, "EADDRINUSE");
    assert.equal(result.rollback.stopped, true);
    assert.deepEqual(calls, ["rollback-owned-child"]);
  });
});
