/** 审批收件箱列表磁贴 — approve-inbox */
import React, { useState } from 'react';
import type {
  ApproveInboxData,
  ApproveInboxItem,
  ApproveInboxAdvice,
  ApproveInboxRiskLevel
} from '../../types/approve-inbox';
import { WorkbenchIcon } from './shared';

/* ========== Mock 兜底数据 ========== */

const MOCK_DATA: ApproveInboxData = {
  businessType: 'approve-inbox',
  items: [
    {
      id: 'mock-001',
      title: '2024年Q4战略采购合同（华为云服务）',
      docType: '采购合同',
      riskLevel: 'high',
      status: 'pending',
      submittedAt: '2024-06-14T09:00:00Z',
      advice: 'reject',
      smartTags: [
        { label: '高金额', kind: 'risk' },
        { label: '付款条款偏离', kind: 'rule' },
        { label: '附件缺失', kind: 'risk' },
        { label: '超预算', kind: 'risk' }
      ],
      runtimeActions: [
        { action: 'approve', label: '通过', enabled: true },
        { action: 'reject', label: '驳回', enabled: true }
      ]
    },
    {
      id: 'mock-002',
      title: '差旅费报销申请（张三，北京出差）',
      docType: '报销申请',
      riskLevel: 'medium',
      status: 'pending',
      submittedAt: '2024-06-14T10:30:00Z',
      advice: 'caution',
      smartTags: [
        { label: '超标准', kind: 'rule' },
        { label: '发票缺项', kind: 'risk' }
      ],
      runtimeActions: [
        { action: 'approve', label: '通过', enabled: true },
        { action: 'reject', label: '驳回', enabled: true }
      ]
    },
    {
      id: 'mock-003',
      title: '办公耗材采购申请',
      docType: '采购申请',
      riskLevel: 'low',
      status: 'pending',
      submittedAt: '2024-06-14T11:00:00Z',
      advice: 'approve',
      smartTags: [{ label: '常规采购', kind: 'advice' }],
      runtimeActions: [
        { action: 'approve', label: '通过', enabled: true },
        { action: 'reject', label: '驳回', enabled: true }
      ]
    },
    {
      id: 'mock-004',
      title: '人员招聘申请（研发部高级工程师）',
      docType: '招聘申请',
      riskLevel: 'medium',
      status: 'done',
      submittedAt: '2024-06-13T14:00:00Z',
      advice: 'approve',
      smartTags: [{ label: 'HC超限', kind: 'rule' }],
      runtimeActions: []
    }
  ]
};

/* ========== 风险维度 tab 定义 ========== */

type TabId = 'all-todo' | 'recent-done' | 'important' | 'attention' | 'low-risk';

interface Tab {
  id: TabId;
  label: string;
}

const TABS: Tab[] = [
  { id: 'all-todo', label: '全部待办' },
  { id: 'recent-done', label: '已办' },
  { id: 'important', label: '重要' },
  { id: 'attention', label: '需关注' },
  { id: 'low-risk', label: '低风险' }
];

/* ========== 工具函数 ========== */

/** 风险等级 → 样式类名后缀 */
const riskClass = (level: ApproveInboxRiskLevel) => `yc-approve-inbox-risk-${level}`;

/** advice → 类名后缀 */
const adviceClass = (advice?: ApproveInboxAdvice) => {
  if (!advice) {
    return '';
  }
  return `yc-approve-inbox-advice-${advice}`;
};

/** 按 tab 过滤列表项 */
const filterItems = (items: ApproveInboxItem[], tab: TabId) => {
  switch (tab) {
    case 'all-todo':
      return items.filter((item) => item.status === 'pending' || !item.status);
    case 'recent-done':
      return items.filter((item) => item.status === 'done');
    case 'important':
      return items.filter((item) => item.riskLevel === 'high');
    case 'attention':
      return items.filter((item) => item.riskLevel === 'medium' || item.advice === 'caution');
    case 'low-risk':
      return items.filter((item) => item.riskLevel === 'low');
    default:
      return items;
  }
};

/* ========== 子组件 ========== */

/** 智能 tag 行（最多 2 个 + N） */
const SmartTags = ({ tags }: { tags?: ApproveInboxItem['smartTags'] }) => {
  if (!tags || tags.length === 0) {
    return null;
  }
  const visible = tags.slice(0, 2);
  const overflow = tags.length - visible.length;
  return (
    <div className="yc-approve-inbox-tags">
      {visible.map((tag, index) => (
        <span
          key={`${tag.label}-${index}`}
          className={`yc-approve-inbox-tag yc-approve-inbox-tag-${tag.kind || 'default'}`}
        >
          {tag.label}
        </span>
      ))}
      {overflow > 0 && (
        <span className="yc-approve-inbox-tag yc-approve-inbox-tag-overflow">+{overflow}</span>
      )}
    </div>
  );
};

