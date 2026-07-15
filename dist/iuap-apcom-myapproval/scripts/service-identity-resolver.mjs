import {
  isBipCliFailure,
  runBipCli as defaultRunBipCli,
} from "./bip-cli-client.mjs";

const COMMAND_PATH = ["auth", "permission", "apply"];
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_CONCURRENCY = 4;
export const SERVICE_NAME_PROVIDER = "iuap-apcom-cli.auth.permission.apply";
const LEGACY_SERVICE_NAME_PROVIDER = "bip-cli.auth.permission.apply";

function cleanText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function localizedText(value) {
  if (typeof value === "string" || typeof value === "number") return cleanText(value);
  if (!value || typeof value !== "object") return "";
  return cleanText(value.zh_CN || value.text || value.name || value.en_US || value.zh_TW);
}

export function normalizeServiceNameSource(value) {
  const source = cleanText(value);
  if (source === LEGACY_SERVICE_NAME_PROVIDER) return SERVICE_NAME_PROVIDER;
  if (source === SERVICE_NAME_PROVIDER || source === "todo") return source;
  return "";
}

function trustedTodoServiceName(value, ...serviceCodes) {
  const serviceName = localizedText(value);
  if (!serviceName) return "";
  const normalizedCodes = serviceCodes
    .map((code) => cleanText(code).toLowerCase())
    .filter(Boolean);
  if (normalizedCodes.includes(serviceName.toLowerCase())) return "";
  // 只拒绝带明确标识符特征的值；Salesforce 等单词型英文业务名仍然可信。
  if (!/[一-龥\s]/.test(serviceName)
    && (/[_./:]/.test(serviceName) || /\d/.test(serviceName))) return "";
  return serviceName;
}

function queryValue(rawUrl, names) {
  const value = cleanText(rawUrl);
  if (!value) return "";

  let params;
  try {
    params = new URL(value).searchParams;
  } catch {
    params = new URLSearchParams(value.split("?").slice(1).join("?"));
  }

  const normalizedNames = new Set(names.map((name) => name.toLowerCase()));
  for (const [key, entryValue] of params.entries()) {
    if (normalizedNames.has(key.toLowerCase())) return cleanText(entryValue);
  }
  return "";
}

function itemUrls(item = {}) {
  return [item.webUrl, item.mUrl, item.originalUrl, item.url];
}

/**
 * 提取待办中权限服务查询使用的原始编码。
 * 保留原值，不做 `list` 等启发式裁剪。
 */
export function extractSourceServiceCode(item = {}) {
  const direct = cleanText(item.sourceServiceCode || item.serviceCode);
  if (direct) return direct;

  for (const rawUrl of itemUrls(item)) {
    const fromUrl = queryValue(rawUrl, ["serviceCode"]);
    if (fromUrl) return fromUrl;
  }
  return "";
}

function extractTransType(item = {}) {
  const businessData = item.businessData && typeof item.businessData === "object"
    ? item.businessData
    : {};
  const direct = cleanText(
    item.transType
      || item.transtype
      || item.transTypeCode
      || businessData.transType
      || businessData.transtype
      || businessData.transTypeCode,
  );
  if (direct) return direct;

  for (const rawUrl of itemUrls(item)) {
    const fromUrl = queryValue(rawUrl, ["transType", "transtype", "transTypeCode"]);
    if (fromUrl) return fromUrl;
  }
  return "";
}

function directTodoResolution(item, sourceServiceCode) {
  const serviceName = trustedTodoServiceName(item?.serviceName, sourceServiceCode);
  // 已落盘记录带来源标记，必须重新查询；否则会把跨同步旧值误当作本轮 todo 原始值。
  if (!serviceName || cleanText(item?.serviceNameSource)) return null;
  const transType = extractTransType(item);
  const prefix = transType ? `${transType}_` : "";
  const canStripExplicitPrefix = prefix
    && sourceServiceCode.startsWith(prefix)
    && sourceServiceCode.length > prefix.length;
  const serviceCode = canStripExplicitPrefix
    ? sourceServiceCode.slice(prefix.length)
    : sourceServiceCode;
  const resolution = {
    serviceCode,
    serviceName,
    serviceNameSource: "todo",
  };
  if (serviceCode !== sourceServiceCode) resolution.sourceServiceCode = sourceServiceCode;
  return resolution;
}

function unresolvedResolution(sourceServiceCode) {
  return {
    serviceCode: sourceServiceCode,
    serviceName: "",
  };
}

function cliPayload(result) {
  if (!result || typeof result !== "object") return null;
  if (isBipCliFailure(result)) return null;
  if (result.data && typeof result.data === "object" && !Array.isArray(result.data)) {
    return { ...result.data, ...result };
  }
  return result;
}

function cliResolution(result, queriedCode, sourceServiceCode) {
  const payload = cliPayload(result);
  const serviceName = trustedTodoServiceName(
    payload?.serviceName,
    sourceServiceCode,
    queriedCode,
    payload?.serviceCode,
  );
  if (!payload || !serviceName) return null;

  const serviceCode = cleanText(payload.serviceCode) || queriedCode;
  const resolution = {
    serviceCode,
    serviceName,
    serviceNameSource: SERVICE_NAME_PROVIDER,
  };
  if (serviceCode !== sourceServiceCode) resolution.sourceServiceCode = sourceServiceCode;
  return resolution;
}

