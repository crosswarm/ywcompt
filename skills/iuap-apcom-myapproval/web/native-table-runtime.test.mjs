/** 智能待办原生表格运行时契约测试 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const webDir = new URL('./', import.meta.url);

test('消息列表由独立生成器输出并保留选择且取消分页契约', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');
  const renderer = await readFile(new URL('message-list-render.js', webDir), 'utf8');
  const styles = await readFile(new URL('message-list.css', webDir), 'utf8');
  const server = await readFile(new URL('server.mjs', webDir), 'utf8');
  const renderMessageListSource = html.match(/function renderMessageList\(items, toolbarHtml\) \{[\s\S]*?\n    \}/)?.[0] || '';
  const aiValueStyles = styles.match(/\.yc-message-center-ai-value \{[^}]*\}/)?.[0] || '';
  const checkedStyles = styles.match(/\.yc-message-center-bulk input:checked,[\s\S]*?\.yc-message-center-check input:checked \{[^}]*\}/)?.[0] || '';

  assert.doesNotMatch(html, /TinperNext|tinper-next|ApproveInboxTinperTable/);
  assert.doesNotMatch(html, /react(?:-dom)?\.production\.min\.js/);
  assert.doesNotMatch(server, /VENDOR_DIR|handleVendorStatic|\/vendor\//);
  assert.match(server, /WEB_STATIC_FILES/);
  assert.match(server, /message-list-render\.js/);
  assert.match(server, /message-list\.css/);
  assert.match(html, /<link rel="stylesheet" href="\/message-list\.css">/);
  assert.match(html, /<script src="\/message-list-render\.js"><\/script>/);
  assert.match(html, /ApproveInboxMessageList\.render/);
  assert.match(html, /function renderMessageList\(items, toolbarHtml\)/);
  assert.doesNotMatch(html, /<table class="yc-native-table"/);
  assert.match(renderer, /<ul class="yc-message-center-list yc-business-message-list yc-semantic-list" role="list">/);
  assert.match(renderer, /const className = 'yc-message-center-item yc-semantic-list-row/);
  assert.doesNotMatch(renderer, /yc-semantic-marker|data-tone=/);
  assert.match(renderer, /class="yc-message-center-unread-dot" aria-label="未读"/);
  assert.match(renderer, /class="yc-message-center-title yc-semantic-head analysis-card-head"/);
  assert.match(renderer, /class="analysis-card-title"/);
  assert.match(renderer, /class="yc-message-center-title-meta analysis-card-text"/);
  assert.doesNotMatch(renderer, /yc-message-center-description analysis-card-text/);
  assert.match(renderer, /data-select-row=/);
  assert.match(renderer, /data-select-all/);
  assert.match(html, /state\.selectedIds\.(?:add|delete)/);
  assert.doesNotMatch(html, /state\.page(?:Size)?\b/);
  assert.doesNotMatch(html, /yc-native-pagination|nativePageSize|data-page-action/);
  assert.match(renderMessageListSource, /const selectable = sorted\.filter/);
  assert.match(renderMessageListSource, /const listItems = sorted\.map/);
  assert.doesNotMatch(renderMessageListSource, /totalPages|pageItems|\.slice\(/);
  assert.doesNotMatch(renderMessageListSource, /\b(?:total|page|pageSize|totalPages):/);
  assert.match(styles, /\.yc-message-center-item\.yc-semantic-list-row \{[^}]*min-height: 0/);
  assert.match(styles, /\.yc-message-center-item\.yc-semantic-list-row \{[^}]*flex: 0 0 auto/);
  assert.match(styles, /\.yc-message-center-item\.yc-semantic-list-row \{[^}]*height: auto/);
  assert.match(styles, /\.yc-message-center-item\.yc-semantic-list-row \{[^}]*padding: 10px 12px[^}]*grid-template-columns: 14px minmax\(0, 1fr\)/);
  assert.match(checkedStyles, /background-image: url\("data:image\/svg\+xml,/);
  assert.match(checkedStyles, /stroke='%23fff'/);
  assert.doesNotMatch(checkedStyles, /linear-gradient/);
  assert.doesNotMatch(styles, /yc-semantic-marker|\[data-tone=/);
  assert.match(styles, /\.yc-message-center-unread-dot \{[^}]*width: 6px[^}]*height: 6px[^}]*background: hsl\(var\(--destructive\)\)/);
  assert.match(styles, /\.yc-message-center-bulk \{[^}]*padding: 0 12px 8px 24px/);
  assert.match(styles, /\.yc-message-center-bulk \{[^}]*position: sticky[^}]*top: 8px[^}]*z-index: 3/);
  assert.match(styles, /\.yc-message-center-bulk \{[^}]*box-shadow: 0 -8px 0 hsl\(var\(--app-surface\)\)/);
  assert.match(styles, /\.yc-message-center-shell \{[^}]*flex: 0 0 auto/);
  assert.match(styles, /\.yc-message-center-list\.yc-semantic-list \{[^}]*flex: 0 0 auto[^}]*overflow-y: visible/);
  assert.match(html, /\.yc-approve-inbox-list\.yc-mail-list \{[^}]*overflow-y: auto; overflow-x: hidden/);
  assert.match(html, /\.yc-approve-inbox-header \{[^}]*padding: 0;/);
  assert.match(html, /\.yc-approve-inbox-header-primary \{[^}]*padding: 0 18px 0 10px[^}]*border-bottom: 1px solid hsl\(var\(--app-border-subtle\)\)/);
  assert.match(html, /\.yc-approve-inbox-header-secondary \{[^}]*padding: 0 12px/);
  assert.match(styles, /\.yc-message-center-list\.yc-semantic-list \{[^}]*display: flex[^}]*flex-direction: column[^}]*gap: 8px/);
  assert.match(styles, /\.yc-message-center-item\.yc-semantic-list-row \{[^}]*border: 0[^}]*border-radius: var\(--yc-radius-subcard\)[^}]*--yc-standard-list-bg: #B7CFFF/);
  assert.match(styles, /\.yc-message-center-item\.yc-semantic-list-row \{[^}]*overflow: visible/);
  assert.match(styles, /\.yc-message-center-footer \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto[^}]*align-items: center/);
  assert.match(styles, /\.yc-message-center-ai-advice \{[^}]*grid-column: 1/);
  assert.match(styles, /\.yc-message-center-side \{[^}]*grid-column: 2/);
  assert.match(styles, /\.yc-message-center-ai-value \{[^}]*overflow-wrap: anywhere[^}]*white-space: normal/);
  assert.match(aiValueStyles, /background: linear-gradient\(90deg, var\(--adc-chart-purple, #7c3aed\), hsl\(var\(--info\)\)\)/);
  assert.match(aiValueStyles, /background-clip: text/);
  assert.match(aiValueStyles, /-webkit-text-fill-color: transparent/);
  assert.match(styles, /@media \(max-width: 767px\) \{[\s\S]*\.yc-message-center-footer \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto[^}]*align-items: center/);
  assert.match(styles, /color-mix\(in srgb, var\(--yc-standard-list-bg\) 20%, transparent\)/);
  assert.match(styles, /\.yc-message-center-item\.yc-message-center-item-done \{[^}]*--yc-standard-list-bg: #D1D5DB[^}]*background:/);
  assert.doesNotMatch(styles, /yc-semantic-list-row\[data-tone="(?:danger|warning)"\][^{]*\{[^}]*--yc-standard-list-bg/);
  assert.match(styles, /box-shadow: inset 0 1px 0 hsl\(0 0% 100% \/ \.54\)/);
  assert.doesNotMatch(styles, /\.yc-message-center-item\.yc-semantic-list-row\.active \{[^}]*inset 3px/);
  assert.doesNotMatch(styles, /\.yc-message-center-item(?:\.yc-semantic-list-row)? \{[^}]*border-bottom:/);
  assert.doesNotMatch(styles, /\.yc-message-center-shell \{[^}]*border-top:/);
  assert.doesNotMatch(styles, /\.yc-message-center-bulk \{[^}]*border-bottom:/);
  assert.match(styles, /\.yc-message-center-item\.yc-semantic-list-row:hover/);
  assert.match(styles, /\.yc-message-center-item\.yc-semantic-list-row\.selected/);
});

test('智能待办一次性渲染全部筛选结果且不输出分页器', async () => {
  const rendererSource = await readFile(new URL('message-list-render.js', webDir), 'utf8');
  const browserWindow = {};
  new Function('window', rendererSource)(browserWindow);
  const items = Array.from({ length: 12 }, (_, index) => ({
    id: `todo-${index + 1}`,
    title: `待办${index + 1}`,
    canSelect: true,
    selected: false,
    extraFields: []
  }));
  const listHtml = browserWindow.ApproveInboxMessageList.render({
    items,
    selectableCount: items.length,
    escapeHtml: value => String(value)
  });

  assert.equal((listHtml.match(/data-open="todo-/g) || []).length, 12);
  assert.doesNotMatch(listHtml, /yc-native-pagination|nativePageSize|data-page-action/);
});

test('消息列表生成器输出原始任务信息、扩展字段和行操作', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');
  const rendererSource = await readFile(new URL('message-list-render.js', webDir), 'utf8');
  const browserWindow = {};
  new Function('window', rendererSource)(browserWindow);
  const listHtml = browserWindow.ApproveInboxMessageList.render({
    items: [{
      id: 'todo-1',
      title: '采购申请单',
      riskLevel: 'medium',
      business: '请购单',
      department: '采购部',
      submitter: '张三',
      submittedAt: '2026-07-14 09:30',
      taskMeta: '请购单 · 张三 · 2026-07-14 09:30',
      extraFields: [
        { id: 'advice', label: 'AI建议', value: '需关注' },
        { id: 'riskLevel', label: '风险', value: '中风险', tone: 'medium' },
        { id: 'tags', label: '标签', value: '预算,跨部门', tags: [{ label: '预算', kind: 'rule' }, { label: '跨部门', kind: 'risk' }] },
        { id: 'attachments', label: '附件', value: '2' }
      ],
      actionsHtml: '<button data-act="approve">同意</button>',
      done: true,
      unread: true,
      selected: false,
      active: false,
      canSelect: true
    }],
    allSelected: false,
    selectableCount: 1,
    emptyText: '暂无待办',
    escapeHtml: value => String(value)
  });

  assert.match(listHtml, /采购申请单/);
  assert.match(listHtml, /yc-message-center-item-done/);
  assert.match(listHtml, /请购单 · 张三 · 2026-07-14 09:30/);
  assert.match(listHtml, /yc-message-center-title-meta analysis-card-text">请购单 · 张三 · 2026-07-14 09:30/);
  assert.match(listHtml, /yc-message-center-title-main"><i class="yc-message-center-unread-dot" aria-label="未读"><\/i><strong class="analysis-card-title">采购申请单/);
  assert.doesNotMatch(listHtml, /yc-message-center-description analysis-card-text/);
  assert.match(listHtml, /yc-message-center-title-tags[\s\S]*中风险[\s\S]*预算[\s\S]*跨部门/);
  assert.match(listHtml, /tag wui-tag wui-tag-sm tag-warning wui-tag-warning yc-message-center-tag/);
  assert.match(listHtml, /tag wui-tag wui-tag-sm tag-danger wui-tag-danger yc-message-center-tag/);
  assert.match(listHtml, /yc-message-center-footer[\s\S]*yc-message-center-ai-advice[\s\S]*yc-message-center-side[\s\S]*data-act="approve"/);
  assert.match(listHtml, /class="yc-message-center-ai-advice analysis-card-text" data-field="advice"/);
  assert.match(listHtml, /data-icon-code="AI_star"/);
  assert.match(listHtml, /需关注/);
  assert.doesNotMatch(listHtml, /wui-tag-ai/);
  assert.doesNotMatch(listHtml, /yc-message-center-field-label">AI建议/);
  assert.match(listHtml, /data-field="attachments"/);
  assert.match(listHtml, /附件/);
  assert.match(listHtml, /data-act="approve"/);
  assert.doesNotMatch(listHtml, /共 1 条/);
  assert.doesNotMatch(listHtml, /<table|<thead|<th/);
  assert.match(html, /const business = businessName\(item\)/);
  assert.match(html, /item\.submitter/);
  assert.match(html, /任务到手 ' \+ formatDate\(item\.receivedAt\)/);
  assert.match(html, /formatDate\(item\.submittedAt\)/);
  assert.match(html, /taskMeta: \[business, submitter, receivedAt, submittedAt\]/);
  assert.match(html, /extraFields:/);
  assert.match(html, /const visibleActions = actions\.slice\(0, 2\)/);
  assert.match(html, /class="yc-native-row-actions"/);
  assert.match(html, /readItemIds: loadReadItemIds\(\)/);
  assert.match(html, /unread: !state\.readItemIds\.has\(item\.id\)/);
  assert.match(html, /done: state\.activeL1 === 'done'/);
  assert.match(html, /function markItemRead\(id\)[\s\S]*?localStorage\.setItem\(READ_ITEMS_STORAGE_KEY/);
  assert.match(html, /const open = e\.target\.closest\('\[data-open\]'\);[\s\S]*?if \(open\) \{ markItemRead\(open\.dataset\.open\); openDetail\(open\.dataset\.open\); \}/);
  assert.match(html, /data-action-menu/);
  assert.match(html, /<summary>更多' \+ icon\('chevronDown'\)/);
});

test('列表工具栏位于全选行右侧且不显示条数记录', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');
  const rendererSource = await readFile(new URL('message-list-render.js', webDir), 'utf8');
  const browserWindow = {};
  new Function('window', rendererSource)(browserWindow);
  const listHtml = browserWindow.ApproveInboxMessageList.render({
    items: [],
    total: 4,
    toolbarHtml: '<label id="search-in-list"></label><button id="batch-in-list">批量同意</button>'
  });

  assert.match(
    listHtml,
    /yc-message-center-bulk[\s\S]*?全选[\s\S]*?yc-message-center-list-tools[\s\S]*?search-in-list[\s\S]*?batch-in-list/
  );
  assert.doesNotMatch(listHtml, /共 4 条/);
  assert.doesNotMatch(rendererSource, /共 ' \+ total \+ ' 条/);
  assert.match(html, /renderMessageList\(visible, listToolbarHtml\)/);
  assert.match(html, /\.yc-mail-search-inline \{[^}]*width: min\(320px, 44vw\)/);
  assert.match(html, /\.yc-approve-inbox-header-primary \.yc-mail-search-inline \{ height: 28px; box-sizing: border-box; align-self: center; margin: 0; position: relative; top: 2px; \}/);
  assert.match(html, /\.yc-mail-search-inline \.yc-action-icon \{[^}]*color: hsl\(var\(--app-text-subtle\)\)/);
  assert.match(html, /\.yc-mail-search-inline input \{[^}]*overflow: hidden[^}]*text-overflow: ellipsis; white-space: nowrap/);
  assert.match(html, /\.yc-mail-search-inline \{ order: 1; width: min\(300px, 52vw\); flex: 0 1 min\(300px, 52vw\); \}/);
});

test('当前租户作用域控制紧跟全选且其余批量操作保持靠右', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');
  const listToolsRule = html.match(/\.yc-message-center-list-tools \{[^}]*\}/)?.[0] || '';
  const tenantToggleRule = html.match(/\.yc-approve-inbox-tenant-toggle \{[^}]*\}/)?.[0] || '';
  const tenantToggleLabelRule = html.match(/\.yc-approve-inbox-tenant-toggle-label \{[^}]*\}/)?.[0] || '';
  const scopeBadgeRule = html.match(/\.yc-approve-inbox-scope-badge \{[^}]*\}/)?.[0] || '';

  assert.match(listToolsRule, /flex: 1 1 auto/);
  assert.match(listToolsRule, /margin-left: 12px/);
  assert.match(tenantToggleRule, /margin-left: 0/);
  assert.match(tenantToggleRule, /margin-right: auto/);
  assert.match(tenantToggleLabelRule, /color: hsl\(var\(--app-text-secondary\)\)/);
  assert.match(scopeBadgeRule, /margin-right: auto/);
  assert.match(html, /const crossCount = items\.filter\(i => i\.crossTenant\)\.length;/);
  assert.match(html, /const tenantFilterAvailable = crossCount > 0;/);
  assert.match(html, /if \(!tenantFilterAvailable\) state\.currentTenantOnly = true;/);
  assert.match(html, /tenantFilterAvailable[\s\S]*?id="btnTenantToggle"[\s\S]*?yc-approve-inbox-scope-badge[\s\S]*?当前租户数据/);
  assert.match(html, /当前服务只返回已验证的租户作用域；如需查看其他租户，请先在 YonWork 切换租户并重新同步/);
  assert.match(html, /@media \(max-width: 767px\)[\s\S]*?\.yc-approve-inbox-tenant-toggle,[\s\S]*?\.yc-approve-inbox-scope-badge \{[\s\S]*?margin-left: 0;[\s\S]*?margin-right: auto;/);
});

test('详情头部保留两层页签并使用风险下拉组合筛选', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');
  const tabsL2Rule = html.match(/\.yc-approve-inbox-tabs-l2 \{[^}]*\}/)?.[0] || '';
  const tabL2Rule = html.match(/\.yc-approve-inbox-tab-l2 \{[^}]*\}/)?.[0] || '';
  const filterToolsRule = html.match(/\.yc-approve-inbox-toolbar\.yc-approve-inbox-filter-tools \{[^}]*\}/)?.[0] || '';

  assert.match(
    html,
    /<div class="yc-approve-inbox-header-row yc-approve-inbox-header-primary">[\s\S]*?yc-approve-inbox-tabs-l1[\s\S]*?id="mailSearch"[\s\S]*?<\/div>/
  );
  assert.doesNotMatch(
    html,
    /if \(crossCount > 0\) \{[\s\S]*?btnTenantToggle/
  );
  assert.match(
    html,
    /<div class="yc-approve-inbox-header-row yc-approve-inbox-header-secondary">[\s\S]*?yc-approve-inbox-tabs-l2[\s\S]*?yc-approve-inbox-toolbar[\s\S]*?<\/div>/
  );
  assert.match(
    html,
    /\.yc-approve-inbox-header-primary \{[^}]*border-bottom: 1px solid hsl\(var\(--app-border-subtle\)\)/
  );
  assert.match(
    html,
    /\.yc-approve-inbox-tenant-toggle \{[^}]*border: 0[^}]*background: transparent/
  );
  assert.match(
    html,
    /\.yc-approve-inbox-tenant-toggle\.on \{[^}]*border-color: transparent[^}]*background: transparent/
  );
  assert.match(
    html,
    /\.yc-approve-inbox-tab-l1-active \{ color: hsl\(var\(--app-text\)\); \}/
  );
  assert.match(
    html,
    /<details class="yc-approve-inbox-risk-select">[\s\S]*?<summary class="yc-approve-inbox-risk-trigger" id="riskFilter" aria-label="风险等级">/
  );
  assert.match(html, /class="yc-approve-inbox-risk-menu" role="listbox" aria-label="风险等级"/);
  assert.match(html, /class="yc-approve-inbox-risk-option[\s\S]*?role="option"[\s\S]*?data-risk-filter=/);
  assert.match(html, /\.yc-approve-inbox-risk-trigger \{[^}]*width: max-content; min-width: 0;/);
  assert.match(html, /\.yc-approve-inbox-risk-trigger \{[^}]*border: 0;/);
  assert.match(html, /\.yc-approve-inbox-risk-menu \{[^}]*width: max-content; min-width: 100%;[^}]*box-shadow:/);
  assert.match(html, /\.yc-approve-inbox-risk-option:hover[^}]*background: hsl\(var\(--app-surface-hover\)\)/);
  assert.match(html, /\.yc-approve-inbox-risk-option-active \{[^}]*color: hsl\(var\(--primary\)\)[^}]*background: hsl\(var\(--primary\) \/ \.06\)/);
  assert.match(html, /\.yc-approve-inbox-reanalyze-pending \{[^}]*height: 34px[^}]*padding: 0 13px[^}]*border: 1px solid hsl\(var\(--app-border-subtle\)\)[^}]*border-radius: 8px[^}]*background: hsl\(var\(--app-surface\)\)[^}]*color: hsl\(var\(--app-text-muted\)\)/);
  assert.match(html, /\.yc-approve-inbox-header-secondary \{ min-height: 42px; gap: 6px; overflow: visible; \}/);
  assert.match(tabsL2Rule, /flex: 1 1 auto/);
  assert.match(tabsL2Rule, /overflow-x: auto; overflow-y: hidden; scrollbar-width: none/);
  assert.match(html, /\.yc-approve-inbox-tabs-l2::-webkit-scrollbar \{ display: none; \}/);
  assert.match(tabL2Rule, /flex: 0 0 auto/);
  assert.match(filterToolsRule, /flex: 0 0 auto/);
  assert.match(filterToolsRule, /margin-left: 0/);
  assert.match(filterToolsRule, /background: hsl\(var\(--app-surface\)\)/);
  assert.match(filterToolsRule, /z-index: 10/);
  assert.match(filterToolsRule, /overflow: visible/);
  assert.match(html, /\{ id: 'all', label: '全部风险等级' \}/);
  assert.match(html, /\{ id: 'high', label: '高风险' \}/);
  assert.match(html, /\{ id: 'medium', label: '需关注' \}/);
  assert.match(html, /\{ id: 'low', label: '低风险' \}/);
  assert.match(html, /\.yc-approve-inbox-tabs-l2 \{[^}]*gap: 6px; padding: 0;[^}]*border: 0; border-radius: 0; background: transparent/);
  assert.match(html, /\.yc-approve-inbox-tab-l2 \{[^}]*border: 1px solid hsl\(var\(--app-border-subtle\)\)[^}]*background: hsl\(var\(--app-bg\)\)/);
  assert.match(html, /\.yc-approve-inbox-tab-l2-active \{[^}]*border-color: hsl\(var\(--primary\) \/ \.35\)[^}]*color: hsl\(var\(--primary\)\)/);
  assert.match(
    html,
    /id="riskFilter"[\s\S]*?const tenantScopeControlHtml = tenantFilterAvailable[\s\S]*?id="btnTenantToggle"[\s\S]*?const listToolbarHtml = tenantScopeControlHtml[\s\S]*?id="btnBatch"/
  );
  assert.match(html, /id="btnBatch"[\s\S]*?id="btnReanalyzePending"/);
  assert.match(
    html,
    /function filterItems\(items, l1, l2, riskFilter = 'all'\)[\s\S]*?if \(l2 && l2 !== 'all'\) arr = arr\.filter\(i => \(i\.docType \|\| '其他'\) === l2\);[\s\S]*?if \(riskFilter && riskFilter !== 'all'\) arr = arr\.filter\(i => i\.riskLevel === riskFilter\)/
  );
  assert.match(html, /const riskOption = e\.target\.closest\('\[data-risk-filter\]'\)[\s\S]*?state\.riskFilter = riskOption\.dataset\.riskFilter/);
  assert.doesNotMatch(html, /id="btnL2Mode"|icon\('switch'\)|state\.l2Mode/);
  assert.doesNotMatch(
    html,
    /\.yc-approve-inbox-list \{[^}]*border-top:/
  );
});

test('页签切换按一级、维度和二级页签恢复列表滚动位置', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');

  assert.match(html, /listScrollPositions: new Map\(\)/);
  assert.match(html, /return \[state\.activeL1, state\.activeL2, state\.riskFilter\]\.join\('::'\)/);
  assert.match(html, /function saveListScrollPosition\(\)[\s\S]*state\.listScrollPositions\.set\(listScrollKey\(\), list\.scrollTop\)/);
  assert.match(html, /function setListScrollPosition\(scrollTop\)[\s\S]*list\.scrollTop = Math\.min\(scrollTop/);
  assert.match(html, /function restoreListScrollPosition\(\)[\s\S]*setListScrollPosition\(scrollTop\)/);
  assert.match(html, /if \(options\.restoreListScroll\) restoreListScrollPosition\(\);[\s\S]*?else if \(Number\.isFinite\(currentListScrollTop\)\) setListScrollPosition\(currentListScrollTop\)/);
  assert.match(html, /if \(l1\) \{ saveListScrollPosition\(\);[\s\S]*?render\(\{ restoreListScroll: true \}\); return; \}/);
  assert.match(html, /if \(l2\) \{ saveListScrollPosition\(\);[\s\S]*?render\(\{ restoreListScroll: true \}\); return; \}/);
  assert.match(html, /const riskOption = e\.target\.closest\('\[data-risk-filter\]'\)[\s\S]*?render\(\{ restoreListScroll: true \}\)/);
});

test('页签激活状态变化时统一滚动到所属页签可视范围', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');
  const tabMarkupSource = html.match(/\/\/ ── L1 行 ──[\s\S]*?const listToolbarHtml/)?.[0] || '';
  const focusSource = html.match(/function scrollActiveTabIntoView\(scope\) \{[\s\S]*?\n    \}/)?.[0] || '';
  const renderSource = html.match(/function render\(options = \{\}\) \{[\s\S]*?const selectAll/)?.[0] || '';
  const tabClickSource = html.match(/const l1 = e\.target\.closest\('\[data-l1\]'\);[\s\S]*?const riskOption/)?.[0] || '';

  assert.ok(tabMarkupSource.includes('class="yc-approve-inbox-tabs-l1" role="tablist" data-tab-focus-scope="l1"'));
  assert.ok(tabMarkupSource.includes('class="yc-approve-inbox-tabs-l2" role="tablist" data-tab-focus-scope="l2"'));
  assert.ok(tabMarkupSource.includes('role="tab" aria-selected="' + "' + (state.activeL1 === t.id ? 'true' : 'false') + '" + '"'));
  assert.ok(tabMarkupSource.includes('role="tab" aria-selected="' + "' + (state.activeL2 === t.id ? 'true' : 'false') + '" + '"'));
  assert.doesNotMatch(tabMarkupSource, /tabindex=/);
  assert.match(focusSource, /requestAnimationFrame/);
  assert.ok(focusSource.includes("querySelector('[data-tab-focus-scope=\"' + scope + '\"]')"));
  assert.ok(focusSource.includes("querySelector('[role=\"tab\"][aria-selected=\"true\"]')"));
  assert.doesNotMatch(focusSource, /\.focus\(/);
  assert.ok(focusSource.includes('const tablistCenter = tablist.clientWidth / 2'));
  assert.ok(focusSource.includes('const activeTabCenter = activeTab.offsetLeft - tablist.offsetLeft + activeTab.offsetWidth / 2'));
  assert.ok(focusSource.includes('const maxScrollLeft = Math.max(0, tablist.scrollWidth - tablist.clientWidth)'));
  assert.ok(focusSource.includes('const targetScrollLeft = Math.min(maxScrollLeft, Math.max(0, activeTabCenter - tablistCenter))'));
  assert.ok(focusSource.includes('tablist.scrollLeft = targetScrollLeft'));
  assert.doesNotMatch(focusSource, /behavior: 'smooth'/);
  assert.match(html, /let lastRenderedActiveTabs = \{ l1: null, l2: null \}/);
  assert.ok(renderSource.includes('const activeL1Changed = lastRenderedActiveTabs.l1 !== state.activeL1'));
  assert.ok(renderSource.includes('const activeL2Changed = lastRenderedActiveTabs.l2 !== state.activeL2'));
  assert.ok(renderSource.includes('lastRenderedActiveTabs = { l1: state.activeL1, l2: state.activeL2 }'));
  assert.ok(renderSource.includes("if (activeL1Changed) scrollActiveTabIntoView('l1')"));
  assert.ok(renderSource.includes("if (activeL2Changed) scrollActiveTabIntoView('l2')"));
  assert.doesNotMatch(tabClickSource, /scrollActiveTab/);
});

test('样式层完整消费驾驶舱外观模式与主题色 token', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');
  const styleSource = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';
  const themeBridgeSource = html.match(/const THEME_SURFACE_KEYS = \[[\s\S]*?function clampNumber/)?.[0] || '';

  for (const token of [
    '--app-surface-elevated', '--app-surface-hover', '--app-surface-subtle',
    '--app-text-secondary', '--app-text-subtle', '--app-border', '--app-border-subtle', '--app-border-hover',
    '--destructive-soft', '--destructive-border', '--warning-soft', '--warning-border', '--warning-text',
    '--success-soft', '--success-border', '--info', '--info-soft', '--info-border', '--yc-control-link'
  ]) {
    assert.ok(themeBridgeSource.includes(token), `缺少宿主主题 token：${token}`);
  }
  assert.match(styleSource, /--app-font-family:/);
  assert.match(styleSource, /body \{[\s\S]*background: hsl\(var\(--app-bg\)\)/);
  assert.match(styleSource, /:root \{[\s\S]*--adc-chart-purple: #8B5CF6;/);
  assert.match(styleSource, /:root\[data-theme="dark"\],[\s\S]*--adc-chart-purple: #A78BFA;/);
  assert.match(styleSource, /\.yc-chart-insight \{[\s\S]*--yc-chart-ai-accent: var\(--adc-chart-purple\)/);
  assert.match(styleSource, /\.yc-chart-insight \{[\s\S]*--yc-chart-ai-companion: hsl\(var\(--info\)\)/);
  assert.match(styleSource, /linear-gradient\(135deg, hsl\(var\(--app-surface\) \/ 0\.9\), hsl\(230 88% 98% \/ 0\.72\) 54%, hsl\(258 88% 98% \/ 0\.62\) 100%\)/);
  assert.match(styleSource, /:root\[data-theme="dark"\] \.yc-chart-insight,[\s\S]*linear-gradient\(135deg, hsl\(var\(--app-surface-elevated\) \/ 0\.82\), hsl\(var\(--app-surface-subtle\) \/ 0\.68\) 58%, hsl\(var\(--app-surface\) \/ 0\.86\) 100%\)/);
  assert.match(styleSource, /\.yc-approve-inbox-risk-high \.yc-approve-inbox-row-title strong \{ color: hsl\(var\(--destructive\)\); \}/);
  assert.match(styleSource, /\.yc-approve-inbox-risk-medium \.yc-approve-inbox-row-title strong \{ color: hsl\(var\(--warning-text\)\); \}/);
  assert.match(styleSource, /--yc-standard-list-bg: hsl\(var\(--info-soft\)\)/);
  assert.match(styleSource, /:root\[data-theme="dark"\] \.yc-message-center-item\.yc-semantic-list-row,[\s\S]*?--yc-standard-list-bg: hsl\(var\(--info-soft\)\)/);
  assert.match(styleSource, /color-mix\(in srgb, var\(--yc-standard-list-bg\) 72%, hsl\(var\(--app-surface-elevated\)\) 28%\)/);
  assert.match(styleSource, /color-mix\(in srgb, hsl\(var\(--app-surface\)\) 86%, var\(--yc-standard-list-bg\) 14%\)/);
  assert.match(styleSource, /\.yc-approve-inbox-attachment-source-other \{ background: hsl\(var\(--primary\) \/ \.08\); color: hsl\(var\(--primary\)\); \}/);
  assert.match(styleSource, /\.yc-attachment-preview-html \{[\s\S]*background: hsl\(var\(--app-surface\)\); color: hsl\(var\(--app-text\)\)/);
});

test('待办列表语义标签在暗黑模式下消费驾驶舱标准语义色', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');
  const styleSource = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';
  const darkTagStyles = styleSource.match(/:root\[data-theme="dark"\] \.yc-message-center-tag,[\s\S]*?\n    \}/)?.[0] || '';

  for (const theme of ['dark', 'night', 'black', '暗黑']) {
    assert.ok(darkTagStyles.includes(`:root[data-theme="${theme}"] .yc-message-center-tag`), `缺少${theme}模式标签适配`);
  }
  for (const declaration of [
    '--wui-tag-light-border: hsl(var(--app-text) / .18)',
    '--wui-tag-light-bg: hsl(var(--app-text) / .08)',
    '--wui-tag-color-text: hsl(var(--app-text-secondary))',
    '--wui-tag-success-border: hsl(var(--success) / .42)',
    '--wui-tag-success-bg: hsl(var(--success) / .18)',
    '--wui-tag-success-text: hsl(var(--success))',
    '--wui-tag-warning-border: hsl(var(--warning) / .42)',
    '--wui-tag-warning-bg: hsl(var(--warning) / .18)',
    '--wui-tag-warning-text: hsl(var(--warning-text))',
    '--wui-tag-danger-border: hsl(var(--destructive) / .42)',
    '--wui-tag-danger-bg: hsl(var(--destructive) / .18)',
    '--wui-tag-danger-text: hsl(var(--destructive))'
  ]) {
    assert.ok(darkTagStyles.includes(declaration), `缺少暗黑标签 token 映射：${declaration}`);
  }
});

test('单据详情通知宿主隐藏头部并按宿主容器模式选择展开方向', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');
  const wideDrawerRule = html.match(/html\[data-container-layout="wide"\] \.yc-approve-inbox-shell-drawer \{[^}]*\}/)?.[0] || '';
  const narrowDrawerRule = html.match(/html\[data-container-layout="narrow"\] \.yc-approve-inbox-shell-drawer \{[^}]*\}/)?.[0] || '';

  assert.ok(html.includes("root.setAttribute('data-container-layout', containerMode)"));
  assert.ok(html.includes("type: 'approve-inbox:detail-visibility', open: true"));
  assert.ok(html.includes("type: 'approve-inbox:detail-visibility', open: false"));
  assert.match(wideDrawerRule, /position: absolute/);
  assert.match(wideDrawerRule, /inset: 0/);
  assert.match(wideDrawerRule, /width: 100%/);
  assert.match(wideDrawerRule, /height: 100%/);
  assert.match(wideDrawerRule, /min-width: 0/);
  assert.match(wideDrawerRule, /border: 0/);
  assert.match(wideDrawerRule, /border-radius: 0/);
  assert.match(wideDrawerRule, /animation: drawer-enter/);
  assert.match(narrowDrawerRule, /position: fixed/);
  assert.match(narrowDrawerRule, /inset: 0/);
  assert.match(narrowDrawerRule, /width: 100%/);
  assert.match(narrowDrawerRule, /height: 100%/);
  assert.match(narrowDrawerRule, /min-width: 0/);
  assert.match(narrowDrawerRule, /border: 0/);
  assert.match(narrowDrawerRule, /border-radius: 0/);
  assert.match(narrowDrawerRule, /animation: sheet-up-narrow/);
});

test('移动端详情抽屉不显示顶部拖拽条且不保留占位', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');

  assert.match(html, /\.yc-sheet-grabber \{ display: none; \}/);
  assert.match(html, /<div class="yc-sheet-grabber" aria-hidden="true"><\/div>/);
  assert.doesNotMatch(html, /\.yc-sheet-grabber \{[^}]*display: block[^}]*padding: 8px 0 4px/);
  assert.doesNotMatch(html, /\.yc-sheet-grabber::before/);
});

test('单据操作合并到详情头部并排在原快捷导航左侧', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');
  const renderDetailSource = html.match(/function renderDetail\(d\) \{[\s\S]*?return h \+ '<\/aside>';\n    \}/)?.[0] || '';

  assert.match(renderDetailSource, /class="yc-approve-inbox-detail-actions" aria-label="单据操作"/);
  assert.match(renderDetailSource, /detailActionsHtml \+\n        '<div class="yc-approve-inbox-detail-nav"/);
  assert.match(renderDetailSource, /data-detail-act=/);
  assert.match(
    renderDetailSource,
    /data-detail-nav="prev"[\s\S]*?data-detail-nav="next"[\s\S]*?data-original-detail-url="1"[\s\S]*?data-detail-act="reanalyze"[\s\S]*?id="btnCloseDetail"/
  );
  assert.doesNotMatch(renderDetailSource, /detailActionsHtml \+= '<button[^\n]*data-detail-act="reanalyze"/);
  assert.doesNotMatch(renderDetailSource, /<footer class="yc-approve-inbox-detail-footer"/);
  assert.match(html, /\.yc-approve-inbox-detail-actions \{[^}]*display: inline-flex[^}]*align-items: center[^}]*gap: 6px/);
});

test('详情导航使用 IconLoader 本地图标且左右箭头矩形贴合', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');
  const renderDetailSource = html.match(/function renderDetail\(d\) \{[\s\S]*?return h \+ '<\/aside>';\n    \}/)?.[0] || '';
  const localIconPaths = html.match(/const LOCAL_ICON_PATHS = \{[\s\S]*?\n    \};/)?.[0] || '';

  for (const code of ['ynf-refresh', 'ynf-external-link', 'uf-close', 'left', 'right']) {
    assert.match(localIconPaths, new RegExp(`['"]${code}['"]:`));
  }
  assert.match(renderDetailSource, /data-original-detail-url="1"[\s\S]*?localIcon\('ynf-external-link'\)/);
  assert.match(renderDetailSource, /data-detail-act="reanalyze"[\s\S]*?localIcon\('ynf-refresh'\)/);
  assert.match(
    renderDetailSource,
    /class="yc-approve-inbox-detail-nav-pair"[\s\S]*?data-detail-nav="prev"[\s\S]*?localIcon\('left'\)[\s\S]*?data-detail-nav="next"[\s\S]*?localIcon\('right'\)/
  );
  assert.match(renderDetailSource, /id="btnCloseDetail"[^\n]*localIcon\('uf-close'\)/);
  assert.match(html, /\.yc-approve-inbox-detail-nav-pair \{[^}]*display: inline-flex[^}]*gap: 0/);
  assert.match(html, /\.yc-approve-inbox-detail-nav-pair \.yc-approve-inbox-detail-nav-btn \+ \.yc-approve-inbox-detail-nav-btn \{[^}]*margin-left: -1px/);
  assert.match(html, /\.yc-approve-inbox-detail-nav \.yc-action-icon \{[^}]*width: 16px[^}]*height: 16px/);
  assert.match(
    html,
    /\.yc-approve-inbox-detail-nav \.yc-approve-inbox-detail-nav-btn,[\s\S]*?\.yc-approve-inbox-detail-nav \.yc-approve-inbox-detail-btn-icon,[\s\S]*?\.yc-approve-inbox-detail-nav \.yc-approve-inbox-detail-close \{[^}]*color: hsl\(var\(--app-text-muted\)\)/
  );
  assert.match(
    html,
    /\.yc-approve-inbox-detail-nav > \[data-original-detail-url\],[\s\S]*?\.yc-approve-inbox-detail-nav > \.yc-approve-inbox-detail-btn-icon,[\s\S]*?\.yc-approve-inbox-detail-nav > \.yc-approve-inbox-detail-close \{[^}]*border: 0/
  );
});

test('单据字段分析与用户级规则分析复用标准 List 语义行', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');
  const renderDetailSource = html.match(/function renderDetail\(d\) \{[\s\S]*?return h \+ '<\/aside>';\n    \}/)?.[0] || '';

  assert.match(html, /const SEVERITY_TONE = \{ risk: 'danger', warning: 'warning', passed: 'success' \}/);
  assert.match(renderDetailSource, /yc-approve-inbox-field-list yc-semantic-list/);
  assert.match(renderDetailSource, /yc-approve-inbox-field-row yc-semantic-list-row" data-tone="' \+ semanticToneForSeverity\(f\.severity\)/);
  assert.match(renderDetailSource, /yc-approve-inbox-rule-list yc-semantic-list/);
  assert.match(renderDetailSource, /yc-approve-inbox-rule-row yc-semantic-list-row" data-tone="' \+ semanticToneForSeverity\(r\.severity\)/);
  assert.match(renderDetailSource, /yc-semantic-marker/);
  assert.match(renderDetailSource, /yc-semantic-content/);
  assert.match(renderDetailSource, /analysis-card-head/);
  assert.match(renderDetailSource, /analysis-card-title/);
  assert.match(renderDetailSource, /analysis-card-text/);
  assert.match(renderDetailSource, /esc\(f\.name \+ \(f\.value \? '：' \+ f\.value : ''\)\)/);
  assert.doesNotMatch(html, /yc-approve-inbox-field-value/);
  assert.match(renderDetailSource, /tag tag-' \+ semanticToneForSeverity\(f\.severity\) \+ ' yc-semantic-row-tag yc-approve-inbox-tag/);
  assert.match(renderDetailSource, /tag tag-' \+ semanticToneForSeverity\(r\.severity\) \+ ' yc-semantic-row-tag yc-approve-inbox-tag/);
  assert.match(renderDetailSource, /esc\(\[r\.summary, r\.evidence\]\.filter\(Boolean\)\.join\('：'\)\)/);
  assert.doesNotMatch(html, /yc-approve-inbox-evidence/);
  assert.match(renderDetailSource, /class="yc-message-center-ai-advice analysis-card-text" data-field="advice"/);
  assert.match(renderDetailSource, /<span class="yc-message-center-ai-icon">' \+ localIcon\('AI_star'\) \+ '<\/span>/);
  assert.match(renderDetailSource, /<span class="yc-message-center-ai-value">' \+ esc\(r\.suggestion\) \+ '<\/span>/);
  assert.doesNotMatch(html, /yc-approve-inbox-suggestion/);
  assert.doesNotMatch(renderDetailSource, /icon\('lightbulb'\)/);
  assert.match(html, /\.yc-approve-inbox-detail \.yc-semantic-list \{[^}]*display: grid[^}]*gap: 8px/);
  assert.match(html, /\.yc-approve-inbox-detail \.yc-semantic-list-row \{[^}]*display: grid[^}]*grid-template-columns: 18px minmax\(0, 1fr\)[^}]*padding: 10px 12px[^}]*border: 0/);
  assert.match(html, /\.yc-approve-inbox-detail \.yc-semantic-head \{[^}]*position: relative[^}]*padding-right: 44px/);
  assert.match(html, /\.yc-approve-inbox-detail \.yc-semantic-row-tag \{[^}]*position: absolute[^}]*top: 0[^}]*right: 0/);
  assert.match(html, /--yc-cockpit-danger: 0 72% 51%/);
  assert.match(html, /--yc-cockpit-warning: 38 92% 50%/);
  assert.match(html, /--yc-cockpit-success: 160 84% 39%/);
  assert.match(html, /--yc-cockpit-tag-danger: hsl\(var\(--yc-cockpit-danger\)\)/);
  assert.match(html, /--yc-cockpit-tag-warning: hsl\(var\(--yc-cockpit-warning\)\)/);
  assert.match(html, /--yc-cockpit-tag-success: hsl\(var\(--yc-cockpit-success\)\)/);
  assert.match(html, /--yc-cockpit-tag-danger-soft: color-mix\(in srgb, hsl\(var\(--yc-cockpit-danger\)\) 16%, hsl\(var\(--app-surface\)\)\)/);
  assert.match(html, /--yc-cockpit-tag-warning-soft: color-mix\(in srgb, hsl\(var\(--yc-cockpit-warning\)\) 16%, hsl\(var\(--app-surface\)\)\)/);
  assert.match(html, /--yc-cockpit-tag-success-soft: color-mix\(in srgb, hsl\(var\(--yc-cockpit-success\)\) 16%, hsl\(var\(--app-surface\)\)\)/);
  assert.match(html, /\.yc-approve-inbox-detail \.tag-danger \{[^}]*color: var\(--yc-cockpit-tag-danger\)[^}]*background: var\(--yc-cockpit-tag-danger-soft\)/);
  assert.match(html, /\.yc-approve-inbox-detail \.tag-warning \{[^}]*color: var\(--yc-cockpit-tag-warning\)[^}]*background: var\(--yc-cockpit-tag-warning-soft\)/);
  assert.match(html, /\.yc-approve-inbox-detail \.tag-success \{[^}]*color: var\(--yc-cockpit-tag-success\)[^}]*background: var\(--yc-cockpit-tag-success-soft\)/);
  assert.match(html, /\.yc-approve-inbox-detail \.yc-semantic-list-row\[data-tone="danger"\] \.yc-semantic-marker \{[^}]*background: hsl\(var\(--yc-cockpit-danger\)\)/);
  assert.match(html, /\.yc-approve-inbox-detail \.yc-semantic-list-row\[data-tone="warning"\] \.yc-semantic-marker \{[^}]*background: hsl\(var\(--yc-cockpit-warning\)\)/);
  assert.match(html, /\.yc-approve-inbox-detail \.yc-semantic-list-row\[data-tone="success"\] \.yc-semantic-marker \{[^}]*background: hsl\(var\(--yc-cockpit-success\)\)/);
  assert.match(html, /color-mix\(in srgb, var\(--yc-standard-list-bg\) 20%, transparent\)/);
  assert.match(html, /color-mix\(in srgb, var\(--yc-standard-list-bg\) 10%, transparent\)/);
  assert.match(html, /\.yc-approve-inbox-detail \.yc-semantic-list-row\[data-tone="danger"\] \{[^}]*--yc-standard-list-bg: color-mix\(in srgb, hsl\(var\(--yc-cockpit-danger\)\) 30%, hsl\(var\(--app-surface\)\)\)/);
  assert.match(html, /\.yc-approve-inbox-detail \.yc-semantic-list-row\[data-tone="warning"\] \{[^}]*--yc-standard-list-bg: color-mix\(in srgb, hsl\(var\(--yc-cockpit-warning\)\) 30%, hsl\(var\(--app-surface\)\)\)/);
  assert.match(html, /\.yc-approve-inbox-detail \.yc-semantic-list-row\[data-tone="success"\] \{[^}]*--yc-standard-list-bg: color-mix\(in srgb, hsl\(var\(--yc-cockpit-success\)\) 30%, hsl\(var\(--app-surface\)\)\)/);
});

test('详情智能建议以建议内容作为标题并使用语意渐变图标', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');
  const renderDetailSource = html.match(/function renderDetail\(d\) \{[\s\S]*?return h \+ '<\/aside>';\n    \}/)?.[0] || '';
  const localIconPaths = html.match(/const LOCAL_ICON_PATHS = \{[\s\S]*?\n    \};/)?.[0] || '';

  assert.match(renderDetailSource, /const hasSmartAdvice = analyzed \|\| d\.compositeAdvice \|\| \(d\.systemRuleAudit && d\.systemRuleAudit\.status === 'success'\)/);
  assert.match(renderDetailSource, /const terminalDetailState = detailFieldsUnavailable \|\| unsupported \|\| \(notFound && !hasFields\);[\s\S]*?if \(hasSmartAdvice \|\| \(d\.overallAnalysis && !terminalDetailState\)\) \{/);
  assert.match(renderDetailSource, /class="yc-approve-inbox-detail-insight yc-chart-insight yc-approve-inbox-detail-insight-' \+ adv \+ '">/);
  assert.match(localIconPaths, /['"]XING-AUTO['"]:/);
  assert.match(html, /function smartAdviceIcon\(\)[\s\S]*data-icon-code="XING-AUTO"[\s\S]*ycApproveInboxAdviceIconGradient/);
  assert.match(renderDetailSource, /class="review-summary-head yc-approve-inbox-detail-advice-head">' \+/);
  assert.match(renderDetailSource, /smartAdviceIcon\(\)[\s\S]*class="yc-approve-inbox-detail-advice yc-approve-inbox-detail-advice-' \+ adv \+ '">/);
  assert.match(renderDetailSource, /esc\(composite\.label \|\| \(d\.conclusion && d\.conclusion\.label\) \|\| ADVICE_LABEL\[adv\]\)/);
  assert.match(renderDetailSource, /review-summary-analysis yc-approve-inbox-detail-insight-analysis/);
  assert.doesNotMatch(renderDetailSource, /<span>智能建议<\/span>/);
  assert.doesNotMatch(renderDetailSource, /localIcon\('AI_star'\)[^\n]*智能建议/);
  assert.doesNotMatch(renderDetailSource, /yc-approve-inbox-section-title">综合审批建议<\/h4>/);
  assert.doesNotMatch(renderDetailSource, /yc-approve-inbox-section-title">总体分析<\/h4>/);
  assert.doesNotMatch(renderDetailSource, /yc-approve-inbox-detail-advice-caption/);
  assert.doesNotMatch(renderDetailSource, /yc-approve-inbox-detail-advice-main/);
  assert.doesNotMatch(renderDetailSource, /yc-approve-inbox-conclusion-light/);
  assert.doesNotMatch(renderDetailSource, /composite\.summary/);
  assert.match(html, /\.yc-approve-inbox-detail-advice \{[^}]*display: block[^}]*padding: 0[^}]*min-height: 0[^}]*border: 0[^}]*background: none[^}]*box-shadow: none[^}]*color: var\(--yc-approve-inbox-advice-tone\)[^}]*font-size: 16px[^}]*font-weight: 700/);
  assert.match(html, /\.yc-approve-inbox-detail-insight-approve \{[^}]*--yc-approve-inbox-advice-tone: hsl\(var\(--success\)\)/);
  assert.match(html, /\.yc-approve-inbox-detail-insight-caution \{[^}]*--yc-approve-inbox-advice-tone: hsl\(var\(--warning-text\)\)/);
  assert.match(html, /\.yc-approve-inbox-detail-insight-reject \{[^}]*--yc-approve-inbox-advice-tone: hsl\(var\(--destructive\)\)/);
  assert.doesNotMatch(html, /\.yc-approve-inbox-detail-advice-(?:approve|caution|reject) \{[^}]*color:/);
  assert.match(html, /\.yc-approve-inbox-detail-advice-icon-stop-start \{ stop-color: var\(--yc-chart-ai-accent\); \}/);
  assert.match(html, /\.yc-approve-inbox-detail-advice-icon-stop-end \{ stop-color: var\(--yc-approve-inbox-advice-tone\); \}/);
  assert.match(html, /class="yc-approve-inbox-detail-advice-icon-stop-end" offset="45%"/);
  assert.match(html, /\.yc-approve-inbox-detail-advice-icon-glyph \* \{ fill: url\(#ycApproveInboxAdviceIconGradient\) !important; \}/);
});

test('基本信息与单据字段独立按前四行展开收起', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');
  const renderConfiguredSource = html.match(/function renderConfiguredDetailSections\(d\) \{[\s\S]*?\n    \}/)?.[0] || '';
  const renderDetailSource = html.match(/function renderDetail\(d\) \{[\s\S]*?return h \+ '<\/aside>';\n    \}/)?.[0] || '';
  const drawerClickSource = html.match(/document\.getElementById\('drawer'\)\.addEventListener\('click',[\s\S]*?\n    \}\);/)?.[0] || '';

  assert.match(html, /const DETAIL_FIELD_PREVIEW_LIMIT = 4;/);
  assert.match(html, /detailFieldExpansion: \{ basic: false, raw: false \}/);
  assert.match(html, /function resetDetailFieldExpansion\(\)[\s\S]*state\.detailFieldExpansion = \{ basic: false, raw: false \}/);
  assert.match(html, /function renderDetailFieldToggle\(scope, total, expanded\)[\s\S]*if \(total <= DETAIL_FIELD_PREVIEW_LIMIT\) return ''/);
  assert.match(html, /data-detail-field-toggle="' \+ scope \+ '"/);
  assert.match(html, /expanded \? '收起字段' : '查看更多'/);
  assert.match(html, /localIcon\('uf-anglearrowdown'\)/);
  assert.match(renderConfiguredSource, /const isBasicSection = \(section\.title \|\| ''\) === '基本信息'/);
  assert.match(renderConfiguredSource, /fields\.slice\(0, DETAIL_FIELD_PREVIEW_LIMIT\)/);
  assert.match(renderConfiguredSource, /renderDetailFieldToggle\('basic', fields\.length, expanded\)/);
  assert.match(renderDetailSource, /const rawFields = \(d\.fields \|\| \[\]\)\.filter/);
  assert.match(renderDetailSource, /rawFields\.slice\(0, DETAIL_FIELD_PREVIEW_LIMIT\)/);
  assert.match(renderDetailSource, /renderDetailFieldToggle\('raw', rawFields\.length, rawExpanded\)/);
  assert.match(drawerClickSource, /const fieldToggle = e\.target\.closest\('\[data-detail-field-toggle\]'\)/);
  assert.match(drawerClickSource, /state\.detailFieldExpansion\[scope\] = !state\.detailFieldExpansion\[scope\]/);
  assert.match(drawerClickSource, /render\(\{ detailScrollTop \}\)/);
  assert.match(html, /\.yc-approve-inbox-field-toggle \{[^}]*display: flex[^}]*align-items: center[^}]*gap: 3px[^}]*margin: 4px auto 0[^}]*padding: 0[^}]*border: 0[^}]*color: hsl\(var\(--app-text-muted\) \/ \.78\)[^}]*font-size: 12px[^}]*font-weight: 700[^}]*background: transparent/);
  assert.match(html, /\.yc-approve-inbox-field-toggle \.yc-action-icon \{[^}]*width: 12px[^}]*height: 12px/);
});

test('智能待办核心详情文字保持 12px 可读下限', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');
  assert.match(html, /\.yc-approve-inbox-fallback-notice \{[^}]*font-size: 12px/);
  assert.match(html, /\.yc-approve-inbox-rawfields \.rf-k \{[^}]*font-size: 12px/);
  assert.match(html, /\.yc-approve-inbox-rawfields \.rf-v \{[^}]*font-size: 12px/);
  assert.match(html, /\.yc-approve-inbox-detail \.yc-approve-inbox-tag \{[^}]*font-size: 12px/);
});

test('列表项点击后立即打开详情抽屉并异步加载内容', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');
  const renderSource = html.match(/function render\(options = \{\}\) \{[\s\S]*?\n    \}\n\n    \/\* ========== 交互/)?.[0] || '';
  const openDetailSource = html.match(/async function openDetail\(id\) \{[\s\S]*?\n    \}\n\n    \/\*\*/)?.[0] || '';

  assert.match(renderSource, /if \(showList && !HOST_OWNS_DETAIL && state\.activeItemId && state\.detail\) \{/);
  assert.match(openDetailSource, /state\.detail = detailLoadingPlaceholder\(id\)/);
  assert.match(html, /function detailLoadingPlaceholder\(id\)/);
  assert.ok(openDetailSource.indexOf('render();') < openDetailSource.indexOf('await fetchDetail(id)'));
  assert.match(openDetailSource, /catch \(e\) \{[\s\S]*if \(e && e\.apiIdentityGuarded\) return;/);
});

