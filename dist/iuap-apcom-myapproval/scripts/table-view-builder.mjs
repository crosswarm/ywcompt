import { getNormalizedField } from "./detail-rich/index.mjs";
import { formatDisplayValue } from "./display-format.mjs";

export const DEFAULT_GROUP_LABELS = {
  "patch.mdf": "紧急补丁",
  "data-request.iform": "数据处理申请",
  "online.iform": "上线申请",
  "expense.mdf": "报销单",
  "backend-service.ynf": "后端微服务申请",
  patch: "紧急补丁",
  "data-request": "数据处理申请",
  online: "上线申请",
  expense: "报销单",
  "backend-service": "后端微服务申请",
  other: "其他",
};

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function itemId(item = {}) {
  return item.id || item.primaryId || item.todoId || "";
}

function isGenericKey(key) {
  return /^generic\./.test(String(key || ""));
}

export function getSourceKey(item = {}) {
  if (item.displayKey) return item.displayKey;
  if (item.summary?.displayKey) return item.summary.displayKey;
  if (item.handlerId) return item.handlerId;
  if (item.docType && item.framework) return `${item.docType}.${item.framework}`;
  return item.docType || item.type || "other";
}

export function getDisplayKey(item = {}, displayHints = {}) {
  return firstText(
    displayHints.displayKey,
    displayHints.groupKey,
    item.displayKey,
    item.summary?.displayKey,
    getSourceKey(item),
  );
}

export function getDisplayLabel(item = {}, displayHints = {}, key = getDisplayKey(item, displayHints)) {
  return firstText(
    displayHints.displayLabel,
    item.displayLabel,
    item.summary?.displayLabel,
    DEFAULT_GROUP_LABELS[key],
    DEFAULT_GROUP_LABELS[String(key).split(".")[0]],
    isGenericKey(key) ? "其他" : key,
  );
}

export function getGroupKey(item = {}, displayHints = {}) {
  return getDisplayKey(item, displayHints);
}

export function mergeTableConfig(defaultConfig = {}, userConfig = {}) {
  const merged = {
    ...clone(defaultConfig),
    ...clone(userConfig),
    defaultColumns: clone(userConfig.defaultColumns || defaultConfig.defaultColumns || []),
    groups: {},
  };

  const groupKeys = new Set([
    ...Object.keys(defaultConfig.groups || {}),
    ...Object.keys(userConfig.groups || {}),
  ]);
  for (const key of groupKeys) {
    merged.groups[key] = {
      ...(defaultConfig.groups?.[key] || {}),
      ...(userConfig.groups?.[key] || {}),
    };
    if (userConfig.groups?.[key]?.columns) {
      merged.groups[key].columns = clone(userConfig.groups[key].columns);
    } else if (defaultConfig.groups?.[key]?.columns) {
      merged.groups[key].columns = clone(defaultConfig.groups[key].columns);
    }
  }

  return merged;
}

function getPathValue(item, path) {
  if (!path) return undefined;
  return String(path).split(".").reduce((current, segment) => {
    if (current == null) return undefined;
    const match = segment.match(/^(.+)\[(\d+)]$/);
    if (match) {
      const base = current?.[match[1]];
      return Array.isArray(base) ? base[Number(match[2])] : undefined;
    }
    return current?.[segment];
  }, item);
}

function findIformField(item, column) {
  const fields = item?.summary?.iformFields || [];
  if (!Array.isArray(fields)) return null;
  if (column.fieldId) {
    const matched = fields.find((field) => field.fieldId === column.fieldId);
    if (matched) return matched;
  }
  if (column.fieldLabel) {
    const matched = fields.find((field) => field.label === column.fieldLabel);
    if (matched) return matched;
  }
  return null;
}

function findDetailField(detail, column) {
  if (!detail || (!column.fieldId && !column.fieldLabel)) return null;
  return getNormalizedField(detail, column) || getNormalizedField(detail.richDetail, column);
}

export function tableConfigUsesDetailPath(config = {}) {
  const groups = Object.values(config.groups || {});
  const columnSets = [
    config.defaultColumns || [],
    ...groups.map((group) => group.columns || []),
  ];
  return columnSets.some((columns) => columns.some((column) => column?.detailPath));
}

export function resolveTableGroupKey(item = {}, { groupBy = "displayGroup" } = {}, displayHints = {}) {
  const sourceKey = getDisplayKey(item, displayHints);
  const summary = item.summary || {};
  const candidates = {
    displayGroup: sourceKey,
    displayKey: sourceKey,
    handlerId: item.handlerId,
    docType: item.docType,
    docTypeName: firstText(item.docTypeName, summary.docTypeName, summary.documentTypeName),
    framework: item.framework,
    type: item.type,
    processName: firstText(item.processName, summary.processName),
    appName: firstText(item.appName, item.app, summary.appName, summary.app),
  };
  const value = firstText(candidates[groupBy]);
  if (!value) {
    return {
      key: sourceKey,
      label: sourceKey,
      sourceKey,
      groupBy: "displayGroup",
    };
  }
  return {
    key: value,
    label: value,
    sourceKey,
    groupBy,
  };
}

function formatValue(value, column = {}, item = {}) {
  return formatDisplayValue(value, column, item);
}

function safeHttpUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

