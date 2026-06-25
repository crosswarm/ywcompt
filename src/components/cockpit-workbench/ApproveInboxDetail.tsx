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
  source?: string;
  sourceKey: string;
  sourceLabel: string;
  analysis?: NonNullable<ApproveInboxDetailData['attachmentAnalysis']>[number];
};

type AttachmentFilterOption = {
  key: string;
  label: string;
  count: number;
};

type AttachmentPreviewContent =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'message'; message: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; kind: 'image' | 'iframe'; objectUrl: string }
  | { status: 'ready'; kind: 'text'; text: string }
  | { status: 'ready'; kind: 'html'; html: string };

declare global {
  interface Window {
    mammoth?: {
      convertToHtml: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
    };
    XLSX?: {
      read: (data: ArrayBuffer, options: { type: 'array' }) => {
        SheetNames: string[];
        Sheets: Record<string, unknown>;
      };
      utils: {
        sheet_to_html: (sheet: unknown, options?: { editable?: boolean }) => string;
      };
    };
  }
}

const TEXT_PREVIEW_EXTENSIONS = new Set([
  'txt', 'text', 'log', 'csv', 'json', 'xml', 'md', 'markdown',
  'js', 'ts', 'jsx', 'tsx', 'css', 'html', 'htm', 'sql', 'yml', 'yaml', 'ini', 'conf', 'sh'
]);
const WORD_PREVIEW_EXTENSIONS = new Set(['doc', 'docx', 'rtf']);
const SPREADSHEET_PREVIEW_EXTENSIONS = new Set(['xls', 'xlsx']);
const PREVIEW_SCRIPT_URLS = {
  mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js',
  xlsx: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'
};
const previewScriptPromises: Partial<Record<keyof typeof PREVIEW_SCRIPT_URLS, Promise<void>>> = {};

const formatFileSize = (bytes?: number): string => {
  const size = Number(bytes || 0);
  if (!size) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

const attachmentSourceInfo = (source?: string): Pick<AttachmentPreviewRow, 'sourceKey' | 'sourceLabel'> => {
  const raw = displayText(source).toLowerCase();
  if (raw.includes('comment')) return { sourceKey: 'comment', sourceLabel: '评论附件' };
  if (raw.includes('task')) return { sourceKey: 'task', sourceLabel: '任务附件' };
  if (raw.includes('approval') || raw.includes('approve') || raw.includes('workflow')) {
    return { sourceKey: 'approval', sourceLabel: '审批附件' };
  }
  if (raw.includes('analysis')) return { sourceKey: 'analysis', sourceLabel: '已识别' };
  if (raw === 'mdf-file-api' || raw.includes('file-api') || raw.includes('standard') || raw.includes('detail')) {
    return { sourceKey: 'standard', sourceLabel: '标准附件' };
  }
  if (!raw) return { sourceKey: 'standard', sourceLabel: '标准附件' };
  return { sourceKey: 'other', sourceLabel: '其他附件' };
};

const attachmentFilterOptions = (rows: AttachmentPreviewRow[]): AttachmentFilterOption[] => {
  const counts = new Map<string, number>();
  const labels = new Map<string, string>();
  rows.forEach((row) => {
    counts.set(row.sourceKey, (counts.get(row.sourceKey) || 0) + 1);
    labels.set(row.sourceKey, row.sourceLabel);
  });
  const preferred = ['standard', 'comment', 'task', 'approval', 'analysis', 'other'];
  const keys = Array.from(counts.keys()).sort((a, b) => {
    const ai = preferred.indexOf(a);
    const bi = preferred.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b);
  });
  return [
    { key: 'all', label: '全部', count: rows.length },
    ...keys.map((key) => ({
      key,
      label: labels.get(key) || attachmentSourceInfo(key).sourceLabel,
      count: counts.get(key) || 0
    }))
  ];
};

const attachmentCacheLabel = (att: AttachmentPreviewRow): string => {
  if (att.error) return '解析异常';
  if (att.localPath) return '已缓存';
  return '未缓存正文';
};

const attachmentExt = (att: AttachmentPreviewRow): string => {
  const type = displayText(att.fileType).toLowerCase().replace(/^\./, '');
  if (type) return type;
  const name = displayText(att.fileName).toLowerCase();
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1) : '';
};