test('打开和关闭详情时保持背景列表滚动位置', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');
  const renderSource = html.match(/function render\(options = \{\}\) \{[\s\S]*?\n    \}\n\n    \/\* ========== 交互/)?.[0] || '';
  const openDetailSource = html.match(/async function openDetail\(id\) \{[\s\S]*?\n    \}\n\n    \/\*\*/)?.[0] || '';
  const closeDetailSource = html.match(/function closeDetail\(\) \{[\s\S]*?\n    \}/)?.[0] || '';

  assert.match(renderSource, /const currentListScrollTop = currentList \? currentList\.scrollTop : null/);
  assert.doesNotMatch(renderSource, /saveListScrollPosition\(\)/);
  assert.match(renderSource, /if \(options\.restoreListScroll\) restoreListScrollPosition\(\);[\s\S]*?else if \(Number\.isFinite\(currentListScrollTop\)\) setListScrollPosition\(currentListScrollTop\)/);
  assert.match(openDetailSource, /if \(!state\.activeItemId\) saveListScrollPosition\(\)/);
  assert.ok(openDetailSource.indexOf('saveListScrollPosition()') < openDetailSource.indexOf('state.activeItemId = id'));
  assert.match(closeDetailSource, /render\(\{ restoreListScroll: true \}\)/);
});

