/**
 * dimensions.js — 通用审批分析维度（跨所有单据类型的检查点）
 *
 * 纯数据 + 纯函数，零依赖。profile 的 commonDimensions 引用这里的 id，
 * agent-runner 组装 prompt 时据此展开为「通用维检查清单」。
 *
 * 每个维度：
 *   id        机器标识（profile 引用）
 *   name      中文名（展示 / prompt）
 *   trigger   触发条件（何时该检查；空=总是）
 *   checkpoints  检查要点（agent 据此发现规则）
 *   severityHint 命中时的建议严重度（risk|warning|passed）
 */

export const DIMENSIONS = [
  {
    id: "amount-compliance",
    name: "金额合规",
    trigger: "单据含金额字段",
    checkpoints: [
      "金额是否在审批权限/免会签阈值内",
      "是否超过岗位/职级审批额度",
      "大额是否需要双签或上级会签",
    ],
    severityHint: "risk",
  },
  {
    id: "budget-match",
    name: "预算匹配",
    trigger: "采购/费用/付款类单据",
    checkpoints: [
      "是否在已批预算/采购计划范围内",
      "预算科目是否正确、余额是否充足",
      "是否超月度/年度计划",
    ],
    severityHint: "warning",
  },
  {
    id: "attachment-completeness",
    name: "附件完整性",
    trigger: "需佐证材料的单据",
    checkpoints: [
      "必备附件是否齐全（合同/发票/报价/比价/证照）",
      "附件与单据信息是否一致",
      "盖章/签字/审核批注是否完整",
    ],
    severityHint: "warning",
  },
  {
    id: "info-consistency",
    name: "信息一致性",
    trigger: "总是",
    checkpoints: [
      "金额/数量/日期在表头与明细间是否一致",
      "申请人/部门/组织与流程是否匹配",
      "发票金额与申请/合同金额是否相符",
    ],
    severityHint: "risk",
  },
  {
    id: "approval-authority",
    name: "审批权限",
    trigger: "总是",
    checkpoints: [
      "当前审批人是否有相应权限/额度",
      "是否存在越权或单人签批高风险项",
      "审批环节是否完整（如需会签是否到位）",
    ],
    severityHint: "warning",
  },
  {
    id: "duplicate-submit",
    name: "重复提交",
    trigger: "总是",
    checkpoints: [
      "是否与历史单据重复（同供应商/同金额/同事由）",
      "是否拆单规避审批阈值",
    ],
    severityHint: "warning",
  },
  {
    id: "timeliness",
    name: "时效合规",
    trigger: "有时间/账期要求的单据",
    checkpoints: [
      "是否超合同约定账期/付款期",
      "申请/报销是否超时效（如跨期报销）",
      "发布/执行时间窗口是否合理",
    ],
    severityHint: "warning",
  },
];

const _byId = Object.fromEntries(DIMENSIONS.map((d) => [d.id, d]));

/** 按 id 取维度定义；未知返回 undefined */
export function getDimension(id) {
  return _byId[id];
}

/**
 * 把维度 id 列表展开为定义数组（过滤未知 id）。
 * @param {string[]} ids
 * @returns {Array}
 */
export function expandDimensions(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => _byId[id]).filter(Boolean);
}
