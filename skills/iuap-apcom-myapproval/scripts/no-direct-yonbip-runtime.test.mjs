import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../..", import.meta.url).pathname;

function read(relPath) {
  return readFileSync(join(ROOT, relPath), "utf-8");
}

function walkSourceFiles(relDir, out = []) {
  const abs = join(ROOT, relDir);
  for (const entry of readdirSync(abs)) {
    const rel = `${relDir}/${entry}`;
    const full = join(ROOT, rel);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkSourceFiles(rel, out);
    } else if (/\.(mjs|js|ts|tsx)$/.test(entry) && !entry.includes(".test.")) {
      out.push(rel);
    }
  }
  return out;
}

function functionBody(source, name) {
  const match = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.notEqual(match, null, `missing function ${name}`);
  const start = match.index;
  const paramsOpen = source.indexOf("(", start);
  assert.ok(paramsOpen >= 0, `missing params for ${name}`);
  let parenDepth = 0;
  let paramsClose = -1;
  for (let i = paramsOpen; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") parenDepth += 1;
    else if (ch === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        paramsClose = i;
        break;
      }
    }
  }
  assert.ok(paramsClose >= 0, `unterminated params for ${name}`);
  const open = source.indexOf("{", paramsClose);
  assert.ok(open >= 0, `missing function body for ${name}`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function assertNoDirectYonbipRuntime(body, label) {
  assert.doesNotMatch(body, /\bfetch\s*\(/, `${label} must not call fetch directly`);
  assert.doesNotMatch(body, /detectProxy|runWorkflowBatchViaYonclawSession|callIformApprove|callIformReject|approve-patches\.mjs/, `${label} must not use legacy direct YonBIP helpers`);
}

describe("approve-inbox YonBIP runtime access", () => {
  it("routes sync, detail, audit and approval entrypoints through iuap-apcom-cli", () => {
    const syncInbox = read("skills/iuap-apcom-myapproval/scripts/sync-inbox.mjs");
    const fetchBillDetail = read("skills/iuap-apcom-myapproval/scripts/fetch-bill-detail.mjs");
    const cloudAudit = read("skills/iuap-apcom-myapproval/scripts/cloud-audit-result.mjs");
    const approval = read("skills/iuap-apcom-myapproval/scripts/approval-executor.mjs");
    const enrich = read("skills/iuap-apcom-myapproval/scripts/enrich-details.mjs");
    const ynf = read("skills/iuap-apcom-myapproval/scripts/frameworks/ynf-client.mjs");

    const cases = [
      ["fetchTodoListResult", syncInbox, ["list-inbox"]],
      ["fetchCurrentTenant", syncInbox, ["fetchTodoListResult"]],
      ["syncInbox", syncInbox, ["verifyManagedCliIdentity", "verifiedSession"]],
      ["fetchBillFields", fetchBillDetail, ["get-document"]],
      ["downloadAttachments", fetchBillDetail, ["attachment_download_delegated_to_document_get"]],
      ["queryCloudAuditResult", cloudAudit, ["get-intelligent-result"]],
      ["refreshActionsForItem", approval, ["list-action"]],
      ["runWorkflowBatch", approval, ["workflowCommandForAction"]],
      ["executePatchBatch", approval, ["approve-patch"]],
      ["executeApproval", approval, ["runWorkflowTaskCommand"]],
      ["runEnrich", enrich, ["iuap-apcom-cli"]],
      ["fetchYnfBillDetail", ynf, ["fetchBillFields"]],
    ];

    for (const [name, source, requiredTexts] of cases) {
      const body = functionBody(source, name);
      assertNoDirectYonbipRuntime(body, name);
      for (const requiredText of requiredTexts) {
        assert.match(body, new RegExp(requiredText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${name} should route through ${requiredText}`);
      }
    }
  });

  it("does not keep direct business fetch call sites in runtime source", () => {
    const allowedFetchLine = (relPath, line) => {
      if (relPath === "skills/iuap-apcom-myapproval/widget/widget.js" && line.includes("apiUrl()")) return true;
      if (relPath === "skills/iuap-apcom-myapproval/scripts/agent-runner.mjs" && line.includes("YONYOU_BASE()")) return true;
      if (relPath === "skills/iuap-apcom-myapproval/scripts/fetch-bill-detail.mjs" && line.includes("http://localhost:${port}/json/list")) return true;
      if (relPath === "skills/iuap-apcom-myapproval/scripts/enrich-details.mjs" && line.includes("http://localhost:${port}${probe}")) return true;
      return false;
    };
    const files = [
      ...walkSourceFiles("skills/iuap-apcom-myapproval/scripts"),
      ...walkSourceFiles("skills/iuap-apcom-myapproval/web"),
      ...walkSourceFiles("skills/iuap-apcom-myapproval/widget"),
    ];
    const violations = [];
    for (const relPath of files) {
      const lines = read(relPath).split("\n");
      lines.forEach((line, idx) => {
        if (!line.includes("fetch(")) return;
        if (!allowedFetchLine(relPath, line)) {
          violations.push(`${relPath}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    assert.deepEqual(violations, []);
  });

  it("does not keep intelligent-audit HTTP or managed Python bypasses in runtime source", () => {
    const files = [
      ...walkSourceFiles("skills/iuap-apcom-myapproval/scripts"),
      ...walkSourceFiles("skills/iuap-apcom-myapproval/web"),
    ];
    const forbidden = [
      /native-system-audit/,
      /queryNativeSystemAudit/,
      /yonbip_skill_utils/,
      /\/ssc-intelligent-audit\/cloudAudit\//,
    ];
    const violations = [];
    for (const relPath of files) {
      const source = read(relPath);
      for (const pattern of forbidden) {
        if (pattern.test(source)) violations.push(`${relPath}: ${pattern}`);
      }
      if (relPath !== "skills/iuap-apcom-myapproval/scripts/bip-cli-client.mjs"
          && /\/yonbip-mid-sscia\/cloudAudit\//.test(source)) {
        violations.push(`${relPath}: direct yonbip-mid-sscia route`);
      }
    }
    assert.deepEqual(violations, []);
  });
});