test('列表内勾选和详情打开等重渲染同步保持当前滚动位置', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');
  const restoreSource = html.match(/function restoreListScrollPosition\(\) \{[\s\S]*?\n    \}/)?.[0] || '';
  const renderSource = html.match(/function render\(options = \{\}\) \{[\s\S]*?\n    \}\n\n    \/\* ========== 交互/)?.[0] || '';
  const selectionSource = html.match(/const selectAll = e\.target\.closest\('\[data-select-all\]'\);[\s\S]*?const rap =/)?.[0] || '';

  assert.match(renderSource, /const currentListScrollTop = currentList \? currentList\.scrollTop : null/);
  assert.ok(renderSource.indexOf('const currentListScrollTop') < renderSource.indexOf('inbox.innerHTML = availabilityHtml'));
  assert.match(renderSource, /if \(options\.restoreListScroll\) restoreListScrollPosition\(\);[\s\S]*?else if \(Number\.isFinite\(currentListScrollTop\)\) setListScrollPosition\(currentListScrollTop\)/);
  assert.doesNotMatch(restoreSource, /requestAnimationFrame/);
  assert.match(selectionSource, /if \(selectAll\)[\s\S]*?render\(\);/);
  assert.match(selectionSource, /if \(selectRow\)[\s\S]*?render\(\);/);
});

