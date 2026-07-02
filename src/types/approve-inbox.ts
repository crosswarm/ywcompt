/** 审批收件箱组件类型定义 — 对齐 docs/jsonSchema/approve-inbox.schema.json */

/** AI 审批结论三态 */
export type ApproveInboxAdvice = 'approve' | 'caution' | 'reject';

/** 风险等级 */
export type ApproveInboxRiskLevel = 'high' | 'medium' | 'low';

/** 条目状态 */
export type ApproveInboxStatus = 'pending' | 'done';

/** 严重度（详情分析用） */
export type ApproveInboxSeverity = 'risk' | 'warning' | 'passed';

/** 智能标识 tag */
export interface ApproveInboxSmartTag {
  /** 标签文本，如「高金额」（不带前缀） */
  label: string;
  /** 类别（可影响颜色） */
  kind?: 'risk' | 'rule' | 'advice';
}

/** 行操作按钮 */
export interface ApproveInboxRuntimeAction {
  /** 动作标识 */
  action: string;
  /** 显示文案 */
  label?: string;
  /** 动作类型：workflow/business/navigation 等 */
  kind?: string;
  /** 执行类型（skill 回调分流用） */
  execType?: string;
  /** YonBIP 待办按钮回调类型 */
  callBackExecType?: string;
  /** 是否可用 */
  enabled?: boolean;
  /** 来源，如 todo.buttons / handler.refreshActions / legacy.compat */
  source?: string;
  /** 本次观察或刷新动作的时间 */
  observedAt?: string;
  /** 执行前是否必须刷新动作 */
  requiresRefresh?: boolean;
  /** 执行端点提示，仅用于分发和诊断，不作为安全依据 */
  endpointHint?: string;
  /** 原始按钮顺序 */
  buttonIndex?: number;
}

/** 单据附件元信息 */
export interface ApproveInboxAttachment {
  /** 附件名 */
  fileName: string;
  /** 文件类型/扩展名 */
  fileType?: string;
  /** 字节数 */
  size?: number;
  /** 文件 ID */
  fid?: string | null;
  /** 可下载 URL；缺失时仅表示已识别附件元数据 */
  url?: string;
  /** 对象存储路径，仅服务侧诊断/后续签名下载使用 */
  storagePath?: string;
  /** 来源 */
  source?: string;
  /** 本地缓存路径 */
  localPath?: string | null;
  /** 下载或解析错误 */
  error?: string | null;
}

/** 审批列表项 */
export interface ApproveInboxItem {
  /** 单据/待办唯一 ID */
  id: string;
  /** YonBIP 审批执行主键 */
  primaryId?: string;
  /** 待办记录 ID */
  todoId?: string | null;
  /** 单据标题 */
  title: string;
  /** 单据类型 */
  docType?: string;
  /** 原始单据详情页 URL（新标签打开） */
  originalUrl?: string;
  /** 风险等级（前端用颜色区分） */
  riskLevel: ApproveInboxRiskLevel;
  /** 待办/已办 */
  status?: ApproveInboxStatus;
  /** 提交时间 ISO */
  submittedAt?: string;
  /** 截止时间 ISO（若上游待办提供，用于驾驶舱 widget 逾期统计） */
  dueAt?: string | null;
  /** 提交人姓名 */
  submitter?: string;
  /** AI 审批结论三态 */
  advice?: ApproveInboxAdvice;
  /** 智能标识（去前缀，直接值） */
  smartTags?: ApproveInboxSmartTag[];
  /** 行操作按钮 */
  runtimeActions?: ApproveInboxRuntimeAction[];
  /** runtimeActions 的语义化别名：上次观察到的动作快照 */
  observedActions?: ApproveInboxRuntimeAction[];
  /** 是否已解析出附件 */
  hasAttachments?: boolean;
  /** 附件数量 */
  attachmentCount?: number;
}

/** ① 总体结论 */
export interface ApproveInboxConclusion {
  /** AI 审批结论三态 */
  advice: ApproveInboxAdvice;
  /** 显示文案，如「建议通过」/「需关注」/「建议拒绝」 */
  label?: string;
}

/** ③ 单据字段分析（单条） */
export interface ApproveInboxFieldAnalysisItem {
  /** 字段/检查点名称 */
  name: string;
  /** 字段值 */
  value?: string;
  /** 分析结论 */
  summary: string;
  /** 严重度 */
  severity?: ApproveInboxSeverity;
}

