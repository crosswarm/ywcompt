/** 审批收件箱 V2 — 类邮箱表格工作台 */
import React from 'react';
import type {
  ApproveInboxBusinessRule,
  ApproveInboxData,
  ApproveInboxItem,
  ApproveInboxAdvice,
  ApproveInboxRiskLevel,
  ApproveInboxViewColumn,
  ApproveInboxViewSettings
} from '../../types/approve-inbox';
import { WorkbenchIcon } from './shared';

type ScopeId = 'pending' | 'done';
type FocusId = 'all' | 'high' | 'medium' | 'low' | 'attention' | 'attachments' | string;
type SortId = NonNullable<ApproveInboxViewSettings['defaultSort']>;
type GroupById = NonNullable<ApproveInboxViewSettings['defaultGroupBy']>;

type SmartFilter =
  | { kind: 'docType'; value: string }
  | { kind: 'text'; value: string }
  | null;

type Column = ApproveInboxViewColumn & {
  id: string;
  label: string;
  width?: number | string;
  locked?: boolean;
};

type ViewCommandPatch = {
  visibleColumnIds?: string[];
  sortId?: SortId;
  groupBy?: GroupById;
  focusId?: FocusId;
  scopeId?: ScopeId;
  smartFilter?: SmartFilter;
};

type ParsedViewCommand = {
  status: 'ready' | 'unknown';
  summary: string;
  patch?: ViewCommandPatch;
  candidates?: Column[];
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  command?: ParsedViewCommand & { id: string; input: string };
};

type YonClawMessagePayload = {
  type: 'view-command' | 'view-command-apply' | 'task-command';
  input?: string;
  patch?: ViewCommandPatch;
  viewSettings?: ApproveInboxViewSettings;
  selectedIds?: string[];
  activeItemId?: string | null;
};

const MOCK_DATA: ApproveInboxData = {
  businessType: 'approve-inbox',
  viewSettings: {
    layoutVariant: 'maillist',
    defaultSort: 'importance-desc',
    visibleColumns: ['title', 'submitter', 'submittedAt', 'docType', 'advice', 'attachments', 'actions'],
    businessRules: [
      { id: 'budget', label: '预算异常', description: '金额、预算、超标相关单据', field: 'smartTags', operator: 'contains', value: '预算' },
      { id: 'contract', label: '合同条款', description: '付款、法务、条款相关单据', field: 'smartTags', operator: 'contains', value: '条款' }
    ]
  },
  items: [
    {
      id: 'mock-001',
      title: '2024年Q4战略采购合同（华为云服务）',
      docType: '采购合同',
      riskLevel: 'high',
      status: 'pending',
      submitter: '张明',
      submittedAt: '2024-06-14T09:00:00Z',
      advice: 'reject',
      hasAttachments: true,
      attachmentCount: 3,
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
      submitter: '张三',
      submittedAt: '2024-06-14T10:30:00Z',
      advice: 'caution',
      hasAttachments: true,
      attachmentCount: 2,
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
      submitter: '李华',
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
      submitter: '王琳',
      submittedAt: '2024-06-13T14:00:00Z',
      advice: 'approve',
      smartTags: [{ label: 'HC超限', kind: 'rule' }],
      runtimeActions: []
    }
  ]
};

const ADVICE_LABELS: Record<ApproveInboxAdvice, string> = {
  approve: '建议通过',
  caution: '需关注',
  reject: '建议拒绝'
};

const RISK_LABELS: Record<ApproveInboxRiskLevel, string> = {
  high: '高风险',
  medium: '需关注',
  low: '低风险'
};

const RISK_ORDER: Record<ApproveInboxRiskLevel, number> = {
  high: 3,
  medium: 2,
  low: 1
};

const DEFAULT_COLUMNS: Column[] = [
  { id: 'title', label: '任务', path: 'title', width: 'minmax(280px, 1.8fr)', pinned: true, locked: true },
  { id: 'submitter', label: '提交人', path: 'submitter', width: 112 },
  { id: 'submittedAt', label: '提交时间', path: 'submittedAt', format: 'date', width: 150 },
  { id: 'docType', label: '业务', path: 'docType', width: 128 },
  { id: 'advice', label: 'AI建议', path: 'advice', format: 'advice', width: 108 },
  { id: 'riskLevel', label: '风险', path: 'riskLevel', format: 'risk', width: 92 },
  { id: 'attachments', label: '附件', path: 'attachmentCount', format: 'attachment', width: 84 },
  { id: 'tags', label: '标签', path: 'smartTags', format: 'tags', width: 160 },
  { id: 'status', label: '状态', path: 'status', width: 84 },
  { id: 'actions', label: '操作', width: 150, locked: true }
];

const COMMAND_COLUMNS: Column[] = [
  { id: 'amount', label: '金额', path: 'amount', fieldLabel: '金额', detailPath: 'fields.amount', width: 120 },
  { id: 'supplier', label: '供应商', path: 'supplier', fieldLabel: '供应商', detailPath: 'fields.supplier', width: 150 },
  { id: 'budget', label: '预算', path: 'budget', fieldLabel: '预算', detailPath: 'fields.budget', width: 120 },
  { id: 'department', label: '部门', path: 'department', fieldLabel: '部门', detailPath: 'fields.department', width: 120 }
];

