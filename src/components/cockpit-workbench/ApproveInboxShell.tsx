/** 审批收件箱 Shell — V2 类邮箱列表 + 大详情工作区 */
import React, { useState } from 'react';
import type {
  ApproveInboxData,
  ApproveInboxDetail as ApproveInboxDetailData,
  ApproveInboxViewSettings
} from '../../types/approve-inbox';
import { ApproveInboxWidget } from './ApproveInboxWidget';
import { ApproveInboxDetail } from './ApproveInboxDetail';
import './approve-inbox.less';

type YonClawMessagePayload = {
  type: 'view-command' | 'view-command-apply' | 'task-command';
  input?: string;
  patch?: Record<string, unknown>;
  viewSettings?: ApproveInboxViewSettings;
  selectedIds?: string[];
  activeItemId?: string | null;
};

export interface ApproveInboxShellProps {
  /** widget.data — 符合 approve-inbox schema；缺失时内部 mock 兜底 */
  data?: ApproveInboxData | Record<string, any>;
  /** 详情数据（异步加载后注入；为 null 时 Detail 用 mock 兜底） */
  detailData?: ApproveInboxDetailData | null;
  /** 单条动作回调 */
  onAction?: (itemId: string, action: string) => void;
  /** 批量通过回调 */
  onBatchApprove?: (ids: string[]) => void;
  /** 详情数据加载回调（外部可异步填充 detailData） */
  onLoadDetail?: (itemId: string) => void;
  /** 保存用户列表展示偏好 */
  onSaveViewSettings?: (settings: ApproveInboxViewSettings) => void;
  /** YonClaw 会话入口消息回调 */
  onYonClawMessage?: (payload: YonClawMessagePayload) => void;
}

export const ApproveInboxShell = ({
  data,
  detailData,
  onAction,
  onBatchApprove,
  onLoadDetail,
  onSaveViewSettings,
  onYonClawMessage
}: ApproveInboxShellProps) => {
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const detailVisible = activeItemId !== null;
  const inboxData = data && Array.isArray((data as ApproveInboxData).items) ? (data as ApproveInboxData) : null;
  const activeItem = inboxData?.items.find((item) => item.id === activeItemId) || null;
  const itemIds = inboxData?.items.map((item) => item.id).filter(Boolean) || [];
  const activeIndex = activeItemId ? itemIds.indexOf(activeItemId) : -1;
  const previousItemId = activeIndex > 0 ? itemIds[activeIndex - 1] : null;
  const nextItemId = activeIndex >= 0 && activeIndex < itemIds.length - 1 ? itemIds[activeIndex + 1] : null;

  const handleOpenDetail = (itemId: string) => {
    setActiveItemId(itemId);
    onLoadDetail?.(itemId);
  };

  const handleNavigateDetail = (itemId: string | null) => {
    if (!itemId) return;
    handleOpenDetail(itemId);
  };

  const handleCloseDetail = () => {
    setActiveItemId(null);
  };

  const handleAction = (itemId: string, action: string) => {
    onAction?.(itemId, action);
  };

  return (
    <div className={`yc-approve-inbox-shell${detailVisible ? ' yc-approve-inbox-shell-split' : ''}`}>
      <div className="yc-approve-inbox-shell-list">
        <ApproveInboxWidget
          data={data}
          activeItemId={activeItemId}
          onOpenDetail={handleOpenDetail}
          onAction={handleAction}
          onBatchApprove={onBatchApprove}
          onSaveViewSettings={onSaveViewSettings}
          onYonClawMessage={onYonClawMessage}
        />
      </div>
      {detailVisible && <div className="yc-sheet-overlay" onClick={handleCloseDetail} />}
      {detailVisible && (
        <div className="yc-approve-inbox-shell-drawer">
          <div className="yc-sheet-grabber" aria-hidden="true" />
          <ApproveInboxDetail
            detail={onLoadDetail ? (detailData || null) : detailData}
            actions={activeItem?.runtimeActions || []}
            visible
            onClose={handleCloseDetail}
            onPrevious={() => handleNavigateDetail(previousItemId)}
            onNext={() => handleNavigateDetail(nextItemId)}
            hasPrevious={Boolean(previousItemId)}
            hasNext={Boolean(nextItemId)}
            onAction={handleAction}
          />
        </div>
      )}
    </div>
  );
};
