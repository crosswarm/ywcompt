#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SUPPORTED_FORMATS } from "./display-format.mjs";
import { validateConfig } from "./config-schema-validator.mjs";
import { getDisplayKey, getCellValue } from "./table-view-builder.mjs";
import { loadUiConfig } from "./ui-config.mjs";
import { loadTableViewConfig } from "./table-view-config.mjs";
import { loadCardViewConfig } from "./card-view-config.mjs";
import { loadDetailCardConfig } from "./detail-card-config.mjs";
import { normalizeInbox, normalizeDetail } from "../web/normalize.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(__dirname, "..");
const BUILTIN_OPTIONAL_FIELD_IDS = new Set([
  "title",
  "submitter",
  "submittedAt",
  "docType",
  "advice",
  "riskLevel",
  "attachments",
  "tags",
  "actions",
  "status",
]);

function isMainModule(metaUrl) {
  return process.argv[1] && fileURLToPath(metaUrl) === process.argv[1];
}

function readJson(file, fallback = {}) {
  if (!file || !existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

export function readUserConfig(file) {
  if (!file || !existsSync(file)) return { missing: true, error: null, value: undefined };
  try {
    return { missing: false, error: null, value: JSON.parse(readFileSync(file, "utf-8")) };
  } catch (error) {
    return { missing: false, error: error?.message || String(error), value: undefined };
  }
}

function add(list, code, message, meta = {}) {
  list.push({ code, message, ...meta });
}

function isMissingConfig(value) {
  return value === undefined || (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

function collectSchemaErrors(rawConfigs = {}, rawUiConfig = {}) {
  const errors = [];
  const checks = [
    ["table-view", rawConfigs.tableView, "table-view.config.json"],
    ["card-view", rawConfigs.cardView, "card-view.config.json"],
    ["detail-card-view", rawConfigs.detailCardView, "detail-card-view.config.json"],
    ["ui-config", rawUiConfig, "ui.config.json"],
  ];
  for (const [name, value, file] of checks) {
    if (isMissingConfig(value)) continue;
    const report = validateConfig(name, value);
    for (const err of report.errors) {
      errors.push({ code: "schema-error", file, path: err.path, message: err.message });
    }
  }
  return errors;
}

function allConfiguredFields({ tableConfig = {}, cardConfig = {}, detailCardConfig = {} } = {}) {
  const fields = [];
  for (const field of tableConfig.defaultColumns || []) fields.push({ surface: "table", groupKey: "default", field });
  for (const [groupKey, group] of Object.entries(tableConfig.groups || {})) {
    for (const field of group.columns || []) fields.push({ surface: "table", groupKey, field });
  }
  for (const field of cardConfig.defaultFields || []) fields.push({ surface: "card", groupKey: "default", field });
  for (const [groupKey, group] of Object.entries(cardConfig.groups || {})) {
    for (const field of group.fields || []) fields.push({ surface: "card", groupKey, field });
  }
  for (const [groupKey, group] of Object.entries(detailCardConfig.groups || {})) {
    for (const section of group.sections || []) {
      for (const field of section.fields || []) fields.push({ surface: "detail", groupKey, sectionId: section.id, field });
    }
  }
  return fields;
}

function readItems(dataDir) {
  const state = readJson(join(dataDir, "inbox.json"), null);
  if (!state) return [];
  const data = normalizeInbox(state);
  return Array.isArray(data?.items) ? data.items : [];
}

function readDetailsById(dataDir, items = []) {
  const detailsById = new Map();
  for (const item of items) {
    const id = item.id || item.primaryId;
    if (!id) continue;
    const detail = readJson(join(dataDir, "details", `${id}.json`), null);
    if (detail) detailsById.set(id, normalizeDetail(detail, item));
  }
  return detailsById;
}

function collectFieldWarnings(configs, items, detailsById) {
  const warnings = [];
  const configured = allConfiguredFields(configs);
  const sampleByGroup = new Map();
  for (const item of items) {
    const key = getDisplayKey(item, {});
    if (!sampleByGroup.has(key)) sampleByGroup.set(key, item);
  }

  for (const { surface, groupKey, sectionId, field } of configured) {
    if (field.format && !SUPPORTED_FORMATS.has(field.format)) {
      add(warnings, "unsupported-format", `${surface} 字段 ${field.id} 使用了未支持的格式 ${field.format}`, { groupKey, sectionId, fieldId: field.id });
    }
    if (groupKey !== "default" && !sampleByGroup.has(groupKey)) {
      add(warnings, "group-not-hit", `分组 ${groupKey} 当前样本未命中`, { groupKey, surface });
      continue;
    }
    if (BUILTIN_OPTIONAL_FIELD_IDS.has(field.id)) continue;
    const samples = groupKey === "default"
      ? items.slice(0, 20)
      : [sampleByGroup.get(groupKey)].filter(Boolean);
    if (!samples.length) continue;
    const hasAnyValue = samples.some((sample) => {
      const detail = detailsById.get(sample.id || sample.primaryId) || null;
      const value = getCellValue(sample, field, detail);
      return value != null && value !== "" && value !== "-";
    });
    if ((field.path || field.fieldId || field.fieldLabel || field.detailPath) && !hasAnyValue) {
      add(warnings, "field-empty-on-sample", `${surface} 字段 ${field.id} 在当前样本上为空`, { groupKey, sectionId, fieldId: field.id });
    }
  }
  return warnings;
}

export function runUiConfigDiagnostics({
  configDir = join(SKILL_DIR, "config"),
  dataDir = join(SKILL_DIR, "data"),
} = {}) {
  const userUi = readUserConfig(join(dataDir, "ui.config.json"));
  const loads = {
    tableView: readUserConfig(join(dataDir, "table-view.config.json")),
    cardView: readUserConfig(join(dataDir, "card-view.config.json")),
    detailCardView: readUserConfig(join(dataDir, "detail-card-view.config.json")),
  };
  const configLoadErrors = [];
  if (userUi.error) add(configLoadErrors, "config-parse-error", userUi.error, { file: "ui.config.json" });
  for (const [key, result] of Object.entries(loads)) {
    if (result.error) add(configLoadErrors, "config-parse-error", result.error, { file: `${key}.config.json` });
  }

  const uiConfig = loadUiConfig({
    defaultConfigFile: join(configDir, "ui.json"),
    userConfigFile: join(dataDir, "ui.config.json"),
  });
  const tableConfig = loadTableViewConfig({
    defaultConfigFile: join(configDir, "table-view.json"),
    userConfigFile: join(dataDir, "table-view.config.json"),
  });
  const cardConfig = loadCardViewConfig({
    defaultConfigFile: join(configDir, "card-view.json"),
    userConfigFile: join(dataDir, "card-view.config.json"),
  });
  const detailCardConfig = loadDetailCardConfig({
    defaultConfigFile: join(configDir, "detail-card-view.json"),
    userConfigFile: join(dataDir, "detail-card-view.config.json"),
  });
  const items = readItems(dataDir);
  const detailsById = readDetailsById(dataDir, items);
  const schemaErrors = collectSchemaErrors({
    tableView: loads.tableView.value,
    cardView: loads.cardView.value,
    detailCardView: loads.detailCardView.value,
  }, userUi.value);
  const warnings = collectFieldWarnings({ tableConfig, cardConfig, detailCardConfig }, items, detailsById);

  return {
    ok: configLoadErrors.length === 0 && schemaErrors.length === 0,
    configDir,
    dataDir,
    itemCount: items.length,
    uiConfig,
    errors: [...configLoadErrors, ...schemaErrors],
    warnings,
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config-dir") options.configDir = argv[++index];
    else if (arg === "--data-dir" || arg === "--data") options.dataDir = argv[++index];
    else if (arg === "--report-file") options.reportFile = argv[++index];
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = runUiConfigDiagnostics(options);
  const body = JSON.stringify(report, null, 2);
  if (options.reportFile) writeFileSync(options.reportFile, `${body}\n`);
  process.stdout.write(`${body}\n`);
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
