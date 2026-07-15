import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

test("原始单据链接显式新窗口打开，不占用驾驶舱窗口", () => {
  assert.match(html, /data-original-detail-url="1"/);
  assert.match(html, /const cockpitEmbed = document\.documentElement\.classList\.contains\('is-cockpit-embed'\);/);
  assert.match(
    html,
    /window\.open\(originalLink\.href,\s*'_blank',\s*'noopener,noreferrer'\);/s
  );
});

test("同一详情被后台刷新重绘时保留滚动位置", () => {
  assert.match(html, /drawer\.dataset\.detailItemId/);
  assert.match(html, /renderedDetailId === String\(state\.activeItemId\)/);
  assert.match(html, /sameDetail && existingDetailBody \? existingDetailBody\.scrollTop : null/);
  assert.match(html, /detailBody\.scrollTop = detailScrollTop/);
});

test("智能待办不再渲染右下角问答入口", () => {
  assert.match(html, /function renderYonClawChat\(\) \{\s*return '';\s*\}/);
  assert.doesNotMatch(html, /id="btnYonClawOpen"/);
});

test("企业规则无有效结果时不渲染详情区块", () => {
  assert.match(html, /if \(status !== 'success'\) return '';/);
  assert.match(html, /if \(!resultDesc && !summaryDesc\) return '';/);
  assert.doesNotMatch(html, /智能审核系统规则暂未返回可用结果。/);
});

test("列表和详情顶部都提示可通过 YonWork 定制", () => {
  assert.match(html, /可在 YonWork 对话中定制智能待办列表、详情页面与智能审核规则/);
  assert.match(html, /yc-approve-inbox-customization-hint/g);
  assert.match(html, /可在 YonWork 对话中定制智能待办列表、详情页面与智能审核规则[\s\S]*<header class="yc-approve-inbox-header"/);
  assert.match(html, /<header class="yc-approve-inbox-detail-header"[\s\S]*yc-approve-inbox-customization-hint/);
});

test("详情分析区使用面向用户的新名称", () => {
  assert.match(html, />信息分析</);
  assert.match(html, />个人规则（可定制）</);
  assert.match(html, />企业规则</);
  assert.doesNotMatch(html, />单据字段分析</);
  assert.doesNotMatch(html, />用户级规则分析</);
  assert.doesNotMatch(html, />系统预置规则</);
});

