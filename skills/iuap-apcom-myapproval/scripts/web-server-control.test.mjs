import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildPidRecord,
  isApproveInboxServerCommand,
  parseArgs,
  parsePidFile,
  parsePidList,
  pidFilePath,
  readPort,
} from "./web-server-control.mjs";

describe("web-server-control readPort()", () => {
  it("accepts valid TCP ports and falls back for invalid input", () => {
    assert.equal(readPort("3907"), 3907);
    assert.equal(readPort("0"), 3891);
    assert.equal(readPort("70000"), 3891);
    assert.equal(readPort("nope", 3901), 3901);
  });
});

describe("web-server-control parseArgs()", () => {
  it("parses command, port, and json flag", () => {
    assert.deepEqual(parseArgs(["restart", "--port", "3907", "--json"]), {
      command: "restart",
      port: 3907,
      json: true,
    });
    assert.deepEqual(parseArgs(["--port=3908"]), {
      command: "status",
      port: 3908,
      json: false,
    });
  });

  it("rejects unknown commands and flags", () => {
    assert.throws(() => parseArgs(["bounce"]), /Unknown command/);
    assert.throws(() => parseArgs(["status", "--force"]), /Unknown argument/);
  });
});

describe("web-server-control pid files", () => {
  it("uses stable pidfile names for default and custom ports", () => {
    assert.equal(pidFilePath("/tmp/data", 3891), "/tmp/data/web-server.pid");
    assert.equal(pidFilePath("/tmp/data", 3907), "/tmp/data/web-server-3907.pid");
  });

  it("round-trips pid records and rejects malformed input", () => {
    const record = buildPidRecord({
      pid: 1234,
      port: 3907,
      skillDir: "/repo/skills/iuap-apcom-myapproval",
      serverPath: "/repo/skills/iuap-apcom-myapproval/web/server.mjs",
      startedAt: "2026-07-06T00:00:00.000Z",
    });

    assert.deepEqual(parsePidFile(JSON.stringify(record)), record);
    assert.equal(parsePidFile("{bad json"), null);
    assert.equal(parsePidFile(JSON.stringify({ pid: "nope" })), null);
  });
});

describe("web-server-control parsePidList()", () => {
  it("parses Unix lsof and PowerShell PID lists", () => {
    assert.deepEqual(parsePidList("123\n456\n123\n"), [123, 456]);
    assert.deepEqual(parsePidList("  9912\r\n 10001\r\n"), [9912, 10001]);
    assert.deepEqual(parsePidList(""), []);
  });
});

describe("web-server-control isApproveInboxServerCommand()", () => {
  const skillDir = "/Users/test/agentwork/approve-center/skills/iuap-apcom-myapproval";
  const serverPath = `${skillDir}/web/server.mjs`;

  it("accepts absolute server paths on Unix and Windows command lines", () => {
    assert.equal(isApproveInboxServerCommand(
      `/usr/local/bin/node ${serverPath}`,
      { skillDir, serverPath },
    ), true);

    assert.equal(isApproveInboxServerCommand(
      "C:\\Program Files\\nodejs\\node.exe C:\\Users\\test\\agentwork\\approve-center\\skills\\iuap-apcom-myapproval\\web\\server.mjs",
      {
        skillDir: "C:/Users/test/agentwork/approve-center/skills/iuap-apcom-myapproval",
        serverPath: "C:/Users/test/agentwork/approve-center/skills/iuap-apcom-myapproval/web/server.mjs",
      },
    ), true);
  });

  it("accepts relative web/server.mjs only when a trusted pidfile cwd matches", () => {
    assert.equal(isApproveInboxServerCommand(
      "node web/server.mjs",
      { skillDir, serverPath },
    ), false);

    assert.equal(isApproveInboxServerCommand(
      "node web/server.mjs",
      {
        skillDir,
        serverPath,
        pidRecord: {
          pid: 1234,
          port: 3891,
          skillDir,
          serverPath,
        },
      },
    ), true);
  });

  it("rejects browser and unrelated Node command lines", () => {
    assert.equal(isApproveInboxServerCommand(
      "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper --type=network.mojom.NetworkService",
      { skillDir, serverPath },
    ), false);

    assert.equal(isApproveInboxServerCommand(
      "/usr/local/bin/node /tmp/other/web/server.mjs",
      { skillDir, serverPath },
    ), false);
  });
});
