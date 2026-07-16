import { test } from "node:test";
import assert from "node:assert/strict";

import {
  analysisKey,
  detailContentHash,
  itemRevision,
  legacyDetailMatchesItem,
  normalizeDetailIdentityUrl,
} from "./detail-cache-identity.mjs";

const ITEM = {
  id: "item-1",
  primaryId: "primary-1",
  taskId: "task-1",
  workflowBusinessKey: "workflow-1",
  businessKey: "bill-1",
  framework: "mdf",
  handlerId: "generic.mdf",
  serviceCode: "pu_applyorderlist",
  sourceServiceCode: "PU_pu_applyorderlist",
  webUrl: "https://EXAMPLE.test:443/voucher/apply/1?serviceCode=pu_applyorderlist&taskId=task-1",
};

test("normalizeDetailIdentityUrl: 去掉临时认证参数、片段并稳定查询参数顺序", () => {
  const left = normalizeDetailIdentityUrl(
    "https://EXAMPLE.test:443/voucher/apply/1?token=secret&taskId=task-1&serviceCode=pu_applyorderlist&tenantId=t1#tab",
  );
  const right = normalizeDetailIdentityUrl(
    "https://example.test/voucher/apply/1?serviceCode=pu_applyorderlist&authorization=secret-2&taskId=task-1&timestamp=999",
  );

  assert.equal(left, "https://example.test/voucher/apply/1?serviceCode=pu_applyorderlist&taskId=task-1");
  assert.equal(left, right);
});

test("normalizeDetailIdentityUrl: 相对 URL 同样稳定且保留业务参数", () => {
  assert.equal(
    normalizeDetailIdentityUrl("/detail/1?b=2&access_token=secret&a=1"),
    "/detail/1?a=1&b=2",
  );
});

test("itemRevision: 忽略同步观察、动作和 AI 字段", () => {
  const original = structuredClone(ITEM);
  const baseline = itemRevision(ITEM);
  const refreshed = itemRevision({
    ...ITEM,
    observedAt: "2026-07-16T00:00:00.000Z",
    syncedAt: "2026-07-16T00:05:00.000Z",
    runtimeActions: [{ action: "approve" }],
    observedActions: [{ action: "return" }],
    analysis: { summary: "changed" },
    aiSuggestion: "reject",
    riskLevel: "high",
    webUrl: "https://example.test/voucher/apply/1?timestamp=123&taskId=task-1&token=new-secret&serviceCode=pu_applyorderlist",
  });

  assert.match(baseline, /^[a-f0-9]{64}$/);
  assert.equal(refreshed, baseline);
  assert.deepEqual(ITEM, original, "helper must not mutate the source item");
});

test("itemRevision: 任务、业务身份和稳定 URL 变化会失效", () => {
  const baseline = itemRevision(ITEM);
  for (const changed of [
    { ...ITEM, taskId: "task-2" },
    { ...ITEM, workflowBusinessKey: "workflow-2" },
    { ...ITEM, businessKey: "bill-2" },
    { ...ITEM, framework: "ynf" },
    { ...ITEM, handlerId: "generic.ynf" },
    { ...ITEM, serviceCode: "other-service" },
    { ...ITEM, sourceServiceCode: "other-source" },
    { ...ITEM, webUrl: "https://example.test/voucher/apply/2?serviceCode=pu_applyorderlist&taskId=task-1" },
    { ...ITEM, webUrl: "https://example.test/voucher/apply/1?serviceCode=pu_applyorderlist&taskId=task-1&mode=edit" },
  ]) {
    assert.notEqual(itemRevision(changed), baseline);
  }
});