export function collectLinkCapabilities(item = {}, detail = null, displayHints = {}) {
  const links = {
    ...(detail?.links || {}),
    ...(item.links || {}),
    ...(displayHints.links || {}),
  };
  if (!links.sourceDocument && item.webUrl) {
    links.sourceDocument = { href: item.webUrl, target: "external" };
  }
  if (!links.sourceDocument && item.originalUrl) {
    links.sourceDocument = { href: item.originalUrl, target: "external" };
  }
  return links;
}

function normalizeLinkTarget(capability = {}, uiConfig = {}) {
  if (capability.target === "same-tab") return "_self";
  if (capability.target === "new-tab") return "_blank";
  if (capability.kind === "internal" || capability.target === "internal") return "_self";
  const openMode = uiConfig.navigation?.openExternalBill === "same-tab" ? "same-tab" : "new-tab";
  return openMode === "same-tab" ? "_self" : "_blank";
}

function buildCellLink(item, column = {}, uiConfig = {}, detail = null, displayHints = {}) {
  if (column.linkTo) {
    const links = collectLinkCapabilities(item, detail, displayHints);
    const capability = links[column.linkTo];
    const href = safeHttpUrl(capability?.href || capability?.url);
    if (!href) return null;
    return {
      href,
      target: normalizeLinkTarget(capability, uiConfig),
      kind: capability?.kind === "internal" || capability?.target === "internal" ? "internal" : "external",
      capability: column.linkTo,
    };
  }
  if (!column.link) return null;
  const href = safeHttpUrl(getPathValue(item, column.link));
  if (!href) return null;
  const openMode = uiConfig.navigation?.openExternalBill === "same-tab" ? "same-tab" : "new-tab";
  return {
    href,
    target: openMode === "same-tab" ? "_self" : "_blank",
    kind: column.linkTarget === "internal" ? "internal" : "external",
  };
}

export function getCellValue(item, column = {}, detail = null) {
  if (column.detailPath) {
    return formatValue(getPathValue(detail, column.detailPath), column, item);
  }
  const detailField = findDetailField(detail, column);
  if (detailField) return formatValue(detailField.displayValue ?? detailField.value, column, item);
  const field = findIformField(item, column);
  if (field) return formatValue(field.value ?? field.name, column, item);
  return formatValue(
    getPathValue(item, column.path) ?? getPathValue(item, `summary.${column.id}`) ?? item[column.id],
    column,
    item,
  );
}

function getGroupConfig(config, key) {
  return config.groups?.[key] || config.groups?.default || {
    label: DEFAULT_GROUP_LABELS[key] || DEFAULT_GROUP_LABELS[String(key || "").split(".")[0]] || "其他",
    columns: config.defaultColumns || [],
  };
}

function getDisplayHint(displayHintsById, primaryId) {
  if (!primaryId) return null;
  return displayHintsById?.get?.(primaryId) || null;
}

function getColumnsForGroup(config, sourceKey, displayHints) {
  if (Array.isArray(displayHints?.table?.columns) && displayHints.table.columns.length > 0) {
    return clone(displayHints.table.columns);
  }
  const groupConfig = getGroupConfig(config, sourceKey);
  return clone(groupConfig.columns || config.defaultColumns || []);
}

export function buildTableView({ items = [], config = {}, detailsById = new Map(), status = "inbox", lastSyncAt = null, uiConfig = {}, displayHintsById = new Map() } = {}) {
  const groupsByKey = new Map();

  for (const item of items) {
    const id = itemId(item);
    const displayHints = getDisplayHint(displayHintsById, id) || getDisplayHint(displayHintsById, item.primaryId) || {};
    const groupKey = resolveTableGroupKey(item, uiConfig.table || {}, displayHints);
    const key = groupKey.key;
    const sourceKey = groupKey.sourceKey;
    if (!groupsByKey.has(key)) {
      const groupConfig = getGroupConfig(config, sourceKey);
      const explicitGroupConfig = config.groups?.[sourceKey] || null;
      groupsByKey.set(key, {
        key,
        label: groupKey.groupBy === "displayGroup"
          ? explicitGroupConfig?.label || getDisplayLabel(item, displayHints, sourceKey)
          : groupKey.label,
        sourceKey,
        groupBy: groupKey.groupBy,
        columns: getColumnsForGroup(config, sourceKey, displayHints),
        rows: [],
      });
    }

    const group = groupsByKey.get(key);
    const cells = {};
    const cellLinks = {};
    const detail = detailsById.get?.(id) || detailsById.get?.(item.primaryId) || null;
    for (const column of group.columns) {
      cells[column.id] = getCellValue(item, column, detail);
      const link = buildCellLink(item, column, uiConfig, detail, displayHints);
      if (link) cellLinks[column.id] = link;
    }
    group.rows.push({
      id,
      primaryId: item.primaryId || id,
      type: item.type || null,
      docType: item.docType || null,
      framework: item.framework || null,
      handlerId: item.handlerId || null,
      sourceKey,
      cells,
      cellLinks,
    });
  }

  const groups = [...groupsByKey.values()].map((group) => ({
    ...group,
    count: group.rows.length,
  }));

  return {
    lastSyncAt,
    status,
    total: items.length,
    groups,
  };
}
