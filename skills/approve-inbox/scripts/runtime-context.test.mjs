import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveRuntimeContext } from "./runtime-context.mjs";

describe("runtime-context", () => {
  it("resolves skill and data dirs from explicit env", () => {
    const ctx = resolveRuntimeContext({
      env: {
        APPROVE_INBOX_SKILL_DIR: "/repo/skills/approve-inbox",
        APPROVE_INBOX_DATA: "/repo/skills/approve-inbox/data",
        APPROVE_INBOX_PORT: "4567",
      },
      exists: () => true,
    });

    assert.equal(ctx.skillId, "approve-inbox");
    assert.equal(ctx.skillDir, "/repo/skills/approve-inbox");
    assert.equal(ctx.dataDir, "/repo/skills/approve-inbox/data");
    assert.equal(ctx.serverUrl, "http://localhost:4567");
    assert.equal(ctx.widgetUrl, "http://localhost:4567/widget/");
    assert.equal(ctx.centerUrl, "http://localhost:4567/");
  });

  it("derives the skill dir from APPROVE_INBOX_DATA when skill dir is absent", () => {
    const dataDir = "/Users/test/Library/Application Support/yonclaw/profiles/profile-a/userData/runtime/openclaw/skills/approve-inbox/data";
    const ctx = resolveRuntimeContext({
      env: { APPROVE_INBOX_DATA: dataDir },
      exists: () => true,
    });

    assert.equal(
      ctx.skillDir,
      "/Users/test/Library/Application Support/yonclaw/profiles/profile-a/userData/runtime/openclaw/skills/approve-inbox",
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

  it("uses server-url override without leaking path policy decisions", () => {
    const ctx = resolveRuntimeContext({
      env: { APPROVE_INBOX_SKILL_DIR: "/repo/skills/approve-inbox" },
      serverUrl: "http://127.0.0.1:9999/",
      exists: () => true,
    });

    assert.equal(ctx.serverUrl, "http://127.0.0.1:9999");
    assert.equal(ctx.widgetUrl, "http://127.0.0.1:9999/widget/");
  });
});
