/** 审批收件箱组件类型定义 — 对齐 docs/jsonSchema/approve-inbox.schema.json */

/** AI 审批结论三态 */
export type ApproveInboxAdvice = 'approve' | 'caution' | 'reject';

/** 风险等级 */
export type ApproveInboxRiskLevel = 'high' | 'medium' | 'low';

/** 条目状态 */
export type ApproveInboxStatus = 'pending' | 'done';

/** 最佳可得任务到手时间的原始来源 */
export type ApproveInboxReceivedAtSource =
  | 'workflow.task.createTime'
  | 'message-center.createTsLong'
  | 'message-center.createTime'
  | 'message-center.msgTsLong'
  | 'unavailable';

/** 到手时间的语义精度 */
export type ApproveInboxReceivedAtSemantics = 'task-created' | 'message-created' | 'message-timestamp' | 'unavailable';

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
  /** 审批任务 ID（智能审核查询用） */
  taskId?: string | null;
  /** 流程业务键（智能审核查询用；区别于单据详情业务键） */
  workflowBusinessKey?: string | null;
  /** 友户通用户 ID（智能审核精确查询用；缺失时不传） */
  yhtUserId?: string | null;
  /** 单据标题 */
  title: string;
  /** @deprecated 兼容旧版展示的单据类型字段；新逻辑优先使用 serviceName */
  docType?: string;
  /** 单据类型显示名 */
  docTypeName?: string;
  /** 用于解析服务名称的标准服务编码 */
  serviceCode?: string | null;
  /** 待办来源提供的原始服务编码 */
  sourceServiceCode?: string | null;
  /** 准确的服务/业务入口显示名称；不保证等同于具体单据名称 */
  serviceName?: string | null;
  /** 服务名称来源 */
  serviceNameSource?: 'todo' | 'bip-cli.auth.permission.apply' | null;
  /** UI 配置匹配用的稳定分组 key */
  displayKey?: string;
  /** UI 配置分组显示名 */
  displayLabel?: string;
  /** handler/source key */
  handlerId?: string | null;
  /** 单据框架 */
  framework?: string | null;
  /** 原始业务类型 */
  type?: string | null;
  processName?: string | null;
  appName?: string | null;
  /** 列表项原始摘要字段，供自定义列按 path 取值 */
  summary?: Record<string, unknown>;
  /** 单据业务键，通常为 billnum_billId；URL busiObj 非空时为 busiObj_billId */
  businessKey?: string | null;
  /** 原始单据详情页 URL（新标签打开） */
  originalUrl?: string;
  /** 风险等级：high=重要、medium=需关注、low=建议通过 */
  riskLevel: ApproveInboxRiskLevel;
  /** 待办/已办 */
  status?: ApproveInboxStatus;
  /** 完成时间 ISO（真实审批写回或已处理通知归档时提供） */
  completedAt?: string | null;
  /** 完成动作：approve / reject / return 等 */
  completedAction?: string;
  /** completedAction 的兼容别名 */
  approvalAction?: string;
  /** 完成状态来源，如本地审批写回或消息中心退回制单通知 */
  completionSource?: string;
  /** 提交时间 ISO */
  submittedAt?: string;
  /** 最佳可得的任务到手时间 ISO；无可靠来源时为 null */
  receivedAt?: string | null;
  /** 到手时间的原始来源；不得使用提交或同步时间 */
  receivedAtSource?: ApproveInboxReceivedAtSource;
  /** 到手时间的语义精度 */
  receivedAtSemantics?: ApproveInboxReceivedAtSemantics;
  /** 面向用户的来源/降级说明 */
  receivedAtSourceLabel?: string;
  /** 截止时间 ISO（若上游待办提供，用于驾驶舱 widget 逾期统计） */
  dueAt?: string | null;
  /** 提交人姓名 */
  submitter?: string;
  /** AI 审批结论三态 */
  advice?: ApproveInboxAdvice;
  /** 列表展示用 AI 建议，来自总体分析或最高优先级审核规则 */
  aiSuggestion?: string;
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

export interface ApproveInboxSystemRuleAudit {
  status: 'success' | 'not_found' | 'disabled' | 'model_error' | 'error' | 'skipped' | string;
  code?: number | string | null;
  message?: string;
  displayCode?: string;
  detailMsg?: string;
  level?: number;
  resultId?: string;
  queryId?: string;
  resultDesc?: string;
  AISummaryResultDesc?: string;
  fetchedAt?: string;
  reason?: string;
  httpStatus?: number;
}

