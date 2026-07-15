import { existsSync, readFileSync } from "node:fs";

export const EMPTY_PERSONAL_RULES_CONFIG = Object.freeze({
  version: 1,
  enabled: true,
  rules: [],
  fieldDisplay: {
    enabled: true,
    instructions: "",
    pinnedFields: [],
    collapsedFields: [],
    hiddenFields: [],
  },
});

function readJson(file, fallback = null) {
  if (!file || !existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

export function loadPersonalRulesConfig({ userConfigFile } = {}) {
  const raw = readJson(userConfigFile, null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...EMPTY_PERSONAL_RULES_CONFIG, rules: [], fieldDisplay: { ...EMPTY_PERSONAL_RULES_CONFIG.fieldDisplay } };
  }
  return {
    version: Number(raw.version) || 1,
    enabled: raw.enabled !== false,
    rules: Array.isArray(raw.rules) ? raw.rules : [],
    fieldDisplay: normalizeFieldDisplay(raw.fieldDisplay),
  };
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function normalizeFieldDisplay(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_PERSONAL_RULES_CONFIG.fieldDisplay };
  }
  return {
    enabled: value.enabled !== false,
    instructions: String(value.instructions || "").trim(),
    pinnedFields: normalizeStringArray(value.pinnedFields),
    collapsedFields: normalizeStringArray(value.collapsedFields),
    hiddenFields: normalizeStringArray(value.hiddenFields),
  };
}

function itemSearchText(item = {}) {
  return [
    item.billnum,
    item.serviceCode,
    item.sourceServiceCode,
    item.serviceName,
    item.docType,
    item.title,
    item.webUrl,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function matchingPersonalRules(item, config = EMPTY_PERSONAL_RULES_CONFIG) {
  if (config?.enabled === false || !Array.isArray(config?.rules)) return [];
  const haystack = itemSearchText(item);
  return config.rules
    .filter((rule) => {
      if (!rule || rule.enabled === false || !rule.ruleName || !rule.checkpoint) return false;
      const matches = Array.isArray(rule.match) ? rule.match.filter(Boolean) : [];
      return matches.length === 0 || matches.some((keyword) => haystack.includes(String(keyword).toLowerCase()));
    })
    .map((rule) => ({
      id: rule.id,
      ruleName: rule.ruleName,
      checkpoint: rule.checkpoint,
      ...(rule.severityHint ? { severityHint: rule.severityHint } : {}),
      ...(rule.suggestion ? { suggestion: rule.suggestion } : {}),
      source: "personal",
    }));
}

export function applyPersonalRules(profile, item, config) {
  const personalRules = matchingPersonalRules(item, config);
  return {
    ...(profile || {}),
    businessRules: [...(Array.isArray(profile?.businessRules) ? profile.businessRules : []), ...personalRules],
    personalRuleCount: personalRules.length,
  };
}

export function fieldDisplayPreferences(config = EMPTY_PERSONAL_RULES_CONFIG) {
  if (config?.fieldDisplay?.enabled === false) return {};
  return config?.fieldDisplay || {};
}
