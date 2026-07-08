import { localizeFields } from "../../analysis/profile-loader.js";

function objectFromFields(fields = {}) {
  if (!Array.isArray(fields)) return {};
  return Object.fromEntries(fields.map((field) => [field.key || field.name, field.value]).filter(([key]) => key));
}

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
      editable: false,
    };
  }
  return { labels, metadata };
}

export async function fetchMdfBillDetail(ctx = {}, todo = {}) {
  const fetched = await ctx.fetchBillFields(todo, ctx.creds);
  if (fetched.error) {
    return {
      error: fetched.error,
      detail: fetched.detail,
      businessKey: fetched.businessKey || "",
      billDetail: null,
      attachments: [],
      fieldLabels: {},
      fieldMetadata: {},
    };
  }
  const fields = fetched.fields || [];
  const { labels, metadata } = labelsFromFields(fields);
  const fieldLabels = { ...labels, ...(fetched.fieldLabels || {}) };
  const fieldMetadata = { ...metadata, ...(fetched.fieldMetadata || {}) };
  const raw = fetched.raw && typeof fetched.raw === "object" ? fetched.raw : objectFromFields(fields);
  const billDetail = raw?.head || raw?.data || raw || objectFromFields(fields);
  return {
    billDetail,
    fields,
    attachments: fetched.attachments || [],
    fieldLabels,
    fieldMetadata,
    businessKey: fetched.businessKey || "",
    via: fetched.via,
  };
}

export const fetchPatchBillDetail = fetchMdfBillDetail;