const FIELD_ALIASES: Array<{ id: string; aliases: string[] }> = [
  { id: 'title', aliases: ['标题', '任务', '单据', '主题'] },
  { id: 'submitter', aliases: ['提交人', '发起人', '申请人', '提交者'] },
  { id: 'submittedAt', aliases: ['提交时间', '提交日期', '日期', '时间'] },
  { id: 'docType', aliases: ['业务', '类型', '单据类型', '业务类型'] },
  { id: 'advice', aliases: ['建议', 'ai建议', 'AI建议', '审批建议'] },
  { id: 'riskLevel', aliases: ['风险', '风险等级'] },
  { id: 'attachments', aliases: ['附件', '文件'] },
  { id: 'tags', aliases: ['标签', '智能标签', '业务标签'] },
  { id: 'status', aliases: ['状态'] },
  { id: 'actions', aliases: ['操作', '动作', '按钮'] },
  { id: 'amount', aliases: ['金额', '合同金额', '付款金额', '报销金额'] },
  { id: 'supplier', aliases: ['供应商', '厂商', '客户'] },
  { id: 'budget', aliases: ['预算', '预算字段'] },
  { id: 'department', aliases: ['部门', '申请部门', '所属部门'] }
];

const ensureRequiredColumnIds = (ids: string[]): string[] => {
  const next = ids.filter((id) => id && id !== 'actions');
  if (!next.includes('title')) next.unshift('title');
  return [...next, 'actions'];
};

const defaultVisibleColumnIds = (settings?: ApproveInboxViewSettings): string[] => {
  const configured = settings?.visibleColumns;
  if (Array.isArray(configured) && configured.length > 0) {
    return ensureRequiredColumnIds(configured.map((column) => (typeof column === 'string' ? column : column.id)).filter(Boolean));
  }
  return ['title', 'submitter', 'submittedAt', 'docType', 'advice', 'attachments', 'actions'];
};

const normalizeText = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean).join('、');
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['displayValue', 'value', 'name', 'label', 'title', 'text']) {
      const text = normalizeText(obj[key]);
      if (text) return text;
    }
    return Object.entries(obj)
      .slice(0, 3)
      .map(([key, nested]) => {
        const text = normalizeText(nested);
        return text ? `${key}:${text}` : '';
      })
      .filter(Boolean)
      .join('，');
  }
  return String(value);
};

const getPathValue = (source: unknown, path?: string): unknown => {
  if (!path || !source || typeof source !== 'object') return undefined;
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current == null) return undefined;
    const arrayMatch = segment.match(/^(.+)\[(\d+)]$/);
    if (arrayMatch) {
      const base = (current as Record<string, unknown>)[arrayMatch[1]];
      return Array.isArray(base) ? base[Number(arrayMatch[2])] : undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, source);
};

const findFieldValue = (item: ApproveInboxItem, column: Column): unknown => {
  const summaryFields = getPathValue(item, 'summary.iformFields');
  if (!Array.isArray(summaryFields)) return undefined;
  const matched = summaryFields.find((field) => {
    if (!field || typeof field !== 'object') return false;
    const record = field as Record<string, unknown>;
    return (
      (column.fieldId && record.fieldId === column.fieldId) ||
      (column.fieldLabel && record.label === column.fieldLabel)
    );
  }) as Record<string, unknown> | undefined;
  return matched ? (matched.value ?? matched.name ?? matched.displayValue) : undefined;
};