test('批量同意沿用 UE 位置并由本地审批安全状态控制可用性', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');

  assert.match(
    html,
    /class="btn btn-primary yc-approve-inbox-batch-approve" id="btnBatch"/
  );
  assert.match(html, /state\.activeL1 === 'todo'[\s\S]*?id="btnBatch"/);
  assert.match(html, /id="btnBatch"'[\s\S]*?selectedApprovable\.length === 0 \|\| interactionsBlocked\(\)/);
  assert.match(html, /icon\('bot'\) \+ '重新分析<\/button>'/);
  assert.match(html, /const selectedApprovable = selectedVisible\.filter\(i => hasAction\(i, 'approve'\)\)/);
  assert.match(html, /function hasAction\(item, action\) \{[\s\S]*?if \(interactionsBlocked\(\) \|\| approvalProcessing\(item\)\) return false;/);
  assert.match(html, /if \(selectedVisible\.length === 0\) \{ toast\('请先选择要批量处理的待办单据', 'info'\); return; \}/);
  assert.match(html, /if \(ids\.length !== selectedVisible\.length\) \{ toast\('所选单据中存在当前不可统一处理的单据，请重新选择', 'info'\); return; \}/);
  assert.match(
    html,
    /\.yc-approve-inbox-batch-approve \{[^}]*border: 1px solid hsl\(var\(--primary\)\)[^}]*background: hsl\(var\(--primary\)\)[^}]*color: hsl\(var\(--primary-foreground\)\)/
  );
});

