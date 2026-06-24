/** 审批收件箱详情抽屉 — 5 段结构 */
import React from 'react';
import type {
  ApproveInboxDetail as ApproveInboxDetailData,
  ApproveInboxAdvice,
  ApproveInboxRuntimeAction,
  ApproveInboxSeverity
} from '../../types/approve-inbox';
import { WorkbenchIcon } from './shared';

/* ========== Mock 兜底详情 ========== */

const MOCK_DETAIL: ApproveInboxDetailData = {
  id: 'mock-001',
  title: '2024年Q4战略采购合同（华为云服务）',
  conclusion: {
    advice: 'reject',
    label: '建议拒绝'
  },
  overallAnalysis: '合同金额超出预算 34%，付款条款存在较大风险，部分附件缺失，建议退回重新议价后审批。',
  fieldAnalysis: [
    { name: '合同金额', value: '¥1,340,000', summary: '超出本财年采购预算上限，需专项审批', severity: 'risk' },
    { name: '付款周期', value: '预付款 60%', summary: '预付款比例高于公司标准（30%），存在资金风险', severity: 'risk' },
    { name: '合同期限', value: '2024-07-01 至 2025-06-30', summary: '合同期限合规，与采购需求匹配', severity: 'passed' },
    { name: '供应商资质', value: '华为技术有限公司', summary: '供应商资质齐全，无历史违约记录', severity: 'passed' }
  ],
  ruleAnalysis: [
    {
      ruleName: '大额采购双签制度',
      severity: 'risk',
      summary: '超过 100 万元采购须双人审批，当前仅单人签批',
      evidence: '采购合同金额 ¥134 万 > 公司制度阈值 ¥100 万，审批记录仅含直属负责人签字',
      suggestion: '退回补充财务总监会签后重新提交'
    },
    {
      ruleName: '预付款比例限制',
      severity: 'risk',
      summary: '预付款 60% 超过公司标准 30% 上限',
      evidence: '合同第 5.2 条款约定首付 60%，《采购管理办法》第 12 条规定预付款不超过合同总额 30%',
      suggestion: '与供应商重新协商付款条款'
    },
    {
      ruleName: '附件完整性检查',
      severity: 'warning',
      summary: '供应商报价单未上传',
      evidence: '附件列表中仅含合同扫描件，缺少询价记录及报价比价文件',
      suggestion: '补充上传三家供应商报价对比文件'
    }
  ],
  attachmentAnalysis: [
    {
      name: '华为云服务采购合同（盖章版）.pdf',
      fileType: 'PDF',
      severity: 'warning',
      summary: '合同内容完整，但第 5.2 付款条款存在风险',
      findings: [
        { name: '付款条款风险', detail: '预付款比例 60% 超出公司规定' },
        { name: '合同盖章', detail: '双方盖章齐全，法务签字有效' }
      ]
    }
  ],
  source: 'skill'
};

/* ========== 工具函数 ========== */

/** advice → 文案 */
const adviceLabel = (advice: ApproveInboxAdvice, label?: string): string => {
  if (label) {
    return label;
  }
  const map: Record<ApproveInboxAdvice, string> = {
    approve: '建议通过',
    caution: '需关注',
    reject: '建议拒绝'
  };
  return map[advice];
};

/** severity → 色点类名 */
const severityDotClass = (severity?: ApproveInboxSeverity) => {
  if (!severity) {
    return 'yc-approve-inbox-dot-default';
  }
  return `yc-approve-inbox-dot-${severity}`;
};

/** severity → tag 类名 */
const severityTagClass = (severity?: ApproveInboxSeverity) => {
  if (!severity) {
    return 'yc-approve-inbox-severity-default';
  }
  return `yc-approve-inbox-severity-${severity}`;
};

/** severity → 文案 */
const severityLabel = (severity?: ApproveInboxSeverity) => {
  const map: Record<ApproveInboxSeverity, string> = {
    risk: '风险',
    warning: '注意',
    passed: '通过'
  };
  return severity ? map[severity] : '';
};