/** 真实单据字段（抓取后展示在详情顶部） */
export interface ApproveInboxRawField {
  /** 原始字段 key */
  key?: string;
  /** 可读字段名，优先中文 */
  name: string;
  /** 可读字段值 */
  value: string;
  /** 关联审核维度 */
  dim?: string;
}

/** richDetail 归一化字段（enrich 后的稳定字段层） */
export interface ApproveInboxNormalizedField {
  fieldId?: string;
  rawPath?: string;
  label?: string;
  name?: string;
  value?: string;
  rawValue?: unknown;
  displayValue?: string;
  controlType?: string;
  dataType?: string;
  section?: string;
  required?: boolean;
  visible?: boolean;
  editable?: boolean;
}

/** 单据字段元数据（来自 MDF/iForm/YNF handler） */
export interface ApproveInboxFieldMetadata {
  label?: string;
  controlType?: string;
  dataType?: string;
  section?: string;
  required?: boolean;
  visible?: boolean;
  editable?: boolean;
  enumType?: string;
  refCode?: string;
  refType?: string;
  dataSourceAlias?: string;
  options?: Array<{ value: string; label: string }>;
}

/** richDetail：前端详情字段优先读取 normalized.fields */
export interface ApproveInboxRichDetail {
  schemaVersion?: number;
  primaryId?: string;
  type?: string;
  docType?: string;
  framework?: 'mdf' | 'iform' | 'ynf' | 'unknown' | string;
  handlerId?: string;
  handlerSource?: string;
  fetchedAt?: string;
  raw?: { kind?: string; dataPath?: string; fetchedAt?: string; source?: string };
  meta?: {
    templateId?: string;
    templateName?: string;
    billNo?: string;
    fields?: Record<string, ApproveInboxFieldMetadata>;
    enums?: Record<string, unknown>;
    references?: Record<string, unknown>;
    sections?: Array<{ id: string; label: string; fieldIds: string[] }>;
  };
  normalized?: {
    fields?: ApproveInboxNormalizedField[];
    byId?: Record<string, number>;
    sections?: Array<{ id: string; label: string; fieldIds: string[] }>;
  };
  fieldLabels?: Record<string, string>;
  /** 上次随详情观察到的动作快照；真实执行仍需 refreshActions */
  observedActions?: ApproveInboxRuntimeAction[];
}

/** ④ 业务规则分析（单条） */
export interface ApproveInboxRuleAnalysisItem {
  /** 规则名称 */
  ruleName: string;
  /** 严重度 */
  severity: ApproveInboxSeverity;
  /** 规则结论 */
  summary: string;
  /** 命中依据（Agent 须给出） */
  evidence?: string;
  /** 建议 */
  suggestion?: string;
}

/** ⑤ 附件分析发现项 */
export interface ApproveInboxAttachmentFinding {
  name?: string;
  detail?: string;
}

/** ⑤ 附件分析（单条） */
export interface ApproveInboxAttachmentAnalysisItem {
  /** 附件名 */
  name: string;
  /** 文件类型 */
  fileType?: string;
  /** 严重度 */
  severity?: ApproveInboxSeverity;
  /** 附件审核结论 */
  summary?: string;
  /** 附件级发现项 */
  findings?: ApproveInboxAttachmentFinding[];
}

/** 5 段详情结构 */
export interface ApproveInboxDetail {
  /** 单据 ID */
  id?: string;
  /** 单据标题 */
  title?: string;
  /** 原始单据详情页 URL（新标签打开） */
  originalUrl?: string;
  /** ① 总体结论 */
  conclusion: ApproveInboxConclusion;
  /** ② 总体分析（~40 字简述） */
  overallAnalysis?: string;
  /** ③ 单据字段分析 */
  fieldAnalysis?: ApproveInboxFieldAnalysisItem[];
  /** ④ 业务规则分析 */
  ruleAnalysis?: ApproveInboxRuleAnalysisItem[];
  /** ⑤ 附件分析 */
  attachmentAnalysis?: ApproveInboxAttachmentAnalysisItem[];
  /** 已识别附件元信息 */
  attachments?: ApproveInboxAttachment[];
  /** 真实抓取的单据字段 */
  fields?: ApproveInboxRawField[];
  /** richDetail 原始归一化详情（可选透传） */
  richDetail?: ApproveInboxRichDetail;
  /** 兼容顶层 normalized 字段 */
  normalized?: ApproveInboxRichDetail['normalized'];
  fieldLabels?: Record<string, string>;
  fieldMetadata?: Record<string, ApproveInboxFieldMetadata>;
  /** 是否已完成真实 AI 分析 */
  analyzed?: boolean;
  /** 当前登录态是否无权读取该租户字段 */
  crossTenant?: boolean;
  /** 跨租户名称 */
  tenantName?: string | null;
  /** 真实字段不可用原因 */
  unavailableReason?: string | null;
  /** 分析失败原因 */
  analysisError?: string | null;
  /** 数据来源：skill 真实分析 / 前端兜底 */
  source?: 'skill' | 'fallback';
}