export interface ApproveInboxCompositeAdvice {
  advice: ApproveInboxAdvice;
  label?: string;
  riskLevel?: ApproveInboxRiskLevel;
  source?: 'system' | 'user' | 'fallback' | string;
  summary?: string;
  reasons?: string[];
  conflict?: boolean;
  systemAdvice?: ApproveInboxAdvice | null;
  userAdvice?: ApproveInboxAdvice | null;
  fetchedAt?: string | null;
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
  /** 单据业务键，通常为 billnum_billId；URL busiObj 非空时为 busiObj_billId */
  businessKey?: string;
  type?: string;
  docType?: string;
  framework?: 'mdf' | 'iform' | 'ynf' | 'unknown' | string;
  handlerId?: string;
  handlerSource?: string;
  fetchedAt?: string;
  raw?: { kind?: string; dataPath?: string; fetchedAt?: string; source?: string };
  meta?: {
    /** 单据业务键，通常为 billnum_billId；URL busiObj 非空时为 busiObj_billId */
    businessKey?: string;
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
  /** 单据业务键，通常为 billnum_billId；URL busiObj 非空时为 busiObj_billId */
  businessKey?: string;
  /** 单据标题 */
  title?: string;
  /** 原始单据详情页 URL（新标签打开） */
  originalUrl?: string;
  /** ① 总体结论 */
  conclusion: ApproveInboxConclusion;
  /** 综合审批建议：系统预置规则优先，用户级规则补充 */
  compositeAdvice?: ApproveInboxCompositeAdvice | null;
  /** 系统预置规则：智能审核 API 实时结果 */
  systemRuleAudit?: ApproveInboxSystemRuleAudit | null;
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
  /** 服务端按 detail-card-view.config.json 解析出的详情字段分组 */
  detailCardSections?: Array<{
    id?: string;
    title?: string;
    fields?: Array<{ id?: string; label?: string; value?: unknown; full?: boolean }>;
  }>;
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
  defaultSort?: 'received-asc' | 'received-desc' | 'submitted-asc' | 'submitted-desc' | 'importance-desc' | 'risk-desc' | 'advice-desc' | 'title-asc';
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
  locked?: boolean;
  showLabel?: boolean;
  full?: boolean;
  linkTo?: string;
  link?: string;
  linkTarget?: 'internal' | 'external' | string;
}

export interface ApproveInboxUiConfig {
  version?: number;
  defaultView?: 'card' | 'table' | string;
  theme?: 'system' | 'light' | 'mist' | 'dark' | string;
  density?: 'compact' | 'comfortable' | string;
  table?: {
    groupBy?: string;
    sortGroups?: string;
    stickyGroupHeader?: boolean;
    actionBar?: string;
  };
  actions?: {
    placements?: string[];
    confirmBulk?: boolean;
    commentPresets?: string[];
  };
  navigation?: {
    preserveQueryOnViewSwitch?: boolean;
    openExternalBill?: 'new-tab' | 'same-tab' | string;
  };
  attachments?: {
    iconStyle?: string;
  };
  appearance?: {
    background?: {
      enabled?: boolean;
      imageUrl?: string;
      fit?: string;
      position?: string;
      attachment?: string;
      dim?: number;
      blur?: number;
      saturate?: number;
      panelOpacity?: number;
    };
  };
}

export interface ApproveInboxTableViewConfig {
  version?: number;
  defaultColumns?: ApproveInboxViewColumn[];
  groups?: Record<string, { label?: string; columns?: ApproveInboxViewColumn[] }>;
}

export interface ApproveInboxCardViewConfig {
  version?: number;
  defaultFields?: ApproveInboxViewColumn[];
  groups?: Record<string, { label?: string; fields?: ApproveInboxViewColumn[] }>;
}

export interface ApproveInboxDetailCardSection {
  id?: string;
  title?: string;
  fields?: ApproveInboxViewColumn[];
}

export interface ApproveInboxDetailCardViewConfig {
  version?: number;
  groups?: Record<string, { label?: string; sections?: ApproveInboxDetailCardSection[] }>;
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
  uiConfig?: ApproveInboxUiConfig;
  tableViewConfig?: ApproveInboxTableViewConfig;
  cardViewConfig?: ApproveInboxCardViewConfig;
  detailCardViewConfig?: ApproveInboxDetailCardViewConfig;
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

/** 驾驶舱智能待办 widget 单项预览 */
export interface ApproveInboxWidgetTodoItem {
  id: string;
  title: string;
  subtitle?: string;
  tags?: ApproveInboxSmartTag[];
  riskLevel: ApproveInboxRiskLevel;
  advice?: ApproveInboxAdvice | null;
  dueAt?: string | null;
  receivedAt?: string | null;
  receivedAtSource?: ApproveInboxReceivedAtSource;
  receivedAtSourceLabel?: string;
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
