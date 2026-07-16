import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import {
  RuntimeIdentityError,
  buildRuntimeIdentity,
  identityMatchesState,
  issueFromError,
  normalizeWhoamiIdentity,
  scopeDataDir,
  verifyManagedCliIdentity,
} from "./runtime-identity.mjs";

const PROFILE_DIR = "/Users/test/Library/Application Support/YonWork/profiles/profile-current";
const CLI_PATH = `${PROFILE_DIR}/userData/runtime/openclaw/skills/iuap-apcom-cli/scripts/bip-cli.js`;

function managedEnv(overrides = {}) {
  return {
    YONCLAW_REQ_PROXY_BASE_URL: "http://127.0.0.1:3211",
    APPROVE_INBOX_SKILL_DIR: `${PROFILE_DIR}/userData/runtime/openclaw/skills/iuap-apcom-myapproval`,
    ...overrides,
  };
}

describe("runtime identity pure functions", () => {
  it("builds opaque stable profile/user/tenant keys and a scoped data path", () => {
    const identity = buildRuntimeIdentity({
      profileDir: PROFILE_DIR,
      userId: "user-secret",
      tenantId: "tenant-secret",
      environment: "c1",
    });

    assert.match(identity.profileKey, /^[a-f0-9]{64}$/);
    assert.match(identity.userKey, /^[a-f0-9]{64}$/);
    assert.match(identity.tenantKey, /^[a-f0-9]{64}$/);
    assert.match(identity.dataScopeKey, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(identity).includes("user-secret"), false);
    assert.equal(JSON.stringify(identity).includes("tenant-secret"), false);
    assert.equal(
      scopeDataDir("/tmp/approve-data", identity),
      join(
        "/tmp/approve-data",
        "scopes",
        identity.profileKey,
        identity.userKey,
        identity.tenantKey,
        identity.dataScopeKey,
      ),
    );
  });

  it("physically isolates the same profile/user/tenant across environments", () => {
    const c1Identity = buildRuntimeIdentity({
      profileDir: PROFILE_DIR,
      userId: "user-secret",
      tenantId: "tenant-secret",
      environment: "c1.example.com",
    });
    const c2Identity = buildRuntimeIdentity({
      profileDir: PROFILE_DIR,
      userId: "user-secret",
      tenantId: "tenant-secret",
      environment: "c2.example.com",
    });

    assert.equal(c1Identity.profileKey, c2Identity.profileKey);
    assert.equal(c1Identity.userKey, c2Identity.userKey);
    assert.equal(c1Identity.tenantKey, c2Identity.tenantKey);
    assert.notEqual(c1Identity.dataScopeKey, c2Identity.dataScopeKey);
    assert.notEqual(
      scopeDataDir("/tmp/approve-data", c1Identity),
      scopeDataDir("/tmp/approve-data", c2Identity),
    );
  });

  it("physically isolates different users in one tenant and different tenants for one user", () => {
    const base = {
      profileDir: PROFILE_DIR,
      userId: "user-a",
      tenantId: "tenant-a",
      environment: "c1.example.com",
    };
    const identityA = buildRuntimeIdentity(base);
    const otherUser = buildRuntimeIdentity({ ...base, userId: "user-b" });
    const otherTenant = buildRuntimeIdentity({ ...base, tenantId: "tenant-b" });

    assert.notEqual(identityA.userKey, otherUser.userKey);
    assert.equal(identityA.tenantKey, otherUser.tenantKey);
    assert.notEqual(scopeDataDir("/tmp/approve-data", identityA), scopeDataDir("/tmp/approve-data", otherUser));
    assert.equal(identityA.userKey, otherTenant.userKey);
    assert.notEqual(identityA.tenantKey, otherTenant.tenantKey);
    assert.notEqual(scopeDataDir("/tmp/approve-data", identityA), scopeDataDir("/tmp/approve-data", otherTenant));
  });

  it("rejects a scope path when dataScopeKey is missing or malformed", () => {
    const identity = buildRuntimeIdentity({
      profileDir: PROFILE_DIR,
      userId: "user-secret",
      tenantId: "tenant-secret",
      environment: "c1",
    });

    assert.throws(
      () => scopeDataDir("/tmp/approve-data", { ...identity, dataScopeKey: "" }),
      (error) => error instanceof RuntimeIdentityError && error.code === "IDENTITY_SCOPE_INVALID",
    );
    assert.throws(
      () => scopeDataDir("/tmp/approve-data", { ...identity, dataScopeKey: "../escape" }),
      (error) => error instanceof RuntimeIdentityError && error.code === "IDENTITY_SCOPE_INVALID",
    );
  });

  it("matches only state stamped with the same data scope", () => {
    const identity = buildRuntimeIdentity({
      profileDir: PROFILE_DIR,
      userId: "user-a",
      tenantId: "tenant-a",
      environment: "c1",
    });
    assert.equal(identityMatchesState(identity, { meta: { identity: { dataScopeKey: identity.dataScopeKey } } }), true);
    assert.equal(identityMatchesState(identity, { meta: { identity: { dataScopeKey: "other" } } }), false);
    assert.equal(identityMatchesState(identity, { items: [] }), false);
  });

  it("normalizes common whoami response shapes without guessing from todo data", () => {
    assert.deepEqual(normalizeWhoamiIdentity({ data: {
      user: { id: "user-a" },
      tenant: { id: "tenant-a" },
      environment: "c1",
    } }), { yhtUserId: "", userId: "user-a", tenantId: "tenant-a", environment: "c1" });
    assert.deepEqual(normalizeWhoamiIdentity({ result: {
      userId: "user-b",
      currentTenantId: "tenant-b",
      baseUrl: "https://c2.yonyoucloud.com/path",
    } }), {
      yhtUserId: "",
      userId: "user-b",
      tenantId: "tenant-b",
      environment: "c2.yonyoucloud.com",
    });
  });

  it("exposes and prioritizes yhtUserId over a conflicting generic userId", () => {
    assert.deepEqual(normalizeWhoamiIdentity({ data: {
      yhtUserId: "canonical-yht-user",
      userId: "conflicting-generic-user",
      currentTenantId: "tenant-a",
      environment: "c1",
    } }), {
      yhtUserId: "canonical-yht-user",
      userId: "canonical-yht-user",
      tenantId: "tenant-a",
      environment: "c1",
    });
  });
});