const isImageAttachment = (att: AttachmentPreviewRow): boolean =>
  /^(png|jpe?g|gif|webp|bmp|svg|ico)$/.test(attachmentExt(att));

const attachmentPreviewUrl = (itemId: string, att: AttachmentPreviewRow): string =>
  itemId && att.localPath && att.fileName
    ? `/api/attachments/${encodeURIComponent(itemId)}/${encodeURIComponent(att.fileName)}`
    : '';

const escapePreviewHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const sanitizePreviewHtml = (html: string): string => {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach((node) => node.remove());
  doc.querySelectorAll('*').forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || (['href', 'src', 'xlink:href'].includes(name) && value.startsWith('javascript:'))) {
        node.removeAttribute(attr.name);
      }
    });
  });
  return doc.body.innerHTML;
};

const csvToPreviewHtml = (text: string): string => {
  const rows = text
    .split(/\r?\n/)
    .filter((row) => row.trim())
    .slice(0, 120)
    .map((row) => row.split(',').map((cell) => cell.trim()));
  if (!rows.length) return '<p class="yc-attachment-preview-empty">文件为空。</p>';
  return `<table><tbody>${rows.map((row, rowIndex) => {
    const tag = rowIndex === 0 ? 'th' : 'td';
    return `<tr>${row.map((cell) => `<${tag}>${escapePreviewHtml(cell)}</${tag}>`).join('')}</tr>`;
  }).join('')}</tbody></table>`;
};

const appendPreviewParam = (url: string): string => `${url}${url.includes('?') ? '&' : '?'}preview=html`;

const readPreviewError = async (response: Response): Promise<string> => {
  try {
    const data = await response.json();
    if (data?.error) return data.error;
    if (data?.message) return data.message;
  } catch {
    // ignore non-json error payloads
  }
  return `HTTP ${response.status}`;
};

const loadPreviewScript = (name: keyof typeof PREVIEW_SCRIPT_URLS): Promise<void> => {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('当前运行环境不支持浏览器预览库'));
  }
  if (name === 'mammoth' && window.mammoth) return Promise.resolve();
  if (name === 'xlsx' && window.XLSX) return Promise.resolve();
  if (!previewScriptPromises[name]) {
    previewScriptPromises[name] = new Promise((resolve, reject) => {
      const id = `yc-preview-lib-${name}`;
      const existing = document.getElementById(id) as HTMLScriptElement | null;
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('预览库加载失败')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.id = id;
      script.src = PREVIEW_SCRIPT_URLS[name];
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('预览库加载失败'));
      document.head.appendChild(script);
    });
  }
  return previewScriptPromises[name] as Promise<void>;
};

const fetchAttachment = async (url: string): Promise<Response> => {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(await readPreviewError(response));
  return response;
};

const tryServerHtmlPreview = async (url: string): Promise<string> => {
  const response = await fetch(appendPreviewParam(url), { credentials: 'same-origin' });
  if (!response.ok) throw new Error(await readPreviewError(response));
  return sanitizePreviewHtml(await response.text());
};

