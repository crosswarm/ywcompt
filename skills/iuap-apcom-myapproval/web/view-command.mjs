export const DEFAULT_VIEW_COLUMNS = [
  { id: "title", label: "任务", locked: true },
  { id: "submitter", label: "提交人" },
  { id: "receivedAt", label: "到手时间" },
  { id: "submittedAt", label: "提交时间" },
  { id: "docType", label: "业务" },
  { id: "advice", label: "AI建议" },
  { id: "riskLevel", label: "风险" },
  { id: "attachments", label: "附件" },
  { id: "tags", label: "标签" },
  { id: "status", label: "状态" },
  { id: "actions", label: "操作" },
  { id: "amount", label: "金额" },
  { id: "supplier", label: "供应商" },
  { id: "budget", label: "预算" },
  { id: "department", label: "部门" },
];

export const FIELD_ALIASES = [
  { id: "title", aliases: ["标题", "任务", "单据", "主题"] },
  { id: "submitter", aliases: ["提交人", "发起人", "申请人", "提交者"] },
  { id: "receivedAt", aliases: ["到手时间", "接收时间", "收到时间", "任务时间", "日期", "时间"] },
  { id: "submittedAt", aliases: ["提交时间", "提交日期"] },
  { id: "docType", aliases: ["业务", "类型", "单据类型", "业务类型"] },
  { id: "advice", aliases: ["建议", "ai建议", "AI建议", "审批建议"] },
  { id: "riskLevel", aliases: ["风险", "风险等级"] },
  { id: "attachments", aliases: ["附件", "文件"] },
  { id: "tags", aliases: ["标签", "智能标签", "业务标签"] },
  { id: "status", aliases: ["状态"] },
  { id: "actions", aliases: ["操作", "动作", "按钮"] },
  { id: "amount", aliases: ["金额", "合同金额", "付款金额", "报销金额"] },
  { id: "supplier", aliases: ["供应商", "厂商", "客户"] },
  { id: "budget", aliases: ["预算", "预算字段"] },
  { id: "department", aliases: ["部门", "申请部门", "所属部门"] },
];

export function parseViewCommand(input, visibleColumnIds, availableColumns = DEFAULT_VIEW_COLUMNS) {
  const compact = String(input || "").trim().replace(/\s+/g, "");
  const availableById = new Map(availableColumns.map((column) => [column.id, column]));
  const matchedIds = FIELD_ALIASES
    .filter((entry) => entry.aliases.some((alias) => compact.includes(alias)))
    .map((entry) => entry.id);
  const uniqueIds = [...new Set(matchedIds)].filter((id) => availableById.has(id));
  const patch = {};
  const summaries = [];

  const wantsHide = /(隐藏|移除|删除|去掉|不显示|不要显示)/.test(compact);
  const wantsShow = /(显示|展示|增加|加入|加上|补充|打开)/.test(compact);
  if (uniqueIds.length > 0 && (wantsShow || wantsHide)) {
    patch.visibleColumnIds = wantsHide
      ? visibleColumnIds.filter((id) => !uniqueIds.includes(id) || availableById.get(id)?.locked)
      : [...new Set([...visibleColumnIds, ...uniqueIds])];
    summaries.push(
      wantsHide
        ? `隐藏 ${uniqueIds.map((id) => availableById.get(id)?.label || id).join("、")}`
        : `显示 ${uniqueIds.map((id) => availableById.get(id)?.label || id).join("、")}`
    );
  }

  if (/(排序|排个序|优先)/.test(compact)) {
    if (/(风险|重要|优先级)/.test(compact)) {
      patch.sortId = "importance-desc";
      summaries.push("按风险优先排序");
    } else if (/(提交)/.test(compact)) {
      patch.sortId = "submitted-desc";
      summaries.push("按提交时间倒序");
    } else if (/(时间|日期|到手|接收|收到)/.test(compact)) {
      patch.sortId = "received-desc";
      summaries.push("按到手时间倒序");
    } else if (/(建议|AI|ai)/.test(compact)) {
      patch.sortId = "advice-desc";
      summaries.push("按 AI 建议排序");
    } else if (/(标题|任务|名称)/.test(compact)) {
      patch.sortId = "title-asc";
      summaries.push("按标题排序");
    }
  }

  if (/(分组|按类型|按业务)/.test(compact)) {
    patch.groupBy = /(风险)/.test(compact) ? "risk" : "docType";
    summaries.push(patch.groupBy === "risk" ? "按风险分组" : "按业务类型分组");
  }

  if (/(不分组|取消分组|平铺)/.test(compact)) {
    patch.groupBy = "none";
    summaries.push("取消分组");
  }

  if (/(只看|筛选|过滤|关注)/.test(compact)) {
    if (/(高风险|重要|拒绝)/.test(compact)) {
      patch.focusId = "high";
      summaries.push("只看重要任务");
    } else if (/(低风险|建议通过|可通过|常规)/.test(compact)) {
      patch.focusId = "low";
      summaries.push("只看建议通过任务");
    } else if (/(中风险|需关注|谨慎)/.test(compact)) {
      patch.focusId = "attention";
      summaries.push("只看需关注任务");
    } else if (/(附件|文件)/.test(compact)) {
      patch.focusId = "attachments";
      summaries.push("只看有附件任务");
    }

    const docTypeMatch = compact.match(/只看(.+?)(单|申请|合同|报销|采购|付款|招聘|入库|上线)/);
    const docTypeValue = docTypeMatch?.[1] && docTypeMatch[1].length <= 8 ? `${docTypeMatch[1]}${docTypeMatch[2]}` : "";
    if (docTypeValue && !["高风险", "低风险", "重要", "需关注", "建议通过"].some((word) => docTypeValue.includes(word))) {
      patch.smartFilter = { kind: "docType", value: docTypeValue };
      summaries.push(`只看 ${docTypeValue}`);
    }
  }

  if (/(待办|未处理)/.test(compact) && /(只看|切到|打开|显示)/.test(compact)) {
    patch.scopeId = "pending";
    summaries.push("切到待办");
  }
  if (/(已办|已处理)/.test(compact) && /(只看|切到|打开|显示)/.test(compact)) {
    patch.scopeId = "done";
    summaries.push("切到已办");
  }

  if (summaries.length > 0) {
    return { status: "ready", summary: summaries.join("，"), patch };
  }

  const likelyConfigRequest = /(字段|列|列表|表格|显示|隐藏|排序|筛选|只看)/.test(compact);
  return {
    status: "unknown",
    summary: likelyConfigRequest ? "我还不能确定要调整哪个字段。" : "我会把这条消息交给 YonWork 处理当前任务。",
    candidates: likelyConfigRequest ? availableColumns.filter((column) => !column.locked).slice(0, 8) : undefined,
  };
}
