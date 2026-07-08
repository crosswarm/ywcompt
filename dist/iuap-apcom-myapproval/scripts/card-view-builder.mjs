import { getCellValue, getDisplayKey } from "./table-view-builder.mjs";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function mergeCardConfig(defaultConfig = {}, userConfig = {}) {
  const merged = {
    ...clone(defaultConfig),
    ...clone(userConfig),
    defaultFields: clone(userConfig.defaultFields || defaultConfig.defaultFields || []),
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
    if (userConfig.groups?.[key]?.fields) {
      merged.groups[key].fields = clone(userConfig.groups[key].fields);
    } else if (defaultConfig.groups?.[key]?.fields) {
      merged.groups[key].fields = clone(defaultConfig.groups[key].fields);
    }
  }

  return merged;
}

function getGroupFields(config = {}, key) {
  return config.groups?.[key]?.fields || config.defaultFields || [];
}

export function buildCardSummary(item = {}, config = {}, displayHints = {}) {
  const key = getDisplayKey(item, displayHints);
  const fields = getGroupFields(config, key);
  const summary = [];

  for (const field of fields) {
    const value = getCellValue(item, field);
    if (value == null || value === "" || value === "-") continue;
    summary.push({
      id: field.id || field.path || field.fieldId || field.fieldLabel || "field",
      label: field.label || field.fieldLabel || field.fieldId || field.id || field.path || "字段",
      value,
      showLabel: field.showLabel !== false,
    });
  }

  return summary;
}

export function formatCardSummary(fields = []) {
  return fields
    .filter((field) => field && field.value != null && field.value !== "")
    .map((field) => field.showLabel === false ? String(field.value) : `${field.label}：${field.value}`)
    .join(" · ");
}
