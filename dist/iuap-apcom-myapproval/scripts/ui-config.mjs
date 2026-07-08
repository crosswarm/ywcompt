import { existsSync, readFileSync } from "node:fs";

const VIEWS = new Set(["card", "table"]);
const THEMES = new Set(["system", "light", "mist", "dark"]);
const DENSITIES = new Set(["compact", "comfortable"]);
const TABLE_GROUP_BY = new Set(["displayGroup", "handlerId", "docType", "docTypeName", "framework", "type", "processName", "appName"]);
const GROUP_SORTS = new Set(["countDesc", "labelAsc", "default"]);
const ACTION_BARS = new Set(["selection-bar", "group-header", "both"]);
const ACTION_PLACEMENTS = new Set(["row-menu", "group-header", "selection-bar", "detail-footer"]);
const EXTERNAL_OPEN_MODES = new Set(["new-tab", "same-tab"]);
const ATTACHMENT_ICON_STYLES = new Set(["type-badge", "text", "none", "emoji"]);
const BACKGROUND_FITS = new Set(["cover", "contain"]);
const BACKGROUND_POSITIONS = new Set(["center", "top", "bottom", "left", "right"]);
const BACKGROUND_ATTACHMENTS = new Set(["fixed", "scroll"]);
const LOCAL_BACKGROUND_URL_RE = /^\/api\/ui-assets\/backgrounds\/[A-Za-z0-9._-]+\.(?:jpg|jpeg|png|webp|gif)$/i;

// 枚举单一事实源：schema (references/schemas/ui-config.schema.json) 必须与此一致。
// 见 initiative 2026-06-25-ui-config-json-schema D4（枚举防漂移互证）。
export const UI_CONFIG_ENUMS = Object.freeze({
  defaultView: [...VIEWS],
  theme: [...THEMES],
  density: [...DENSITIES],
  tableGroupBy: [...TABLE_GROUP_BY],
  tableSortGroups: [...GROUP_SORTS],
  tableActionBar: [...ACTION_BARS],
  actionPlacements: [...ACTION_PLACEMENTS],
  navigationOpenExternalBill: [...EXTERNAL_OPEN_MODES],
  attachmentsIconStyle: [...ATTACHMENT_ICON_STYLES],
  backgroundFit: [...BACKGROUND_FITS],
  backgroundPosition: [...BACKGROUND_POSITIONS],
  backgroundAttachment: [...BACKGROUND_ATTACHMENTS],
});

export const DEFAULT_UI_CONFIG = Object.freeze({
  version: 1,
  defaultView: "table",
  theme: "system",
  density: "comfortable",
  table: {
    groupBy: "displayGroup",
    sortGroups: "countDesc",
    stickyGroupHeader: true,
    actionBar: "selection-bar",
  },
  actions: {
    placements: ["row-menu", "group-header", "selection-bar", "detail-footer"],
    confirmBulk: true,
    commentPresets: ["同意", "已核对，同意", "请补充信息"],
  },
  navigation: {
    preserveQueryOnViewSwitch: true,
    openExternalBill: "new-tab",
  },
  attachments: {
    iconStyle: "type-badge",
  },
  appearance: {
    background: {
      enabled: false,
      imageUrl: "",
      fit: "cover",
      position: "center",
      attachment: "fixed",
      dim: 0.42,
      blur: 0,
      saturate: 0.9,
      panelOpacity: 0.96,
    },
  },
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function boolOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function enumOr(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function backgroundUrlOr(value, fallback) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return "";
  return LOCAL_BACKGROUND_URL_RE.test(trimmed) ? trimmed : fallback;
}

function numberInRange(value, fallback, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizePlacements(value, fallback) {
  if (!Array.isArray(value)) return clone(fallback);
  const placements = value.filter((item) => ACTION_PLACEMENTS.has(item));
  return placements.length > 0 ? placements : clone(fallback);
}

function normalizeStrings(value, fallback) {
  if (!Array.isArray(value)) return clone(fallback);
  return value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
}

export function mergeUiConfig(config = {}, fallback = DEFAULT_UI_CONFIG) {
  const table = config.table || {};
  const actions = config.actions || {};
  const navigation = config.navigation || {};
  const attachments = config.attachments || {};
  const appearance = config.appearance || {};
  const background = appearance.background || {};
  const fallbackBackground = fallback.appearance?.background || DEFAULT_UI_CONFIG.appearance.background;
  const imageUrl = backgroundUrlOr(background.imageUrl, fallbackBackground.imageUrl || "");

  return {
    version: 1,
    defaultView: enumOr(config.defaultView, VIEWS, fallback.defaultView),
    theme: enumOr(config.theme, THEMES, fallback.theme),
    density: enumOr(config.density, DENSITIES, fallback.density),
    table: {
      groupBy: enumOr(table.groupBy, TABLE_GROUP_BY, fallback.table.groupBy),
      sortGroups: enumOr(table.sortGroups, GROUP_SORTS, fallback.table.sortGroups),
      stickyGroupHeader: boolOr(table.stickyGroupHeader, fallback.table.stickyGroupHeader),
      actionBar: enumOr(table.actionBar, ACTION_BARS, fallback.table.actionBar),
    },
    actions: {
      placements: normalizePlacements(actions.placements, fallback.actions.placements),
      confirmBulk: boolOr(actions.confirmBulk, fallback.actions.confirmBulk),
      commentPresets: normalizeStrings(actions.commentPresets, fallback.actions.commentPresets),
    },
    navigation: {
      preserveQueryOnViewSwitch: boolOr(navigation.preserveQueryOnViewSwitch, fallback.navigation.preserveQueryOnViewSwitch),
      openExternalBill: enumOr(navigation.openExternalBill, EXTERNAL_OPEN_MODES, fallback.navigation.openExternalBill),
    },
    attachments: {
      iconStyle: enumOr(attachments.iconStyle, ATTACHMENT_ICON_STYLES, fallback.attachments?.iconStyle || "type-badge"),
    },
    appearance: {
      background: {
        enabled: boolOr(background.enabled, fallbackBackground.enabled) && Boolean(imageUrl),
        imageUrl,
        fit: enumOr(background.fit, BACKGROUND_FITS, fallbackBackground.fit),
        position: enumOr(background.position, BACKGROUND_POSITIONS, fallbackBackground.position),
        attachment: enumOr(background.attachment, BACKGROUND_ATTACHMENTS, fallbackBackground.attachment),
        dim: numberInRange(background.dim, fallbackBackground.dim, 0, 0.85),
        blur: numberInRange(background.blur, fallbackBackground.blur, 0, 16),
        saturate: numberInRange(background.saturate, fallbackBackground.saturate, 0, 1.4),
        panelOpacity: numberInRange(background.panelOpacity, fallbackBackground.panelOpacity, 0.72, 1),
      },
    },
  };
}

function readJson(file) {
  if (!file || !existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf-8"));
}

export function loadUiConfig({ defaultConfigFile, userConfigFile } = {}) {
  let defaults = DEFAULT_UI_CONFIG;
  try {
    defaults = mergeUiConfig(readJson(defaultConfigFile), DEFAULT_UI_CONFIG);
  } catch {
    defaults = DEFAULT_UI_CONFIG;
  }

  try {
    return mergeUiConfig(readJson(userConfigFile), defaults);
  } catch {
    return defaults;
  }
}