test('详情控件 hover 沿用控件原色并加深', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');

  assert.match(html, /--yc-control-link: 217 91% 53%/);
  assert.match(html, /--yc-control-link-hover: 217 91% 43%/);
  assert.match(html, /\.yc-native-row-action:hover \{ color: hsl\(var\(--yc-control-link-hover\)\); \}/);
  assert.match(html, /\.yc-native-row-action \{[^}]*color: hsl\(var\(--yc-control-link\)\)/);
  assert.doesNotMatch(html, /--yc-control-link: hsl\(var\(--primary\)\)/);
  assert.match(html, /\.yc-mail-search-inline:hover \{ border-color: hsl\(var\(--app-border-hover\)\); \}/);
  assert.match(html, /\.yc-mail-search-inline:focus-within \{ border-color: hsl\(var\(--app-border-hover\)\); box-shadow: inset 0 0 0 1px hsl\(var\(--app-border-hover\) \/ \.45\); \}/);
  assert.match(html, /\.yc-approve-inbox-row-btn-reject:hover \{ color: hsl\(var\(--app-text\)\);/);
  assert.doesNotMatch(html, /\.yc-native-row-action:hover \{ color: hsl\(var\(--primary\)\); \}/);
  assert.doesNotMatch(html, /\.yc-mail-search-inline:hover \{ border-color: hsl\(var\(--primary\)\); \}/);
  assert.doesNotMatch(html, /\.yc-mail-search-inline:focus-within \{ border-color: hsl\(var\(--primary\)\);/);
  assert.match(html, /\.yc-approval-modal-close \{[^}]*border: 0; border-radius: 0;[^}]*background: transparent/);
  assert.match(html, /\.yc-approval-modal-close:hover \{ background: transparent; color: hsl\(var\(--app-text\)\); \}/);
  assert.match(html, /\.yc-approval-field textarea:focus,[\s\S]*?\.yc-approval-field select:focus \{[^}]*outline: none;[^}]*border-color: hsl\(var\(--app-border-hover\)\);[^}]*box-shadow: inset 0 0 0 1px hsl\(var\(--app-border-hover\) \/ \.45\)/);
  assert.doesNotMatch(html, /\.yc-approval-field (?:textarea|select):focus-visible,[\s\S]*?outline: 2px solid hsl\(var\(--primary\)/);
});

