import { existsSync, readFileSync } from "node:fs";

import { mergeTableConfig } from "./table-view-builder.mjs";

function readJson(file, fallback = null) {
  if (!file || !existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

export function loadTableViewConfig({ defaultConfigFile, userConfigFile } = {}) {
  const defaultConfig = readJson(defaultConfigFile, { version: 1, defaultColumns: [], groups: {} });
  const userConfig = readJson(userConfigFile, {});
  return mergeTableConfig(defaultConfig, userConfig || {});
}
