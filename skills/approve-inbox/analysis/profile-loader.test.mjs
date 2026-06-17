/**
 * profile-loader.test.mjs — profile 选择 + 字段中文化 + 维度展开 单测（node:test）
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  loadProfiles,
  selectProfile,
  profileDimensions,
  loadFieldDict,
  localizeFields,
} from "./profile-loader.js";
import { DIMENSIONS, getDimension, expandDimensions } from "./dimensions.js";

describe("dimensions.js", () => {
  it("DIMENSIONS 含 ≥7 个通用维", () => {
    assert.ok(DIMENSIONS.length >= 7);
    const ids = DIMENSIONS.map((d) => d.id);
    for (const must of ["amount-compliance", "budget-match", "attachment-completeness", "info-consistency", "approval-authority", "duplicate-submit", "timeliness"]) {
      assert.ok(ids.includes(must), `缺维度 ${must}`);
    }
  });
  it("getDimension 按 id 取定义", () => {
    assert.equal(getDimension("amount-compliance").name, "金额合规");
    assert.equal(getDimension("nope"), undefined);
  });
  it("expandDimensions 过滤未知 id", () => {
    const r = expandDimensions(["amount-compliance", "nope", "timeliness"]);
    assert.equal(r.length, 2);
    assert.equal(r[0].id, "amount-compliance");
  });
});

describe("loadProfiles()", () => {
  it("加载到 9 个 profile（8 业务 + generic）", () => {
    const ps = loadProfiles();
    assert.ok(ps.length >= 9, `实际 ${ps.length}`);
    assert.ok(ps.some((p) => p._file === "generic.json"));
    assert.ok(ps.some((p) => p._file === "purchase.json"));
  });
});

describe("selectProfile()", () => {
  it("采购 billnum pu_applyorder → purchase", () => {
    const p = selectProfile({ billnum: "pu_applyorder", docType: "请购单" });
    assert.equal(p._file, "purchase.json");
  });
  it("出差 znbzbx → expense-travel", () => {
    const p = selectProfile({ docType: "出差申请", webUrl: "x/voucher/znbzbx_busistrip/1" });
    assert.equal(p._file, "expense-travel.json");
  });
  it("销售合同 → contract", () => {
    const p = selectProfile({ billnum: "sact_salescontract", docType: "合同" });
    // sact_salescontract 同时被 purchase(sact_) 与 contract(sact_salescontract) 匹配，
    // contract 关键词更精确（命中 sact_salescontract + 合同 = 2 分）应胜出
    assert.equal(p._file, "contract.json");
  });
  it("入库单 st_purinrecord → instock", () => {
    const p = selectProfile({ billnum: "st_purinrecord", docType: "入库单" });
    assert.equal(p._file, "instock.json");
  });
  it("数据申请 → data-request", () => {
    assert.equal(selectProfile({ docType: "数据申请" })._file, "data-request.json");
  });
  it("无命中 → generic 兜底", () => {
    const p = selectProfile({ docType: "某种没见过的单据" });
    assert.equal(p._file, "generic.json");
  });
  it("空 item → generic", () => {
    assert.equal(selectProfile(null)._file, "generic.json");
  });
  it("注入 profiles 测试", () => {
    const fake = [
      { _file: "a.json", match: ["foo"] },
      { _file: "generic.json", match: [] },
    ];
    assert.equal(selectProfile({ title: "foo bar" }, fake)._file, "a.json");
    assert.equal(selectProfile({ title: "zzz" }, fake)._file, "generic.json");
  });
});

describe("profileDimensions()", () => {
  it("展开 profile 的 commonDimensions", () => {
    const p = selectProfile({ billnum: "pu_applyorder" });
    const dims = profileDimensions(p);
    assert.ok(dims.length > 0);
    assert.ok(dims.every((d) => d.id && d.name));
  });
});

describe("loadFieldDict() / localizeFields()", () => {
  it("loadFieldDict 扁平化分组", () => {
    const d = loadFieldDict();
    assert.ok(d.submitter_username);
    assert.equal(d.submitter_username.cn, "提交人");
    assert.equal(d.vouchdate.dim, "timeliness");
  });
  it("localizeFields 中文化已知字段 + 标维度", () => {
    const r = localizeFields([
      { key: "submitter_username", value: "强骁" },
      { key: "vouchdate", value: "2026-04-29" },
    ]);
    assert.equal(r[0].name, "提交人");
    assert.equal(r[1].name, "单据日期");
    assert.equal(r[1].dim, "timeliness");
  });
  it("未知 key 保留原 key + 模糊推断维度", () => {
    const r = localizeFields([
      { key: "weird_field", value: "x" },
      { key: "someMoney", value: "100" },
    ]);
    assert.equal(r[0].name, "weird_field");
    assert.equal(r[1].dim, "amount-compliance");
  });
  it("非数组 → []", () => {
    assert.deepEqual(localizeFields(null), []);
  });
  it("注入 dict 测试", () => {
    const r = localizeFields([{ key: "k", value: "v" }], { k: { cn: "中文K", dim: "x" } });
    assert.equal(r[0].name, "中文K");
    assert.equal(r[0].dim, "x");
  });
});
