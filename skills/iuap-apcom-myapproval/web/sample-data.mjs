/**
 * sample-data.mjs — 智能待办样例数据（无真实抓取凭据时的兜底）
 *
 * 数据结构对齐 src/types/approve-inbox.ts 与 docs/jsonSchema/approve-inbox.schema.json。
 * 单据类型聚焦 BIP 正常【业务审批】：采购合同 / 采购申请 / 费用报销 / 付款申请 /
 * 销售合同 / 用印申请 / 招聘 / 借款 等；5 段分析（结论/总体/字段/规则/附件）
 * 围绕业务审核维度（金额、预算、付款条款、票据、合同、资质等）。
 *
 * 用途：`node web/server.mjs` 在未配置抓取链路时仍能在浏览器查看 v3 视觉。
 * 真实数据落盘 data/inbox.json + data/details/ 后会优先读取真实数据。
 */

/** @type {import('../../../src/types/approve-inbox').ApproveInboxData} */
export const SAMPLE_INBOX = {
  businessType: "approve-inbox",
  summary: { total: 11, pendingCount: 6, doneCount: 5, lastSyncAt: null },
  viewSettings: { defaultTabId: "all-todo" },
  reviewSummary: {
    period: "近 7 天",
    total: 5,
    approvedCount: 4,
    rejectedCount: 1,
    returnedCount: 0,
    riskDistribution: { high: 1, medium: 2, low: 2 },
    typeDistribution: [
      { type: "费用报销", count: 1 },
      { type: "采购合同", count: 1 },
      { type: "付款申请", count: 1 },
      { type: "借款申请", count: 1 },
      { type: "销售合同", count: 1 },
    ],
    highlights: [
      { label: "通过率", value: "80%" },
      { label: "平均时长", value: "2.6h" },
    ],
    analysis:
      "近 7 天共处理 5 件业务审批，通过率 80%、平均处理时长 2.6 小时。1 件高风险为项目备用金借款，因超额度且用途不清被驳回；报销、采购合同、付款、销售合同均合规通过。整体资金与合同风险可控，建议持续关注大额付款的发票合规与借款额度执行。",
  },
  items: [
    {
      id: "sample-001",
      title: "2026年Q3战略采购合同（华为云服务）",
      docType: "采购合同",
      riskLevel: "high",
      status: "pending",
      submittedAt: "2026-06-16T09:00:00Z",
      submitter: "王建国",
      advice: "reject",
      smartTags: [
        { label: "金额超预算 34%", kind: "risk" },
        { label: "预付款 60%", kind: "rule" },
        { label: "报价单缺失", kind: "risk" },
        { label: "需双签", kind: "rule" },
      ],
      runtimeActions: [
        { action: "approve", label: "通过", enabled: true },
        { action: "reject", label: "驳回", enabled: true },
      ],
    },
    {
      id: "sample-002",
      title: "付款申请（华东供应商货款·Q2 结算）",
      docType: "付款申请",
      riskLevel: "high",
      status: "pending",
      submittedAt: "2026-06-16T08:20:00Z",
      submitter: "周倩",
      advice: "caution",
      smartTags: [
        { label: "发票金额不符", kind: "risk" },
        { label: "超账期", kind: "rule" },
        { label: "合同已备案", kind: "advice" },
      ],
      runtimeActions: [
        { action: "approve", label: "通过", enabled: true },
        { action: "reject", label: "驳回", enabled: true },
      ],
    },
    {
      id: "sample-003",
      title: "差旅费报销申请（张三·北京出差 3 天）",
      docType: "费用报销",
      riskLevel: "medium",
      status: "pending",
      submittedAt: "2026-06-15T16:40:00Z",
      submitter: "张三",
      advice: "caution",
      smartTags: [
        { label: "住宿超标 ¥220", kind: "rule" },
        { label: "缺 1 张发票", kind: "risk" },
      ],
      runtimeActions: [
        { action: "approve", label: "通过", enabled: true },
        { action: "reject", label: "驳回", enabled: true },
      ],
    },
    {
      id: "sample-004",
      title: "采购申请（生产物料请购·6 月）",
      docType: "采购申请",
      riskLevel: "medium",
      status: "pending",
      submittedAt: "2026-06-15T10:30:00Z",
      submitter: "孙磊",
      advice: "caution",
      smartTags: [
        { label: "超月度计划 12%", kind: "rule" },
        { label: "单一供应商", kind: "risk" },
        { label: "交期合理", kind: "advice" },
      ],
      runtimeActions: [
        { action: "approve", label: "通过", enabled: true },
        { action: "reject", label: "驳回", enabled: true },
      ],
    },
    {
      id: "sample-005",
      title: "用印申请（年度销售框架合同盖章）",
      docType: "用印申请",
      riskLevel: "medium",
      status: "pending",
      submittedAt: "2026-06-14T14:00:00Z",
      submitter: "李娜",
      advice: "caution",
      smartTags: [
        { label: "法务未会签", kind: "risk" },
        { label: "对方资质齐全", kind: "advice" },
      ],
      runtimeActions: [
        { action: "approve", label: "通过", enabled: true },
        { action: "reject", label: "驳回", enabled: true },
      ],
    },
    {
      id: "sample-006",
      title: "人员招聘申请（研发部·高级工程师）",
      docType: "招聘申请",
      riskLevel: "low",
      status: "pending",
      submittedAt: "2026-06-14T11:00:00Z",
      submitter: "周敏",
      advice: "approve",
      smartTags: [{ label: "HC 在编制内", kind: "advice" }],
      runtimeActions: [
        { action: "approve", label: "通过", enabled: true },
        { action: "reject", label: "驳回", enabled: true },
      ],
    },
    {
      id: "sample-007",
      title: "差旅费报销申请（李四·上海出差 2 天）",
      docType: "费用报销",
      riskLevel: "low",
      status: "done",
      submittedAt: "2026-06-13T09:10:00Z",
      submitter: "李四",
      advice: "approve",
      smartTags: [{ label: "票据齐全", kind: "advice" }],
      runtimeActions: [],
    },
    {
      id: "sample-008",
      title: "采购合同（办公家具批量采购）",
      docType: "采购合同",
      riskLevel: "low",
      status: "done",
      submittedAt: "2026-06-12T14:30:00Z",
      submitter: "李娜",
      advice: "approve",
      smartTags: [{ label: "比价充分", kind: "advice" }],
      runtimeActions: [],
    },
    {
      id: "sample-009",
      title: "付款申请（办公场地房租·季付）",
      docType: "付款申请",
      riskLevel: "medium",
      status: "done",
      submittedAt: "2026-06-11T15:00:00Z",
      submitter: "周倩",
      advice: "approve",
      smartTags: [{ label: "合同与发票一致", kind: "advice" }],
      runtimeActions: [],
    },
    {
      id: "sample-010",
      title: "借款申请（项目备用金·华南项目组）",
      docType: "借款申请",
      riskLevel: "high",
      status: "done",
      submittedAt: "2026-06-10T11:20:00Z",
      submitter: "郑昊",
      advice: "reject",
      smartTags: [
        { label: "超额度 ¥3 万", kind: "risk" },
        { label: "用途不清", kind: "risk" },
      ],
      runtimeActions: [],
    },
    {
      id: "sample-011",
      title: "销售合同审批（年度框架·制造行业）",
      docType: "销售合同",
      riskLevel: "medium",
      status: "done",
      submittedAt: "2026-06-10T14:00:00Z",
      submitter: "高翔",
      advice: "approve",
      smartTags: [
        { label: "条款合规", kind: "advice" },
        { label: "信用额度内", kind: "advice" },
      ],
      runtimeActions: [],
    },
  ],
};

