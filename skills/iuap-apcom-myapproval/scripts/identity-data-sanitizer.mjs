const SENSITIVE_IDENTITY_KEYS = new Set([
  "tenantid",
  "tenantname",
  "currenttenantid",
  "currenttenantname",
  "yhtuserid",
  "userid",
  "usernameid",
  "creator",
  "creatorid",
  "modifier",
  "modifierid",
  "createdby",
  "modifiedby",
  "ytenant",
  "ytenantid",
  "profiledir",
  "proxy",
  "proxyurl",
  "authorization",
  "cookie",
  "secret",
  "accesstoken",
  "refreshtoken",
]);

const SENSITIVE_QUERY_KEYS = new Set([
  "tenantid",
  "currenttenantid",
  "yhtuserid",
  "userid",
  "adt",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
]);

function normalizedKey(value) {
  return String(value || "").replace(/[_-]/g, "").toLowerCase();
}

export function sanitizeIdentityBearingUrl(value) {
  const text = String(value || "");
  if (!text || !/[?&](?:tenantId|currentTenantId|yhtUserId|userId|adt|token|accessToken|refreshToken|authorization)=/i.test(text)) {
    return text;
  }
  try {
    const url = new URL(text);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(normalizedKey(key))) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return text
      .replace(/([?&])(?:tenantId|currentTenantId|yhtUserId|userId|adt|token|accessToken|refreshToken|authorization)=[^&#]*/gi, "$1")
      .replace(/[?&]+$/, "")
      .replace(/\?&/, "?")
      .replace(/&&+/g, "&");
  }
}

export function sanitizeStoredIdentityData(value) {
  if (Array.isArray(value)) return value.map((entry) => sanitizeStoredIdentityData(entry));
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? sanitizeIdentityBearingUrl(value) : value;
  }
  const sanitized = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_IDENTITY_KEYS.has(normalizedKey(key))) continue;
    sanitized[key] = sanitizeStoredIdentityData(entry);
  }
  return sanitized;
}