test("legacyDetailMatchesItem: 需要 id 和稳定工作流证据同时匹配", () => {
  assert.equal(legacyDetailMatchesItem({ id: ITEM.id }, ITEM), false);
  assert.equal(legacyDetailMatchesItem({
    id: ITEM.id,
    originalUrl: `${ITEM.webUrl}&token=expired`,
  }, ITEM), true);
  assert.equal(legacyDetailMatchesItem({
    id: ITEM.id,
    businessKey: ITEM.workflowBusinessKey,
  }, ITEM), true);
  assert.equal(legacyDetailMatchesItem({
    id: ITEM.id,
    taskId: "different-task",
    originalUrl: "https://example.test/voucher/apply/other?taskId=other",
  }, ITEM), false);
  assert.equal(legacyDetailMatchesItem({
    id: "different-id",
    businessKey: ITEM.workflowBusinessKey,
  }, ITEM), false);
});

test("detailContentHash: 忽略缓存、抓取、动作和分析元数据", () => {
  const detail = {
    id: "item-1",
    docType: "请购单",
    businessKey: "bill-1",
    framework: "mdf",
    handlerId: "generic.mdf",
    content: {
      fields: [{ name: "amount", value: "100" }],
      attachments: [{ fileName: "quote.pdf", url: "https://file.test/quote.pdf?token=old&fid=f-1" }],
      fetchedAt: "2026-07-16T00:00:00.000Z",
    },
    normalized: { fields: [{ fieldId: "amount", value: "100" }] },
    _approveInbox: { scopeKey: "scope-a", snapshotId: "snapshot-a" },
    analysis: { summary: "approve" },
    analysisMeta: { analyzedAt: "2026-07-16T00:01:00.000Z" },
    fieldDisplayPlan: { visible: ["amount"] },
  };
  const baseline = detailContentHash(detail);
  const refreshed = detailContentHash({
    ...detail,
    content: {
      ...detail.content,
      fetchedAt: "2026-07-16T01:00:00.000Z",
      attachments: [{ fileName: "quote.pdf", url: "https://file.test/quote.pdf?fid=f-1&token=new" }],
    },
    _approveInbox: { scopeKey: "scope-a", snapshotId: "snapshot-b" },
    observedActions: [{ action: "approve" }],
    analysis: { summary: "reject" },
    analysisError: { message: "new error" },
    fieldDisplayPlan: { visible: [] },
  });

  assert.match(baseline, /^[a-f0-9]{64}$/);
  assert.equal(refreshed, baseline);
});

test("detailContentHash: 真实字段或附件身份变化会失效", () => {
  const baseline = detailContentHash({
    content: {
      fields: [{ name: "amount", value: "100" }],
      attachments: [{ fileName: "quote.pdf", url: "https://file.test/quote.pdf?fid=f-1" }],
    },
  });

  assert.notEqual(
    detailContentHash({ content: { fields: [{ name: "amount", value: "200" }], attachments: [{ fileName: "quote.pdf", url: "https://file.test/quote.pdf?fid=f-1" }] } }),
    baseline,
  );
  assert.notEqual(
    detailContentHash({ content: { fields: [{ name: "amount", value: "100" }], attachments: [{ fileName: "quote-v2.pdf", url: "https://file.test/quote.pdf?fid=f-2" }] } }),
    baseline,
  );
});

test("analysisKey: 同时绑定 item、详情内容和分析契约版本", () => {
  const revision = itemRevision(ITEM);
  const contentHash = detailContentHash({ content: { fields: [{ name: "amount", value: "100" }] } });
  const positional = analysisKey(revision, contentHash, "analyzer-v3", "policy-v2");
  const objectForm = analysisKey({
    policyVersion: "policy-v2",
    detailContentHash: contentHash,
    analyzerVersion: "analyzer-v3",
    itemRevision: revision,
  });

  assert.match(positional, /^[a-f0-9]{64}$/);
  assert.equal(objectForm, positional);
  assert.notEqual(analysisKey(revision, contentHash, "analyzer-v4", "policy-v2"), positional);
  assert.notEqual(analysisKey(revision, detailContentHash({ content: { fields: [{ name: "amount", value: "200" }] } }), "analyzer-v3", "policy-v2"), positional);
  assert.notEqual(analysisKey(itemRevision({ ...ITEM, taskId: "task-2" }), contentHash, "analyzer-v3", "policy-v2"), positional);
});
