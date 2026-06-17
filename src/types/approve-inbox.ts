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
  /** 执行类型（skill 回调分流用） */
  execType?: string;
  /** 是否可用 */
  enabled?: boolean;
}

/** 审批列表项 */
export interface ApproveInboxItem {
  /** 单据/待办唯一 ID */
  id: string;
  /** 单据标题 */
  title: string;
  /** 单据类型 */
  docType?: string;
  /** 风险等级（前端用颜色区分） */
  riskLevel: ApproveInboxRiskLevel;
  /** 待办/已办 */
  status?: ApproveInboxStatus;
  /** 提交时间 ISO */
  submittedAt?: string;
  /** 提交人姓名 */
  submitter?: string;
  /** AI 审批结论三态 */
  advice?: ApproveInboxAdvice;
  /** 智能标识（去前缀，直接值） */
  smartTags?: ApproveInboxSmartTag[];
  /** 行操作按钮 */
  runtimeActions?: ApproveInboxRuntimeAction[];
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
  defaultTabId?: string;
  defaultSort?: 'submitted-asc' | 'importance-desc';
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
