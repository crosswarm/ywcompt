import { localizeFields } from "../../analysis/profile-loader.js";

const LAYOUT_COMPONENTS = new Set([
  "TableLayout",
  "TdLayout",
  "TrLayout",
  "GridLayout",
  "Paragraph",
  "DividingLine",
  "Layout",
  "Container",
]);

function labelsFromFields(fields = []) {
  const labels = {};
  const metadata = {};
  for (const field of localizeFields(fields || [])) {
    const id = field.key || field.name;
    if (!id) continue;
    labels[id] = field.name || id;
    metadata[id] = {
      label: field.name || id,
      section: field.dim,
      dataType: typeof field.value,
      visible: true,
      editable: true,
    };
  }
  return { labels, metadata };
}

function normalizeOptions(options) {
  if (!Array.isArray(options)) return undefined;
  return options
    .map((option) => {
      if (!option || typeof option !== "object") return null;
      const value = option.selectionId ?? option.value ?? option.id ?? option.code;
      const label = option.name ?? option.label ?? option.title ?? option.text;
      if (value == null || label == null) return null;
      return { value: String(value), label: String(label) };
    })
    .filter(Boolean);
}

function authByField(processauthinfo = {}) {
  const out = {};
  for (const entries of Object.values(processauthinfo || {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const fieldId = entry?.fieldid || entry?.fieldId;
      if (!fieldId) continue;
      out[fieldId] = {
        editable: entry.auth == null ? undefined : String(entry.auth) !== "0",
      };
    }
  }
  return out;
}

/**
 * Extract a lightweight field metadata index from iForm billVue.json.
 * The full template can be ~1MB, so callers should persist this compact map.
 */
export function extractIformFieldMetadata(templateJson = {}, iformData = {}) {
  const fields = {};
  const fieldAuth = authByField(iformData?.processauthinfo || {});
  function visit(node, section = "") {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, section);
      return;
    }
    const nextSection = node.title && !node.fieldId && !LAYOUT_COMPONENTS.has(node.componentKey)
      ? String(node.title)
      : section;
    const fieldId = node.fieldId;
    const componentKey = node.componentKey || node.type || "";
    if (fieldId && node.title && !LAYOUT_COMPONENTS.has(componentKey)) {
      const options = normalizeOptions(node.options);
      fields[fieldId] = {
        ...(fields[fieldId] || {}),
        fieldId,
        label: String(node.title),
        controlType: componentKey,
        section: section || node.groupTitle || node.parentTitle || "",
        required: typeof node.required === "boolean" ? node.required : fields[fieldId]?.required,
        visible: node.invisible == null ? (typeof node.visible === "boolean" ? node.visible : fields[fieldId]?.visible) : !node.invisible,
        editable: typeof node.editable === "boolean"
          ? node.editable
          : (typeof node.isReadonly === "boolean" ? !node.isReadonly : fieldAuth[fieldId]?.editable ?? fields[fieldId]?.editable),
        options: options || fields[fieldId]?.options,
      };
    }
    for (const key of ["formComponents", "children", "layoutDetail", "items", "columns", "controls"]) {
      if (node[key]) visit(node[key], nextSection);
    }
  }
  visit(templateJson);
  return fields;
}

export async function fetchIformData(ctx = {}, todo = {}) {
  const fetched = await ctx.fetchBillFields(todo, ctx.creds);
  if (fetched.error) {
    return {
      error: fetched.error,
      detail: fetched.detail,
      businessKey: fetched.businessKey || "",
      iformData: null,
      attachments: [],
      fieldLabels: {},
      fieldMetadata: {},
    };
  }
  const { labels, metadata } = labelsFromFields(fetched.fields || []);
  const fieldLabels = { ...labels, ...(fetched.fieldLabels || {}) };
  const fieldMetadata = { ...metadata, ...(fetched.fieldMetadata || {}) };
  return {
    iformData: fetched.raw || null,
    fields: fetched.fields || [],
    attachments: fetched.attachments || [],
    fieldLabels,
    fieldMetadata,
    businessKey: fetched.businessKey || "",
  };
}

export function fieldLabelsFromMetadata(fieldMetadata = {}) {
  return Object.fromEntries(
    Object.entries(fieldMetadata)
      .map(([fieldId, meta]) => [fieldId, meta?.label || meta?.title || meta?.caption || fieldId])
      .filter(([, label]) => label),
  );
}

export async function fetchFieldMetadata() {
  return {};
}

export async function fetchFieldLabels(ctx, todo, iformData) {
  const head = iformData?.head || {};
  return Object.fromEntries(
    Object.entries(head)
      .map(([fieldId, value]) => [fieldId, value?.label || value?.name || fieldId])
      .filter(([, label]) => label),
  );
}