test('退回弹窗使用 Tinper 标准自定义下拉并保持提交字段契约', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');

  assert.doesNotMatch(html, /<select id="approval(?:RejectTarget|SelectedByRejecter)"/);
  assert.match(html, /function renderApprovalSelect\(/);
  assert.match(html, /class="yc-approval-select select dropdown" data-approval-select="/);
  assert.match(html, /class="yc-approval-select-trigger select-selection dropdown-trigger"/);
  assert.match(html, /class="yc-approval-select-arrow select-arrow"/);
  assert.match(html, /class="yc-approval-select-menu select-dropdown dropdown-menu" role="listbox"/);
  assert.match(html, /class="yc-approval-select-option select-item dropdown-item/);
  assert.match(html, /select-item-selected/);
  assert.match(html, /renderApprovalSelect\('rejectTarget', '退回目标', d\.rejectTarget\)/);
  assert.match(html, /renderApprovalSelect\('selectedByRejecter', '再次提交后', d\.selectedByRejecter\)/);
  assert.match(html, /state\.approvalDialog\[field\] = value/);
  assert.match(html, /rejectTarget: d\.rejectTarget \|\| '-1'/);
  assert.match(html, /selectedByRejecter: d\.selectedByRejecter \|\| '0'/);
  assert.match(html, /\.yc-approval-select-menu \{[^}]*box-shadow:/);
  assert.match(html, /\.yc-approval-select-option:hover \{[^}]*background: hsl\(var\(--app-surface-hover\)\)/);
  assert.match(html, /\.yc-approval-select-option\.select-item-selected \{[^}]*background: hsl\(var\(--primary\) \/ \.06\)/);
});

test('审批弹窗使用无分隔基础布局且提交后沿用本地后台处理与对账', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');

  assert.match(html, /\.yc-approval-modal-header \{[^}]*padding: 14px 16px 8px;[^}]*border-bottom: 0;/);
  assert.match(html, /\.yc-approval-modal-body \{ padding: 8px 16px 16px;/);
  assert.match(html, /\.yc-approval-modal-footer \{[^}]*padding: 0 16px 14px; border-top: 0;[^}]*background: transparent;/);
  assert.match(html, /const approvalDialogHost = document\.getElementById\('approvalDialogHost'\);/);
  assert.match(html, /if \(!state\.approvalDialog \|\| !approvalDialogHost\.firstElementChild \|\| options\.refreshApprovalDialog\) \{/);
  assert.match(html, /approvalDialogHost\.innerHTML = renderApprovalDialog\(\);/);
  assert.doesNotMatch(html, /document\.getElementById\('approvalDialogHost'\)\.innerHTML = renderApprovalDialog\(\);/);
  assert.match(html, /markLocalApprovalProcessing\(ids, payload, localRequestId\);/);
  assert.match(html, /state\.approvalDialog = null;\s+render\(\);/);
  assert.match(html, /APPROVAL_RECONCILIATION_CODES\.has\(responseIssueCode\(res\)\)/);
});

test('正式运行态仅接受真实数据源并拒绝导入 UE 预览逻辑', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');
  const server = await readFile(new URL('server.mjs', webDir), 'utf8');

  assert.match(html, /if \(data && data\.dataSource === 'real'\) return data;/);
  assert.doesNotMatch(html, /dataSource === 'preview'/);
  assert.doesNotMatch(server, /APPROVE_INBOX_PREVIEW_TODOS/);
  assert.doesNotMatch(server, /handlePreview/);
});

