const SECTION_KINDS = new Set(["primary", "more", "technical"]);

function displayText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(displayText).filter(Boolean).join("、");
  if (typeof value === "object") {
    for (const key of ["name", "displayName", "label", "title", "text", "value", "code", "id"]) {
      const text = displayText(value[key]);
      if (text) return text;
    }
    return "";
  }
  return String(value);
}

function normalizeKind(kind) {
  const value = String(kind || "").trim();
  return SECTION_KINDS.has(value) ? value : "primary";
}

function sourceFields(detail = {}) {
  return Array.isArray(detail.fields) ? detail.fields : [];
}

function fieldLookup(detail = {}) {
  const fields = sourceFields(detail);
  const byId = new Map();
  const byLabel = new Map();
  for (const field of fields) {
    const key = displayText(field.key || field.id || field.fieldId);
    const name = displayText(field.name || field.label);
    if (key) byId.set(key, field);
    if (name) byLabel.set(name, field);
  }
  return { byId, byLabel };
}

function resolvePlannedField(field = {}, lookup, { allowUnresolved = false } = {}) {
  const fieldId = displayText(field.fieldId || field.id || field.key);
  const label = displayText(field.label || field.name || field.fieldLabel);
  const source = (fieldId && lookup.byId.get(fieldId)) || (label && lookup.byLabel.get(label)) || null;
  if (!source && !allowUnresolved) return null;
  return {
    id: displayText(source?.key || source?.id || source?.fieldId || fieldId || label || "field"),
    label: displayText(field.label || field.name || source?.name || source?.label || fieldId || "字段"),
    value: source ? displayText(source.value) : displayText(field.value),
    full: field.full === true,
    reason: displayText(field.reason || field.summary),
  };
}

export function normalizeFieldDisplayPlan(plan = null, detail = {}, options = {}) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return null;
  const lookup = fieldLookup(detail);
  const sections = Array.isArray(plan.sections) ? plan.sections : [];
  const normalizedSections = sections
    .map((section) => {
      const kind = normalizeKind(section?.kind);
      const fields = (Array.isArray(section?.fields) ? section.fields : [])
        .map((field) => resolvePlannedField(field, lookup, options))
        .filter((field) => field && field.label && (field.value || options.allowUnresolved));
      return {
        id: displayText(section?.id || kind),
        title: displayText(section?.title || (kind === "technical" ? "技术信息" : "关键字段")),
        kind,
        collapsed: section?.collapsed === true || kind === "technical",
        fields,
        note: displayText(section?.note),
      };
    })
    .filter((section) => section.fields.length > 0);

  if (!normalizedSections.length) return null;
  return {
    sections: normalizedSections,
    notes: displayText(plan.notes || plan.note),
  };
}

export function buildFieldDisplaySections(detail = {}) {
  const plan = normalizeFieldDisplayPlan(detail.fieldDisplayPlan, detail);
  if (!plan) return [];
  return plan.sections.map((section) => ({
    id: section.id,
    title: section.title,
    kind: section.kind,
    collapsed: section.collapsed,
    source: "agent",
    note: section.note,
    fields: section.fields.map((field) => ({
      id: field.id,
      label: field.label,
      value: field.value,
      full: field.full,
      reason: field.reason,
    })),
  }));
}

function fieldKey(field = {}) {
  return displayText(field.id || field.label).toLowerCase();
}

export function mergeDetailCardSections(configured = [], planned = []) {
  const seen = new Set();
  const out = [];
  for (const sourceSection of [
    ...configured.map((section) => ({ ...section, source: section.source || "config" })),
    ...planned,
  ]) {
    const fields = (sourceSection.fields || []).filter((field) => {
      const key = fieldKey(field);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!fields.length) continue;
    out.push({
      ...sourceSection,
      fields,
    });
  }
  return out;
}
