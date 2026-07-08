import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveRuntimeContext } from "./runtime-context.mjs";

describe("runtime-context", () => {
  it("resolves skill and data dirs from explicit env", () => {
    const ctx = resolveRuntimeContext({
      env: {
        APPROVE_INBOX_SKILL_DIR: "/repo/skills/iuap-apcom-myapproval",
        APPROVE_INBOX_DATA: "/repo/skills/iuap-apcom-myapproval/data",
        APPROVE_INBOX_PORT: "4567",
      },
      exists: () => true,
    });

    assert.equal(ctx.skillId, "iuap-apcom-myapproval");
    assert.equal(ctx.skillDir, "/repo/skills/iuap-apcom-myapproval");
    assert.equal(ctx.dataDir, "/repo/skills/iuap-apcom-myapproval/data");
    assert.equal(ctx.serverUrl, "http://localhost:4567");
    assert.equal(ctx.widgetUrl, "http://localhost:4567/widget/");
    assert.equal(ctx.centerUrl, "http://localhost:4567/");
  });

  it("derives the skill dir from APPROVE_INBOX_DATA when skill dir is absent", () => {
    const dataDir = "/Users/test/Library/Application Support/yonclaw/profiles/profile-a/userData/runtime/openclaw/skills/iuap-apcom-myapproval/data";
    const ctx = resolveRuntimeContext({
      env: { APPROVE_INBOX_DATA: dataDir },
      exists: () => true,
    });

    assert.equal(
      ctx.skillDir,
      "/Users/test/Library/Application Support/yonclaw/profiles/profile-a/userData/runtime/openclaw/skills/iuap-apcom-myapproval",
    );
    assert.equal(
      ctx.profileDir,
      "/Users/test/Library/Application Support/yonclaw/profiles/profile-a",
    );
    assert.equal(
      ctx.runtimeDir,
      "/Users/test/Library/Application Support/yonclaw/profiles/profile-a/userData/runtime",
    );
    assert.equal(
      ctx.openclawDir,
      "/Users/test/Library/Application Support/yonclaw/profiles/profile-a/userData/runtime/openclaw",
    );
  });

  it("derives runtime dirs from the installed YonWork skill alias", () => {
    const dataDir = "/Users/test/Library/Application Support/YonWork/profiles/profile-a/userData/runtime/openclaw/skills/iuap-apcom-myapproval/data";
    const ctx = resolveRuntimeContext({
      env: { APPROVE_INBOX_DATA: dataDir },
      exists: () => true,
    });

    assert.equal(
      ctx.skillDir,
      "/Users/test/Library/Application Support/YonWork/profiles/profile-a/userData/runtime/openclaw/skills/iuap-apcom-myapproval",
    );
    assert.equal(
      ctx.profileDir,
      "/Users/test/Library/Application Support/YonWork/profiles/profile-a",
    );
    assert.equal(
      ctx.openclawDir,
      "/Users/test/Library/Application Support/YonWork/profiles/profile-a/userData/runtime/openclaw",
    );
  });

  it("keeps deriving runtime dirs from the legacy installed skill alias", () => {
    const dataDir = "/Users/test/Library/Application Support/YonWork/profiles/profile-a/userData/runtime/openclaw/skills/iuap-apcom-approveinbox/data";
    const ctx = resolveRuntimeContext({
      env: { APPROVE_INBOX_DATA: dataDir },
      exists: () => true,
    });

    assert.equal(
      ctx.skillDir,
      "/Users/test/Library/Application Support/YonWork/profiles/profile-a/userData/runtime/openclaw/skills/iuap-apcom-approveinbox",
    );
    assert.equal(
      ctx.openclawDir,
      "/Users/test/Library/Application Support/YonWork/profiles/profile-a/userData/runtime/openclaw",
    );
  });

  it("uses server-url override without leaking path policy decisions", () => {
    const ctx = resolveRuntimeContext({
      env: { APPROVE_INBOX_SKILL_DIR: "/repo/skills/iuap-apcom-myapproval" },
      serverUrl: "http://127.0.0.1:9999/",
      exists: () => true,
    });

    assert.equal(ctx.serverUrl, "http://127.0.0.1:9999");
    assert.equal(ctx.widgetUrl, "http://127.0.0.1:9999/widget/");
  });
});