/** @type {Record<string, import('../../../src/types/approve-inbox').ApproveInboxDetail>} */
export const SAMPLE_DETAILS = {
  "sample-001": {
    id: "sample-001",
    title: "2026年Q3战略采购合同（华为云服务）",
    conclusion: { advice: "reject", label: "建议拒绝" },
    overallAnalysis:
      "合同金额超预算 34%，预付款比例偏高，报价比价文件缺失，建议退回重新议价后再审。",
    fieldAnalysis: [
      { name: "合同金额", value: "¥1,340,000", summary: "超本财年采购预算上限，需专项审批", severity: "risk" },
      { name: "付款周期", value: "预付款 60%", summary: "预付比例高于公司标准（30%），存在资金风险", severity: "risk" },
      { name: "合同期限", value: "2026-07-01 至 2027-06-30", summary: "期限合规，与采购需求匹配", severity: "passed" },
      { name: "供应商资质", value: "华为技术有限公司", summary: "资质齐全，无历史违约记录", severity: "passed" },
      { name: "预算科目", value: "云资源采购", summary: "科目正确，但本期余额不足", severity: "warning" },
    ],
    ruleAnalysis: [
      {
        ruleName: "大额采购双签制度",
        severity: "risk",
        summary: "超 100 万元采购须双人审批，当前仅单人签批",
        evidence: "合同金额 ¥134 万 > 制度阈值 ¥100 万，审批记录仅含直属负责人签字",
        suggestion: "退回补充财务总监会签后重新提交",
      },
      {
        ruleName: "预付款比例限制",
        severity: "risk",
        summary: "预付款 60% 超公司标准 30% 上限",
        evidence: "合同第 5.2 条约定首付 60%，《采购管理办法》第 12 条规定预付款不超过总额 30%",
        suggestion: "与供应商重新协商付款条款",
      },
      {
        ruleName: "附件完整性检查",
        severity: "warning",
        summary: "供应商报价比价文件未上传",
        evidence: "附件仅含合同扫描件，缺三家询价记录及报价对比",
        suggestion: "补充上传三家供应商报价对比文件",
      },
    ],
    attachmentAnalysis: [
      {
        name: "华为云服务采购合同（盖章版）.pdf",
        fileType: "PDF",
        severity: "warning",
        summary: "合同内容完整，但第 5.2 付款条款存在风险",
        findings: [
          { name: "付款条款风险", detail: "预付款比例 60% 超出公司规定" },
          { name: "合同盖章", detail: "双方盖章齐全，法务签字有效" },
        ],
      },
    ],
    source: "skill",
  },
  "sample-002": {
    id: "sample-002",
    title: "付款申请（华东供应商货款·Q2 结算）",
    conclusion: { advice: "caution", label: "需关注" },
    overallAnalysis: "付款对应合同已备案，但发票金额与申请金额不符，且已超合同约定账期，建议核实后付款。",
    fieldAnalysis: [
      { name: "付款金额", value: "¥486,000", summary: "与采购合同总额一致", severity: "passed" },
      { name: "发票金额", value: "¥468,000", summary: "发票合计较申请少 ¥1.8 万，存在差额", severity: "risk" },
      { name: "付款账期", value: "已超 12 天", summary: "超合同约定「月结 30 天」账期", severity: "warning" },
      { name: "对应合同", value: "CG-2026-0418", summary: "合同已备案，主体一致", severity: "passed" },
    ],
    ruleAnalysis: [
      {
        ruleName: "发票-付款一致性",
        severity: "risk",
        summary: "付款金额须与发票金额匹配",
        evidence: "申请付款 ¥48.6 万，已上传发票合计 ¥46.8 万，差额 ¥1.8 万无对应发票",
        suggestion: "补传差额发票或将本次付款调整为 ¥46.8 万",
      },
      {
        ruleName: "账期合规",
        severity: "warning",
        summary: "付款应在合同约定账期内",
        evidence: "合同约定月结 30 天，本次较应付日延后 12 天",
        suggestion: "说明延期原因，确认是否产生违约金",
      },
    ],
    attachmentAnalysis: [
      {
        name: "增值税专用发票（3 张）.pdf",
        fileType: "PDF",
        severity: "warning",
        summary: "发票真实有效，但合计金额与申请不符",
        findings: [{ name: "金额差额", detail: "发票合计 ¥46.8 万 < 申请 ¥48.6 万" }],
      },
    ],
    source: "skill",
  },
  "sample-003": {
    id: "sample-003",
    title: "差旅费报销申请（张三·北京出差 3 天）",
    conclusion: { advice: "caution", label: "需关注" },
    overallAnalysis: "报销总额合理，住宿单日略超标准，且缺 1 张餐饮发票，建议补齐后通过。",
    fieldAnalysis: [
      { name: "报销总额", value: "¥3,860", summary: "在部门差旅预算范围内", severity: "passed" },
      { name: "住宿费", value: "¥620/晚", summary: "超北京差标 ¥400/晚 共 ¥220", severity: "warning" },
      { name: "交通费", value: "¥1,240", summary: "高铁往返票据齐全，金额合规", severity: "passed" },
    ],
    ruleAnalysis: [
      {
        ruleName: "差旅住宿标准",
        severity: "warning",
        summary: "住宿单价超出职级对应标准",
        evidence: "《差旅管理制度》北京地区经理级住宿标准 ¥400/晚，实报 ¥620/晚",
        suggestion: "超标部分需本人确认自理或补充说明",
      },
      {
        ruleName: "票据完整性",
        severity: "risk",
        summary: "餐饮费缺 1 张发票",
        evidence: "报销明细 5 项，仅上传 4 张发票，6 月 12 日午餐 ¥86 无票",
        suggestion: "补传缺失发票或调整报销金额",
      },
    ],
    attachmentAnalysis: [
      {
        name: "差旅票据合集.pdf",
        fileType: "PDF",
        severity: "warning",
        summary: "票据基本齐全，缺 1 张餐饮发票",
        findings: [{ name: "缺票", detail: "6 月 12 日午餐 ¥86 缺发票" }],
      },
    ],
    source: "skill",
  },
  "sample-004": {
    id: "sample-004",
    title: "采购申请（生产物料请购·6 月）",
    conclusion: { advice: "caution", label: "需关注" },
    overallAnalysis: "物料需求真实、交期合理，但本次请购超月度采购计划，且为单一供应商，建议补充比价。",
    fieldAnalysis: [
      { name: "采购金额", value: "¥182,000", summary: "超 6 月物料采购计划 12%", severity: "warning" },
      { name: "供应商", value: "单一来源", summary: "未提供比价，存在采购合规风险", severity: "risk" },
      { name: "到货周期", value: "15 个工作日", summary: "与生产排程匹配，交期合理", severity: "passed" },
      { name: "物料类目", value: "电子元器件", summary: "属常规生产物料，需求真实", severity: "passed" },
    ],
    ruleAnalysis: [
      {
        ruleName: "采购计划匹配",
        severity: "warning",
        summary: "请购金额超月度采购计划",
        evidence: "6 月物料采购计划 ¥16.3 万，本次请购 ¥18.2 万，超 12%",
        suggestion: "说明超计划原因或拆分至下月",
      },
      {
        ruleName: "比价/招采合规",
        severity: "risk",
        summary: "金额超 10 万须多家比价",
        evidence: "本次 ¥18.2 万 > 比价阈值 ¥10 万，仅单一供应商报价",
        suggestion: "补充至少两家供应商比价",
      },
    ],
    attachmentAnalysis: [],
    source: "skill",
  },
  "sample-005": {
    id: "sample-005",
    title: "用印申请（年度销售框架合同盖章）",
    conclusion: { advice: "caution", label: "需关注" },
    overallAnalysis: "对方主体资质齐全，但合同未经法务会签即申请用印，存在条款合规风险，建议补法务审核。",
    fieldAnalysis: [
      { name: "用印类型", value: "合同专用章", summary: "用印类型与文件匹配", severity: "passed" },
      { name: "法务会签", value: "未会签", summary: "合同条款未经法务审核", severity: "risk" },
      { name: "对方资质", value: "已核验（营业执照有效）", summary: "对方主体资质齐全", severity: "passed" },
      { name: "合同金额", value: "框架（不约定总额）", summary: "框架合同，按订单结算", severity: "passed" },
    ],
    ruleAnalysis: [
      {
        ruleName: "用印法务前置",
        severity: "risk",
        summary: "对外合同用印须经法务会签",
        evidence: "用印流程要求合同先法务会签，本单法务会签节点为空",
        suggestion: "退回补充法务会签后再用印",
      },
    ],
    attachmentAnalysis: [
      {
        name: "年度销售框架合同.pdf",
        fileType: "PDF",
        severity: "warning",
        summary: "合同结构完整，缺法务批注",
        findings: [{ name: "缺法务意见", detail: "文档无法务审核批注或会签记录" }],
      },
    ],
    source: "skill",
  },
  "sample-006": {
    id: "sample-006",
    title: "人员招聘申请（研发部·高级工程师）",
    conclusion: { advice: "approve", label: "建议通过" },
    overallAnalysis: "招聘需求在编制内、薪资带宽合规、业务理由充分，建议通过。",
    fieldAnalysis: [
      { name: "编制占用", value: "1/3（剩余 2）", summary: "在研发部年度 HC 编制内", severity: "passed" },
      { name: "薪资带宽", value: "¥28-35K", summary: "符合高级工程师职级带宽", severity: "passed" },
      { name: "招聘理由", value: "项目扩张补员", summary: "业务理由充分，有项目背书", severity: "passed" },
    ],
    ruleAnalysis: [
      {
        ruleName: "编制合规检查",
        severity: "passed",
        summary: "未超部门年度编制",
        evidence: "研发部 2026 HC 3 个，已用 1 个，本次申请第 2 个",
        suggestion: "",
      },
    ],
    attachmentAnalysis: [],
    source: "skill",
  },
  "sample-007": {
    id: "sample-007",
    title: "差旅费报销申请（李四·上海出差 2 天）",
    conclusion: { advice: "approve", label: "建议通过" },
    overallAnalysis: "报销金额合规、票据齐全、住宿与交通均在标准内，已通过。",
    fieldAnalysis: [
      { name: "报销总额", value: "¥2,340", summary: "在预算范围内", severity: "passed" },
      { name: "票据", value: "齐全", summary: "发票与明细一一对应", severity: "passed" },
    ],
    ruleAnalysis: [
      {
        ruleName: "票据完整性",
        severity: "passed",
        summary: "票据与明细一致",
        evidence: "4 项明细均有对应发票",
        suggestion: "",
      },
    ],
    attachmentAnalysis: [],
    source: "skill",
  },
  "sample-008": {
    id: "sample-008",
    title: "采购合同（办公家具批量采购）",
    conclusion: { advice: "approve", label: "建议通过" },
    overallAnalysis: "采购金额在预算内、比价充分、合同条款合规，已通过。",
    fieldAnalysis: [
      { name: "合同金额", value: "¥86,000", summary: "在行政采购预算内", severity: "passed" },
      { name: "比价", value: "三家比价", summary: "已选最优报价", severity: "passed" },
    ],
    ruleAnalysis: [
      {
        ruleName: "比价合规",
        severity: "passed",
        summary: "已完成多家比价",
        evidence: "附三家供应商报价对比，选定最低价",
        suggestion: "",
      },
    ],
    attachmentAnalysis: [],
    source: "skill",
  },
  "sample-009": {
    id: "sample-009",
    title: "付款申请（办公场地房租·季付）",
    conclusion: { advice: "approve", label: "建议通过" },
    overallAnalysis: "付款对应租赁合同，发票与金额一致，账期合规，已通过。",
    fieldAnalysis: [
      { name: "付款金额", value: "¥210,000", summary: "与租赁合同季付金额一致", severity: "passed" },
      { name: "发票", value: "金额一致", summary: "发票与申请金额匹配", severity: "passed" },
    ],
    ruleAnalysis: [
      {
        ruleName: "发票-付款一致性",
        severity: "passed",
        summary: "付款与发票匹配",
        evidence: "发票合计 ¥21 万 = 申请金额",
        suggestion: "",
      },
    ],
    attachmentAnalysis: [],
    source: "skill",
  },
  "sample-010": {
    id: "sample-010",
    title: "借款申请（项目备用金·华南项目组）",
    conclusion: { advice: "reject", label: "建议拒绝" },
    overallAnalysis: "借款超个人备用金额度且用途说明不清，存在资金挪用风险，已驳回。",
    fieldAnalysis: [
      { name: "借款金额", value: "¥80,000", summary: "超个人备用金额度 ¥5 万 共 ¥3 万", severity: "risk" },
      { name: "借款用途", value: "项目杂费", summary: "用途笼统，无明细预算", severity: "risk" },
    ],
    ruleAnalysis: [
      {
        ruleName: "备用金额度限制",
        severity: "risk",
        summary: "借款超个人备用金上限",
        evidence: "《资金管理办法》个人备用金上限 ¥5 万，本次申请 ¥8 万",
        suggestion: "拆分用途或走专项资金审批",
      },
    ],
    attachmentAnalysis: [],
    source: "skill",
  },
  "sample-011": {
    id: "sample-011",
    title: "销售合同审批（年度框架·制造行业）",
    conclusion: { advice: "approve", label: "建议通过" },
    overallAnalysis: "合同条款合规、客户信用额度充足、定价在授权范围内，已通过。",
    fieldAnalysis: [
      { name: "合同条款", value: "标准模板", summary: "采用标准条款，无重大偏离", severity: "passed" },
      { name: "客户信用", value: "额度内", summary: "客户信用额度充足", severity: "passed" },
    ],
    ruleAnalysis: [
      {
        ruleName: "信用额度控制",
        severity: "passed",
        summary: "合同金额在客户信用额度内",
        evidence: "客户授信余额 > 合同预估金额",
        suggestion: "",
      },
    ],
    attachmentAnalysis: [],
    source: "skill",
  },
};
