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
  extractMdfAttachmentMeta,
  extractMdfFieldMetadata,
  normalizeMdfFileAttachments,
  buildMdfFileParams,
  buildMdfCommentFileParams,
  buildMdfTaskFileParams,
  fetchMdfCommentFileAttachments,
  fetchMdfTaskFileAttachments,
  buildIuapFileSignHeaders,
  decryptMdfFileDownloadUrl,
  resolveMdfFileDownloadUrl,
  clearIuapFileSignConfigCache,
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

  it("voucher 型保留 serviceCode（附件接口需要）", () => {
    const r = parseWebUrl(
      "https://c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/2520915154810437641?domainKey=upu&serviceCode=pu_applyorderlist"
    );
    assert.equal(r.serviceCode, "pu_applyorderlist");
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
  it("st_purchaseorder → yonbip-scm-pu", () => {
    assert.equal(pickMicroservice("st_purchaseorder"), "yonbip-scm-pu");
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

  it("getFetchProfile 命中采购订单 st_purchaseorder profile", () => {
    const p = getFetchProfile("st_purchaseorder");
    assert.ok(p);
    assert.equal(p.microservice, "yonbip-scm-pu");
    assert.equal(p.serviceCode, "st_purchaseorderlist");
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

describe("extractMdfAttachmentMeta()", () => {
  it("从 MDF meta 的 attachment style 和 filelist 控件提取附件参数", () => {
    const meta = {
      view: {
        areas: [
          {
            cGroupCode: "pu_applyorder_body_attach_base_data",
            cStyle: JSON.stringify({
              type: "attachment",
              objectName: "yonbip-scm-pu",
              attachGroupCode: "upu.pu_applyorder",
            }),
          },
        ],
        fields: [
          {
            cControlType: "FileList",
            cDataSourceName: "pu.applyorder.ApplyOrder",
            cGroupCode: "pu_applyorder_body_attach_base_data",
          },
        ],
      },
    };
    const r = extractMdfAttachmentMeta(meta);
    assert.equal(r.attachGroupCode, "pu_applyorder_body_attach_base_data");
    assert.equal(r.objectName, "yonbip-scm-pu");
    assert.equal(r.ndiUri, "pu.applyorder.ApplyOrder");
  });
});

describe("extractMdfFieldMetadata()", () => {
  it("从 MDF meta controls 提取 label、枚举、参照和权限", () => {
    const meta = {
      viewmeta: {
        view: {
          containers: [
            {
              cGroupName: "基本信息",
              controls: [
                {
                  cItemName: "vinvoicesituation",
                  cShowCaption: "账单情况",
                  cControlType: "Select",
                  cEnumType: "vinvoicesituation",
                  cEnumString: "{\"0\":\"无发票\",\"1\":\"全电票\"}",
                  bShowIt: true,
                  bMustSelect: true,
                },
                {
                  cItemName: "pk_project",
                  cShowCaption: "预算项目",
                  cControlType: "refer",
                  cRefType: "ucfbasedoc.bd_projectNewRef",
                },
                {
                  cItemName: "btnAudit",
                  cShowCaption: "审核",
                  cControlType: "Button",
                },
              ],
            },
          ],
        },
      },
    };
    const fields = extractMdfFieldMetadata(meta);
    assert.equal(fields.vinvoicesituation.label, "账单情况");
    assert.equal(fields.vinvoicesituation.enumType, "vinvoicesituation");
    assert.deepEqual(fields.vinvoicesituation.options, [
      { value: "0", label: "无发票" },
      { value: "1", label: "全电票" },
    ]);
    assert.equal(fields.vinvoicesituation.required, true);
    assert.equal(fields.pk_project.refType, "ucfbasedoc.bd_projectNewRef");
    assert.equal(fields.btnAudit, undefined);
  });

  it("把 MDF 参照显示字段别名归并到真实字段 ID", () => {
    const fields = extractMdfFieldMetadata({
      viewmeta: {
        view: {
          containers: [
            {
              cGroupName: "基本信息",
              controls: [
                {
                  cItemName: "pk_project_name",
                  cFieldName: "pk_project.name",
                  cShowCaption: "预算项目",
                  cControlType: "refer",
                  cRefType: "ucfbasedoc.bd_projectNewRef",
                },
              ],
            },
          ],
        },
      },
    });
    assert.equal(fields.pk_project.label, "预算项目");
    assert.ok(fields.pk_project.aliases.includes("pk_project_name"));
    assert.ok(fields.pk_project.aliases.includes("pk_project.name"));
    assert.equal(fields.pk_project_name, undefined);
  });
});

describe("normalizeMdfFileAttachments()", () => {
  it("归一化 iuap-apcom-file/rest/fe/file/files 响应", () => {
    const r = normalizeMdfFileAttachments({
      data: [
        {
          fileId: "6a3ba98e3de1e84873dc58dc",
          id: "6a3ba98e3de1e84873dc58dc",
          filePath: "iuap-apcom-file-private/yonbip-scm-pu/perm/i7nir83e/a.docx",
          fileExtension: ".docx",
          fileSize: 44582,
          fileName: "请购单_增强说明版",
          name: "请购单_增强说明版.docx",
          sign: "sig-1",
          expandParams: { authId: "pu_applyorderlist" },
        },
      ],
      count: 1,
    });
    assert.equal(r.length, 1);
    assert.equal(r[0].fileName, "请购单_增强说明版.docx");
    assert.equal(r[0].fileType, "docx");
    assert.equal(r[0].size, 44582);
    assert.equal(r[0].fid, "6a3ba98e3de1e84873dc58dc");
    assert.equal(r[0].storagePath, "iuap-apcom-file-private/yonbip-scm-pu/perm/i7nir83e/a.docx");
    assert.equal(r[0].authId, "pu_applyorderlist");
    assert.equal(r[0].fileSign, "sig-1");
    assert.equal(r[0].url, "");
  });

  it("按 fid/name/path 去重", () => {
    const row = { fileId: "f1", name: "a.pdf", filePath: "p/a.pdf" };
    assert.equal(normalizeMdfFileAttachments({ data: [row, row] }).length, 1);
  });

  it("归一化任务附件的嵌套 fileInfo 响应并标记来源", () => {
    const r = normalizeMdfFileAttachments(
      {
        data: {
          records: [
            {
              fileInfo: {
                id: "task-file-1",
                fileName: "任务附件说明.png",
                fileSize: 1024,
                fileUrl: "/download/task-file-1",
              },
            },
          ],
        },
      },
      { source: "mdf-task-file-api" }
    );
    assert.equal(r.length, 1);
    assert.equal(r[0].fileName, "任务附件说明.png");
    assert.equal(r[0].fid, "task-file-1");
    assert.equal(r[0].fileType, "png");
    assert.equal(r[0].source, "mdf-task-file-api");
  });
});

describe("MDF attachment params", () => {
  const parsed = {
    kind: "voucher",
    billnum: "st_purchaseorder",
    billId: "2569696396933857299",
    domainKey: "upu",
    serviceCode: "st_purchaseorderlist",
  };
  const detail = {
    code: "000352",
    verifystate: 1,
    org: "1719525968768401418",
  };
  const opts = {
    item: { billName: "采购订单" },
    serviceCode: "st_purchaseorderlist",
    ms: "yonbip-scm-pu",
    tplInfo: { transtype: "2569692479914770435" },
    attachmentMeta: {
      attachGroupCode: "st_purchaseorder_body_attach_base_data",
      objectName: "yonbip-scm-pu",
      ndiUri: "pu.purchaseorder.PurchaseOrder",
    },
  };

  it("标准附件参数对齐采购订单 000352", () => {
    const p = buildMdfFileParams(parsed, detail, opts);
    assert.equal(p.objectId, "2569696396933857299");
    assert.equal(p.objectName, "yonbip-scm-pu");
    assert.equal(p.businessId, "2569696396933857299");
    assert.equal(p.groupId, "0");
    assert.equal(p.authId, "st_purchaseorderlist");
    assert.equal(p.buttonPrefix, "st_purchaseorderlist_st_purchaseorder_body_attach_base_data");
    assert.equal(p.billNo, "st_purchaseorder");
    assert.equal(p.servicePrefix, "2569692479914770435");
    assert.equal(p.domainApp, "yonbip-scm-pu");
    assert.equal(p.ndiUri, "pu.purchaseorder.PurchaseOrder");
    assert.equal(p.billCode, "000352");
    assert.equal(p.billId, "2569696396933857299");
    assert.equal(p.serviceCode, "st_purchaseorderlist");
    assert.equal(p.domainKey, "upu");
    assert.equal(p.transtype, "2569692479914770435");
    assert.equal(p.orgId, "1719525968768401418");
    assert.equal(p.billName, "采购订单");
    assert.equal(p.sbillno, "st_purchaseorderlist");
  });

  it("评论附件使用 billId_comment 且 groupId 为空", () => {
    const p = buildMdfCommentFileParams(parsed, detail, opts);
    assert.equal(p.objectId, "2569696396933857299_comment");
    assert.equal(p.objectName, "yonbip-scm-pu");
    assert.equal(p.businessId, "2569696396933857299");
    assert.equal(p.businessType, "yonbip-scm-pu");
    assert.equal(p.groupId, "");
    assert.equal(p.billCode, "000352");
    assert.equal(p.buttonPrefix, "st_purchaseorderlist_st_purchaseorder_body_attach_base_data");
  });

  it("任务附件参数只保留鉴权上下文并扩大 pageSize", () => {
    const p = buildMdfTaskFileParams(parsed, detail, opts);
    assert.equal(p.authId, "st_purchaseorderlist");
    assert.equal(p.buttonPrefix, "st_purchaseorderlist_st_purchaseorder_body_attach_base_data");
    assert.equal(p.billNo, "st_purchaseorder");
    assert.equal(p.billId, "2569696396933857299");
    assert.equal(p.billCode, "000352");
    assert.equal(p.pageSize, "500");
    assert.equal("objectId" in p, false);
    assert.equal("objectName" in p, false);
    assert.equal("businessId" in p, false);
    assert.equal("businessType" in p, false);
  });
});

describe("MDF side-channel attachment fetchers", () => {
  const parsed = {
    kind: "voucher",
    billnum: "st_purchaseorder",
    billId: "2569696396933857299",
    domainKey: "upu",
    serviceCode: "st_purchaseorderlist",
  };
  const detail = { code: "000352", org: "1719525968768401418" };
  const opts = {
    serviceCode: "st_purchaseorderlist",
    ms: "yonbip-scm-pu",
    tplInfo: { transtype: "2569692479914770435" },
    attachmentMeta: {
      attachGroupCode: "st_purchaseorder_body_attach_base_data",
      objectName: "yonbip-scm-pu",
      ndiUri: "pu.purchaseorder.PurchaseOrder",
    },
  };

  it("评论附件请求 file/files，并把 objectId 改为 billId_comment", async () => {
    const oldFetch = globalThis.fetch;
    const oldProxy = process.env.APPROVE_INBOX_PROXY;
    process.env.APPROVE_INBOX_PROXY = "https://proxy.example";
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), headers: options.headers || {} });
      return new Response(JSON.stringify({
        code: 200,
        data: [{ fileId: "comment-file-1", name: "评论附件.pdf", filePath: "p/comment.pdf" }],
      }));
    };
    try {
      const r = await fetchMdfCommentFileAttachments(parsed, detail, opts);
      assert.equal(r.length, 1);
      assert.equal(r[0].source, "mdf-comment-file-api");
      assert.equal(r[0].authId, "st_purchaseorderlist");
      const u = new URL(calls[0].url);
      assert.equal(u.pathname, "/iuap-apcom-file/rest/fe/file/files");
      assert.equal(u.searchParams.get("objectId"), "2569696396933857299_comment");
      assert.equal(u.searchParams.get("groupId"), "");
      assert.equal(u.searchParams.get("billCode"), "000352");
      assert.equal(u.searchParams.get("buttonPrefix"), "st_purchaseorderlist_st_purchaseorder_body_attach_base_data");
    } finally {
      globalThis.fetch = oldFetch;
      if (oldProxy == null) delete process.env.APPROVE_INBOX_PROXY;
      else process.env.APPROVE_INBOX_PROXY = oldProxy;
    }
  });

  it("任务附件请求 cooperation task/files 并标记来源", async () => {
    const oldFetch = globalThis.fetch;
    const oldProxy = process.env.APPROVE_INBOX_PROXY;
    process.env.APPROVE_INBOX_PROXY = "https://proxy.example";
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), headers: options.headers || {} });
      return new Response(JSON.stringify({
        code: 200,
        data: { records: [{ fileInfo: { id: "task-file-1", fileName: "任务附件.xlsx" } }] },
      }));
    };
    try {
      const r = await fetchMdfTaskFileAttachments(parsed, detail, opts);
      assert.equal(r.length, 1);
      assert.equal(r[0].source, "mdf-task-file-api");
      assert.equal(r[0].authId, "st_purchaseorderlist");
      const u = new URL(calls[0].url);
      assert.equal(u.pathname, "/yonbip-ec-project/task/rest/v1/cooperation/suite/yonbip-scm-pu/2569696396933857299/task/files");
      assert.equal(u.searchParams.get("pageSize"), "500");
      assert.equal(u.searchParams.get("billCode"), "000352");
      assert.equal(u.searchParams.get("authId"), "st_purchaseorderlist");
      assert.equal(u.searchParams.has("objectId"), false);
    } finally {
      globalThis.fetch = oldFetch;
      if (oldProxy == null) delete process.env.APPROVE_INBOX_PROXY;
      else process.env.APPROVE_INBOX_PROXY = oldProxy;
    }
  });
});

