/** 智能待办消息中心列表生成器 */
(function initApproveInboxMessageList(window) {
  'use strict';

  const joinText = (parts) => parts.filter(Boolean).join(' · ');
  const FIELD_ORDER = { advice: 0, riskLevel: 1, tags: 2 };
  const AI_STAR_ICON = '<svg class="yc-action-icon yc-local-icon" data-icon-code="AI_star" viewBox="0 0 1024 1024" aria-hidden="true"><path d="M910.27456 281.728l11.52-2.56c15.232-3.2 15.232-24.832 0-28.16l-11.52-2.432a128 128 0 0 1-98.304-98.304l-2.49856-11.52c-3.2-15.232-24.89344-15.232-28.16 0l-2.49344 11.52a128 128 0 0 1-98.24256 98.304l-11.58144 2.49856c-15.17056 3.2-15.17056 24.89344 0 28.16l11.52 2.49344a128 128 0 0 1 98.304 98.24256l2.56 11.58144c3.2 15.16544 24.832 15.16544 28.16 0l2.432-11.52a128 128 0 0 1 98.304-98.304zM719.36 579.26144c24.576-5.248 24.576-40.32 0-45.568-114.688-24.63744-240.896-150.84544-265.53344-265.6-5.25312-24.50944-40.32512-24.50944-45.568 0-24.64256 114.75456-150.85056 240.96256-265.60512 265.6-24.50944 5.248-24.50944 40.32 0 45.568 114.75456 24.64256 240.96256 150.85056 265.6 265.6 5.248 24.51456 40.32 24.51456 45.568 0 24.64256-114.74944 150.85056-240.95744 265.6-265.6h-.06144z" fill="currentColor"></path></svg>';
  const TAG_TONE_CLASS = {
    high: 'tag-danger wui-tag-danger',
    medium: 'tag-warning wui-tag-warning',
    low: 'tag-success wui-tag-success',
    risk: 'tag-danger wui-tag-danger',
    rule: 'tag-warning wui-tag-warning',
    advice: 'tag-success wui-tag-success'
  };

  const renderTag = (text, tone, escapeHtml) => {
    const value = escapeHtml(text);
    return '<span class="tag wui-tag wui-tag-sm ' + (TAG_TONE_CLASS[tone] || 'tag-default wui-tag-light') + ' yc-message-center-tag">' + value + '</span>';
  };

  const renderTagValues = (field, escapeHtml) => {
    const values = field.id === 'tags'
      ? (Array.isArray(field.tags) && field.tags.length
          ? field.tags
          : String(field.value).split(/[、，,]/).filter(Boolean).map((label) => ({ label })))
      : [{ label: field.value, kind: field.tone }];
    return values.map((tag) => renderTag(tag.label, tag.kind || field.tone, escapeHtml)).join('');
  };

  const renderAiAdvice = (field, escapeHtml, aiIconHtml) => {
    if (!field || !field.value) {
      return '';
    }
    return '<p class="yc-message-center-ai-advice analysis-card-text" data-field="' + escapeHtml(field.id) + '">' +
      '<span class="yc-message-center-ai-icon">' + (aiIconHtml || AI_STAR_ICON) + '</span>' +
      '<span class="yc-message-center-ai-value">' + escapeHtml(field.value) + '</span>' +
    '</p>';
  };

  /** 生成消息中心式待办列表 */
  function render(options) {
    const {
      items = [],
      allSelected = false,
      selectableCount = 0,
      total = 0,
      page = 1,
      pageSize = 10,
      totalPages = 1,
      toolbarHtml = '',
      emptyText = '暂无待办',
      aiIconHtml = AI_STAR_ICON,
      escapeHtml = (value) => String(value ?? '')
    } = options || {};

    let html = '<section class="yc-message-center-shell" aria-label="智能待办列表">';
    html += '<div class="yc-message-center-bulk">' +
      '<label><input type="checkbox" data-select-all aria-label="选择当前页"' +
        (allSelected ? ' checked' : '') + (selectableCount ? '' : ' disabled') + '>全选</label>' +
      (toolbarHtml ? '<div class="yc-message-center-list-tools">' + toolbarHtml + '</div>' : '') +
    '</div>';

    if (!items.length) {
      html += '<div class="yc-message-center-empty" role="status">' + escapeHtml(emptyText) + '</div>';
    } else {
      html += '<ul class="yc-message-center-list yc-business-message-list yc-semantic-list" role="list">';
      for (const item of items) {
        const className = 'yc-message-center-item yc-semantic-list-row yc-approve-inbox-risk-' + escapeHtml(item.riskLevel || 'low') +
          (item.done ? ' yc-message-center-item-done' : '') + (item.selected ? ' selected' : '') + (item.active ? ' active' : '');
        const taskMeta = item.taskMeta || joinText([item.business, item.submitter, item.submittedAt]);
        const extraFields = Array.isArray(item.extraFields)
          ? item.extraFields
            .filter((field) => field && field.value)
            .sort((left, right) => (FIELD_ORDER[left.id] ?? 99) - (FIELD_ORDER[right.id] ?? 99))
          : [];
        const aiAdviceField = extraFields.find((field) => field.id === 'advice');
        const titleTagFields = extraFields.filter((field) => field.id === 'riskLevel' || field.id === 'tags');
        const bodyFields = extraFields.filter((field) => field.id !== 'advice' && field.id !== 'riskLevel' && field.id !== 'tags');
        const tenantTag = item.tenantName
          ? '<span class="yc-approve-inbox-tenant-tag">' + escapeHtml(item.tenantName) + '</span>'
          : '';
        const titleTagsHtml = titleTagFields.length
          ? '<span class="yc-message-center-title-tags">' + titleTagFields.map((field) => renderTagValues(field, escapeHtml)).join('') + '</span>'
          : '';
        const titleMetaHtml = taskMeta
          ? '<span class="yc-message-center-title-meta analysis-card-text">' + escapeHtml(taskMeta) + '</span>'
          : '';
        const unreadDotHtml = item.unread
          ? '<i class="yc-message-center-unread-dot" aria-label="未读"></i>'
          : '';
        const fieldsHtml = bodyFields.length
          ? '<div class="yc-message-center-fields">' + bodyFields.map((field) => {
                return '<span class="yc-message-center-field" data-field="' + escapeHtml(field.id) + '">' +
                  '<span class="yc-message-center-field-label">' + escapeHtml(field.label) + '</span>' +
                  '<span class="yc-message-center-field-value">' + escapeHtml(field.value) + '</span>' +
                '</span>';
            }).join('') + '</div>'
          : '';
        const adviceHtml = renderAiAdvice(aiAdviceField, escapeHtml, aiIconHtml);
        const footerHtml = adviceHtml || item.actionsHtml
          ? '<div class="yc-message-center-footer">' +
              adviceHtml +
              '<div class="yc-message-center-side">' +
                (item.actionsHtml || '') +
              '</div>' +
            '</div>'
          : '';

        html += '<li class="yc-message-center-item' + className.slice('yc-message-center-item'.length) + '" data-open="' + escapeHtml(item.id) + '">' +
          '<div class="yc-message-center-check"><input type="checkbox" data-select-row="' + escapeHtml(item.id) + '" aria-label="选择 ' + escapeHtml(item.title) + '"' +
            (item.selected ? ' checked' : '') + (item.canSelect ? '' : ' disabled') + '></div>' +
          '<div class="yc-message-center-content yc-semantic-content">' +
            '<div class="yc-message-center-main">' +
              '<div class="yc-message-center-title yc-semantic-head analysis-card-head"><span class="yc-message-center-title-main">' + unreadDotHtml + '<strong class="analysis-card-title">' + escapeHtml(item.title) + '</strong>' + titleTagsHtml + tenantTag + '</span>' + titleMetaHtml + '</div>' +
            '</div>' +
            fieldsHtml +
            footerHtml +
          '</div>' +
        '</li>';
      }
      html += '</ul>';
    }

    if (total > pageSize) {
      html += '<div class="yc-native-pagination" role="navigation" aria-label="列表分页">' +
        '<span class="yc-native-pagination-summary">第 ' + page + ' / ' + totalPages + ' 页</span>' +
        '<select id="nativePageSize" aria-label="每页条数">' +
          '<option value="10"' + (pageSize === 10 ? ' selected' : '') + '>10 条/页</option>' +
          '<option value="20"' + (pageSize === 20 ? ' selected' : '') + '>20 条/页</option>' +
          '<option value="50"' + (pageSize === 50 ? ' selected' : '') + '>50 条/页</option>' +
        '</select>' +
        '<button type="button" data-page-action="prev" aria-label="上一页"' + (page <= 1 ? ' disabled' : '') + '>‹</button>' +
        '<button type="button" data-page-action="next" aria-label="下一页"' + (page >= totalPages ? ' disabled' : '') + '>›</button>' +
      '</div>';
    }

    return html + '</section>';
  }

  window.ApproveInboxMessageList = { render };
})(window);