const displayText = (value: unknown): string => {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (
      (text.startsWith('{') && text.endsWith('}')) ||
      (text.startsWith('[') && text.endsWith(']'))
    ) {
      try {
        return displayText(JSON.parse(text));
      } catch {
        return text;
      }
    }
    return text;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(displayText).filter(Boolean).join('、');
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['name', 'displayName', 'label', 'title', 'text', 'value', 'code', 'id']) {
      const text = displayText(obj[key]);
      if (text) return text;
    }
    return Object.entries(obj)
      .slice(0, 4)
      .map(([key, nestedValue]) => {
        const text = displayText(nestedValue);
        return text ? `${key}:${text}` : '';
      })
      .filter(Boolean)
      .join('，');
  }
  return String(value);
};

type AttachmentPreviewRow = {
  fileName: string;
  fileType?: string;
  size?: number;
  localPath?: string | null;
  error?: string | null;
  analysis?: NonNullable<ApproveInboxDetailData['attachmentAnalysis']>[number];
};

const formatFileSize = (bytes?: number): string => {
  const size = Number(bytes || 0);
  if (!size) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

const attachmentExt = (att: AttachmentPreviewRow): string => {
  const type = displayText(att.fileType).toLowerCase().replace(/^\./, '');
  if (type) return type;
  const name = displayText(att.fileName).toLowerCase();
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1) : '';
};

const isImageAttachment = (att: AttachmentPreviewRow): boolean =>
  /^(png|jpe?g|gif|webp|bmp|svg)$/.test(attachmentExt(att));

const isFramePreviewAttachment = (att: AttachmentPreviewRow): boolean =>
  /^(pdf|txt|text|csv|json|xml|md)$/.test(attachmentExt(att));

const attachmentPreviewUrl = (itemId: string, att: AttachmentPreviewRow): string =>
  itemId && att.localPath && att.fileName
    ? `/api/attachments/${encodeURIComponent(itemId)}/${encodeURIComponent(att.fileName)}`
    : '';

/* ========== Props ========== */

export interface ApproveInboxDetailProps {
  /** 详情数据，缺失时使用 mock 兜底 */
  detail?: ApproveInboxDetailData | null;
  /** 当前单据真实可用动作 */
  actions?: ApproveInboxRuntimeAction[];
  /** 是否显示（用于抽屉控制） */
  visible?: boolean;
  /** 关闭回调 */
  onClose?: () => void;
  /** 操作回调 */
  onAction?: (itemId: string, action: string) => void;
}

/* ========== 主组件 ========== */

