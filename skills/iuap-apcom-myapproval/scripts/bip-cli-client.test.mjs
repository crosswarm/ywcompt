import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  INTELLIGENT_AUDIT_BIP_CLI_COMMAND,
  REQUIRED_BIP_CLI_ARTIFACT_MARKERS,
  REQUIRED_BIP_CLI_COMMANDS,
  assertRequiredBipCliCapabilities,
  clearBipCliCapabilityCache,
  resolveApproveInboxBipCliPath,
  runBipCli,
} from "./bip-cli-client.mjs";

const tempDirs = [];

function makeTempDir(prefix = "approve-inbox-bip-cli-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeFakeCli(dir, {
  schema = [...REQUIRED_BIP_CLI_COMMANDS, INTELLIGENT_AUDIT_BIP_CLI_COMMAND].map((path) => ({ path })),
  schemaRaw,
  schemaExitCode = 0,
  padding = "",
  artifactMarkers = REQUIRED_BIP_CLI_ARTIFACT_MARKERS,
} = {}) {
  const cliPath = join(dir, "bip-cli.js");
  const config = { schema, schemaRaw, schemaExitCode };
  writeFileSync(cliPath, `
const fs = require("fs");
const config = ${JSON.stringify(config)};
const args = process.argv.slice(2);
const logPath = process.env.FAKE_CLI_LOG;
if (logPath) fs.appendFileSync(logPath, JSON.stringify({ args, cwd: process.cwd() }) + "\\n");

if (args.length === 1 && args[0] === "--schema") {
  if (config.schemaExitCode) {
    process.stderr.write("fake schema failure");
    process.exit(config.schemaExitCode);
  }
  if (config.schemaRaw !== undefined) process.stdout.write(config.schemaRaw);
  else process.stdout.write(JSON.stringify(config.schema));
} else {
  const optionIndex = args.findIndex((arg) => arg.startsWith("--"));
  const commandPath = args.slice(0, optionIndex === -1 ? args.length : optionIndex).join(" ");
  let input = {};
  try {
    const raw = fs.readFileSync(0, "utf-8").trim();
    input = raw ? JSON.parse(raw) : {};
  } catch {}
  process.stdout.write(JSON.stringify({ success: true, commandPath, cwd: process.cwd(), input }));
}
// ${artifactMarkers.join("\n// ")}
// ${padding}
`, "utf-8");
  return cliPath;
}

