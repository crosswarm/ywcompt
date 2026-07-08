import { existsSync, readFileSync } from "node:fs";

import { mergeCardConfig } from "./card-view-builder.mjs";

function readJson(file, fallback = null) {
  if (!file || !existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

export function loadCardViewConfig({ defaultConfigFile, userConfigFile } = {}) {
  const defaultConfig = readJson(defaultConfigFile, { version: 1, defaultFields: [], groups: {} });
  const userConfig = readJson(userConfigFile, {});
  return mergeCardConfig(defaultConfig, userConfig || {});
}
