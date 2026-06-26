/**
 * bill-utils.mjs — 单据工具函数
 *
 * 纯函数，无外部依赖，专为单元测试设计。
 */

// ── 类型检测 ──────────────────────────────────────────────

/**
 * 根据待办标题和 formId 检测单据类型
 * @param {{ title?: string, formId?: string }} todo
 * @returns {string} patch | data-request | online | expense | other
 */
export function detectType(todo) {
  const title = todo.title || "";
  const formId = todo.formId || "";
  if (title.includes("紧急补丁审批单") || formId.includes("CJJBDYJZSP"))
    return "patch";
  if (formId === "73176167895d4880b47a1dd9ed4ad790")
    return "data-request";
  if (title.includes("BIP上线申请单") || title.includes("上线申请单"))
    return "online";
  if (title.includes("报销") || formId.includes("expensebill"))
    return "expense";
  return "other";
}

// ── 附件提取 ──────────────────────────────────────────────

/**
 * 从 iformData.head 中提取附件元数据
 * @param {object|null} iformData
 * @returns {Array<{ fieldId: string, fileName: string, fileType: string, size: number, url: string, fid: string, newFileId: string|null, author: string, uploadTime: string, localPath: null }>}
 */
export function extractAttachments(iformData) {
  const attachments = [];
  if (!iformData?.head) return attachments;
  for (const [fieldId, val] of Object.entries(iformData.head)) {
    const raw = val?.name || val?.value || "";
    if (!raw.startsWith("[")) continue;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        if (item.url && item.fid && item.name) {
          attachments.push({
            fieldId,
            fileName: item.name,
            fileType: item.type || "",
            size: item.size || item.filesize || 0,
            url: item.url,
            fid: item.fid,
            newFileId: item.newFileId || null,
            author: item.author || "",
            uploadTime: item.uploadtime || "",
            localPath: null,
          });
        }
      }
    } catch {
      continue;
    }
  }
  return attachments;
}

/**
 * 对比新旧 ID 集合，检测变化
 *
 * @param {string[]} inboxIds - 本地已有的 primaryId 列表
 * @param {string[]} currentIds - 远端最新的 primaryId 列表
 * @returns {{ newIds: string[], completedIds: string[], hasChanges: boolean }}
 */
export function detectChanges(inboxIds, currentIds) {
  const inbox = new Set(inboxIds);
  const current = new Set(currentIds);

  const newIds = currentIds.filter((id) => !inbox.has(id));
  const completedIds = inboxIds.filter((id) => !current.has(id));

  return {
    newIds,
    completedIds,
    hasChanges: newIds.length > 0 || completedIds.length > 0,
  };
}
