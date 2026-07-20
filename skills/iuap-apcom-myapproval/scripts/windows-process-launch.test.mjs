import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const skillDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(skillDir, relativePath), "utf-8");
}

function assertHidden(source, pattern, label) {
  assert.match(source, pattern, `${label} must set windowsHide: true`);
}

describe("Windows child-process console visibility", () => {
  it("hides Node and cmd subprocesses launched by the web service", () => {
    const source = read("web/server.mjs");

    assertHidden(
      source,
      /execFile\(\s*process\.execPath,\s*\[scriptPath, \.\.\.args\],[\s\S]{0,220}?windowsHide:\s*true/,
      "runScript",
    );
    assertHidden(
      source,
      /execFileAsync\(\s*process\.execPath,\s*args,[\s\S]{0,220}?windowsHide:\s*true/,
      "batch enrich",
    );
    assertHidden(
      source,
      /execFile\(\s*process\.execPath,\s*\[ENRICH_SCRIPT,[\s\S]{0,220}?windowsHide:\s*true/,
      "single-item enrich",
    );
    assertHidden(
      source,
      /execFile\(opener, args,[\s\S]{0,160}?windowsHide:\s*true/,
      "browser opener",
    );
    for (const command of ["textutil", "pandoc", "strings"]) {
      assertHidden(
        source,
        new RegExp(`execFileAsync\\("${command}"[\\s\\S]{0,220}?windowsHide:\\s*true`),
        `${command} attachment converter`,
      );
    }
  });

  it("keeps the detached web service hidden", () => {
    const ensureService = read("scripts/ensure-service.mjs");

    assertHidden(
      ensureService,
      /spawn\(process\.execPath, \[serverPath\],[\s\S]{0,260}?windowsHide:\s*true/,
      "ensure-service web server",
    );
  });

  it("hides legacy CLI, attachment-tool, and agent fallback subprocesses", () => {
    const browserAuth = read("scripts/browser-auth.mjs");
    const fetchBillDetail = read("scripts/fetch-bill-detail.mjs");
    const agentRunner = read("scripts/agent-runner.mjs");

    assertHidden(
      browserAuth,
      /execFile\("node", \[cliPath, \.\.\.args\],[\s\S]{0,180}?windowsHide:\s*true/,
      "browser auth CLI",
    );
    assertHidden(
      fetchBillDetail,
      /spawnSync\("openssl", args,[\s\S]{0,180}?windowsHide:\s*true/,
      "OpenSSL attachment decrypt",
    );
    const agentCommands = [
      ["command lookup", /execFileSync\("which", \[command\],[\s\S]{0,180}?windowsHide:\s*true/],
      ["Python attachment extractor", /execFileSync\("python3",[\s\S]{0,240}?windowsHide:\s*true/],
      ["textutil attachment extractor", /execFileSync\("textutil",[\s\S]{0,240}?windowsHide:\s*true/],
      ["PDF attachment extractor", /execFileSync\("pdftotext",[\s\S]{0,240}?windowsHide:\s*true/],
      ["strings attachment extractor", /execFileSync\("strings",[\s\S]{0,240}?windowsHide:\s*true/],
      ["Claude lookup", /execSync\("which claude",[\s\S]{0,180}?windowsHide:\s*true/],
      ["Claude fallback", /execSync\(`claude -p[\s\S]{0,260}?windowsHide:\s*true/],
    ];
    for (const [label, pattern] of agentCommands) assertHidden(agentRunner, pattern, label);
  });
});
