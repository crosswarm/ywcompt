/**
 * bill-utils.test.mjs — 单据工具函数单元测试
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectType, extractAttachments, detectChanges } from "./bill-utils.mjs";

// ── detectType ─────────────────────────────────────────────

describe("detectType()", () => {
  it("识别 patch：标题含紧急补丁审批单", () => {
    assert.equal(detectType({ title: "紧急补丁审批单#HXDA-123" }), "patch");
  });

  it("识别 patch：formId 含 CJJBDYJZSP", () => {
    assert.equal(detectType({ title: "", formId: "developplatform.CJJBDYJZSP" }), "patch");
  });

  it("识别 data-request：特定 formId", () => {
    assert.equal(detectType({ formId: "73176167895d4880b47a1dd9ed4ad790" }), "data-request");
  });

  it("识别 online：标题含上线申请单", () => {
    assert.equal(detectType({ title: "BIP上线申请单打印管理紧急上线" }), "online");
    assert.equal(detectType({ title: "上线申请单测试" }), "online");
  });

  it("识别 expense：标题含报销", () => {
    assert.equal(detectType({ title: "员工费用报销单待办提醒" }), "expense");
  });

  it("识别 expense：formId 含 expensebill", () => {
    assert.equal(detectType({ formId: "RBSM.znbzbx_expensebill" }), "expense");
  });

  it("兜底返回 other", () => {
    assert.equal(detectType({ title: "请假申请", formId: "abc123" }), "other");
  });

  it("处理空输入", () => {
    assert.equal(detectType({}), "other");
  });
});

// ── extractAttachments ─────────────────────────────────────

describe("extractAttachments()", () => {
  it("返回空数组当 iformData 为 null", () => {
    assert.deepEqual(extractAttachments(null), []);
  });

  it("返回空数组当 head 为空", () => {
    assert.deepEqual(extractAttachments({ head: {} }), []);
  });

  it("提取附件元数据", () => {
    const iformData = {
      head: {
        someField: {
          name: JSON.stringify([
            { name: "test.pdf", type: "pdf", size: 1024, url: "/files/test.pdf", fid: "fid123" },
          ]),
        },
      },
    };
    const result = extractAttachments(iformData);
    assert.equal(result.length, 1);
    assert.equal(result[0].fileName, "test.pdf");
    assert.equal(result[0].fileType, "pdf");
    assert.equal(result[0].size, 1024);
    assert.equal(result[0].url, "/files/test.pdf");
    assert.equal(result[0].fid, "fid123");
  });

  it("跳过非 JSON 数组的字段", () => {
    const iformData = {
      head: {
        name: { name: "普通文本" },
        num: { name: "123" },
      },
    };
    assert.deepEqual(extractAttachments(iformData), []);
  });

  it("跳过不含 url/fid/name 的条目", () => {
    const iformData = {
      head: {
        f: {
          name: JSON.stringify([{ type: "pdf", size: 100 }]),
        },
      },
    };
    assert.deepEqual(extractAttachments(iformData), []);
  });

  it("处理 value 中也存在附件数据的情况", () => {
    const iformData = {
      head: {
        f: {
          value: JSON.stringify([
            { name: "doc.docx", type: "docx", size: 2048, url: "/files/doc.docx", fid: "fid456" },
          ]),
        },
      },
    };
    const result = extractAttachments(iformData);
    assert.equal(result.length, 1);
    assert.equal(result[0].fileName, "doc.docx");
  });
});

// ── detectChanges ─────────────────────────────────────────

describe("detectChanges()", () => {
  it("两空集 → 无变化", () => {
    const r = detectChanges([], []);
    assert.equal(r.hasChanges, false);
    assert.deepEqual(r.newIds, []);
    assert.deepEqual(r.completedIds, []);
  });

  it("相同集合 → 无变化", () => {
    const r = detectChanges(["a", "b"], ["a", "b"]);
    assert.equal(r.hasChanges, false);
  });

  it("发现新增条目", () => {
    const r = detectChanges(["a"], ["a", "b", "c"]);
    assert.equal(r.hasChanges, true);
    assert.deepEqual(r.newIds.sort(), ["b", "c"]);
  });

  it("发现已完成条目", () => {
    const r = detectChanges(["a", "b", "c"], ["a"]);
    assert.equal(r.hasChanges, true);
    assert.deepEqual(r.completedIds, ["b", "c"]);
  });

  it("同时发现新增和已完成", () => {
    const r = detectChanges(["a", "b"], ["b", "c"]);
    assert.equal(r.hasChanges, true);
    assert.deepEqual(r.newIds, ["c"]);
    assert.deepEqual(r.completedIds, ["a"]);
  });

  it("只有新增 → 有变化", () => {
    const r = detectChanges([], ["a"]);
    assert.equal(r.hasChanges, true);
    assert.deepEqual(r.newIds, ["a"]);
    assert.deepEqual(r.completedIds, []);
  });

  it("只有完成 → 有变化", () => {
    const r = detectChanges(["a"], []);
    assert.equal(r.hasChanges, true);
    assert.deepEqual(r.newIds, []);
    assert.deepEqual(r.completedIds, ["a"]);
  });
});
