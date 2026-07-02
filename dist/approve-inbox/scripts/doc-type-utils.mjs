const DOC_TYPE_ALIASES = new Map([
  ["采购下单", "采购订单"],
  ["采购订单下单", "采购订单"],
]);

const SERVICE_CODE_DOC_TYPES = [
  [/^st_purchaseorder/i, "采购订单"],
  [/^pu_applyorder/i, "请购单"],
  [/^st_purinrecord/i, "采购入库单"],
  [/^ycReqApply/i, "需求申请"],
  [/^znbzbx_busistrip/i, "费用报销"],
  [/^sact_salescontract/i, "销售合同"],
];

const KNOWN_DOC_TYPES = [
  "数据处理申请",
  "人员招聘申请",
  "采购入库单",
  "差旅费报销",
  "采购订单",
  "采购合同",
  "采购申请",
  "销售合同",
  "付款申请",
  "借款申请",
  "用印申请",
  "出差申请",
  "费用报销",
  "需求申请",
  "上线申请",
  "文件签署",
  "招聘申请",
  "请购单",
  "入库单",
  "审批单",
].sort((a, b) => b.length - a.length);

function cleanText(input) {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function serviceCodeFromUrl(webUrl = "") {
  try {
    return new URL(webUrl).searchParams.get("serviceCode") || "";
  } catch {
    return new URLSearchParams(String(webUrl).split("?").slice(1).join("?")).get("serviceCode") || "";
  }
}

export function docTypeFromTitle(title) {
  const text = cleanText(title);
  if (!text) return "";
  return KNOWN_DOC_TYPES.find((name) => text.includes(name)) || "";
}

export function docTypeFromServiceCode(serviceCode = "") {
  const code = cleanText(serviceCode).replace(/list$/i, "");
  if (!code) return "";
  const found = SERVICE_CODE_DOC_TYPES.find(([re]) => re.test(code));
  return found ? found[1] : "";
}

export function canonicalDocTypeName(rawDocType, context = {}) {
  const titleType = docTypeFromTitle(context.title);
  if (titleType) return titleType;

  const billNameType = docTypeFromTitle(context.billName || context.typeLabel || context.kindLabel);
  if (billNameType) return billNameType;

  const serviceType = docTypeFromServiceCode(context.serviceCode || serviceCodeFromUrl(context.webUrl));
  const raw = cleanText(rawDocType);
  const alias = DOC_TYPE_ALIASES.get(raw) || raw;
  if (serviceType && (!alias || DOC_TYPE_ALIASES.has(raw) || /^[a-z0-9_-]+$/i.test(alias))) return serviceType;

  const rawType = docTypeFromTitle(alias);
  if (rawType) return rawType;
  if (alias) return alias.slice(0, 20);
  return serviceType || "审批单";
}

export function docTypeFromTodo(todo = {}) {
  let iconName = "";
  const icon = todo.serviceIcon || "";
  if (icon) {
    try {
      const base = decodeURIComponent(icon.split("/").pop() || "");
      const name = base.replace(/\.[a-z0-9]+$/i, "");
      if (/[一-龥]/.test(name)) iconName = cleanText(name);
    } catch {
      // 解码失败时走 serviceCode / title 兜底。
    }
  }
  const canonical = canonicalDocTypeName(iconName, todo);
  if (canonical === "审批单" && todo.serviceCode) {
    return cleanText(todo.serviceCode).replace(/list$/i, "") || canonical;
  }
  return canonical;
}