export const ApproveInboxDetail = ({
  detail,
  actions,
  visible = true,
  onClose,
  onAction
}: ApproveInboxDetailProps) => {
  const data = detail === undefined ? MOCK_DETAIL : detail;
  const [previewAttachment, setPreviewAttachment] = React.useState<AttachmentPreviewRow | null>(null);
  React.useEffect(() => {
    setPreviewAttachment(null);
  }, [data?.id]);

  if (!visible) {
    return null;
  }

  if (!data) {
    return (
      <aside className="yc-approve-inbox-detail">
        <header className="yc-approve-inbox-detail-header">
          <strong className="yc-approve-inbox-detail-title">审批单据详情</strong>
          {onClose && (
            <button
              type="button"
              className="yc-approve-inbox-detail-close"
              onClick={onClose}
              aria-label="关闭"
            >
              <WorkbenchIcon name="close" />
            </button>
          )}
        </header>
        <div className="yc-approve-inbox-detail-loading">
          <WorkbenchIcon name="bot" />
          <span>正在加载详情…</span>
        </div>
      </aside>
    );
  }

  const itemId = data.id || '';
  const rawFields = (data.fields || [])
    .map((field) => ({
      name: displayText(field.name || field.key || '未命名字段'),
      value: displayText(field.value)
    }))
    .filter((field) => field.name && field.value);
  const canReanalyze = data.source !== 'fallback' && !data.crossTenant;
  const visibleActions = (actions || []).filter((action) => action.enabled !== false);
  const attachmentAnalysis = data.attachmentAnalysis || [];
  const attachments = data.attachments || [];
  const attachmentRows: AttachmentPreviewRow[] = (attachments.length > 0 ? attachments : attachmentAnalysis.map((att) => ({
    fileName: att.name,
    fileType: att.fileType,
    size: undefined,
    localPath: null,
    error: null
  }))).map((att, index) => {
    const fileName = displayText(att.fileName);
    const matched = attachmentAnalysis.find((analysis) => analysis.name === fileName) || attachmentAnalysis[index];
    return {
      fileName,
      fileType: displayText(att.fileType || matched?.fileType || ''),
      size: att.size,
      localPath: att.localPath,
      error: att.error,
      analysis: matched
    };
  });

  return (
    <>
    <aside className="yc-approve-inbox-detail">
      {/* 抽屉头 */}
      <header className="yc-approve-inbox-detail-header">
        <strong className="yc-approve-inbox-detail-title">
          {data.title || '审批单据详情'}
        </strong>
        {onClose && (
          <button
            type="button"
            className="yc-approve-inbox-detail-close"
            onClick={onClose}
            aria-label="关闭"
          >
            <WorkbenchIcon name="close" />
          </button>
        )}
      </header>

      {/* 兜底提示 */}
      {data.source === 'fallback' && (
        <div className="yc-approve-inbox-fallback-notice">
          <WorkbenchIcon name="bot" />
          <span>AI 兜底 · 仅供参考</span>
        </div>
      )}

      <div className="yc-approve-inbox-detail-body">
        {/* ① 总体结论 */}
        <section className="yc-approve-inbox-detail-section">
          <h4 className="yc-approve-inbox-section-title">总体结论</h4>
          <div className={`yc-approve-inbox-conclusion yc-approve-inbox-conclusion-${data.conclusion.advice}`}>
            <span className="yc-approve-inbox-conclusion-light" aria-hidden="true" />
            <strong className="yc-approve-inbox-conclusion-label">
              {adviceLabel(data.conclusion.advice, data.conclusion.label)}
            </strong>
          </div>
        </section>

        {/* ② 总体分析 */}
        {data.overallAnalysis && (
          <section className="yc-approve-inbox-detail-section">
            <h4 className="yc-approve-inbox-section-title">总体分析</h4>
            <p className="yc-approve-inbox-overall-analysis">{data.overallAnalysis}</p>
          </section>
        )}

        {rawFields.length > 0 && (
          <section className="yc-approve-inbox-detail-section">
            <h4 className="yc-approve-inbox-section-title">单据字段</h4>
            <div className="yc-approve-inbox-rawfields">
              {rawFields.map((field, index) => (
                <div className="rf-row" key={`${field.name}-${index}`}>
                  <span className="rf-k" title={field.name}>{field.name}</span>
                  <span className="rf-v" title={field.value}>{field.value}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ③ 单据字段分析 */}
        {data.fieldAnalysis && data.fieldAnalysis.length > 0 && (
          <section className="yc-approve-inbox-detail-section">
            <h4 className="yc-approve-inbox-section-title">单据字段分析</h4>
            <div className="yc-approve-inbox-field-list">
              {data.fieldAnalysis.map((field, index) => (
                <article
                  key={`${field.name}-${index}`}
                  className="yc-approve-inbox-field-row"
                >
                  <i className={`yc-approve-inbox-dot ${severityDotClass(field.severity)}`} />
                  <div className="yc-approve-inbox-field-content">
                    <div className="yc-approve-inbox-field-head">
                      <span className="yc-approve-inbox-field-name">{field.name}</span>
                      {field.value && (
                        <code className="yc-approve-inbox-field-value">{displayText(field.value)}</code>
                      )}
                      {field.severity && (
                        <span className={`yc-approve-inbox-severity ${severityTagClass(field.severity)}`}>
                          {severityLabel(field.severity)}
                        </span>
                      )}
                    </div>
                    <p className="yc-approve-inbox-field-summary">{displayText(field.summary)}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* ④ 业务规则分析 */}
        {data.ruleAnalysis && data.ruleAnalysis.length > 0 && (
          <section className="yc-approve-inbox-detail-section">
            <h4 className="yc-approve-inbox-section-title">业务规则分析</h4>
            <div className="yc-approve-inbox-rule-list">
              {data.ruleAnalysis.map((rule, index) => (
                <article
                  key={`${rule.ruleName}-${index}`}
                  className="yc-approve-inbox-rule-row"
                >
                  <div className="yc-approve-inbox-rule-head">
                    <i className={`yc-approve-inbox-dot ${severityDotClass(rule.severity)}`} />
                    <strong className="yc-approve-inbox-rule-name">{rule.ruleName}</strong>
                    <span className={`yc-approve-inbox-severity ${severityTagClass(rule.severity)}`}>
                      {severityLabel(rule.severity)}
                    </span>
                  </div>
                  <p className="yc-approve-inbox-rule-summary">{rule.summary}</p>
                  {rule.evidence && (
                    <blockquote className="yc-approve-inbox-evidence">
                      <WorkbenchIcon name="file" />
                      <span>{rule.evidence}</span>
                    </blockquote>
                  )}
                  {rule.suggestion && (
                    <p className="yc-approve-inbox-suggestion">
                      <WorkbenchIcon name="lightbulb" />
                      {rule.suggestion}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {/* ⑤ 附件分析 */}
        {attachmentRows.length > 0 && (
          <section className="yc-approve-inbox-detail-section">
            <h4 className="yc-approve-inbox-section-title">附件分析</h4>
            <div className="yc-approve-inbox-attachment-list">
              {attachmentRows.map((att, index) => (
                <article
                  key={`${att.fileName}-${index}`}
                  className="yc-approve-inbox-attachment-row"
                >
                  <div className="yc-approve-inbox-attachment-head">
                    <button
                      type="button"
                      className="yc-approve-inbox-attachment-preview-trigger"
                      onClick={() => setPreviewAttachment(att)}
                      title="预览附件"
                    >
                      <WorkbenchIcon name="file" />
                      <span className="yc-approve-inbox-attachment-name">{att.fileName}</span>
                    </button>
                    {att.fileType && (
                      <code className="yc-approve-inbox-attachment-type">{att.fileType}</code>
                    )}
                    {att.analysis?.severity && (
                      <span className={`yc-approve-inbox-severity ${severityTagClass(att.analysis.severity)}`}>
                        {severityLabel(att.analysis.severity)}
                      </span>
                    )}
                  </div>
                  {att.analysis?.summary ? (
                    <p className="yc-approve-inbox-attachment-summary">{att.analysis.summary}</p>
                  ) : (
                    <p className="yc-approve-inbox-attachment-summary yc-approve-inbox-attachment-pending">
                      已识别附件{att.size ? `（${Math.round(att.size / 1024)} KB）` : ''}，正文内容解析待完成。
                    </p>
                  )}
                  {att.error && (
                    <p className="yc-approve-inbox-attachment-status">解析状态：{att.error}</p>
                  )}
                  {att.analysis?.findings && att.analysis.findings.length > 0 && (
                    <ul className="yc-approve-inbox-findings">
                      {att.analysis.findings.map((finding, fi) => (
                        <li key={`finding-${fi}`}>
                          {finding.name && <strong>{finding.name}：</strong>}
                          {finding.detail}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* 操作栏 */}
      {itemId && onAction && (
        <footer className="yc-approve-inbox-detail-footer">
          {visibleActions.map((action) => (
            <button
              key={action.action}
              type="button"
              className={`yc-approve-inbox-detail-btn${action.action === 'approve' ? ' yc-approve-inbox-detail-btn-approve' : ''}`}
              onClick={() => onAction(itemId, action.action)}
            >
              {action.label || action.action}
            </button>
          ))}
          {canReanalyze && (
            <button
              type="button"
              className="yc-approve-inbox-detail-btn yc-approve-inbox-detail-btn-icon"
              onClick={() => onAction(itemId, 'reanalyze')}
              title="重新分析本单"
              aria-label="重新分析本单"
            >
              <WorkbenchIcon name="bot" />
            </button>
          )}
        </footer>
      )}
    </aside>
    {previewAttachment && (
      <div
        className="yc-attachment-preview-layer"
        role="presentation"
        onClick={(event) => {
          if (event.target === event.currentTarget) setPreviewAttachment(null);
        }}
      >
        <section className="yc-attachment-preview" role="dialog" aria-modal="true" aria-labelledby="attachmentPreviewTitle">
          <header className="yc-attachment-preview-header">
            <strong className="yc-attachment-preview-title" id="attachmentPreviewTitle">
              <WorkbenchIcon name="file" />
              <span>{previewAttachment.fileName}</span>
            </strong>
            <button
              type="button"
              className="yc-attachment-preview-close"
              onClick={() => setPreviewAttachment(null)}
              aria-label="关闭"
            >
              <WorkbenchIcon name="close" />
            </button>
          </header>
          <div className="yc-attachment-preview-body">
            <div className="yc-attachment-preview-meta">
              <div>
                <small>文件类型</small>
                <strong>{previewAttachment.fileType || attachmentExt(previewAttachment) || '-'}</strong>
              </div>
              <div>
                <small>文件大小</small>
                <strong>{formatFileSize(previewAttachment.size)}</strong>
              </div>
              <div>
                <small>解析状态</small>
                <strong>{previewAttachment.error || (attachmentPreviewUrl(itemId, previewAttachment) ? '可预览' : '未缓存正文')}</strong>
              </div>
            </div>
            <p className="yc-attachment-preview-summary">
              {previewAttachment.analysis?.summary ||
                `已识别附件${previewAttachment.size ? `（${formatFileSize(previewAttachment.size)}）` : ''}，正文内容解析待完成。`}
            </p>
            {previewAttachment.analysis?.findings && previewAttachment.analysis.findings.length > 0 && (
              <ul className="yc-approve-inbox-findings">
                {previewAttachment.analysis.findings.map((finding, index) => (
                  <li key={`preview-finding-${index}`}>
                    {finding.name && <strong>{finding.name}：</strong>}
                    {finding.detail}
                  </li>
                ))}
              </ul>
            )}
            <div className="yc-attachment-preview-pane">
              {(() => {
                const url = attachmentPreviewUrl(itemId, previewAttachment);
                if (url && isImageAttachment(previewAttachment)) {
                  return <img src={url} alt={previewAttachment.fileName} />;
                }
                if (url && isFramePreviewAttachment(previewAttachment)) {
                  return <iframe src={url} title={previewAttachment.fileName} sandbox="" />;
                }
                if (url) {
                  return <p className="yc-attachment-preview-empty">当前格式暂不支持浏览器内嵌预览，可点击下方“打开原文件”。</p>;
                }
                return <p className="yc-attachment-preview-empty">附件正文暂未缓存。已显示当前可用的附件元信息和智能分析结果；重新分析拿到下载地址后可在此直接预览。</p>;
              })()}
            </div>
          </div>
          <footer className="yc-attachment-preview-footer">
            {attachmentPreviewUrl(itemId, previewAttachment) && (
              <a
                className="yc-attachment-preview-btn"
                href={attachmentPreviewUrl(itemId, previewAttachment)}
                target="_blank"
                rel="noreferrer"
              >
                打开原文件
              </a>
            )}
            <button type="button" className="yc-attachment-preview-btn" onClick={() => setPreviewAttachment(null)}>
              关闭
            </button>
          </footer>
        </section>
      </div>
    )}
    </>
  );
};
