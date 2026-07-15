import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

import { REQUIRED_BIP_CLI_COMMANDS } from "./scripts/bip-cli-client.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tempDirs = [];

function makeTempDir(prefix = "approve-inbox-pack-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeSchemaCli(dir, paths) {
  const cliPath = join(dir, "bip-cli.js");
  writeFileSync(cliPath, `
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--schema") {
  process.stdout.write(JSON.stringify(${JSON.stringify(paths.map((path) => ({ path })))}));
} else {
  process.stdout.write(JSON.stringify({ success: true }));
}
`, "utf-8");
  return cliPath;
}

function runPack(outputRoot, cliPath) {
  return spawnSync(process.execPath, [join(__dirname, "pack-skill.mjs"), outputRoot], {
    cwd: __dirname,
    env: {
      ...process.env,
      APPROVE_INBOX_RUNTIME_MODE: "local-dev",
      APPROVE_INBOX_BIP_CLI: cliPath,
    },
    encoding: "utf-8",
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("pack-skill CLI 能力门禁", () => {
  it("兼容 CLI 能生成 ZIP，包含修复后的运行时代码且不含测试", () => {
    const dir = makeTempDir();
    const cliPath = writeSchemaCli(dir, REQUIRED_BIP_CLI_COMMANDS);
    const outputRoot = join(dir, "out");

    const result = runPack(outputRoot, cliPath);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const zipPath = join(outputRoot, "iuap-apcom-myapproval.zip");
    const packagedClient = join(outputRoot, "iuap-apcom-myapproval", "scripts", "bip-cli-client.mjs");
    assert.equal(existsSync(zipPath), true);
    assert.match(readFileSync(packagedClient, "utf-8"), /REQUIRED_BIP_CLI_COMMANDS/);
    assert.match(readFileSync(packagedClient, "utf-8"), /--schema/);

    const entries = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf-8" })
      .trim()
      .split("\n");
    assert.equal(entries.some((entry) => entry.endsWith(".test.mjs")), false);
    execFileSync("unzip", ["-t", zipPath], { stdio: "pipe" });
  });

  it("不兼容 CLI 阻止发布且不删除旧产物", () => {
    const dir = makeTempDir();
    const cliPath = writeSchemaCli(dir, ["workflow task batch-approve"]);
    const outputRoot = join(dir, "out");
    const oldDest = join(outputRoot, "iuap-apcom-myapproval");
    const oldZip = join(outputRoot, "iuap-apcom-myapproval.zip");
    mkdirSync(oldDest, { recursive: true });
    writeFileSync(join(oldDest, "sentinel.txt"), "keep-old-directory", "utf-8");
    writeFileSync(oldZip, "keep-old-zip", "utf-8");

    const result = runPack(outputRoot, cliPath);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /依赖能力不兼容/);
    assert.equal(readFileSync(join(oldDest, "sentinel.txt"), "utf-8"), "keep-old-directory");
    assert.equal(readFileSync(oldZip, "utf-8"), "keep-old-zip");
  });
});
