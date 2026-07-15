const DOC_TYPE_ALIASES = new Map([
  ["采购下单", "采购订单"],
  ["采购订单下单", "采购订单"],
]);

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

export function docTypeFromTitle(title) {
  const text = cleanText(title);
  if (!text) return "";
  return KNOWN_DOC_TYPES.find((name) => text.includes(name)) || "";
}

export function canonicalDocTypeName(rawDocType, context = {}) {
  const titleType = docTypeFromTitle(context.title);
  if (titleType) return titleType;

  const billNameType = docTypeFromTitle(context.billName || context.typeLabel || context.kindLabel);
  if (billNameType) return billNameType;

  const raw = cleanText(rawDocType);
  const alias = DOC_TYPE_ALIASES.get(raw) || raw;

  const rawType = docTypeFromTitle(alias);
  if (rawType) return rawType;
  if (alias && !/^[a-z0-9_.:-]+$/i.test(alias)) return alias.slice(0, 20);
  return "审批单";
}

export function docTypeFromTodo(todo = {}) {
  const serviceName = cleanText(todo.serviceName);
  if (serviceName) return serviceName;

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
  if (iconName) return (DOC_TYPE_ALIASES.get(iconName) || iconName).slice(0, 20);
  return canonicalDocTypeName(todo.docType, todo);
}