const buildAttachmentPreviewContent = async (itemId: string, att: AttachmentPreviewRow): Promise<AttachmentPreviewContent> => {
  const url = attachmentPreviewUrl(itemId, att);
  if (!url) {
    return {
      status: 'message',
      message: '附件正文暂未缓存。已显示当前可用的附件元信息和智能分析结果；重新分析拿到下载地址后可在此直接预览。'
    };
  }

  const ext = attachmentExt(att);
  if (isImageAttachment(att)) {
    const blob = await (await fetchAttachment(url)).blob();
    return { status: 'ready', kind: 'image', objectUrl: URL.createObjectURL(blob) };
  }
  if (ext === 'pdf') {
    const blob = await (await fetchAttachment(url)).blob();
    return { status: 'ready', kind: 'iframe', objectUrl: URL.createObjectURL(blob) };
  }
  if (TEXT_PREVIEW_EXTENSIONS.has(ext)) {
    const text = await (await fetchAttachment(url)).text();
    if (ext === 'csv') {
      return { status: 'ready', kind: 'html', html: csvToPreviewHtml(text) };
    }
    if (ext === 'json') {
      try {
        return { status: 'ready', kind: 'text', text: JSON.stringify(JSON.parse(text), null, 2).slice(0, 200000) };
      } catch {
        return { status: 'ready', kind: 'text', text: text.slice(0, 200000) };
      }
    }
    return { status: 'ready', kind: 'text', text: text.slice(0, 200000) };
  }
  if (WORD_PREVIEW_EXTENSIONS.has(ext)) {
    let serverError = '';
    if (ext === 'doc' || ext === 'rtf') {
      try {
        return { status: 'ready', kind: 'html', html: await tryServerHtmlPreview(url) };
      } catch (e) {
        serverError = e instanceof Error ? e.message : String(e);
      }
    }
    try {
      await loadPreviewScript('mammoth');
      if (!window.mammoth) throw new Error('Word 预览库不可用');
      const arrayBuffer = await (await fetchAttachment(url)).arrayBuffer();
      const result = await window.mammoth.convertToHtml({ arrayBuffer });
      return { status: 'ready', kind: 'html', html: sanitizePreviewHtml(result.value) };
    } catch (e) {
      try {
        return { status: 'ready', kind: 'html', html: await tryServerHtmlPreview(url) };
      } catch {
        const clientError = e instanceof Error ? e.message : String(e);
        throw new Error(serverError ? `${clientError}；${serverError}` : clientError);
      }
    }
  }
  if (SPREADSHEET_PREVIEW_EXTENSIONS.has(ext)) {
    await loadPreviewScript('xlsx');
    if (!window.XLSX) throw new Error('Excel 预览库不可用');
    const arrayBuffer = await (await fetchAttachment(url)).arrayBuffer();
    const workbook = window.XLSX.read(arrayBuffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return { status: 'message', message: '工作簿没有可预览的工作表。' };
    const html = window.XLSX.utils.sheet_to_html(workbook.Sheets[firstSheetName], { editable: false });
    return { status: 'ready', kind: 'html', html: sanitizePreviewHtml(html) };
  }
  return { status: 'message', message: '当前格式暂不支持浏览器内嵌预览，可点击下方“打开原文件”。' };
};

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
  const itemIdForPreview = data?.id || '';
  const [previewAttachment, setPreviewAttachment] = React.useState<AttachmentPreviewRow | null>(null);
  const [previewContent, setPreviewContent] = React.useState<AttachmentPreviewContent>({ status: 'idle' });
  const [attachmentFilter, setAttachmentFilter] = React.useState('all');
  const previewObjectUrlRef = React.useRef<string | null>(null);
  const clearPreviewObjectUrl = React.useCallback(() => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    setPreviewAttachment(null);
    setAttachmentFilter('all');
  }, [data?.id]);

  React.useEffect(() => {
    clearPreviewObjectUrl();
    if (!previewAttachment) {
      setPreviewContent({ status: 'idle' });
      return undefined;
    }

    let cancelled = false;
    setPreviewContent({ status: 'loading' });
    buildAttachmentPreviewContent(itemIdForPreview, previewAttachment)
      .then((content) => {
        if (cancelled) {
          if (content.status === 'ready' && 'objectUrl' in content) URL.revokeObjectURL(content.objectUrl);
          return;
        }
        if (content.status === 'ready' && 'objectUrl' in content) {
          previewObjectUrlRef.current = content.objectUrl;
        }
        setPreviewContent(content);
      })
      .catch((error) => {
        if (cancelled) return;
        setPreviewContent({
          status: 'error',
          message: error instanceof Error ? error.message : String(error)
        });
      });

    return () => {
      cancelled = true;
    };
  }, [clearPreviewObjectUrl, itemIdForPreview, previewAttachment]);

  React.useEffect(() => () => clearPreviewObjectUrl(), [clearPreviewObjectUrl]);

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
    error: null,
    source: 'analysis'
  }))).map((att, index) => {
    const fileName = displayText(att.fileName);
    const matched = attachmentAnalysis.find((analysis) => analysis.name === fileName) || attachmentAnalysis[index];
    const source = displayText(att.source || '');
    const sourceInfo = attachmentSourceInfo(source);
    return {
      fileName,
      fileType: displayText(att.fileType || matched?.fileType || ''),
      size: att.size,
      localPath: att.localPath,
      error: att.error,
      source,
      ...sourceInfo,
      analysis: matched
    };
  });
  const attachmentFilters = attachmentFilterOptions(attachmentRows);
  const activeAttachmentFilter = attachmentFilters.some((option) => option.key === attachmentFilter) ? attachmentFilter : 'all';
  const visibleAttachmentRows = activeAttachmentFilter === 'all'
    ? attachmentRows
    : attachmentRows.filter((att) => att.sourceKey === activeAttachmentFilter);

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
            <div className="yc-approve-inbox-attachment-toolbar">
              <div>
                <h4 className="yc-approve-inbox-section-title">附件分析</h4>
                <p className="yc-approve-inbox-attachment-count">
                  共 {attachmentRows.length} 个附件，按来源快速筛选
                </p>
              </div>
              <div className="yc-approve-inbox-attachment-filter" role="toolbar" aria-label="附件来源筛选">
                {attachmentFilters.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`yc-approve-inbox-attachment-filter-btn${option.key === activeAttachmentFilter ? ' active' : ''}`}
                    onClick={() => setAttachmentFilter(option.key)}
                    aria-pressed={option.key === activeAttachmentFilter}
                  >
                    {option.label} {option.count}
                  </button>
                ))}
              </div>
            </div>
            <div className="yc-approve-inbox-attachment-list">
              {visibleAttachmentRows.map((att, index) => (
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
                    <span className={`yc-approve-inbox-attachment-source yc-approve-inbox-attachment-source-${att.sourceKey}`}>
                      {att.sourceLabel}
                    </span>
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
                  <p className="yc-approve-inbox-attachment-status">
                    <span>{att.sourceLabel}</span>
                    <span>{formatFileSize(att.size)}</span>
                    <span>{attachmentCacheLabel(att)}</span>
                  </p>
                  {att.error && (
                    <p className="yc-approve-inbox-attachment-status">
                      <span>解析状态：{att.error}</span>
                    </p>
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
                <small>附件来源</small>
                <strong>{previewAttachment.sourceLabel}</strong>
              </div>
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
                if (previewContent.status === 'loading') {
                  return <p className="yc-attachment-preview-empty">正在生成预览…</p>;
                }
                if (previewContent.status === 'message') {
                  return <p className="yc-attachment-preview-empty">{previewContent.message}</p>;
                }
                if (previewContent.status === 'error') {
                  return <p className="yc-attachment-preview-empty yc-attachment-preview-error">预览失败：{previewContent.message}</p>;
                }
                if (previewContent.status === 'ready' && previewContent.kind === 'image') {
                  return <img src={previewContent.objectUrl} alt={previewAttachment.fileName} />;
                }
                if (previewContent.status === 'ready' && previewContent.kind === 'iframe') {
                  return <iframe src={previewContent.objectUrl} title={previewAttachment.fileName} />;
                }
                if (previewContent.status === 'ready' && previewContent.kind === 'text') {
                  return <pre className="yc-attachment-preview-text">{previewContent.text}</pre>;
                }
                if (previewContent.status === 'ready' && previewContent.kind === 'html') {
                  return <div className="yc-attachment-preview-html" dangerouslySetInnerHTML={{ __html: previewContent.html }} />;
                }
                return <p className="yc-attachment-preview-empty">准备预览…</p>;
              })()}
            </div>
          </div>
          <footer className="yc-attachment-preview-footer">
            {attachmentPreviewUrl(itemId, previewAttachment) && (
              <>
                <a
                  className="yc-attachment-preview-btn"
                  href={attachmentPreviewUrl(itemId, previewAttachment)}
                  target="_blank"
                  rel="noreferrer"
                >
                  打开原文件
                </a>
                <a
                  className="yc-attachment-preview-btn"
                  href={attachmentPreviewUrl(itemId, previewAttachment)}
                  download={previewAttachment.fileName}
                >
                  下载附件
                </a>
              </>
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
