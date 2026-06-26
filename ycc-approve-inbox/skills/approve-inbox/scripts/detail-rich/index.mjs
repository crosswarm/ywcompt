export const DETAIL_RICH_SCHEMA_VERSION = 2;

const INTERNAL_FIELD_IDS = new Set([
  "dr",
  "sysversion",
  "pk_temp",
  "pk_procdef",
  "pk_procdefins",
  "ytenant_id",
  "tenantid",
  "tenant_id",
  "id",
  "pubts",
  "createuser",
  "creator",
  "modifier",
  "startdept",
  "startorg",
  "status",
  "version",
  "modifydate",
  "isWfControlled",
  "verifystate",
]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function compactObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined && value !== ""));
}

function normalizeOptions(options) {
  if (!Array.isArray(options) || options.length === 0) return undefined;
  return options
    .map((option) => {
      if (!isPlainObject(option)) return null;
      const value = option.value ?? option.id ?? option.selectionId ?? option.code ?? option.key;
      const label = option.label ?? option.name ?? option.caption ?? option.title;
      if (value == null || label == null) return null;
      return { value: String(value), label: String(label) };
    })
    .filter(Boolean);
}

function normalizeFieldMeta(fieldId, meta = {}, labelFallback = "") {
  if (!fieldId) return null;
  const label = meta.label || meta.title || meta.caption || meta.name || labelFallback || "";
  return compactObject({
    fieldId,
    label,
    controlType: meta.controlType || meta.componentKey || meta.type,
    dataType: meta.dataType || meta.bizType,
    section: meta.section,
    required: typeof meta.required === "boolean" ? meta.required : undefined,
    visible: typeof meta.visible === "boolean" ? meta.visible : undefined,
    editable: typeof meta.editable === "boolean" ? meta.editable : undefined,
    enumType: meta.enumType,
    refCode: meta.refCode,
    refType: meta.refType,
    dataSourceAlias: meta.dataSourceAlias,
    options: normalizeOptions(meta.options),
  });
}

function normalizeFieldMetaMap(fieldMetadata = {}, fieldLabels = {}) {
  const fields = {};
  const ids = new Set([...Object.keys(fieldLabels || {}), ...Object.keys(fieldMetadata || {})]);
  for (const fieldId of ids) {
    const meta = normalizeFieldMeta(fieldId, fieldMetadata[fieldId] || {}, fieldLabels[fieldId]);
    if (meta) fields[fieldId] = meta;
  }
  return fields;
}

