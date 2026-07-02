export function fieldsFromObject(data = {}, fieldLabels = {}, limit = 80) {
  const source = data?.head || data?.data || data || {};
  return Object.entries(source)
    .filter(([key, value]) => !key.startsWith("_") && value != null && value !== "")
    .slice(0, limit)
    .map(([fieldId, value]) => ({
      fieldId,
      label: fieldLabels[fieldId] || fieldId,
      value: typeof value === "object" ? (value.name || value.displayName || value.label || value.value || value.code || "") : String(value),
    }))
    .filter((field) => field.value);
}

export function buildBaseSummary(todo = {}, handler = {}) {
  return {
    title: todo.title || "",
    type: handler.docType || todo.docType || "other",
    typeLabel: handler.typeLabel || todo.docType || "其他",
    applicant: todo.submitter || todo.commitUserName || null,
    commitTime: todo.submittedAt || todo.commitTime || null,
  };
}

export function createExtensionApi({ detectFramework }) {
  return {
    detectFramework,
    fieldsFromObject,
    buildBaseSummary,
  };
}