test("点击单据立即打开详情骨架，企业规则在后台刷新", () => {
  assert.match(html, /function detailLoadingPlaceholder\(id\)/);
  assert.match(html, /state\.detail = detailLoadingPlaceholder\(id\);\s*state\.detailEnriching = false;[\s\S]*?render\(\);\s*let d;/);
  assert.match(html, /void refreshSystemRuleAudit\(id\);/);
  assert.match(html, /\/api\/system-rule-audit\//);
});

test("列表使用行动型 AI 建议和统一风险文案", () => {
  assert.match(html, /const RISK_LABEL = \{ high: '重要', medium: '需关注', low: '建议通过' \}/);
  assert.match(html, /renderAdvice\(item\)/);
  assert.match(html, /item\.aiSuggestion/);
  assert.doesNotMatch(html, /const RISK_LABEL = \{ high: '高风险'/);
});

test("列表和详情区分到手时间、来源和提交时间", () => {
  assert.match(html, /\{ id: 'receivedAt', label: '到手时间', path: 'receivedAt'/);
  assert.match(html, /receivedAtSourceLabel/);
  assert.match(html, /到手时间不可用/);
  assert.match(html, /\{ id: 'submittedAt', label: '提交时间', path: 'submittedAt'/);
  assert.match(html, /sortByReceivedAt\(filterItems/);
  assert.match(html, /Number\.isNaN\(at\)/);
  assert.match(html, /yc-mail-head-receivedAt/);
});

test("列表始终显示简洁的重新分析按钮", () => {
  assert.match(html, /id="btnReanalyzePending" title="重新分析"/);
  assert.match(html, /icon\('bot'\) \+ '重新分析<\/button>'/);
  assert.doesNotMatch(html, /if \(pendingAnalysis > 0\)/);
  assert.doesNotMatch(html, /重新分析未完成/);
});

test("刷新错误文案按结构化 issue、sync issue、sync message、error 顺序降级", () => {
  assert.match(
    html,
    /res\?\.issue\?\.userMessage[\s\S]*res\?\.sync\?\.issue\?\.userMessage[\s\S]*res\?\.sync\?\.message[\s\S]*res\?\.error/,
  );
});

test("认证、身份和服务上下文冲突会清空敏感前端状态且拒绝旧 data", () => {
  assert.match(html, /const BLOCKING_SYNC_STATES = new Set\(\[[\s\S]*'auth_required'[\s\S]*'identity_mismatch'[\s\S]*'service_context_mismatch'/);
  assert.match(html, /function clearSensitiveState\(\)[\s\S]*state\.data = null;[\s\S]*state\.selectedIds\.clear\(\);[\s\S]*state\.activeItemId = null;/);
  assert.match(html, /function applySyncResponse\(res\)[\s\S]*applyApiIdentityGuard\(res,[\s\S]*return \{ status: identityBlocked \? state\.availability\.status : status, acceptedData: false \};/);
  assert.match(html, /state\.attachmentPreview = null;[\s\S]*state\.approvalDialog = null;[\s\S]*state\.chatMessages = freshChatMessages\(\);/);
  assert.match(html, /state\.uiConfig = null;[\s\S]*state\.detailCardViewConfig = null;[\s\S]*state\.visibleColumns = \['title'/);
  assert.match(html, /else if \(dm\) \{\s*dm\.className = 'data-mode data-mode-unavailable';\s*dm\.textContent = '未同步';/);
});

test("所有业务 API 共用 HTTP 401 和身份 issue 守卫", () => {
  assert.match(
    html,
    /function isBlockingApiIdentityFailure\(res, httpStatus\)[\s\S]*BLOCKING_SYNC_STATES\.has\(syncResponseState\(res, httpStatus\)\)/,
  );
  assert.match(html, /code\.startsWith\('AUTH_'\)/);
  assert.match(html, /code\.startsWith\('IDENTITY_'\) \|\| issue\.category === 'identity'/);
  assert.match(html, /issue\.category === 'service-context'/);
  assert.match(
    html,
    /function applyApiIdentityGuard\(res, httpStatus, options = \{\}\)[\s\S]*syncIssueMessage\(payload\)[\s\S]*clearSensitiveState\(\);[\s\S]*toast\(message, 'error'\)/,
  );
});

test("详情或附件快照过期不会伪装成账号租户切换", () => {
  assert.match(
    html,
    /const RESOURCE_SNAPSHOT_ISSUE_CODES = new Set\(\[[\s\S]*'STALE_DETAIL_SNAPSHOT'[\s\S]*'STALE_ATTACHMENT_SNAPSHOT'[\s\S]*'LIST_SNAPSHOT_CHANGED'/,
  );
  assert.match(
    html,
    /RESOURCE_SNAPSHOT_ISSUE_CODES\.has\(code\)[\s\S]*return 'unavailable';[\s\S]*code\.startsWith\('IDENTITY_'\)/,
  );
  assert.match(
    html,
    /d\.dataSource === 'real' && d\.enriched === false[\s\S]*await enrichAndPoll\(id\)/,
  );
});

test("详情、enrich、状态轮询和附件响应均接入统一身份守卫", () => {
  assert.match(html, /async function fetchDetail\(id\)[\s\S]*applyApiIdentityGuard\(payload, r\.status\)[\s\S]*apiIdentityGuardedError/);
  assert.match(html, /async function getJson\(url\)[\s\S]*applyApiIdentityGuard\(payload, r\.status\)[\s\S]*apiIdentityGuardedError/);
  assert.match(html, /postJson\('\/api\/enrich\/'[\s\S]*applyApiIdentityGuard\(res, res\?\._httpStatus\)/);
  assert.match(html, /async function pollSyncStatus\(\)[\s\S]*fetch\('\/api\/sync-status'\)[\s\S]*applyApiIdentityGuard\(s, r\.status\)/);
  assert.match(html, /async function guardAttachmentIdentityResponse\(response\)[\s\S]*applyApiIdentityGuard\(payload, response\.status\)/);
  assert.match(html, /async function fetchAttachmentForPreview\(url\)[\s\S]*guardAttachmentIdentityResponse\(response\)/);
  assert.match(html, /data-attachment-file-action="open"[\s\S]*data-attachment-file-action="download"/);
});

test("已处理的身份失败不会被详情、分析或附件通用错误覆盖", () => {
  assert.match(html, /catch \(e\) \{\s*if \(e && e\.apiIdentityGuarded\) return;\s*toast\('详情加载失败'/);
  assert.match(html, /catch \(e\) \{\s*if \(e && e\.apiIdentityGuarded\) return;\s*toast\('分析失败'/);
  assert.match(html, /catch\(error => \{[\s\S]*if \(error && error\.apiIdentityGuarded\) return;[\s\S]*attachmentPreviewContent/);
});

test("刷新状态区分重新登录、身份切换、服务冲突、同身份陈旧和正常空态", () => {
  for (const state of [
    "auth_required",
    "identity_mismatch",
    "service_context_mismatch",
    "stale_same_identity",
    "empty",
  ]) {
    assert.match(html, new RegExp(state));
  }
  assert.match(html, /需要重新登录 YonBIP/);
  assert.match(html, /检测到账号或租户已切换/);
  assert.match(html, /智能待办正在切换运行环境/);
  assert.match(html, /当前显示的是缓存数据/);
  assert.match(html, /当前账号在此租户暂无待办/);
  assert.doesNotMatch(html, /真实待办列表为空，请检查 YonWork 登录态和当前租户/);
});

test("同身份陈旧数据保持只读，禁用审批和重新分析", () => {
  assert.match(html, /function interactionsBlocked\(\)[\s\S]*stale_same_identity/);
  assert.match(html, /function renderRowActions\(item\) \{\s*if \(interactionsBlocked\(\)\) return '';/);
  assert.match(html, /function hasAction\(item, action\) \{\s*if \(interactionsBlocked\(\)\) return false;/);
});

test("审批认证或身份错误复用统一安全状态并清空敏感上下文", () => {
  assert.match(
    html,
    /function applyApprovalSafetyResponse\(res\)[\s\S]*applyApiIdentityGuard\(res, res\?\._httpStatus\)[\s\S]*BLOCKING_SYNC_STATES\.has\(status\)[\s\S]*approve-inbox:approve-result/,
  );
  assert.match(html, /if \(code\.startsWith\('IDENTITY_'\) \|\| issue\.category === 'identity'\) return 'identity_mismatch';/);
  assert.match(
    html,
    /function clearSensitiveState\(\)[\s\S]*state\.data = null;[\s\S]*state\.selectedIds\.clear\(\);[\s\S]*state\.detail = null;[\s\S]*state\.approvalDialog = null;/,
  );
  assert.match(html, /const safety = applyApprovalSafetyResponse\(res\);\s*if \(safety\.blocked\) return res;\s*const completed =/);
});

test("远端审批结果不确定或已提交待对账时锁定交互并要求刷新核对", () => {
  assert.match(
    html,
    /const APPROVAL_RECONCILIATION_CODES = new Set\(\[[\s\S]*'APPROVAL_REMOTE_OUTCOME_UNKNOWN'[\s\S]*'APPROVAL_REMOTE_COMMITTED_RECONCILE'/,
  );
  assert.match(
    html,
    /APPROVAL_RECONCILIATION_CODES\.has\(issueCode\)[\s\S]*state\.selectedIds\.clear\(\);[\s\S]*state\.approvalDialog = null;[\s\S]*status: 'stale_same_identity'/,
  );
  assert.match(html, /审批结果需要核对，请立即刷新，确认前请勿重复提交。/);
  assert.match(html, /reconcile: true/);
});
