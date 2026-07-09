import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseArgs,
  pidFilePath,
  readPort,
  serviceUrls,
} from "./ensure-service.mjs";

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
    });
  });

  it("uses the same pid file naming as web-server-control", () => {
    assert.equal(pidFilePath("/tmp/data", 3891), "/tmp/data/web-server.pid");
    assert.equal(pidFilePath("/tmp/data", 3901), "/tmp/data/web-server-3901.pid");
  });
});
