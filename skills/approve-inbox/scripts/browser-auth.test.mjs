import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildAuthFromCookieMap,
  cookieMapToString,
  findAuthEntry,
  getBipCliPathCandidates,
  getBrowserAuth,
  loadAuthFromSettings,
  normalizeBaseUrl,
  resolveBipCliPath,
  validateAuth,
} from "./browser-auth.mjs";

function tmp() {
  return mkdtempSync(join(tmpdir(), "approve-inbox-auth-"));
}

function writeSettings(dir, settings) {
  const file = join(dir, "settings.json");
  writeFileSync(file, JSON.stringify(settings, null, 2));
  return file;
}

describe("browser-auth", () => {
  it("resolves BIP-CLI from env override first", () => {
    const resolved = resolveBipCliPath("/repo/skills/approve-inbox/scripts", {
      env: { APPROVE_INBOX_BIP_CLI: "/custom/bip-cli.js" },
      argvPath: "/repo/skills/approve-inbox/scripts/sync-inbox.mjs",
      homeDir: "/Users/test",
      exists: (candidate) => candidate === "/custom/bip-cli.js",
    });

    assert.equal(resolved, "/custom/bip-cli.js");
  });

  it("resolves BIP-CLI when called with an options object", () => {
    const resolved = resolveBipCliPath({
      scriptDir: "/repo/skills/approve-inbox/scripts",
      env: { BIP_CLI_PATH: "/env/bip-cli.js" },
      argvPath: "/repo/skills/approve-inbox/scripts/sync-inbox.mjs",
      homeDir: "/Users/test",
      exists: (candidate) => candidate === "/env/bip-cli.js",
    });

    assert.equal(resolved, "/env/bip-cli.js");
  });

  it("prefers the iuap-apcom-cli sibling from APPROVE_INBOX_DATA profile", () => {
    const dataDir = "/Users/test/Library/Application Support/yonclaw/profiles/profile-a/userData/runtime/openclaw/skills/approve-inbox/data";
    const expected = "/Users/test/Library/Application Support/yonclaw/profiles/profile-a/userData/runtime/openclaw/skills/iuap-apcom-cli/scripts/bip-cli.js";
    const resolved = resolveBipCliPath("/repo/skills/approve-inbox/scripts", {
      env: { APPROVE_INBOX_DATA: dataDir },
      argvPath: "/repo/skills/approve-inbox/scripts/server.mjs",
      homeDir: "/Users/test",
      exists: (candidate) => candidate === expected,
    });

    assert.equal(resolved, expected);
  });

  it("prefers the iuap-apcom-cli sibling from installed runtime skill aliases", () => {
    const dataDir = "/Users/test/Library/Application Support/yonclaw/profiles/profile-a/userData/runtime/openclaw/skills/iuap-apcom-approveinbox/data";
    const expected = "/Users/test/Library/Application Support/yonclaw/profiles/profile-a/userData/runtime/openclaw/skills/iuap-apcom-cli/scripts/bip-cli.js";
    const resolved = resolveBipCliPath("/repo/skills/approve-inbox/scripts", {
      env: { APPROVE_INBOX_DATA: dataDir },
      argvPath: "/repo/skills/approve-inbox/scripts/server.mjs",
      homeDir: "/Users/test",
      exists: (candidate) => candidate === expected,
    });

    assert.equal(resolved, expected);
  });

  it("lists adjacent skill and YonClaw runtime candidates", () => {
    const candidates = getBipCliPathCandidates({
      scriptDir: "/repo/skills/approve-inbox/scripts",
      argvPath: "/repo/skills/approve-inbox/scripts/sync-inbox.mjs",
      homeDir: "/Users/test",
      env: {},
    });

    assert.ok(candidates.includes("/repo/skills/iuap-apcom-cli/scripts/bip-cli.js"));
    assert.ok(candidates.includes("/Users/test/.agents/skills/iuap-apcom-cli/scripts/bip-cli.js"));
  });

  it("orders YonClaw runtime candidates by recent skill directory mtime", () => {
    const homeDir = tmp();
    const oldDir = join(homeDir, "Library", "Application Support", "yonclaw", "profiles", "profile-old", "userData", "runtime", "openclaw", "skills", "iuap-apcom-cli");
    const newDir = join(homeDir, "Library", "Application Support", "yonclaw", "profiles", "profile-new", "userData", "runtime", "openclaw", "skills", "iuap-apcom-cli");
    mkdirSync(join(oldDir, "scripts"), { recursive: true });
    mkdirSync(join(newDir, "scripts"), { recursive: true });
    const oldDate = new Date("2026-01-01T00:00:00.000Z");
    const newDate = new Date("2026-02-01T00:00:00.000Z");
    utimesSync(oldDir, oldDate, oldDate);
    utimesSync(newDir, newDate, newDate);

    const yonclawCandidates = getBipCliPathCandidates({
      scriptDir: "/repo/skills/approve-inbox/scripts",
      argvPath: "/repo/skills/approve-inbox/scripts/sync-inbox.mjs",
      homeDir,
      env: {},
    }).filter((candidate) => candidate.includes("Library/Application Support/yonclaw"));

    assert.match(yonclawCandidates[0], /profile-new/);
    assert.match(yonclawCandidates[1], /profile-old/);
  });

  it("lists YonWork runtime candidates after the app rename", () => {
    const homeDir = tmp();
    const dir = join(homeDir, "Library", "Application Support", "YonWork", "profiles", "profile-a", "userData", "runtime", "openclaw", "skills", "iuap-apcom-cli");
    mkdirSync(join(dir, "scripts"), { recursive: true });

    const candidates = getBipCliPathCandidates({
      scriptDir: "/repo/skills/approve-inbox/scripts",
      argvPath: "/repo/skills/approve-inbox/scripts/sync-inbox.mjs",
      homeDir,
      env: {},
    });

    assert.ok(candidates.includes(join(dir, "scripts", "bip-cli.js")));
  });

  it("normalizes base URLs for matching", () => {
    assert.equal(normalizeBaseUrl("https://c1.yonyoucloud.com/"), "https://c1.yonyoucloud.com");
    assert.equal(normalizeBaseUrl("https://c1.yonyoucloud.com/path?x=1#hash"), "https://c1.yonyoucloud.com/path");
  });

  it("builds Cookie header strings", () => {
    assert.equal(cookieMapToString({
      "XSRF-TOKEN": "xsrf",
      tenantid: "tenant",
      empty: "",
      missing: null,
    }), "XSRF-TOKEN=xsrf; tenantid=tenant");
  });

  it("selects auth by normalized baseUrl", () => {
    const settings = {
      auth: [
        { baseUrl: "https://c2.yonyoucloud.com", updatedAt: "2026-01-02T00:00:00.000Z" },
        { baseUrl: "https://c1.yonyoucloud.com/", updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
    };
    assert.equal(findAuthEntry(settings, "https://c1.yonyoucloud.com").baseUrl, "https://c1.yonyoucloud.com/");
  });

  it("loads auth from BIP-CLI settings", () => {
    const dir = tmp();
    const settingsPath = writeSettings(dir, {
      auth: [{
        baseUrl: "https://c1.yonyoucloud.com",
        cookieMap: {
          "XSRF-TOKEN": "xsrf",
          yht_access_token: "access",
          yht_usertoken_diwork: "yht",
          tenantid: "tenant",
        },
      }],
    });

    const { auth, valid } = loadAuthFromSettings({ settingsPath, baseUrl: "https://c1.yonyoucloud.com" });
    assert.equal(valid.ok, true);
    assert.equal(auth.xsrfToken, "xsrf");
    assert.equal(auth.yhtToken, "yht");
    assert.match(auth.cookieStr, /yht_access_token=access/);
  });

  it("marks incomplete auth when required cookies are missing", () => {
    const auth = buildAuthFromCookieMap({
      cookieMap: { JSESSIONID: "session" },
      baseUrl: "https://c1.yonyoucloud.com",
    });

    assert.deepEqual(validateAuth(auth), {
      ok: false,
      reason: "missing_required_cookies:XSRF-TOKEN",
    });
  });

  it("refreshes stale settings once through BIP-CLI fetch", async () => {
    const dir = tmp();
    const settingsPath = writeSettings(dir, {
      auth: [{ baseUrl: "https://c1.yonyoucloud.com", cookieMap: { JSESSIONID: "old" } }],
    });
    const calls = [];
    const execFile = (_bin, args) => {
      calls.push(args.join(" "));
      if (args.includes("status")) {
        return JSON.stringify({
          success: true,
          data: { baseUrl: "https://c1.yonyoucloud.com", port: 50541, loginValid: true },
        });
      }
      if (args.includes("fetch")) {
        writeSettings(dir, {
          auth: [{
            baseUrl: "https://c1.yonyoucloud.com",
            cookieMap: { "XSRF-TOKEN": "new-xsrf", yht_access_token: "new-access" },
          }],
        });
        return JSON.stringify({ success: true });
      }
      throw new Error(`unexpected args: ${args.join(" ")}`);
    };

    const auth = await getBrowserAuth({ cliPath: "/fake/bip-cli.js", settingsPath, execFile });

    assert.equal(auth.xsrfToken, "new-xsrf");
    assert.equal(auth.browserPort, 50541);
    assert.deepEqual(calls, [
      "/fake/bip-cli.js yonbrowser login status --format json",
      "/fake/bip-cli.js yonbrowser login fetch --format json",
    ]);
  });

  it("reports invalid browser sessions without printing cookies", async () => {
    const dir = tmp();
    mkdirSync(dir, { recursive: true });
    const execFile = () => JSON.stringify({
      success: false,
      data: { loginValid: false, hasBrowserSession: false },
    });

    await assert.rejects(
      getBrowserAuth({ cliPath: "/fake/bip-cli.js", settingsPath: join(dir, "settings.json"), execFile }),
      /BIP browser session is not logged in/,
    );
  });
});
