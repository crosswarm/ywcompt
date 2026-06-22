/**
 * fetch-bill-detail.test.mjs — parseWebUrl / pickMicroservice / billDetailToFields 单测
 * 纯函数部分（不涉及网络/cookie），用真实 webUrl 样本验证解析。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseWebUrl,
  pickMicroservice,
  billDetailToFields,
  loadFetchProfiles,
  getFetchProfile,
  extractDetailAttachments,
} from "./fetch-bill-detail.mjs";

describe("parseWebUrl()", () => {
  it("voucher 型（请购单 pu_applyorder）", () => {
    const r = parseWebUrl(
      "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/2552842636008882176?domainKey=upu&taskId=a01c4fb6-5e5f-11f1-abe1-729468f180f8&appSource=PU&taskFlag=todo&tenantId=z1kqq"
    );
    assert.equal(r.kind, "voucher");
    assert.equal(r.billnum, "pu_applyorder");
    assert.equal(r.billId, "2552842636008882176");
    assert.equal(r.domainKey, "upu");
    assert.equal(r.taskId, "a01c4fb6-5e5f-11f1-abe1-729468f180f8");
    assert.equal(r.tenantId, "z1kqq");
  });

  it("voucher 型大写 Voucher（审批 d85663_qx001）", () => {
    const r = parseWebUrl(
      "https://c1.yonyoucloud.com/mdf-node/meta/Voucher/d85663_qx001/2548901470954586115?domainKey=x"
    );
    assert.equal(r.kind, "voucher");
    assert.equal(r.billnum, "d85663_qx001");
    assert.equal(r.billId, "2548901470954586115");
  });

  it("voucher 型（合同 sact_salescontract）", () => {
    const r = parseWebUrl(
      "https://c1.yonyoucloud.com/mdf-node/meta/voucher/sact_salescontract/2452667059306758152"
    );
    assert.equal(r.kind, "voucher");
    assert.equal(r.billnum, "sact_salescontract");
  });

  it("iform 型（formId + formInstanceId）", () => {
    const r = parseWebUrl(
      "https://c1.yonyoucloud.com/yonbip-ec-iform/index?formId=73176167&formInstanceId=abc123&taskId=t1&tenantId=tn"
    );
    assert.equal(r.kind, "iform");
    assert.equal(r.formId, "73176167");
    assert.equal(r.formInstanceId, "abc123");
  });

  it("外部域 ting.diwork → unsupported", () => {
    assert.equal(parseWebUrl("https://ting.diwork.com").kind, "unsupported");
  });

  it("任务通知 redirect → unsupported", () => {
    assert.equal(
      parseWebUrl("https://c1.yonyoucloud.com/yonbip-ec-logger/task/index/messageUrlRedirect").kind,
      "unsupported"
    );
  });

  it("空/非法 → unsupported", () => {
    assert.equal(parseWebUrl("").kind, "unsupported");
    assert.equal(parseWebUrl(null).kind, "unsupported");
    assert.equal(parseWebUrl("not a url").kind, "unsupported");
  });
});

describe("pickMicroservice()", () => {
  it("znbzbx → fi-expsrbsm", () => {
    assert.equal(pickMicroservice("znbzbx_expensebill"), "yonbip-fi-expsrbsm");
  });
  it("hrtm → hr-tm", () => {
    assert.equal(pickMicroservice("hrtm_x"), "yonbip-hr-tm");
  });
  it("pu_applyorder → yonbip-scm-pu", () => {
    assert.equal(pickMicroservice("pu_applyorder"), "yonbip-scm-pu");
  });
  it("未知前缀 → 默认 yonbuilder-runtime", () => {
    assert.equal(pickMicroservice("unknown_x"), "iuap-yonbuilder-runtime");
  });
  it("空 → 默认", () => {
    assert.equal(pickMicroservice(""), "iuap-yonbuilder-runtime");
  });
});

describe("loadFetchProfiles() / getFetchProfile()", () => {
  it("loadFetchProfiles 返回字典对象（含已验证条目）", () => {
    const d = loadFetchProfiles();
    assert.equal(typeof d, "object");
    assert.ok(d.pu_applyorder, "应含 pu_applyorder");
    assert.equal(d.pu_applyorder.endpoint, "report/detail");
  });

  it("getFetchProfile 命中有 endpoint 的 profile", () => {
    const p = getFetchProfile("pu_applyorder");
    assert.ok(p);
    assert.equal(p.microservice, "yonbip-scm-pu");
    assert.equal(p.serviceCode, "pu_applyorderlist");
  });

  it("getFetchProfile 对 unverified（无 endpoint）返回 null", () => {
    const p = getFetchProfile("tr_project_manage_card");
    assert.equal(p, null);
  });

  it("getFetchProfile 对未知 billnum 返回 null", () => {
    assert.equal(getFetchProfile("nonexistent_bill"), null);
  });

  it("getFetchProfile 支持注入测试字典", () => {
    const p = getFetchProfile("x", { x: { endpoint: "bill/detail", microservice: "ms-x" } });
    assert.equal(p.endpoint, "bill/detail");
  });

  it("getFetchProfile 注入字典中无 endpoint → null", () => {
    assert.equal(getFetchProfile("y", { y: { status: "unverified" } }), null);
  });
});

describe("billDetailToFields()", () => {
  it("提取标量字段，过滤系统字段与空值，并把常见参照对象转成可读值", () => {
    const data = {
      issueid: "8924946",
      sqr: "樊英泽",
      jjcd: "一般",
      lymk: "云打印",
      supplier: { id: "s1", name: "华为技术有限公司" },
      id: "2542254339033923591", // 系统字段，过滤
      pubts: "2026-05-19 10:22:39", // 系统字段，过滤
      creator: "uuid", // 系统字段，过滤
      isWfControlled: 1, // 系统字段，过滤
      nested: { a: 1 }, // 无显示名对象，过滤
      arr: [1, 2], // 数组，过滤
      empty: "", // 空值，过滤
    };
    const fields = billDetailToFields(data);
    const keys = fields.map((f) => f.key);
    assert.ok(keys.includes("issueid"));
    assert.ok(keys.includes("sqr"));
    assert.ok(keys.includes("jjcd"));
    assert.ok(keys.includes("lymk"));
    assert.ok(keys.includes("supplier"));
    assert.ok(!keys.includes("id"));
    assert.ok(!keys.includes("pubts"));
    assert.ok(!keys.includes("creator"));
    assert.ok(!keys.includes("isWfControlled"));
    assert.ok(!keys.includes("nested"));
    assert.ok(!keys.includes("empty"));
    assert.equal(fields.find((f) => f.key === "sqr").value, "樊英泽");
    assert.equal(fields.find((f) => f.key === "supplier").value, "华为技术有限公司");
  });

  it("从 data.head 取字段", () => {
    const fields = billDetailToFields({ head: { amount: "1000", title: "x" } });
    assert.equal(fields.length, 2);
  });

  it("空输入 → []", () => {
    assert.deepEqual(billDetailToFields(null), []);
    assert.deepEqual(billDetailToFields({}), []);
  });
});

describe("extractDetailAttachments()", () => {
  it("从 JSON 数组字符串字段提取附件（url+name+fid）", () => {
    const data = {
      head: {
        amount: "1000",
        accessory: JSON.stringify([
          { name: "合同.pdf", url: "/file/proxy/abc", fid: "f1", size: 2048, type: "pdf" },
          { name: "报价.xlsx", url: "/file/proxy/def", fid: "f2" },
        ]),
      },
    };
    const r = extractDetailAttachments(data);
    assert.equal(r.length, 2);
    assert.equal(r[0].fileName, "合同.pdf");
    assert.equal(r[0].fid, "f1");
    assert.equal(r[0].fileType, "pdf");
    assert.equal(r[1].fileType, "xlsx"); // 从扩展名推断
  });

  it("兼容数组型字段 + fileName/filePath 别名", () => {
    const data = { atts: [{ fileName: "x.doc", filePath: "/p/x", fileId: "i1" }] };
    const r = extractDetailAttachments(data);
    assert.equal(r.length, 1);
    assert.equal(r[0].fileName, "x.doc");
    assert.equal(r[0].url, "/p/x");
    assert.equal(r[0].fid, "i1");
  });

  it("去重（同名同 url）", () => {
    const a = JSON.stringify([{ name: "a.pdf", url: "/u" }]);
    const r = extractDetailAttachments({ f1: a, f2: a });
    assert.equal(r.length, 1);
  });

  it("无附件字段 → []（缺 url 或 name 不计）", () => {
    assert.deepEqual(extractDetailAttachments({ x: JSON.stringify([{ name: "无url" }]) }), []);
    assert.deepEqual(extractDetailAttachments({ a: "1", b: "文本" }), []);
    assert.deepEqual(extractDetailAttachments(null), []);
  });
});