describe("IUAP file download URL helpers", () => {
  it("生成 YonClaw 文件服务签名头（仅 path 参与签名）", () => {
    const headers = buildIuapFileSignHeaders({
      method: "GET",
      url: "/iuap-apcom-file/rest/fe/file/getDownloadUrlWithFileId?x=1",
      tenantId: "tenant-a",
      userId: "user-a",
      salt: "salt-a",
      timestamp: 1782290000000,
      nonce: "nonce-a",
    });
    assert.deepEqual(headers, {
      "X-IUAP-FILE-Timestamp": "1782290000000",
      "X-IUAP-FILE-Nonce": "nonce-a",
      "X-IUAP-FILE-Signature": "4fcbba2942def3e7faf2fb29f3f88ea2ba9ed8f7e088fd0d560ef9a202d812c1",
    });
  });

  it("解密 getDownloadUrlWithFileId 返回的 DES-CBC URL", () => {
    assert.equal(
      decryptMdfFileDownloadUrl("6HtMGnszTAhI7tJaaK8gva4nxaTWyfslCd30s5RbYD0="),
      "https://example.com/file.docx"
    );
  });

  it("无直链时用 fileId + authId 换取真实下载 URL", async () => {
    clearIuapFileSignConfigCache();
    const oldProxy = process.env.APPROVE_INBOX_PROXY;
    const oldBase = process.env.APPROVE_INBOX_BASE;
    process.env.APPROVE_INBOX_PROXY = "https://proxy.example";
    delete process.env.APPROVE_INBOX_BASE;
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url: String(url), headers: options.headers || {} });
      if (String(url).includes("/iuap-apcom-workbench/me")) {
        return new Response(JSON.stringify({ data: { userid: "user-a", tenantid: "tenant-a" } }));
      }
      if (String(url).includes("/iuap-apcom-file/rest/v1/jssdk/queryConfiguration")) {
        return new Response(JSON.stringify({
          code: 200,
          data: {
            "iuap-file-sign-tenantId": "tenant-a",
            "iuap-file-sign-userId": "user-a",
            "iuap-file-sign-salt": Buffer.from("salt-a").toString("base64"),
          },
        }));
      }
      if (String(url).includes("/iuap-apcom-file/rest/fe/file/getDownloadUrlWithFileId")) {
        return new Response(JSON.stringify({
          code: 200,
          data: { url: "6HtMGnszTAhI7tJaaK8gva4nxaTWyfslCd30s5RbYD0=" },
        }));
      }
      throw new Error(`unexpected_url:${url}`);
    };

    try {
      const url = await resolveMdfFileDownloadUrl(
        { fid: "file-1", authId: "pu_applyorderlist" },
        {},
        { fetchImpl, apiHost: "c1.yonyoucloud.com" }
      );
      assert.equal(url, "https://example.com/file.docx");
      const downloadUrlCall = calls.find((c) => c.url.includes("getDownloadUrlWithFileId"));
      assert.ok(downloadUrlCall, "应调用 getDownloadUrlWithFileId");
      assert.ok(downloadUrlCall.url.includes("fileId=file-1"));
      assert.ok(downloadUrlCall.url.includes("authId=pu_applyorderlist"));
      assert.ok(downloadUrlCall.headers["X-IUAP-FILE-Signature"], "应带文件签名头");
    } finally {
      clearIuapFileSignConfigCache();
      if (oldProxy == null) delete process.env.APPROVE_INBOX_PROXY;
      else process.env.APPROVE_INBOX_PROXY = oldProxy;
      if (oldBase == null) delete process.env.APPROVE_INBOX_BASE;
      else process.env.APPROVE_INBOX_BASE = oldBase;
    }
  });
});
