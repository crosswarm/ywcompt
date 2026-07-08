import { existsSync, readFileSync } from "node:fs";

import { mergeDetailCardConfig } from "./detail-card-builder.mjs";

function readJson(file, fallback = null) {
  if (!file || !existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

export function loadDetailCardConfig({ defaultConfigFile, userConfigFile } = {}) {
  const defaultConfig = readJson(defaultConfigFile, { version: 1, groups: {} });
  const userConfig = readJson(userConfigFile, {});
  return mergeDetailCardConfig(defaultConfig, userConfig || {});
}
