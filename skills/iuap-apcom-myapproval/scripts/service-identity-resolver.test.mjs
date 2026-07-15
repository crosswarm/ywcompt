import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyServiceIdentity,
  extractSourceServiceCode,
  resolveServiceIdentities,
} from "./service-identity-resolver.mjs";

test("extractSourceServiceCode: todo.serviceCode 优先，URL 可兜底且不裁剪 list", () => {
  assert.equal(
    extractSourceServiceCode({
      serviceCode: "pu_applyorderlist",
      webUrl: "https://example.test/todo?serviceCode=ignored",
    }),
    "pu_applyorderlist",
  );
  assert.equal(
    extractSourceServiceCode({
      webUrl: "https://example.test/todo?serviceCode=st_purchaseorderlist",
    }),
    "st_purchaseorderlist",
  );
});

test("resolveServiceIdentities: todo.serviceName 直接使用，不调用 CLI", async () => {
  let calls = 0;
  const result = await resolveServiceIdentities(
    [{ serviceCode: "GZTACT045", serviceName: "权限申请单" }],
    {
      runBipCli: async () => {
        calls += 1;
        throw new Error("不应调用");
      },
    },
  );

  assert.equal(calls, 0);
  assert.deepEqual(result.bySourceCode.get("GZTACT045"), {
    serviceCode: "GZTACT045",
    serviceName: "权限申请单",
    serviceNameSource: "todo",
  });
  assert.equal(result.resolvedCount, 1);
  assert.equal(result.unresolvedCount, 0);
  assert.equal(result.provider, "bip-cli.auth.permission.apply");
});

test("resolveServiceIdentities: 精确查询原始编码并透传 15 秒超时", async () => {
  const calls = [];
  const result = await resolveServiceIdentities(
    [{ webUrl: "https://example.test/todo?serviceCode=pu_applyorderlist" }],
    {
      runBipCli: async (...args) => {
        calls.push(args);
        return { serviceCode: "pu_applyorderlist", serviceName: "请购单" };
      },
    },
  );

  assert.deepEqual(calls, [
    [["auth", "permission", "apply"], { service: "pu_applyorderlist" }, { timeoutMs: 15_000 }],
  ]);
  assert.deepEqual(result.bySourceCode.get("pu_applyorderlist"), {
    serviceCode: "pu_applyorderlist",
    serviceName: "请购单",
    serviceNameSource: "bip-cli.auth.permission.apply",
  });
});

test("resolveServiceIdentities: 仅精确查询失败且匹配 transType_ 时重试后缀", async () => {
  const calls = [];
  const result = await resolveServiceIdentities(
    [{ serviceCode: "PU_pu_applyorderlist", transType: "PU" }],
    {
      runBipCli: async (_command, input) => {
        calls.push(input.service);
        if (input.service === "PU_pu_applyorderlist") {
          return { error: true, message: "not found" };
        }
        return { serviceCode: "pu_applyorderlist", serviceName: "请购单" };
      },
    },
  );

  assert.deepEqual(calls, ["PU_pu_applyorderlist", "pu_applyorderlist"]);
  assert.deepEqual(result.bySourceCode.get("PU_pu_applyorderlist"), {
    serviceCode: "pu_applyorderlist",
    sourceServiceCode: "PU_pu_applyorderlist",
    serviceName: "请购单",
    serviceNameSource: "bip-cli.auth.permission.apply",
  });
});

test("resolveServiceIdentities: 精确成功不重试，未匹配前缀也不重试", async () => {
  const exactCalls = [];
  await resolveServiceIdentities([{ serviceCode: "PU_orderlist", transType: "PU" }], {
    runBipCli: async (_command, input) => {
      exactCalls.push(input.service);
      return { serviceCode: input.service, serviceName: "采购订单" };
    },
  });
  assert.deepEqual(exactCalls, ["PU_orderlist"]);

  const failedCalls = [];
  const failed = await resolveServiceIdentities([{ serviceCode: "orderlist", transType: "PU" }], {
    runBipCli: async (_command, input) => {
      failedCalls.push(input.service);
      throw new Error("offline");
    },
  });
  assert.deepEqual(failedCalls, ["orderlist"]);
  assert.deepEqual(failed.bySourceCode.get("orderlist"), {
    serviceCode: "orderlist",
    serviceName: "",
  });
  assert.equal(failed.unresolvedCount, 1);
});

test("resolveServiceIdentities: 相同原始编码去重，并发上限不超过 4，单项失败不抛出", async () => {
  let active = 0;
  let maxActive = 0;
  const calls = [];
  const items = [
    ...Array.from({ length: 7 }, (_, index) => ({ serviceCode: `service-${index}` })),
    { serviceCode: "service-0" },
  ];

  const result = await resolveServiceIdentities(items, {
    concurrency: 99,
    runBipCli: async (_command, input) => {
      calls.push(input.service);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (input.service === "service-6") throw new Error("isolated failure");
      return { serviceCode: input.service, serviceName: `名称-${input.service}` };
    },
  });

  assert.equal(calls.length, 7);
  assert.equal(calls.filter((code) => code === "service-0").length, 1);
  assert.ok(maxActive <= 4, `实际并发 ${maxActive} 超过上限`);
  assert.equal(result.bySourceCode.size, 7);
  assert.equal(result.resolvedCount, 6);
  assert.equal(result.unresolvedCount, 1);
});

test("applyServiceIdentity: 写入规范编码和名称，sourceServiceCode 仅在编码变化时存在", () => {
  assert.deepEqual(
    applyServiceIdentity(
      { id: "1", serviceCode: "PU_pu_applyorderlist", docType: "审批单" },
      {
        serviceCode: "pu_applyorderlist",
        sourceServiceCode: "PU_pu_applyorderlist",
        serviceName: "请购单",
        serviceNameSource: "bip-cli.auth.permission.apply",
      },
    ),
    {
      id: "1",
      serviceCode: "pu_applyorderlist",
      sourceServiceCode: "PU_pu_applyorderlist",
      serviceName: "请购单",
      serviceNameSource: "bip-cli.auth.permission.apply",
      docType: "审批单",
    },
  );

  const unchanged = applyServiceIdentity(
    { id: "2", serviceCode: "GZTACT045", sourceServiceCode: "GZTACT045" },
    {
      serviceCode: "GZTACT045",
      serviceName: "权限申请单",
      serviceNameSource: "todo",
    },
  );
  assert.equal(unchanged.sourceServiceCode, undefined);
});