/** 顶部汇总（可选，前端不渲染大指标卡） */
export interface ApproveInboxSummary {
  total?: number;
  pendingCount?: number;
  doneCount?: number;
  lastSyncAt?: string;
}

/** 已办智能总结（以审核数据统计 + 分析为主） */
export interface ApproveInboxReviewSummary {
  /** 统计周期，如「近 7 天」 */
  period?: string;
  /** 已处理总数 */
  total?: number;
  /** 通过数 */
  approvedCount?: number;
  /** 驳回数 */
  rejectedCount?: number;
  /** 退回数 */
  returnedCount?: number;
  /** 风险分布 */
  riskDistribution?: { high?: number; medium?: number; low?: number };
  /** 类型分布 */
  typeDistribution?: Array<{ type: string; count: number }>;
  /** 关键指标（通过率、平均处理时长等） */
  highlights?: Array<{ label: string; value: string }>;
  /** 总体分析文字（数据统计结论） */
  analysis?: string;
}

/** 视图默认设置 */
export interface ApproveInboxViewSettings {
  /** 布局版本；maillist = V2 类邮箱表格体验 */
  layoutVariant?: 'classic' | 'maillist';
  defaultTabId?: string;
  defaultSort?: 'submitted-asc' | 'submitted-desc' | 'importance-desc' | 'risk-desc' | 'advice-desc' | 'title-asc';
  /** 默认分组维度 */
  defaultGroupBy?: 'none' | 'risk' | 'docType' | 'status' | string;
  /** 列表展示列；字符串表示内置列 id，对象表示自定义字段列 */
  visibleColumns?: Array<string | ApproveInboxViewColumn>;
  /** 需要固定在左侧的列 id */
  pinnedColumns?: string[];
  /** 用户关注的业务规则或规则视图 */
  businessRules?: ApproveInboxBusinessRule[];
}

/** V2 邮件式列表列配置 */
export interface ApproveInboxViewColumn {
  id: string;
  label: string;
  path?: string;
  fieldLabel?: string;
  fieldId?: string;
  detailPath?: string;
  format?: 'advice' | 'risk' | 'date' | 'tags' | 'attachment' | string;
  width?: number | string;
  pinned?: boolean;
}

/** V2 用户关注的业务规则视图 */
export interface ApproveInboxBusinessRule {
  id: string;
  label: string;
  description?: string;
  field?: string;
  operator?: 'contains' | 'equals' | 'gt' | 'lt' | 'exists';
  value?: string | number | boolean;
  riskLevel?: ApproveInboxRiskLevel;
  docType?: string;
}

/** 审批收件箱组件数据（widget.data 根对象） */
export interface ApproveInboxData {
  businessType: 'approve-inbox';
  summary?: ApproveInboxSummary;
  viewSettings?: ApproveInboxViewSettings;
  items: ApproveInboxItem[];
  /** 已办智能总结（审核统计 + 分析；前端在「已办」tab 渲染） */
  reviewSummary?: ApproveInboxReviewSummary;
  /** 详情（按需异步加载，可选） */
  detail?: ApproveInboxDetail;
}

/** 驾驶舱智能待办 widget 汇总 */
export interface ApproveInboxWidgetSummary {
  pendingCount: number;
  highPriorityCount: number;
  attentionCount: number;
  lastSyncAt?: string | null;
}

/** 驾驶舱智能待办 widget 单条预览 */
export interface ApproveInboxWidgetTodoItem {
  id: string;
  title: string;
  subtitle?: string;
  tags?: ApproveInboxSmartTag[];
  riskLevel: ApproveInboxRiskLevel;
  advice?: ApproveInboxAdvice | null;
  dueAt?: string | null;
}

/** 驾驶舱智能待办 widget 数据 */
export interface ApproveInboxWidgetData {
  businessType: 'approve-inbox-widget';
  summary: ApproveInboxWidgetSummary;
  items: ApproveInboxWidgetTodoItem[];
  magicSummary?: string;
  actions?: {
    openCenterUrl?: string;
    refreshUrl?: string;
  };
  state?: 'ready' | 'empty' | 'unavailable';
}