const formatDate = (iso?: string) => {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatValue = (item: ApproveInboxItem, column: Column): string => {
  if (column.id === 'advice') return item.advice ? ADVICE_LABELS[item.advice] : '-';
  if (column.id === 'riskLevel') return RISK_LABELS[item.riskLevel] || '-';
  if (column.id === 'attachments') return item.hasAttachments ? `${item.attachmentCount || 1}` : '-';
  if (column.id === 'status') return item.status === 'done' ? '已办' : '待办';
  if (column.format === 'date') return formatDate(normalizeText(getPathValue(item, column.path)));
  if (column.format === 'tags') return normalizeText(item.smartTags?.map((tag) => tag.label));

  const direct = getPathValue(item, column.path);
  const field = findFieldValue(item, column);
  const value = field ?? direct ?? getPathValue(item, `summary.${column.id}`) ?? (item as Record<string, unknown>)[column.id];
  const text = normalizeText(value).trim();
  return text || '-';
};

const itemSearchText = (item: ApproveInboxItem) =>
  [
    item.title,
    item.docType,
    item.submitter,
    item.advice ? ADVICE_LABELS[item.advice] : '',
    item.riskLevel ? RISK_LABELS[item.riskLevel] : '',
    item.smartTags?.map((tag) => tag.label).join(' ')
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

const matchBusinessRule = (item: ApproveInboxItem, rule: ApproveInboxBusinessRule): boolean => {
  if (rule.riskLevel && item.riskLevel !== rule.riskLevel) return false;
  if (rule.docType && !item.docType?.includes(rule.docType)) return false;
  if (!rule.field) return true;

  const value =
    rule.field === 'smartTags'
      ? item.smartTags?.map((tag) => tag.label).join(' ')
      : normalizeText(getPathValue(item, rule.field) ?? (item as Record<string, unknown>)[rule.field]);
  const text = normalizeText(value);

  switch (rule.operator) {
    case 'equals':
      return text === normalizeText(rule.value);
    case 'gt':
      return Number(text) > Number(rule.value);
    case 'lt':
      return Number(text) < Number(rule.value);
    case 'exists':
      return Boolean(text);
    case 'contains':
    default:
      return text.includes(normalizeText(rule.value));
  }
};

const sortItems = (items: ApproveInboxItem[], sortId: SortId) => {
  const sorted = [...items];
  sorted.sort((a, b) => {
    if (sortId === 'title-asc') return a.title.localeCompare(b.title, 'zh-CN');
    if (sortId === 'submitted-asc') {
      return new Date(a.submittedAt || 0).getTime() - new Date(b.submittedAt || 0).getTime();
    }
    if (sortId === 'advice-desc') {
      const rank: Record<string, number> = { reject: 3, caution: 2, approve: 1 };
      return (rank[b.advice || ''] || 0) - (rank[a.advice || ''] || 0);
    }
    if (sortId === 'importance-desc' || sortId === 'risk-desc') {
      return (RISK_ORDER[b.riskLevel] || 0) - (RISK_ORDER[a.riskLevel] || 0);
    }
    return new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime();
  });
  return sorted;
};

const mergeColumns = (settings?: ApproveInboxViewSettings): Column[] => {
  const custom = (settings?.visibleColumns || [])
    .filter((column): column is ApproveInboxViewColumn => typeof column === 'object' && Boolean(column?.id))
    .map((column) => ({ ...column }));
  const byId = new Map<string, Column>();
  [...DEFAULT_COLUMNS, ...COMMAND_COLUMNS, ...custom].forEach((column) => byId.set(column.id, column));
  return Array.from(byId.values());
};

const extractCustomColumns = (settings?: ApproveInboxViewSettings): Column[] =>
  (settings?.visibleColumns || [])
    .filter((column): column is ApproveInboxViewColumn => typeof column === 'object' && Boolean(column?.id))
    .map((column) => ({ ...column }));

const widthToCss = (width?: string | number) => {
  if (typeof width === 'number') return `${width}px`;
  return width || 'minmax(96px, 1fr)';
};

const parseViewCommand = (input: string, visibleColumnIds: string[], availableColumns: Column[]): ParsedViewCommand => {
  const text = input.trim();
  const compact = text.replace(/\s+/g, '');
  const availableById = new Map(availableColumns.map((column) => [column.id, column]));
  const matchedIds = FIELD_ALIASES.filter((entry) => entry.aliases.some((alias) => compact.includes(alias))).map((entry) => entry.id);
  const uniqueIds = Array.from(new Set(matchedIds)).filter((id) => availableById.has(id));
  const patch: ViewCommandPatch = {};
  const summaries: string[] = [];

  const wantsHide = /(隐藏|移除|删除|去掉|不显示|不要显示)/.test(compact);
  const wantsShow = /(显示|展示|增加|加入|加上|补充|打开)/.test(compact);
  if (uniqueIds.length > 0 && (wantsShow || wantsHide)) {
    patch.visibleColumnIds = wantsHide
      ? visibleColumnIds.filter((id) => !uniqueIds.includes(id) || availableById.get(id)?.locked)
      : Array.from(new Set([...visibleColumnIds, ...uniqueIds]));
    summaries.push(
      wantsHide
        ? `隐藏 ${uniqueIds.map((id) => availableById.get(id)?.label || id).join('、')}`
        : `显示 ${uniqueIds.map((id) => availableById.get(id)?.label || id).join('、')}`
    );
  }

  if (/(排序|排个序|优先)/.test(compact)) {
    if (/(风险|重要|优先级)/.test(compact)) {
      patch.sortId = 'importance-desc';
      summaries.push('按风险优先排序');
    } else if (/(时间|日期|提交)/.test(compact)) {
      patch.sortId = 'submitted-desc';
      summaries.push('按提交时间倒序');
    } else if (/(建议|AI|ai)/.test(compact)) {
      patch.sortId = 'advice-desc';
      summaries.push('按 AI 建议排序');
    } else if (/(标题|任务|名称)/.test(compact)) {
      patch.sortId = 'title-asc';
      summaries.push('按标题排序');
    }
  }

  if (/(分组|按类型|按业务)/.test(compact)) {
    patch.groupBy = /(风险)/.test(compact) ? 'risk' : 'docType';
    summaries.push(patch.groupBy === 'risk' ? '按风险分组' : '按业务类型分组');
  }

  if (/(不分组|取消分组|平铺)/.test(compact)) {
    patch.groupBy = 'none';
    summaries.push('取消分组');
  }

  if (/(只看|筛选|过滤|关注)/.test(compact)) {
    if (/(高风险|重要|拒绝)/.test(compact)) {
      patch.focusId = 'high';
      summaries.push('只看高风险任务');
    } else if (/(低风险|可通过|常规)/.test(compact)) {
      patch.focusId = 'low';
      summaries.push('只看低风险任务');
    } else if (/(中风险|需关注|谨慎)/.test(compact)) {
      patch.focusId = 'attention';
      summaries.push('只看需关注任务');
    } else if (/(附件|文件)/.test(compact)) {
      patch.focusId = 'attachments';
      summaries.push('只看有附件任务');
    }

    const docTypeMatch = compact.match(/只看(.+?)(单|申请|合同|报销|采购|付款|招聘|入库|上线)/);
    const docTypeValue = docTypeMatch?.[1] && docTypeMatch[1].length <= 8 ? `${docTypeMatch[1]}${docTypeMatch[2]}` : '';
    if (docTypeValue && !['高风险', '低风险', '需关注'].some((word) => docTypeValue.includes(word))) {
      patch.smartFilter = { kind: 'docType', value: docTypeValue };
      summaries.push(`只看 ${docTypeValue}`);
    }
  }

  if (/(待办|未处理)/.test(compact) && /(只看|切到|打开|显示)/.test(compact)) {
    patch.scopeId = 'pending';
    summaries.push('切到待办');
  }
  if (/(已办|已处理)/.test(compact) && /(只看|切到|打开|显示)/.test(compact)) {
    patch.scopeId = 'done';
    summaries.push('切到已办');
  }

  if (summaries.length > 0) {
    return { status: 'ready', summary: summaries.join('，'), patch };
  }

  const likelyConfigRequest = /(字段|列|列表|表格|显示|隐藏|排序|筛选|只看)/.test(compact);
  return {
    status: 'unknown',
    summary: likelyConfigRequest
      ? '我还不能确定要调整哪个字段。'
      : '我会把这条消息交给 YonClaw 处理当前任务。',
    candidates: likelyConfigRequest ? availableColumns.filter((column) => !column.locked).slice(0, 8) : undefined
  };
};

const toViewSettings = (
  base: ApproveInboxViewSettings | undefined,
  visibleColumnIds: string[],
  sortId: SortId,
  groupBy: GroupById,
  availableColumns: Column[] = []
): ApproveInboxViewSettings => {
  const builtInIds = new Set([...DEFAULT_COLUMNS, ...COMMAND_COLUMNS].map((column) => column.id));
  const availableById = new Map(availableColumns.map((column) => [column.id, column]));
  const visibleColumns = visibleColumnIds.map((id) => {
    const column = availableById.get(id);
    if (!column || builtInIds.has(id)) return id;
    const { locked: _locked, ...serializableColumn } = column;
    return serializableColumn;
  });
  return {
    ...(base || {}),
    layoutVariant: 'maillist',
    visibleColumns,
    defaultSort: sortId,
    defaultGroupBy: groupBy
  };
};

const groupItems = (items: ApproveInboxItem[], groupBy: GroupById) => {
  if (!groupBy || groupBy === 'none') return [{ key: 'all', label: '', items }];
  const groups = new Map<string, ApproveInboxItem[]>();
  items.forEach((item) => {
    const key = groupBy === 'risk' ? item.riskLevel : groupBy === 'status' ? item.status || 'pending' : item.docType || '其他';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)?.push(item);
  });
  return Array.from(groups.entries()).map(([key, group]) => ({
    key,
    label: groupBy === 'risk' ? RISK_LABELS[key as ApproveInboxRiskLevel] || key : key === 'done' ? '已办' : key === 'pending' ? '待办' : key,
    items: group
  }));
};

const SmartTags = ({ tags }: { tags?: ApproveInboxItem['smartTags'] }) => {
  if (!tags || tags.length === 0) return <span className="yc-mail-muted">-</span>;
  return (
    <div className="yc-mail-tags">
      {tags.slice(0, 2).map((tag, index) => (
        <span key={`${tag.label}-${index}`} className={`yc-mail-tag yc-mail-tag-${tag.kind || 'default'}`}>
          {tag.label}
        </span>
      ))}
      {tags.length > 2 && <span className="yc-mail-tag yc-mail-tag-more">+{tags.length - 2}</span>}
    </div>
  );
};

const AdvicePill = ({ advice }: { advice?: ApproveInboxAdvice }) => {
  if (!advice) return <span className="yc-mail-muted">-</span>;
  return <span className={`yc-mail-advice yc-mail-advice-${advice}`}>{ADVICE_LABELS[advice]}</span>;
};

const RiskPill = ({ risk }: { risk: ApproveInboxRiskLevel }) => (
  <span className={`yc-mail-risk-pill yc-mail-risk-${risk}`}>
    <i />
    {RISK_LABELS[risk]}
  </span>
);

const RowActions = ({
  item,
  onAction
}: {
  item: ApproveInboxItem;
  onAction: (itemId: string, action: string) => void;
}) => {
  const actions = item.runtimeActions?.filter((action) => action.enabled !== false) || [];
  if (actions.length === 0) return <span className="yc-mail-muted">-</span>;
  return (
    <div className="yc-mail-row-actions">
      {actions.slice(0, 2).map((action) => (
        <button
          key={action.action}
          type="button"
          className={`yc-mail-action-btn${action.action === 'approve' ? ' primary' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            onAction(item.id, action.action);
          }}
        >
          {action.label || action.action}
        </button>
      ))}
    </div>
  );
};

export interface ApproveInboxWidgetProps {
  data?: ApproveInboxData | Record<string, any>;
  activeItemId?: string | null;
  onAction?: (itemId: string, action: string) => void;
  onOpenDetail?: (itemId: string) => void;
  onBatchApprove?: (ids: string[]) => void;
  onSaveViewSettings?: (settings: ApproveInboxViewSettings) => void;
  onYonClawMessage?: (payload: YonClawMessagePayload) => void;
}

export const ApproveInboxWidget = ({
  data,
  activeItemId,
  onAction,
  onOpenDetail,
  onBatchApprove,
  onSaveViewSettings,
  onYonClawMessage
}: ApproveInboxWidgetProps) => {
  const inboxData =
    data && Array.isArray((data as ApproveInboxData).items) ? (data as ApproveInboxData) : MOCK_DATA;
  const viewSettings = React.useMemo(() => inboxData.viewSettings || {}, [inboxData.viewSettings]);
  const allColumns = React.useMemo(() => mergeColumns(viewSettings), [viewSettings]);
  const [scopeId, setScopeId] = React.useState<ScopeId>(
    viewSettings.defaultTabId === 'recent-done' || viewSettings.defaultTabId === 'done' ? 'done' : 'pending'
  );
  const [focusId, setFocusId] = React.useState<FocusId>('all');
  const [query, setQuery] = React.useState('');
  const [queryDraft, setQueryDraft] = React.useState('');
  const [searchComposing, setSearchComposing] = React.useState(false);
  const [currentTenantOnly, setCurrentTenantOnly] = React.useState(true);
  const [smartFilter, setSmartFilter] = React.useState<SmartFilter>(null);
  const [sortId, setSortId] = React.useState<SortId>(viewSettings.defaultSort || 'importance-desc');
  const [groupBy, setGroupBy] = React.useState<GroupById>(viewSettings.defaultGroupBy || 'none');
  const [visibleColumnIds, setVisibleColumnIds] = React.useState<string[]>(() => defaultVisibleColumnIds(viewSettings));
  const [customColumns, setCustomColumns] = React.useState<Column[]>(() => extractCustomColumns(viewSettings));
  const [customColumnLabel, setCustomColumnLabel] = React.useState('');
  const [customColumnPath, setCustomColumnPath] = React.useState('');
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [columnPanelOpen, setColumnPanelOpen] = React.useState(false);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [chatInput, setChatInput] = React.useState('');
  const [pendingCommandId, setPendingCommandId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: '可以分析任务，也可以调整列表。'
    }
  ]);

  React.useEffect(() => {
    setVisibleColumnIds(defaultVisibleColumnIds(viewSettings));
    setCustomColumns(extractCustomColumns(viewSettings));
  }, [viewSettings]);

  const availableColumns = React.useMemo(() => {
    const byId = new Map<string, Column>();
    [...allColumns, ...COMMAND_COLUMNS, ...customColumns].forEach((column) => byId.set(column.id, column));
    return Array.from(byId.values());
  }, [allColumns, customColumns]);

  const visibleColumns = React.useMemo(() => {
    const byId = new Map(availableColumns.map((column) => [column.id, column]));
    return visibleColumnIds.map((id) => byId.get(id)).filter((column): column is Column => Boolean(column));
  }, [availableColumns, visibleColumnIds]);

  const crossTenantCount = React.useMemo(
    () => inboxData.items.filter((item) => Boolean(item.crossTenant)).length,
    [inboxData.items]
  );

  const tenantScopedItems = React.useMemo(
    () => (currentTenantOnly ? inboxData.items.filter((item) => !item.crossTenant) : inboxData.items),
    [currentTenantOnly, inboxData.items]
  );

  const counts = React.useMemo(() => {
    const pending = tenantScopedItems.filter((item) => item.status !== 'done').length;
    const done = tenantScopedItems.filter((item) => item.status === 'done').length;
    const high = tenantScopedItems.filter((item) => item.status !== 'done' && item.riskLevel === 'high').length;
    const attention = tenantScopedItems.filter(
      (item) => item.status !== 'done' && (item.riskLevel === 'medium' || item.advice === 'caution')
    ).length;
    const attachments = tenantScopedItems.filter((item) => item.status !== 'done' && item.hasAttachments).length;
    return { pending, done, high, attention, attachments };
  }, [tenantScopedItems]);

  const filteredItems = React.useMemo(() => {
    const lowerQuery = query.trim().toLowerCase();
    const scoped = tenantScopedItems.filter((item) => (scopeId === 'done' ? item.status === 'done' : item.status !== 'done'));
    const focused = scoped.filter((item) => {
      if (focusId === 'high') return item.riskLevel === 'high';
      if (focusId === 'medium') return item.riskLevel === 'medium';
      if (focusId === 'low') return item.riskLevel === 'low';
      if (focusId === 'attention') return item.riskLevel === 'medium' || item.advice === 'caution';
      if (focusId === 'attachments') return Boolean(item.hasAttachments);
      const rule = viewSettings.businessRules?.find((businessRule) => businessRule.id === focusId);
      return rule ? matchBusinessRule(item, rule) : true;
    });
    const smartFiltered = focused.filter((item) => {
      if (!smartFilter) return true;
      if (smartFilter.kind === 'docType') return Boolean(item.docType?.includes(smartFilter.value));
      return itemSearchText(item).includes(smartFilter.value.toLowerCase());
    });
    const searched = lowerQuery ? smartFiltered.filter((item) => itemSearchText(item).includes(lowerQuery)) : smartFiltered;
    return sortItems(searched, sortId);
  }, [focusId, query, scopeId, smartFilter, sortId, tenantScopedItems, viewSettings.businessRules]);

  const groupedItems = React.useMemo(() => groupItems(filteredItems, groupBy), [filteredItems, groupBy]);

  const updateVisibleColumns = (nextIds: string[], columnsForSave: Column[] = availableColumns) => {
    const normalized = ensureRequiredColumnIds(nextIds);
    setVisibleColumnIds(normalized);
    onSaveViewSettings?.(toViewSettings(viewSettings, normalized, sortId, groupBy, columnsForSave));
  };

  const toggleColumn = (id: string) => {
    const column = availableColumns.find((candidate) => candidate.id === id);
    if (column?.locked) return;
    updateVisibleColumns(
      visibleColumnIds.includes(id)
        ? visibleColumnIds.filter((columnId) => columnId !== id)
        : [...visibleColumnIds, id]
    );
  };

  const moveColumn = (id: string, direction: -1 | 1) => {
    const fromIndex = visibleColumnIds.indexOf(id);
    const toIndex = fromIndex + direction;
    const movingColumn = availableColumns.find((column) => column.id === id);
    const targetColumn = availableColumns.find((column) => column.id === visibleColumnIds[toIndex]);
    if (fromIndex < 0 || toIndex < 0 || toIndex >= visibleColumnIds.length || movingColumn?.locked || targetColumn?.locked) return;
    const nextIds = [...visibleColumnIds];
    [nextIds[fromIndex], nextIds[toIndex]] = [nextIds[toIndex], nextIds[fromIndex]];
    updateVisibleColumns(nextIds);
  };

  const addCustomColumn = () => {
    const label = customColumnLabel.trim();
    const path = customColumnPath.trim();
    if (!label || !path) return;
    const baseId = `custom-${(path || label)
      .trim()
      .replace(/[^\w]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || Date.now()}`;
    const existingIds = new Set(availableColumns.map((column) => column.id));
    let id = baseId;
    let suffix = 2;
    while (existingIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    const nextColumn: Column = {
      id,
      label,
      path,
      fieldLabel: label,
      detailPath: path,
      width: 140
    };
    const nextCustomColumns = [...customColumns, nextColumn];
    const nextAvailableColumns = [...availableColumns, nextColumn];
    setCustomColumns(nextCustomColumns);
    setCustomColumnLabel('');
    setCustomColumnPath('');
    updateVisibleColumns([...visibleColumnIds, id], nextAvailableColumns);
  };

  const handleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSelectAllVisible = () => {
    const visibleIds = filteredItems.map((item) => item.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? selectedIds.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...selectedIds, ...visibleIds])));
  };

  const handleBatchApprove = () => {
    if (selectedIds.length > 0) onBatchApprove?.(selectedIds);
  };

  const applyCommand = (message: ChatMessage) => {
    const command = message.command;
    if (!command?.patch) return;
    const patch = command.patch;
    const nextColumns = patch.visibleColumnIds || visibleColumnIds;
    const nextSort = patch.sortId || sortId;
    const nextGroupBy = patch.groupBy || groupBy;

    if (patch.scopeId) setScopeId(patch.scopeId);
    if (patch.focusId) setFocusId(patch.focusId);
    if (patch.smartFilter !== undefined) setSmartFilter(patch.smartFilter);
    if (patch.sortId) setSortId(patch.sortId);
    if (patch.groupBy) setGroupBy(patch.groupBy);
    if (patch.visibleColumnIds) setVisibleColumnIds(nextColumns);

    const nextSettings = toViewSettings(viewSettings, nextColumns, nextSort, nextGroupBy, availableColumns);
    onSaveViewSettings?.(nextSettings);
    onYonClawMessage?.({
      type: 'view-command-apply',
      input: command.input,
      patch,
      viewSettings: nextSettings,
      selectedIds,
      activeItemId
    });
    setPendingCommandId(null);
    setMessages((prev) => [
      ...prev,
      { id: `applied-${Date.now()}`, role: 'assistant', text: `已应用：${command.summary}` }
    ]);
  };

  const submitChat = () => {
    const input = chatInput.trim();
    if (!input) return;
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: 'user', text: input };
    const parsed = parseViewCommand(input, visibleColumnIds, availableColumns);
    onYonClawMessage?.({ type: parsed.status === 'ready' ? 'view-command' : 'task-command', input, selectedIds, activeItemId });
    setChatInput('');

    if (parsed.status === 'ready') {
      const commandId = `cmd-${Date.now()}`;
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: `我会这样调整：${parsed.summary}`,
        command: { ...parsed, id: commandId, input }
      };
      setPendingCommandId(commandId);
      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      return;
    }

    const candidateText = parsed.candidates?.length
      ? `可选字段：${parsed.candidates.map((column) => column.label).join('、')}`
      : '已发送给 YonClaw 处理。';
    setMessages((prev) => [
      ...prev,
      userMessage,
      { id: `assistant-${Date.now()}`, role: 'assistant', text: `${parsed.summary}${candidateText ? ` ${candidateText}` : ''}` }
    ]);
  };

  const renderCell = (item: ApproveInboxItem, column: Column) => {
    if (column.id === 'title') {
      return (
        <div className="yc-mail-title-cell">
          <i className={`yc-mail-risk-dot yc-mail-risk-${item.riskLevel}`} />
          <div>
            <strong>{item.title}</strong>
            <span>{[item.docType, item.submitter, formatDate(item.submittedAt)].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
      );
    }
    if (column.id === 'advice') return <AdvicePill advice={item.advice} />;
    if (column.id === 'riskLevel') return <RiskPill risk={item.riskLevel} />;
    if (column.id === 'attachments') {
      return item.hasAttachments ? (
        <span className="yc-mail-attachment">
          <WorkbenchIcon name="file" />
          {item.attachmentCount || 1}
        </span>
      ) : (
        <span className="yc-mail-muted">-</span>
      );
    }
    if (column.id === 'tags') return <SmartTags tags={item.smartTags} />;
    if (column.id === 'actions') return <RowActions item={item} onAction={(itemId, action) => onAction?.(itemId, action)} />;
    return <span className="yc-mail-cell-text">{formatValue(item, column)}</span>;
  };

  const focusItems = [
    { id: 'all', label: '全部', count: counts.pending },
    { id: 'high', label: '重要', count: counts.high },
    { id: 'attention', label: '需关注', count: counts.attention },
    { id: 'attachments', label: '有附件', count: counts.attachments },
    ...(viewSettings.businessRules || []).map((rule) => ({
      id: rule.id,
      label: rule.label,
      count: tenantScopedItems.filter((item) => item.status !== 'done' && matchBusinessRule(item, rule)).length
    }))
  ];

  const columnTemplate = `36px ${visibleColumns.map((column) => widthToCss(column.width)).join(' ')}`;
  const allVisibleSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedIds.includes(item.id));

  return (
    <div className="yc-approve-inbox yc-mail-workbench">
      <aside className="yc-mail-sidebar">
        <div className="yc-mail-brand">
          <span>YonClaw</span>
          <strong>智能待办</strong>
        </div>
        <nav className="yc-mail-nav" aria-label="审批范围">
          <button type="button" className={scopeId === 'pending' ? 'active' : ''} onClick={() => setScopeId('pending')}>
            <span>待办</span>
            <b>{counts.pending}</b>
          </button>
          <button type="button" className={scopeId === 'done' ? 'active' : ''} onClick={() => setScopeId('done')}>
            <span>已办</span>
            <b>{counts.done}</b>
          </button>
        </nav>
        <div className="yc-mail-nav-section">
          <span>关注</span>
          {focusItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={focusId === item.id ? 'active' : ''}
              onClick={() => {
                setFocusId(item.id);
                setSmartFilter(null);
              }}
            >
              <span>{item.label}</span>
              <b>{item.count}</b>
            </button>
          ))}
        </div>
      </aside>

      <main className="yc-mail-main">
        <header className="yc-mail-toolbar">
          <div className="yc-mail-search">
            <WorkbenchIcon name="search" />
            <input
              value={queryDraft}
              onChange={(event) => {
                const value = event.target.value;
                setQueryDraft(value);
                if (!searchComposing) setQuery(value);
              }}
              onCompositionStart={() => setSearchComposing(true)}
              onCompositionEnd={(event) => {
                const value = event.currentTarget.value;
                setSearchComposing(false);
                setQueryDraft(value);
                setQuery(value);
              }}
              placeholder="搜索标题、提交人、业务、AI 建议"
            />
          </div>
          <div className="yc-mail-toolbar-actions">
            <select value={sortId} onChange={(event) => setSortId(event.target.value as SortId)} aria-label="排序">
              <option value="importance-desc">风险优先</option>
              <option value="submitted-desc">最新提交</option>
              <option value="submitted-asc">最早提交</option>
              <option value="advice-desc">AI 建议</option>
              <option value="title-asc">标题</option>
            </select>
            <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as GroupById)} aria-label="分组">
              <option value="none">不分组</option>
              <option value="docType">按业务</option>
              <option value="risk">按风险</option>
            </select>
            <button type="button" className="yc-mail-icon-btn" title="列设置" onClick={() => setColumnPanelOpen((open) => !open)}>
              <WorkbenchIcon name="columns" />
            </button>
            {crossTenantCount > 0 && (
              <button
                type="button"
                className={`yc-approve-inbox-tenant-toggle${currentTenantOnly ? ' on' : ''}`}
                role="switch"
                aria-checked={currentTenantOnly}
                title={currentTenantOnly ? '当前仅显示当前租户任务' : '当前显示全部租户任务'}
                onClick={() => {
                  setCurrentTenantOnly((value) => !value);
                  setSelectedIds([]);
                }}
              >
                <span className="yc-approve-inbox-tenant-switch" aria-hidden="true" />
                <span className="yc-approve-inbox-tenant-toggle-label">仅当前租户</span>
              </button>
            )}
            <button type="button" className="yc-mail-batch-btn" disabled={selectedIds.length === 0} onClick={handleBatchApprove}>
              <WorkbenchIcon name="done" />
              {selectedIds.length > 0 ? `通过已选 ${selectedIds.length}` : '通过已选'}
            </button>
          </div>
        </header>

        {smartFilter && (
          <div className="yc-mail-filter-bar">
            <WorkbenchIcon name="filter" />
            <span>{smartFilter.kind === 'docType' ? `业务包含 ${smartFilter.value}` : `内容包含 ${smartFilter.value}`}</span>
            <button type="button" onClick={() => setSmartFilter(null)}>
              清除
            </button>
          </div>
        )}

        {columnPanelOpen && (
          <section className="yc-mail-column-panel">
            <div className="yc-mail-column-list">
              {availableColumns.map((column) => {
                const visible = visibleColumnIds.includes(column.id);
                const orderIndex = visibleColumnIds.indexOf(column.id);
                return (
                  <div key={column.id} className={`yc-mail-column-item${column.locked ? ' locked' : ''}`}>
                    <label className="yc-mail-column-toggle">
                      <input
                        type="checkbox"
                        checked={visible}
                        disabled={column.locked}
                        onChange={() => toggleColumn(column.id)}
                      />
                      <span>{column.label}</span>
                    </label>
                    <div className="yc-mail-column-order" aria-label={`${column.label} 列排序`}>
                      <button
                        type="button"
                        title="上移"
                        disabled={!visible || orderIndex <= 1 || column.locked}
                        onClick={() => moveColumn(column.id, -1)}
                      >
                        <WorkbenchIcon name="chevronUp" />
                      </button>
                      <button
                        type="button"
                        title="下移"
                        disabled={!visible || orderIndex < 0 || orderIndex >= visibleColumnIds.length - 1 || column.locked}
                        onClick={() => moveColumn(column.id, 1)}
                      >
                        <WorkbenchIcon name="chevronDown" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="yc-mail-column-custom">
              <label className="yc-mail-column-field">
                <span>字段名称</span>
                <input
                  value={customColumnLabel}
                  onChange={(event) => setCustomColumnLabel(event.target.value)}
                  placeholder="合同金额"
                />
              </label>
              <label className="yc-mail-column-field">
                <span>字段路径</span>
                <input
                  value={customColumnPath}
                  onChange={(event) => setCustomColumnPath(event.target.value)}
                  placeholder="summary.amount"
                />
              </label>
              <button
                type="button"
                onClick={addCustomColumn}
                disabled={!customColumnLabel.trim() || !customColumnPath.trim()}
              >
                新增字段
              </button>
            </div>
          </section>
        )}

        <section className="yc-mail-table" aria-label="审批任务列表">
          <div className="yc-mail-thead" style={{ gridTemplateColumns: columnTemplate }}>
            <label className="yc-mail-check">
              <input type="checkbox" checked={allVisibleSelected} onChange={handleSelectAllVisible} />
            </label>
            {visibleColumns.map((column) => (
              <span key={column.id} className={`yc-mail-head yc-mail-head-${column.id}`} data-col={column.id}>
                {column.label}
              </span>
            ))}
          </div>
          <div className="yc-mail-tbody">
            {filteredItems.length === 0 ? (
              <div className="yc-mail-empty">
                <WorkbenchIcon name="check" />
                <span>{scopeId === 'done' ? '暂无已办' : '暂无待办'}</span>
              </div>
            ) : (
              groupedItems.map((group) => (
                <React.Fragment key={group.key}>
                  {group.label && (
                    <div className="yc-mail-group-row">
                      <span>{group.label}</span>
                      <b>{group.items.length}</b>
                    </div>
                  )}
                  {group.items.map((item) => (
                    <article
                      key={item.id}
                      className={`yc-mail-row${activeItemId === item.id ? ' active' : ''}`}
                      style={{ gridTemplateColumns: columnTemplate }}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenDetail?.(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') onOpenDetail?.(item.id);
                      }}
                    >
                      <label className="yc-mail-check" onClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => handleSelect(item.id)} />
                      </label>
                      {visibleColumns.map((column) => (
                        <div key={column.id} className={`yc-mail-cell yc-mail-cell-${column.id}`} data-label={column.label}>
                          {renderCell(item, column)}
                        </div>
                      ))}
                    </article>
                  ))}
                </React.Fragment>
              ))
            )}
          </div>
        </section>

        {selectedIds.length > 0 && (
          <footer className="yc-mail-selection-bar">
            <span>已选 {selectedIds.length} 条</span>
            <button type="button" onClick={() => setSelectedIds([])}>
              清空
            </button>
          </footer>
        )}
      </main>

      <div className={`yc-yonclaw-chat${chatOpen ? ' open' : ''}`}>
        {!chatOpen ? (
          <button type="button" className="yc-yonclaw-launcher" onClick={() => setChatOpen(true)} aria-label="打开 YonClaw 会话">
            <WorkbenchIcon name="message" />
          </button>
        ) : (
          <section className="yc-yonclaw-panel" aria-label="YonClaw 会话">
            <header>
              <strong>YonClaw</strong>
              <button type="button" onClick={() => setChatOpen(false)} aria-label="关闭">
                <WorkbenchIcon name="close" />
              </button>
            </header>
            <div className="yc-yonclaw-messages">
              {messages.map((message) => (
                <article key={message.id} className={message.role}>
                  <p>{message.text}</p>
                  {message.command && pendingCommandId === message.command.id && (
                    <div className="yc-yonclaw-command-actions">
                      <button type="button" onClick={() => applyCommand(message)}>
                        应用
                      </button>
                      <button type="button" onClick={() => setPendingCommandId(null)}>
                        撤销
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
            <div className="yc-yonclaw-input">
              <input
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitChat();
                }}
                placeholder="显示金额和供应商，或分析已选任务"
              />
              <button type="button" onClick={submitChat}>
                发送
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