/** 单条行操作按钮 */
const RowActions = ({
  item,
  onAction
}: {
  item: ApproveInboxItem;
  onAction: (itemId: string, action: string) => void;
}) => {
  const actions = item.runtimeActions?.filter((a) => a.enabled !== false) || [];
  if (actions.length === 0) {
    return null;
  }
  return (
    <div className="yc-approve-inbox-row-actions">
      {actions.map((a) => (
        <button
          key={a.action}
          type="button"
          className={`yc-approve-inbox-row-btn${a.action === 'approve' ? ' yc-approve-inbox-row-btn-approve' : a.action === 'reject' ? ' yc-approve-inbox-row-btn-reject' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            onAction(item.id, a.action);
          }}
        >
          {a.label || a.action}
        </button>
      ))}
    </div>
  );
};

/** 单条列表项 */
const InboxRow = ({
  item,
  selected,
  onSelect,
  onOpenDetail,
  onAction
}: {
  item: ApproveInboxItem;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpenDetail: (id: string) => void;
  onAction: (itemId: string, action: string) => void;
}) => (
  <article
    className={['yc-approve-inbox-row', riskClass(item.riskLevel), adviceClass(item.advice)]
      .filter(Boolean)
      .join(' ')}
    onClick={() => onOpenDetail(item.id)}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        onOpenDetail(item.id);
      }
    }}
  >
    <input
      type="checkbox"
      className="yc-approve-inbox-checkbox"
      checked={selected}
      onClick={(e) => e.stopPropagation()}
      onChange={() => onSelect(item.id)}
    />
    <div className="yc-approve-inbox-row-main">
      <div className="yc-approve-inbox-row-title">
        <i className="yc-approve-inbox-risk-dot" />
        <strong>{item.title}</strong>
        {item.hasAttachments && (
          <span
            className="yc-approve-inbox-attachment-indicator"
            title={`含 ${item.attachmentCount || 1} 个附件`}
            aria-label={`含 ${item.attachmentCount || 1} 个附件`}
          >
            <WorkbenchIcon name="file" />
          </span>
        )}
      </div>
      <SmartTags tags={item.smartTags} />
    </div>
    <RowActions item={item} onAction={onAction} />
  </article>
);

/* ========== Props ========== */

export interface ApproveInboxWidgetProps {
  /** 组件数据（符合 approve-inbox schema），缺失时使用 mock 兜底 */
  data?: ApproveInboxData | Record<string, any>;
  /** 单条动作回调 */
  onAction?: (itemId: string, action: string) => void;
  /** 打开详情回调 */
  onOpenDetail?: (itemId: string) => void;
  /** 批量通过回调 */
  onBatchApprove?: (ids: string[]) => void;
}

/* ========== 主组件 ========== */

export const ApproveInboxWidget = ({
  data,
  onAction,
  onOpenDetail,
  onBatchApprove
}: ApproveInboxWidgetProps) => {
  const inboxData =
    data && (data as ApproveInboxData).items ? (data as ApproveInboxData) : MOCK_DATA;

  const [activeTab, setActiveTab] = useState<TabId>(
    (inboxData.viewSettings?.defaultTabId as TabId | undefined) || 'all-todo'
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const visibleItems = filterItems(inboxData.items, activeTab);

  const handleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleAction = (itemId: string, action: string) => {
    onAction?.(itemId, action);
  };

  const handleOpenDetail = (itemId: string) => {
    onOpenDetail?.(itemId);
  };

  const handleBatchApprove = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (selectedIds.length > 0) {
      onBatchApprove?.(selectedIds);
    }
  };

  return (
    <div className="yc-approve-inbox">
      {/* 顶部：tab + 工具栏 */}
      <header className="yc-approve-inbox-header">
        <nav className="yc-approve-inbox-tabs" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`yc-approve-inbox-tab${activeTab === tab.id ? ' yc-approve-inbox-tab-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="yc-approve-inbox-toolbar">
          <button type="button" className="yc-approve-inbox-toolbar-icon" title="筛选维度">
            <WorkbenchIcon name="filter" />
          </button>
          <button type="button" className="yc-approve-inbox-toolbar-icon" title="排序">
            <WorkbenchIcon name="chevronDown" />
          </button>
          <button
            type="button"
            className="yc-approve-inbox-batch-approve"
            onClick={handleBatchApprove}
            disabled={selectedIds.length === 0}
          >
            <WorkbenchIcon name="done" />
            {selectedIds.length > 0 ? `通过已选（${selectedIds.length}）` : '通过已选'}
          </button>
        </div>
      </header>

      {/* 列表 */}
      <div className="yc-approve-inbox-list">
        {visibleItems.length === 0 ? (
          <div className="yc-approve-inbox-empty">
            <WorkbenchIcon name="check" />
            <span>暂无待办</span>
          </div>
        ) : (
          visibleItems.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              selected={selectedIds.includes(item.id)}
              onSelect={handleSelect}
              onOpenDetail={handleOpenDetail}
              onAction={handleAction}
            />
          ))
        )}
      </div>

      {/* 已选提示条 */}
      {selectedIds.length > 0 && (
        <footer className="yc-approve-inbox-selection-bar">
          <span>已选 {selectedIds.length} 条</span>
          <button type="button" onClick={() => setSelectedIds([])}>
            清空
          </button>
        </footer>
      )}
    </div>
  );
};
