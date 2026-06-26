import { localizeFields } from "../../analysis/profile-loader.js";

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

export async function fetchIformData(ctx = {}, todo = {}) {
  const fetched = await ctx.fetchBillFields(todo, ctx.creds);
  if (fetched.error) {
    return {
      error: fetched.error,
      detail: fetched.detail,
      iformData: null,
      attachments: [],
      fieldLabels: {},
      fieldMetadata: {},
    };
  }
  const { labels, metadata } = labelsFromFields(fetched.fields || []);
  return {
    iformData: fetched.raw || null,
    fields: fetched.fields || [],
    attachments: fetched.attachments || [],
    fieldLabels: labels,
    fieldMetadata: metadata,
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