function displayPrimitive(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function getIformValue(entry) {
  if (!isPlainObject(entry)) return { rawValue: entry, displayValue: entry };
  return {
    rawValue: entry.pk ?? entry.value ?? entry.id ?? entry.code ?? entry.name,
    displayValue: entry.name || entry.displayName || entry.value || entry.label || entry.pk,
  };
}

function getObjectValue(data, fieldId) {
  const rawValue = data?.[fieldId];
  if (Array.isArray(rawValue)) {
    const display = rawValue.map((item) => {
      if (isPlainObject(item)) return item.name || item.displayName || item.label || item.value || item.code || "";
      return displayPrimitive(item);
    }).filter(Boolean).join("、");
    return { rawValue, displayValue: display };
  }
  if (isPlainObject(rawValue)) {
    return {
      rawValue: rawValue.id ?? rawValue.pk ?? rawValue.value ?? rawValue.code ?? rawValue.name,
      displayValue: rawValue.name || rawValue.displayName || rawValue.label || rawValue.title || rawValue.value || rawValue.code,
    };
  }
  return {
    rawValue,
    displayValue: data?.[`${fieldId}_$name`] ?? data?.[`${fieldId}_name`] ?? rawValue,
  };
}

function isDisplayableValue(value) {
  return displayPrimitive(value) !== "";
}

function makeNormalizedField({ fieldId, rawPath, rawValue, displayValue, meta = {} }) {
  if (meta.options && rawValue != null) {
    const matched = meta.options.find((option) => String(option.value) === String(rawValue));
    if (matched) displayValue = matched.label;
  }
  if (!isDisplayableValue(displayValue)) return null;
  return compactObject({
    fieldId,
    rawPath,
    label: meta.label || fieldId,
    name: meta.label || fieldId,
    value: String(displayValue),
    rawValue,
    displayValue: String(displayValue),
    controlType: meta.controlType,
    dataType: meta.dataType,
    section: meta.section,
    required: meta.required,
    visible: meta.visible,
    editable: meta.editable,
    enumType: meta.enumType,
    refCode: meta.refCode,
    refType: meta.refType,
    dataSourceAlias: meta.dataSourceAlias,
    options: meta.options,
  });
}

function buildById(fields) {
  return Object.fromEntries(fields.map((field, index) => [field.fieldId, index]));
}

function buildSections(fields) {
  const byTitle = new Map();
  for (const field of fields) {
    if (!field.section) continue;
    if (!byTitle.has(field.section)) {
      byTitle.set(field.section, { id: `section-${byTitle.size + 1}`, label: field.section, fieldIds: [] });
    }
    byTitle.get(field.section).fieldIds.push(field.fieldId);
  }
  return [...byTitle.values()];
}

function buildEnumMap(metaFields) {
  const enums = {};
  for (const [fieldId, meta] of Object.entries(metaFields)) {
    if (meta.enumType || meta.options) {
      enums[fieldId] = compactObject({ enumType: meta.enumType, options: meta.options });
    }
  }
  return enums;
}

function normalizeIformFields(iformData, metaFields) {
  const fields = [];
  const head = iformData?.head || {};
  const ids = new Set([...Object.keys(metaFields), ...Object.keys(head)]);
  for (const fieldId of ids) {
    if (INTERNAL_FIELD_IDS.has(fieldId)) continue;
    const { rawValue, displayValue } = getIformValue(head[fieldId]);
    const field = makeNormalizedField({
      fieldId,
      rawPath: `iformData.head.${fieldId}`,
      rawValue,
      displayValue,
      meta: metaFields[fieldId],
    });
    if (field) fields.push(field);
  }
  return fields;
}

function normalizeObjectFields(data, metaFields, sourcePath) {
  const fields = [];
  const source = data?.head || data?.data || data || {};
  const ids = new Set([
    ...Object.keys(metaFields),
    ...Object.keys(source).filter((key) => !key.endsWith("_$name") && !key.endsWith("_name")),
  ]);
  for (const fieldId of ids) {
    if (fieldId.startsWith("_") || INTERNAL_FIELD_IDS.has(fieldId)) continue;
    const { rawValue, displayValue } = getObjectValue(source, fieldId);
    const field = makeNormalizedField({
      fieldId,
      rawPath: `${sourcePath}.${fieldId}`,
      rawValue,
      displayValue,
      meta: metaFields[fieldId],
    });
    if (field) fields.push(field);
  }
  return fields;
}

export function createRichDetail({
  primaryId,
  type,
  docType,
  framework,
  handlerId,
  handlerSource,
  fetchedAt,
  billDetail = null,
  iformData = null,
  fieldLabels = {},
  fieldMetadata = {},
} = {}) {
  if (!billDetail && !iformData) return null;

  const kind = iformData ? "iform" : framework || "mdf";
  const dataPath = iformData ? "iformData" : "billDetail";
  const metaFields = normalizeFieldMetaMap(fieldMetadata, fieldLabels);
  const normalizedFields = iformData
    ? normalizeIformFields(iformData, metaFields)
    : normalizeObjectFields(billDetail, metaFields, "billDetail");

  return {
    schemaVersion: DETAIL_RICH_SCHEMA_VERSION,
    primaryId,
    type,
    docType,
    framework,
    handlerId,
    handlerSource,
    fetchedAt,
    raw: { kind, dataPath },
    meta: {
      fields: metaFields,
      enums: buildEnumMap(metaFields),
      sections: buildSections(Object.values(metaFields)),
    },
    normalized: {
      fields: normalizedFields,
      byId: buildById(normalizedFields),
      sections: buildSections(normalizedFields),
    },
    fieldLabels: clone(fieldLabels || {}),
  };
}

export function getNormalizedField(detail = {}, selector = {}) {
  const fields = detail?.normalized?.fields;
  if (!Array.isArray(fields)) return null;
  if (selector.fieldId) {
    const idx = detail?.normalized?.byId?.[selector.fieldId];
    if (Number.isInteger(idx) && fields[idx]) return fields[idx];
    const matched = fields.find((field) => field.fieldId === selector.fieldId);
    if (matched) return matched;
  }
  if (selector.fieldLabel) {
    const matched = fields.find((field) => field.label === selector.fieldLabel);
    if (matched) return matched;
  }
  return null;
}
