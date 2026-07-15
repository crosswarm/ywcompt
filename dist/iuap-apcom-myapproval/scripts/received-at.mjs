export const RECEIVED_AT_SOURCE = Object.freeze({
  WORKFLOW_TASK_CREATE_TIME: "workflow.task.createTime",
  MESSAGE_CENTER_CREATE_TS_LONG: "message-center.createTsLong",
  MESSAGE_CENTER_CREATE_TIME: "message-center.createTime",
  MESSAGE_CENTER_MSG_TS_LONG: "message-center.msgTsLong",
  UNAVAILABLE: "unavailable",
});

const SOURCE_RULES = [
  {
    source: RECEIVED_AT_SOURCE.WORKFLOW_TASK_CREATE_TIME,
    semantics: "task-created",
    label: "流程任务创建时间",
    values: (raw) => [raw.workflowTaskCreateTime, raw.workflowTask?.createTime, raw.task?.createTime],
  },
  {
    source: RECEIVED_AT_SOURCE.MESSAGE_CENTER_CREATE_TS_LONG,
    semantics: "message-created",
    label: "消息中心待办创建时间（近似）",
    values: (raw) => [raw.createTsLong],
  },
  {
    source: RECEIVED_AT_SOURCE.MESSAGE_CENTER_CREATE_TIME,
    semantics: "message-created",
    label: "消息中心待办创建时间（近似）",
    values: (raw) => [raw.createTime],
  },
  {
    source: RECEIVED_AT_SOURCE.MESSAGE_CENTER_MSG_TS_LONG,
    semantics: "message-timestamp",
    label: "消息生成时间（弱近似）",
    values: (raw) => [raw.msgTsLong],
  },
];

const RULE_BY_SOURCE = new Map(SOURCE_RULES.map((rule, index) => [rule.source, { ...rule, rank: index }]));
const UNAVAILABLE = Object.freeze({
  receivedAt: null,
  receivedAtSource: RECEIVED_AT_SOURCE.UNAVAILABLE,
  receivedAtSemantics: "unavailable",
  receivedAtSourceLabel: "到手时间不可用",
});

export function toIsoTimestamp(value) {
  if (value == null || value === "") return null;
  let date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value.trim()))) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    date = new Date(numeric);
  } else {
    date = new Date(String(value).trim());
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function candidateForRule(raw, rule) {
  const values = rule.values(raw);
  if (raw.receivedAtSource === rule.source) values.unshift(raw.receivedAt);
  for (const value of values) {
    const receivedAt = toIsoTimestamp(value);
    if (!receivedAt) continue;
    return {
      receivedAt,
      receivedAtSource: rule.source,
      receivedAtSemantics: rule.semantics,
      receivedAtSourceLabel: rule.label,
    };
  }
  return null;
}

export function resolveReceivedAt(raw = {}) {
  for (const rule of SOURCE_RULES) {
    const candidate = candidateForRule(raw, rule);
    if (candidate) return candidate;
  }
  return { ...UNAVAILABLE };
}

function sourceRank(metadata) {
  if (!metadata || !toIsoTimestamp(metadata.receivedAt)) return Number.POSITIVE_INFINITY;
  return RULE_BY_SOURCE.get(metadata.receivedAtSource)?.rank ?? Number.POSITIVE_INFINITY;
}

export function strongerReceivedAt(current, candidate) {
  const currentNormalized = resolveReceivedAt(current || {});
  const candidateNormalized = resolveReceivedAt(candidate || {});
  return sourceRank(candidateNormalized) < sourceRank(currentNormalized) ? candidateNormalized : currentNormalized;
}
