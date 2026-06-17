/** 审批收件箱 Shell — 列表 + 侧边详情抽屉组合容器 */
import React, { useState } from 'react';
import type { ApproveInboxData, ApproveInboxDetail as ApproveInboxDetailData } from '../../types/approve-inbox';
import { ApproveInboxWidget } from './ApproveInboxWidget';
import { ApproveInboxDetail } from './ApproveInboxDetail';
import './approve-inbox.less';

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
}

export const ApproveInboxShell = ({
  data,
  detailData,
  onAction,
  onBatchApprove,
  onLoadDetail
}: ApproveInboxShellProps) => {
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const detailVisible = activeItemId !== null;

  const handleOpenDetail = (itemId: string) => {
    setActiveItemId(itemId);
    onLoadDetail?.(itemId);
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
          onOpenDetail={handleOpenDetail}
          onAction={handleAction}
          onBatchApprove={onBatchApprove}
        />
      </div>
      {detailVisible && (
        <div className="yc-approve-inbox-shell-drawer">
          <ApproveInboxDetail
            detail={detailData}
            visible
            onClose={handleCloseDetail}
            onAction={handleAction}
          />
        </div>
      )}
    </div>
  );
};