describe("verifyManagedCliIdentity", () => {
  it("fails closed when the YonWork managed proxy context is missing", async () => {
    await assert.rejects(
      verifyManagedCliIdentity({
        env: managedEnv({ YONCLAW_REQ_PROXY_BASE_URL: "" }),
        cliPath: CLI_PATH,
        existsSync: () => true,
        runBipCli: async () => assert.fail("CLI must not run without host auth context"),
      }),
      (error) => {
        assert.equal(error.code, "HOST_AUTH_CONTEXT_MISSING");
        assert.equal(error.issue.errorCode, "HOST_AUTH_CONTEXT_MISSING");
        return true;
      },
    );
  });

  it("runs whoami -> list-inbox -> whoami in one managed context", async () => {
    const calls = [];
    const results = [
      { data: { yhtUserId: "user-a", tenantId: "tenant-a", environment: "c1" } },
      { success: true, currentTenantId: "tenant-a", items: [{ id: "todo-1" }] },
      { data: { yhtUserId: "user-a", tenantId: "tenant-a", environment: "c1" } },
    ];
    const report = await verifyManagedCliIdentity({
      env: managedEnv(),
      cliPath: CLI_PATH,
      existsSync: () => true,
      runBipCli: async (command, input, options) => {
        calls.push({ command: Array.isArray(command) ? command.join(" ") : command, input, env: options.env });
        return results.shift();
      },
    });

    assert.deepEqual(calls.map((call) => call.command), [
      "whoami",
      "workflow inboxtask list-inbox",
      "whoami",
    ]);
    assert.equal(calls.every((call) => call.env.YONCLAW_REQ_PROXY_BASE_URL === "http://127.0.0.1:3211"), true);
    assert.equal(report.success, true);
    assert.equal(report.authMode, "managed-yonwork");
    assert.deepEqual(report.rawIdentity, {
      yhtUserId: "user-a",
      userId: "user-a",
      tenantId: "tenant-a",
      environment: "c1",
    });
    assert.equal(report.listResult.items.length, 1);
    assert.equal(report.attempts, 1);
  });

  it("uses list-inbox currentTenantId when real whoami only returns yhtUserId", async () => {
    const results = [
      { success: true, yhtUserId: "user-a", environment: "c1" },
      { success: true, currentTenantId: "tenant-a", items: [] },
      { success: true, yhtUserId: "user-a", environment: "c1" },
    ];
    const report = await verifyManagedCliIdentity({
      env: managedEnv(),
      cliPath: CLI_PATH,
      existsSync: () => true,
      runBipCli: async () => results.shift(),
    });

    assert.equal(report.success, true);
    assert.deepEqual(report.rawIdentity, {
      yhtUserId: "user-a",
      userId: "user-a",
      tenantId: "tenant-a",
      environment: "c1",
    });
    assert.equal(report.listResult.currentTenantId, "tenant-a");
  });

  it("derives the managed user scope only from yhtUserId when generic userId conflicts", async () => {
    const results = [
      {
        success: true,
        yhtUserId: "canonical-yht-user",
        userId: "conflicting-generic-user",
        currentTenantId: "tenant-a",
        environment: "c1",
      },
      { success: true, currentTenantId: "tenant-a", items: [] },
      {
        success: true,
        yhtUserId: "canonical-yht-user",
        userId: "conflicting-generic-user",
        currentTenantId: "tenant-a",
        environment: "c1",
      },
    ];
    const report = await verifyManagedCliIdentity({
      env: managedEnv(),
      cliPath: CLI_PATH,
      existsSync: () => true,
      runBipCli: async () => results.shift(),
    });
    const canonicalIdentity = buildRuntimeIdentity({
      profileDir: PROFILE_DIR,
      userId: "canonical-yht-user",
      tenantId: "tenant-a",
      environment: "c1",
    });
    const conflictingIdentity = buildRuntimeIdentity({
      profileDir: PROFILE_DIR,
      userId: "conflicting-generic-user",
      tenantId: "tenant-a",
      environment: "c1",
    });

    assert.equal(report.identity.userKey, canonicalIdentity.userKey);
    assert.notEqual(report.identity.userKey, conflictingIdentity.userKey);
    assert.equal(report.rawIdentity.yhtUserId, "canonical-yht-user");
    assert.equal(report.rawIdentity.userId, "canonical-yht-user");
  });

  it("fails closed when whoami exposes only a generic userId", async () => {
    const calls = [];
    await assert.rejects(
      verifyManagedCliIdentity({
        env: managedEnv(),
        cliPath: CLI_PATH,
        existsSync: () => true,
        runBipCli: async (command) => {
          calls.push(Array.isArray(command) ? command.join(" ") : command);
          return { success: true, userId: "generic-only-user", environment: "c1" };
        },
      }),
      (error) => {
        assert.equal(error.code, "IDENTITY_INCOMPLETE");
        assert.match(error.issue.reason, /yhtUserId/);
        return true;
      },
    );
    assert.deepEqual(calls, ["whoami"]);
  });

  it("derives a stable environment from the latest list-inbox business URL when whoami omits it", async () => {
    const results = [
      { success: true, yhtUserId: "user-a" },
      {
        success: true,
        currentTenantId: "tenant-a",
        items: [{ tenantId: "tenant-a", webUrl: "https://c2.yonyoucloud.com/app/todo/1" }],
      },
      { success: true, yhtUserId: "user-a" },
    ];
    const report = await verifyManagedCliIdentity({
      env: managedEnv(),
      cliPath: CLI_PATH,
      existsSync: () => true,
      runBipCli: async () => results.shift(),
    });

    assert.equal(report.rawIdentity.environment, "c2.yonyoucloud.com");
  });

  it("treats a YonBIP short environment id and its business hostname as the same environment", async () => {
    const results = [
      { success: true, yhtUserId: "user-a", environment: "c1" },
      {
        success: true,
        currentTenantId: "tenant-a",
        items: [{ webUrl: "https://c1.yonyoucloud.com/app/todo/1" }],
      },
      { success: true, yhtUserId: "user-a", environment: "c1" },
    ];
    const report = await verifyManagedCliIdentity({
      env: managedEnv(),
      cliPath: CLI_PATH,
      existsSync: () => true,
      runBipCli: async () => results.shift(),
    });

    assert.equal(report.success, true);
    assert.equal(report.rawIdentity.environment, "c1");
  });

  it("clears CLI caches and retries the whole probe exactly once after a 401", async () => {
    const calls = [];
    const cleared = [];
    let invocation = 0;
    const report = await verifyManagedCliIdentity({
      env: managedEnv(),
      cliPath: CLI_PATH,
      existsSync: () => true,
      clearCaches: (cliPath) => cleared.push(cliPath),
      runBipCli: async (command) => {
        const label = Array.isArray(command) ? command.join(" ") : command;
        calls.push(label);
        invocation += 1;
        if (invocation === 2) throw new Error("获取 secret 失败: HTTP 401");
        if (label === "workflow inboxtask list-inbox") {
          return { success: true, currentTenantId: "tenant-a", items: [] };
        }
        return { data: { yhtUserId: "user-a", tenantId: "tenant-a", environment: "c1" } };
      },
    });

    assert.deepEqual(calls, [
      "whoami",
      "workflow inboxtask list-inbox",
      "whoami",
      "workflow inboxtask list-inbox",
      "whoami",
    ]);
    assert.deepEqual(cleared, [CLI_PATH]);
    assert.equal(report.attempts, 2);
  });

  it("maps a repeated 401 to AUTH_REQUIRED_IN_YONWORK without yonbrowser fallback", async () => {
    const calls = [];
    await assert.rejects(
      verifyManagedCliIdentity({
        env: managedEnv(),
        cliPath: CLI_PATH,
        existsSync: () => true,
        clearCaches: () => {},
        runBipCli: async (command) => {
          calls.push(Array.isArray(command) ? command.join(" ") : command);
          throw new Error("HTTP 401 Unauthorized");
        },
      }),
      (error) => {
        assert.equal(error.code, "AUTH_REQUIRED_IN_YONWORK");
        assert.equal(error.issue.recovery.action, "reopen-in-yonwork");
        assert.equal(error.issue.httpStatus, 401);
        return true;
      },
    );
    assert.deepEqual(calls, ["whoami", "whoami"]);
    assert.equal(calls.some((call) => call.includes("yonbrowser")), false);
  });

  it("maps an exit-zero errcode 401 envelope to AUTH_REQUIRED_IN_YONWORK", async () => {
    await assert.rejects(
      verifyManagedCliIdentity({
        env: managedEnv(),
        cliPath: CLI_PATH,
        existsSync: () => true,
        clearCaches: () => {},
        runBipCli: async () => ({ errcode: 401, message: "managed session expired" }),
      }),
      (error) => {
        assert.equal(error.code, "AUTH_REQUIRED_IN_YONWORK");
        assert.equal(error.issue.httpStatus, 401);
        return true;
      },
    );
  });

  it("maps status 200 plus errcode/code 401 envelopes to AUTH_REQUIRED_IN_YONWORK", async () => {
    for (const envelope of [
      { status: 200, errcode: 401, message: "managed session expired" },
      { status: 200, code: 401, message: "managed session expired" },
    ]) {
      await assert.rejects(
        verifyManagedCliIdentity({
          env: managedEnv(),
          cliPath: CLI_PATH,
          existsSync: () => true,
          clearCaches: () => {},
          runBipCli: async () => envelope,
        }),
        (error) => {
          assert.equal(error.code, "AUTH_REQUIRED_IN_YONWORK");
          assert.equal(error.issue.httpStatus, 401);
          return true;
        },
      );
    }
  });

  it("rejects identity changes during the probe and tenant disagreement from list-inbox", async () => {
    const identities = [
      { data: { yhtUserId: "user-a", tenantId: "tenant-a", environment: "c1" } },
      { success: true, currentTenantId: "tenant-a", items: [] },
      { data: { yhtUserId: "user-b", tenantId: "tenant-a", environment: "c1" } },
    ];
    await assert.rejects(
      verifyManagedCliIdentity({
        env: managedEnv(),
        cliPath: CLI_PATH,
        existsSync: () => true,
        runBipCli: async () => identities.shift(),
      }),
      (error) => {
        assert.equal(error.code, "IDENTITY_CHANGED_DURING_PROBE");
        return true;
      },
    );
  });

  it("rejects an environment switch between the two whoami probes", async () => {
    const results = [
      { data: { yhtUserId: "user-a", tenantId: "tenant-a", environment: "c1" } },
      { success: true, currentTenantId: "tenant-a", items: [] },
      { data: { yhtUserId: "user-a", tenantId: "tenant-a", environment: "c2" } },
    ];

    await assert.rejects(
      verifyManagedCliIdentity({
        env: managedEnv(),
        cliPath: CLI_PATH,
        existsSync: () => true,
        runBipCli: async () => results.shift(),
      }),
      (error) => {
        assert.equal(error.code, "IDENTITY_CHANGED_DURING_PROBE");
        assert.equal(error.issue.httpStatus, 409);
        return true;
      },
    );
  });

  it("rejects a list-inbox environment that disagrees with whoami", async () => {
    const results = [
      { data: { yhtUserId: "user-a", tenantId: "tenant-a", environment: "c1.yonyoucloud.com" } },
      {
        success: true,
        currentTenantId: "tenant-a",
        items: [{ webUrl: "https://c2.yonyoucloud.com/app/todo/1" }],
      },
      { data: { yhtUserId: "user-a", tenantId: "tenant-a", environment: "c1.yonyoucloud.com" } },
    ];

    await assert.rejects(
      verifyManagedCliIdentity({
        env: managedEnv(),
        cliPath: CLI_PATH,
        existsSync: () => true,
        runBipCli: async () => results.shift(),
      }),
      (error) => {
        assert.equal(error.code, "ENVIRONMENT_CONTEXT_MISMATCH");
        assert.equal(error.issue.httpStatus, 409);
        return true;
      },
    );
  });
});

describe("runtime identity issues", () => {
  it("preserves structured RuntimeIdentityError issues", () => {
    const original = new RuntimeIdentityError(issueFromError(new Error("HTTP 401"), { exhausted: true }));
    assert.equal(issueFromError(original).errorCode, "AUTH_REQUIRED_IN_YONWORK");
  });
});
