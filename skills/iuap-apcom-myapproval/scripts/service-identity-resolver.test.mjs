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
  assert.equal(result.provider, "iuap-apcom-cli.auth.permission.apply");
});

test("resolveServiceIdentities: todo.serviceName 是技术码时不可信，仍查询 CLI", async () => {
  let calls = 0;
  const result = await resolveServiceIdentities(
    [{ serviceCode: "GZTACT045", serviceName: "GZTACT045" }],
    {
      runBipCli: async () => {
        calls += 1;
        return { serviceCode: "GZTACT045", serviceName: "权限申请单" };
      },
    },
  );

  assert.equal(calls, 1);
  assert.equal(result.bySourceCode.get("GZTACT045").serviceName, "权限申请单");
  assert.equal(
    result.bySourceCode.get("GZTACT045").serviceNameSource,
    "iuap-apcom-cli.auth.permission.apply",
  );
});

test("resolveServiceIdentities: 单词型英文业务名称不被误判为技术码", async () => {
  let calls = 0;
  const result = await resolveServiceIdentities(
    [{ serviceCode: "crm_salesforce", serviceName: "Salesforce" }],
    {
      runBipCli: async () => {
        calls += 1;
        throw new Error("不应调用");
      },
    },
  );

  assert.equal(calls, 0);
  assert.equal(result.bySourceCode.get("crm_salesforce").serviceName, "Salesforce");
});

test("resolveServiceIdentities: todo 直出可信名称时按明确 transType_ 前缀规范编码", async () => {
  let calls = 0;
  const sourceServiceCode = "1559597441248919553_znbzbx_expensebilllist";
  const result = await resolveServiceIdentities(
    [{
      serviceCode: sourceServiceCode,
      transType: "1559597441248919553",
      serviceName: "通用报销单",
    }],
    {
      runBipCli: async () => {
        calls += 1;
        throw new Error("不应调用");
      },
    },
  );

  assert.equal(calls, 0);
  assert.deepEqual(result.bySourceCode.get(sourceServiceCode), {
    serviceCode: "znbzbx_expensebilllist",
    sourceServiceCode,
    serviceName: "通用报销单",
    serviceNameSource: "todo",
  });
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
    serviceNameSource: "iuap-apcom-cli.auth.permission.apply",
  });
});

test("resolveServiceIdentities: 元数据返回技术码名称时按未解析处理", async () => {
  const result = await resolveServiceIdentities(
    [{ serviceCode: "unknownbill" }],
    {
      runBipCli: async () => ({
        serviceCode: "unknownbill",
        serviceName: "unknownbill",
      }),
    },
  );

  assert.deepEqual(result.bySourceCode.get("unknownbill"), {
    serviceCode: "unknownbill",
    serviceName: "",
  });
  assert.equal(result.resolvedCount, 0);
  assert.equal(result.unresolvedCount, 1);
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
    serviceNameSource: "iuap-apcom-cli.auth.permission.apply",
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
        serviceNameSource: "iuap-apcom-cli.auth.permission.apply",
      },
    ),
    {
      id: "1",
      serviceCode: "pu_applyorderlist",
      sourceServiceCode: "PU_pu_applyorderlist",
      serviceName: "请购单",
      serviceNameSource: "iuap-apcom-cli.auth.permission.apply",
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

test("历史标准身份在本轮解析失败时保持一致，且不会把落盘名称当作 todo 直出值", async () => {
  const historical = {
    id: "history-1",
    status: "done",
    serviceCode: "pu_applyorderlist",
    sourceServiceCode: "PU_pu_applyorderlist",
    serviceName: "请购单",
    serviceNameSource: "iuap-apcom-cli.auth.permission.apply",
  };
  let calls = 0;
  const batch = await resolveServiceIdentities([historical], {
    runBipCli: async () => {
      calls += 1;
      throw new Error("offline");
    },
  });

  assert.equal(calls, 1);
  const applied = applyServiceIdentity(
    historical,
    batch.bySourceCode.get("PU_pu_applyorderlist"),
  );
  assert.deepEqual(applied, historical);
});

test("历史 bip-cli 来源在元数据暂时不可用时迁移为正式 iuap-apcom-cli 来源", async () => {
  const historical = {
    id: "history-legacy-provider",
    status: "done",
    serviceCode: "GZTACT045",
    serviceName: "权限申请单",
    serviceNameSource: "bip-cli.auth.permission.apply",
  };
  const batch = await resolveServiceIdentities([historical], {
    runBipCli: async () => {
      throw new Error("offline");
    },
  });

  const applied = applyServiceIdentity(
    historical,
    batch.bySourceCode.get("GZTACT045"),
  );
  assert.equal(
    applied.serviceNameSource,
    "iuap-apcom-cli.auth.permission.apply",
  );
});

test("历史技术码名称在刷新失败时清理整组派生身份", async () => {
  const historical = {
    id: "history-technical",
    status: "done",
    serviceCode: "unknownbill",
    serviceName: "unknownbill",
    serviceNameSource: "iuap-apcom-cli.auth.permission.apply",
    docTypeName: "unknownbill",
    displayLabel: "unknownbill",
  };
  const batch = await resolveServiceIdentities([historical], {
    runBipCli: async () => {
      throw new Error("offline");
    },
  });

  const applied = applyServiceIdentity(
    historical,
    batch.bySourceCode.get("unknownbill"),
  );
  assert.equal(applied.serviceName, undefined);
  assert.equal(applied.serviceNameSource, undefined);
  assert.equal(applied.docTypeName, undefined);
  assert.equal(applied.displayLabel, undefined);
  assert.equal(applied.serviceCode, "unknownbill");
});