function readLog(logPath) {
  return readFileSync(logPath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("bip-cli-client", () => {
  it("支持三个现有环境变量选择能力校验目标", () => {
    const dir = makeTempDir();
    const cliSkillDir = join(dir, "iuap-apcom-cli");
    const cliScriptsDir = join(cliSkillDir, "scripts");
    mkdirSync(cliScriptsDir, { recursive: true });
    const cliPath = writeFakeCli(cliScriptsDir);
    const emptyOverrides = {
      APPROVE_INBOX_BIP_CLI: "",
      BIP_CLI_PATH: "",
      IUAP_APCOM_CLI_DIR: "",
    };

    assert.equal(resolveApproveInboxBipCliPath({
      runtimeMode: "local-dev",
      env: { ...emptyOverrides, APPROVE_INBOX_BIP_CLI: cliPath },
    }), cliPath);
    assert.equal(resolveApproveInboxBipCliPath({
      runtimeMode: "local-dev",
      env: { ...emptyOverrides, BIP_CLI_PATH: cliPath },
    }), cliPath);
    assert.equal(resolveApproveInboxBipCliPath({
      runtimeMode: "local-dev",
      env: { ...emptyOverrides, IUAP_APCOM_CLI_DIR: cliSkillDir },
    }), cliPath);
  });

  it("managed-yonwork defaults to the current Profile sibling CLI and ignores global overrides", () => {
    const profileDir = "/Users/test/Library/Application Support/YonWork/profiles/profile-current";
    const skillDir = `${profileDir}/userData/runtime/openclaw/skills/iuap-apcom-myapproval`;
    const expected = `${profileDir}/userData/runtime/openclaw/skills/iuap-apcom-cli/scripts/bip-cli.js`;
    assert.equal(resolveApproveInboxBipCliPath({
      env: {
        APPROVE_INBOX_SKILL_DIR: skillDir,
        APPROVE_INBOX_DATA: "/Users/test/Library/Application Support/YonWork/profiles/profile-old/userData/runtime/openclaw/skills/iuap-apcom-myapproval/data",
        APPROVE_INBOX_BIP_CLI: "/tmp/wrong-profile/bip-cli.js",
      },
      existsSync: () => true,
    }), expected);
  });

  it("managed-yonwork binds directly to APPROVE_INBOX_PROFILE_DIR when the skill runs from a repo checkout", () => {
    const profileDir = "/Users/test/Library/Application Support/YonWork/profiles/profile-current";
    const expected = `${profileDir}/userData/runtime/openclaw/skills/iuap-apcom-cli/scripts/bip-cli.js`;
    assert.equal(resolveApproveInboxBipCliPath({
      skillDir: "/workspace/ycc-approve-inbox/skills/iuap-apcom-myapproval",
      env: { APPROVE_INBOX_PROFILE_DIR: profileDir },
      existsSync: (candidate) => candidate === expected,
    }), expected);
  });

  it("默认从 CLI 所在目录启动探测和业务子进程", async () => {
    const dir = makeTempDir();
    const cliPath = writeFakeCli(dir);
    const logPath = join(dir, "calls.log");

    const result = await runBipCli("workflow inboxtask list-inbox", { pageSize: 20 }, {
      cliPath,
      env: { FAKE_CLI_LOG: logPath },
    });

    const expectedCwd = realpathSync(dirname(cliPath));
    assert.equal(result.cwd, expectedCwd);
    assert.deepEqual(readLog(logPath).map((call) => call.cwd), [expectedCwd, expectedCwd]);
  });

  it("允许 options.cwd 覆盖默认工作目录", async () => {
    const dir = makeTempDir();
    const cliPath = writeFakeCli(dir);
    const cwd = join(dir, "safe-cwd");
    const logPath = join(dir, "calls.log");
    mkdirSync(cwd);

    const result = await runBipCli("workflow inboxtask list-inbox", {}, {
      cliPath,
      cwd,
      env: { FAKE_CLI_LOG: logPath },
    });

    const expectedCwd = realpathSync(cwd);
    assert.equal(result.cwd, expectedCwd);
    assert.deepEqual(readLog(logPath).map((call) => call.cwd), [expectedCwd, expectedCwd]);
  });

  it("拒绝相对 CLI 路径，避免安全 cwd 再次依赖父进程目录", async () => {
    await assert.rejects(
      runBipCli("workflow inboxtask list-inbox", {}, {
        cliPath: "relative/iuap-apcom-cli/scripts/bip-cli.js",
        existsSync: () => true,
      }),
      /CLI 路径必须是绝对路径.*relative\/iuap-apcom-cli\/scripts\/bip-cli\.js/,
    );
  });

  it("兼容 CLI 通过 Schema 探测后再执行业务命令", async () => {
    const dir = makeTempDir();
    const cliPath = writeFakeCli(dir);
    const logPath = join(dir, "calls.log");

    const result = await runBipCli(["workflow", "inboxtask", "list-inbox"], { pageSize: 50 }, {
      cliPath,
      env: { FAKE_CLI_LOG: logPath },
    });

    assert.equal(result.success, true);
    assert.equal(result.commandPath, "workflow inboxtask list-inbox");
    assert.deepEqual(result.input, { pageSize: 50 });
    assert.deepEqual(readLog(logPath).map((call) => call.args[0]), ["--schema", "workflow"]);
  });

  it("危险命令只使用当前 CLI 声明的参数，不追加未支持的 --yes", async () => {
    const dir = makeTempDir();
    const cliPath = writeFakeCli(dir);
    const logPath = join(dir, "calls.log");

    await runBipCli(
      ["workflow", "task", "batch-approve"],
      { primaryIds: JSON.stringify(["m1"]), content: "同意" },
      {
        cliPath,
        dangerous: true,
        env: { FAKE_CLI_LOG: logPath },
      },
    );

    const businessCall = readLog(logPath).find((call) => call.args[0] === "workflow");
    assert.deepEqual(businessCall.args, [
      "workflow",
      "task",
      "batch-approve",
      "--input",
      "-",
      "--format",
      "json",
    ]);
  });

  it("旧 CLI 缺少业务命令时在调用前给出同 profile 升级提示", async () => {
    const dir = makeTempDir();
    const cliPath = writeFakeCli(dir, { schema: [{ path: "workflow task batch-approve" }] });
    const logPath = join(dir, "calls.log");

    await assert.rejects(
      runBipCli("workflow inboxtask list-inbox", {}, { cliPath, env: { FAKE_CLI_LOG: logPath } }),
      (error) => {
        assert.match(error.message, /依赖能力不兼容/);
        assert.match(error.message, /workflow inboxtask list-inbox/);
        assert.match(error.message, /同一 profile/);
        assert.match(error.message, new RegExp(cliPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        return true;
      },
    );
    assert.deepEqual(readLog(logPath).map((call) => call.args), [["--schema"]]);
  });

  it("旧智能审核路由只禁用智能审核，不阻塞待办主流程", async () => {
    const dir = makeTempDir();
    const cliPath = writeFakeCli(dir, {
      artifactMarkers: ["/ssc-intelligent-audit/cloudAudit/queryCloudAuditResultDesc"],
    });
    const logPath = join(dir, "calls.log");

    const inbox = await runBipCli("workflow inboxtask list-inbox", { pageSize: 20 }, {
      cliPath,
      env: { FAKE_CLI_LOG: logPath },
    });
    assert.equal(inbox.success, true);
    await assert.doesNotReject(assertRequiredBipCliCapabilities({ cliPath }));

    await assert.rejects(
      runBipCli("workflow inboxtask get-intelligent-result", {
        taskId: "task-1",
        businessKey: "biz-1",
      }, { cliPath, env: { FAKE_CLI_LOG: logPath } }),
      (error) => {
        assert.match(error.message, /依赖能力不兼容/);
        assert.match(error.message, /缺少智能审核兼容路由/);
        assert.match(error.message, /yonbip-mid-sscia/);
        assert.equal(error.remoteRequestStarted, false);
        return true;
      },
    );
    const businessCalls = readLog(logPath).filter((call) => call.args[0] !== "--schema");
    assert.deepEqual(businessCalls.map((call) => call.args.slice(0, 3)), [["workflow", "inboxtask", "list-inbox"]]);
  });

  it("Schema 非 JSON 时返回可诊断错误", async () => {
    const dir = makeTempDir();
    const cliPath = writeFakeCli(dir, { schemaRaw: "not-json" });

    await assert.rejects(
      runBipCli("workflow inboxtask list-inbox", {}, { cliPath }),
      /能力探测失败.*--schema 返回非 JSON/,
    );
  });

  it("Schema 不是数组时返回可诊断错误", async () => {
    const dir = makeTempDir();
    const cliPath = writeFakeCli(dir, { schema: { path: "workflow inboxtask list-inbox" } });

    await assert.rejects(
      assertRequiredBipCliCapabilities({ cliPath }),
      /能力探测失败.*--schema 返回值不是数组/,
    );
  });

  it("Schema 探测进程失败时返回可诊断错误", async () => {
    const dir = makeTempDir();
    const cliPath = writeFakeCli(dir, { schemaExitCode: 9 });

    await assert.rejects(
      runBipCli("workflow inboxtask list-inbox", {}, { cliPath }),
      /能力探测失败.*fake schema failure/,
    );
  });

  it("CLI 文件更新后缓存失效并重新探测", async () => {
    const dir = makeTempDir();
    const cliPath = writeFakeCli(dir);
    const logPath = join(dir, "calls.log");
    const options = { cliPath, env: { FAKE_CLI_LOG: logPath } };

    await runBipCli("workflow inboxtask list-inbox", {}, options);
    writeFakeCli(dir, {
      schema: [{ path: "workflow task batch-approve" }],
      padding: "force-size-change-for-cache-invalidation",
    });

    await assert.rejects(
      runBipCli("workflow inboxtask list-inbox", {}, options),
      /workflow inboxtask list-inbox/,
    );
    assert.equal(readLog(logPath).filter((call) => call.args[0] === "--schema").length, 2);
  });

  it("supports explicit capability cache clearing", async () => {
    const dir = makeTempDir();
    const cliPath = writeFakeCli(dir);
    const logPath = join(dir, "calls.log");
    const options = { cliPath, env: { FAKE_CLI_LOG: logPath } };

    await runBipCli("whoami", {}, options);
    await runBipCli("whoami", {}, options);
    clearBipCliCapabilityCache(cliPath);
    await runBipCli("whoami", {}, options);

    assert.equal(readLog(logPath).filter((call) => call.args[0] === "--schema").length, 2);
  });
});