async function queryServiceIdentity(sourceServiceCode, transType, runBipCli, timeoutMs) {
  const query = async (service) => {
    try {
      const result = await runBipCli(COMMAND_PATH, { service }, { timeoutMs });
      return cliResolution(result, service, sourceServiceCode);
    } catch {
      return null;
    }
  };

  const exact = await query(sourceServiceCode);
  if (exact) return exact;

  const prefix = transType ? `${transType}_` : "";
  if (!prefix || !sourceServiceCode.startsWith(prefix)) {
    return unresolvedResolution(sourceServiceCode);
  }

  const suffix = sourceServiceCode.slice(prefix.length);
  if (!suffix) return unresolvedResolution(sourceServiceCode);
  return (await query(suffix)) || unresolvedResolution(sourceServiceCode);
}

function boundedConcurrency(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return MAX_CONCURRENCY;
  return Math.min(parsed, MAX_CONCURRENCY);
}

/**
 * 将解析出的服务身份应用到单据副本。
 * `sourceServiceCode` 只在规范编码与原始编码不同时保留。
 */
export function applyServiceIdentity(item = {}, resolution = null) {
  const next = { ...item };
  const sourceServiceCode = extractSourceServiceCode(item);
  const chosen = resolution || directTodoResolution(item, sourceServiceCode);
  const chosenServiceName = localizedText(chosen?.serviceName);

  // 解析失败时保留历史完整身份；新记录则只补原始 serviceCode，不制造名称或来源。
  if (!chosenServiceName) {
    const existingServiceName = trustedTodoServiceName(
      next.serviceName,
      sourceServiceCode,
      next.serviceCode,
    );
    const historicalSource = normalizeServiceNameSource(next.serviceNameSource);
    const canPreserveHistoricalName = existingServiceName && historicalSource;
    if (!canPreserveHistoricalName) {
      delete next.serviceName;
      delete next.serviceNameSource;
    } else {
      next.serviceNameSource = historicalSource;
    }
    if (!trustedTodoServiceName(next.docTypeName, sourceServiceCode, next.serviceCode)) {
      delete next.docTypeName;
    }
    if (!trustedTodoServiceName(next.displayLabel, sourceServiceCode, next.serviceCode)) {
      delete next.displayLabel;
    }
    if (!cleanText(next.serviceCode) && sourceServiceCode) next.serviceCode = sourceServiceCode;
    if (next.sourceServiceCode && next.sourceServiceCode === next.serviceCode) delete next.sourceServiceCode;
    return next;
  }

  const serviceCode = cleanText(chosen?.serviceCode) || sourceServiceCode;
  const serviceName = chosenServiceName;
  const serviceNameSource = normalizeServiceNameSource(chosen?.serviceNameSource);

  if (serviceCode) next.serviceCode = serviceCode;
  if (serviceName) next.serviceName = serviceName;
  if (serviceName && serviceNameSource) next.serviceNameSource = serviceNameSource;
  else delete next.serviceNameSource;

  const resolutionSource = cleanText(chosen?.sourceServiceCode);
  const differingSource = resolutionSource && resolutionSource !== serviceCode
    ? resolutionSource
    : sourceServiceCode && sourceServiceCode !== serviceCode
      ? sourceServiceCode
      : "";
  if (differingSource) next.sourceServiceCode = differingSource;
  else delete next.sourceServiceCode;

  return next;
}

/**
 * 批量解析权限服务名称；同一原始编码只查询一次，CLI 查询并发最大为 4。
 * 单个查询失败会产生 unresolved 结果，不中断整批处理。
 */
export async function resolveServiceIdentities(items = [], options = {}) {
  const inputItems = Array.isArray(items) ? items : [];
  const groups = new Map();

  for (const item of inputItems) {
    const sourceServiceCode = extractSourceServiceCode(item);
    if (!sourceServiceCode) continue;

    let group = groups.get(sourceServiceCode);
    if (!group) {
      group = {
        sourceServiceCode,
        transType: "",
        directResolution: null,
      };
      groups.set(sourceServiceCode, group);
    }
    if (!group.transType) group.transType = extractTransType(item);
    if (!group.directResolution) {
      group.directResolution = directTodoResolution(item, sourceServiceCode);
    }
  }

  const bySourceCode = new Map();
  const pending = [];
  for (const group of groups.values()) {
    if (group.directResolution) bySourceCode.set(group.sourceServiceCode, group.directResolution);
    else pending.push(group);
  }

  const runBipCli = typeof options.runBipCli === "function"
    ? options.runBipCli
    : defaultRunBipCli;
  const parsedTimeoutMs = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(parsedTimeoutMs) && parsedTimeoutMs > 0
    ? parsedTimeoutMs
    : DEFAULT_TIMEOUT_MS;
  const workerCount = Math.min(boundedConcurrency(options.concurrency), pending.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < pending.length) {
      const group = pending[cursor];
      cursor += 1;
      const resolution = await queryServiceIdentity(
        group.sourceServiceCode,
        group.transType,
        runBipCli,
        timeoutMs,
      );
      bySourceCode.set(group.sourceServiceCode, resolution);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  let resolvedCount = 0;
  let unresolvedCount = 0;
  for (const resolution of bySourceCode.values()) {
    if (localizedText(resolution.serviceName)) resolvedCount += 1;
    else unresolvedCount += 1;
  }

  return {
    bySourceCode,
    resolvedCount,
    unresolvedCount,
    provider: SERVICE_NAME_PROVIDER,
  };
}