test('Web 静态资源使用精确白名单且不扩大路径访问范围', async () => {
  const server = await readFile(new URL('server.mjs', webDir), 'utf8');

  assert.match(server, /const WEB_STATIC_FILES = new Set\(\["message-list-render\.js", "message-list\.css"\]\)/);
  assert.match(server, /WEB_STATIC_FILES\.has\(path\.slice\(1\)\)/);
  assert.match(server, /if \(!WEB_STATIC_FILES\.has\(fileName\)\)/);
  assert.doesNotMatch(server, /path\.startsWith\("\/message-list/);
});

test('待办智能速览复用驾驶舱 AI 洞察卡片并使用本地 AI_star 图标', async () => {
  const html = await readFile(new URL('index.html', webDir), 'utf8');

  assert.match(html, /class="yc-approve-inbox-review-summary yc-chart-insight"/);
  assert.match(html, /class="review-summary-head"><span class="yc-message-center-ai-icon">' \+ localIcon\('AI_star'\) \+ '<\/span><span>' \+ title/);
  assert.match(html, /localIcon\('AI_star'\)/);
  assert.match(html, /AI_star:/);
  assert.match(html, /data-icon-code="' \+ esc\(code\) \+ '"/);
  assert.match(html, /\.yc-chart-insight \{[^}]*radial-gradient/s);
  assert.match(html, /class="review-summary-stats yc-metric-list detail-metrics"/);
  assert.match(html, /class="stat yc-metric detail-metric detail-metric--success stat-approve"><span class="detail-metric-label">通过<\/span><strong class="detail-metric-value">/);
  assert.match(html, /\.review-summary-stats \{[^}]*width: 100%[^}]*display: grid[^}]*grid-template-columns: repeat\(auto-fit, minmax\(120px, 1fr\)\)/);
  assert.match(html, /\.review-summary-stats \.stat \{[^}]*min-width: 0[^}]*padding: 7px[^}]*border: 1px solid hsl\(var\(--app-border-subtle\) \/ \.52\)[^}]*background:/);
  assert.doesNotMatch(html, /review-summary-head[^\n]*icon\('bot'\)/);
});
