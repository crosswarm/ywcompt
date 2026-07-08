import { getCellValue, getDisplayKey } from "./table-view-builder.mjs";
import { formatDisplayValue } from "./display-format.mjs";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function mergeDetailCardConfig(defaultConfig = {}, userConfig = {}) {
  const merged = {
    ...clone(defaultConfig),
    ...clone(userConfig),
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
    if (userConfig.groups?.[key]?.sections) {
      merged.groups[key].sections = clone(userConfig.groups[key].sections);
    } else if (defaultConfig.groups?.[key]?.sections) {
      merged.groups[key].sections = clone(defaultConfig.groups[key].sections);
    }
  }

  return merged;
}

function getGroupConfig(config = {}, key) {
  return config.groups?.[key] || config.groups?.default || null;
}

export function buildDetailCardFields(item = {}, detail = {}, config = {}, displayHints = {}) {
  const key = getDisplayKey(item, displayHints);
  const group = getGroupConfig(config, key);
  if (!group || !Array.isArray(group.sections)) return [];

  return group.sections.map((section) => {
    const fields = (section.fields || []).map((field) => {
      const value = getDetailFieldValue(item, detail, field);
      return {
        id: field.id || field.path || field.detailPath || field.fieldId || field.fieldLabel || "field",
        label: field.label || field.fieldLabel || field.fieldId || field.id || field.path || "字段",
        value,
        full: field.full === true,
      };
    }).filter((field) => field.value != null && field.value !== "" && field.value !== "-");

    return {
      id: section.id || section.title || "section",
      title: section.title || "基本信息",
      fields,
    };
  }).filter((section) => section.fields.length > 0);
}

function getPathValue(root, path) {
  if (!path) return undefined;
  return String(path).split(".").reduce((current, segment) => {
    if (current == null) return undefined;
    const match = segment.match(/^(.+)\[(\d+)]$/);
    if (match) {
      const base = current?.[match[1]];
      return Array.isArray(base) ? base[Number(match[2])] : undefined;
    }
    return current?.[segment];
  }, root);
}

function formatValue(value, field = {}) {
  return formatDisplayValue(value, field);
}

function getDetailFieldValue(item, detail, field) {
  if (field.detailPath) return formatValue(getPathValue(detail, field.detailPath), field);
  return getCellValue(item, field, detail);
}
