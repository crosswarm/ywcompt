export function isStrictApiSuccess(result) {
  if (!result || typeof result !== "object") return false;
  if (typeof result._httpStatus === "number" && result._httpStatus >= 400) return false;
  if (Object.hasOwn(result, "success")) {
    return result.success === true || result.success === "true";
  }
  if (Object.hasOwn(result, "flag")) return result.flag === 0 || result.flag === "0";
  if (Object.hasOwn(result, "code")) return result.code === 200;
  return false;
}

export function hasExplicitFailure(result) {
  if (!result || typeof result !== "object") return false;
  if (result.success === false || result.success === "false") return true;
  if (Object.hasOwn(result, "flag") && result.flag !== 0 && result.flag !== "0") return true;
  if (typeof result.failCount === "number" && result.failCount > 0) return true;
  if (Object.hasOwn(result, "code") && result.code !== 200) return true;
  if (Array.isArray(result.results)) return result.results.some(hasExplicitFailure);
  if (Array.isArray(result.bills)) return result.bills.some(hasExplicitFailure);
  return false;
}

export function itemPrimaryId(item = {}) {
  const id = item.primaryId || item.id;
  return id == null ? "" : String(id);
}

export function isValidPrimaryId(id) {
  return typeof id === "string" && id.length > 0 && id.length <= 128 && /^[A-Za-z0-9_.:-]+$/.test(id);
}

export function normalizeApprovalBody(body = {}) {
  const ids = body.ids || body.primaryIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, status: 400, error: "ids required" };
  }
  const normalizedIds = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  if (normalizedIds.length === 0) {
    return { ok: false, status: 400, error: "ids required" };
  }
  if (!normalizedIds.every(isValidPrimaryId)) {
    return { ok: false, status: 400, error: "Invalid id" };
  }

  const action = body.action === "reject" || body.action === "return" ? body.action : "approve";
  const comment =
    typeof body.comment === "string" && body.comment.trim()
      ? body.comment.trim()
      : action === "approve"
        ? "同意"
        : "不同意";

  return {
    ok: true,
    ids: normalizedIds,
    action,
    comment,
    mode: body.mode === "tempsave" ? "tempsave" : "direct",
    rejectTarget: body.rejectTarget || "-1",
    selectedByRejecter: String(body.selectedByRejecter ?? "0"),
    fieldAssignments: body.fieldAssignments && typeof body.fieldAssignments === "object" ? body.fieldAssignments : {},
  };
}

export function findStateItems(state, ids) {
  const idSet = new Set(ids);
  const source = state?.businessType === "approve-inbox" && Array.isArray(state.items)
    ? state.items
    : [...(state?.inbox || []), ...(state?.done || [])];
  return source.filter((item) => idSet.has(itemPrimaryId(item)));
}

export function collectSuccessfulIds(groups = []) {
  const ids = new Set();
  for (const group of groups) {
    if (!group) continue;
    if (Array.isArray(group.successIds)) {
      for (const id of group.successIds) ids.add(String(id));
    }
    if (group.success === true && Array.isArray(group.ids)) {
      for (const id of group.ids) ids.add(String(id));
    }
    const nested = group.result?.results || group.results;
    if (Array.isArray(nested)) {
      for (const result of nested) {
        if (result?.success === true || result?.success === "true") {
          const id = result.primaryId || result.id;
          if (id) ids.add(String(id));
        }
      }
    }
  }
  return ids;
}

export function moveItemsToDone(state, completedIds, action = "approve", completedAt = new Date().toISOString()) {
  const idSet = completedIds instanceof Set ? completedIds : new Set(completedIds || []);
  if (!state || idSet.size === 0) return 0;

  if (state.businessType === "approve-inbox" && Array.isArray(state.items)) {
    let moved = 0;
    for (const item of state.items) {
      if (!idSet.has(itemPrimaryId(item))) continue;
      if (item.status !== "done") moved++;
      item.status = "done";
      item.runtimeActions = [];
      item.completedAt = completedAt;
      item.completedAction = action;
      item.approvalAction = action;
    }
    if (state.summary) {
      const pending = state.items.filter((item) => item.status !== "done").length;
      state.summary.total = state.items.length;
      state.summary.pendingCount = pending;
      state.summary.doneCount = state.items.length - pending;
    }
    return moved;
  }

  const movedItems = (state.inbox || []).filter((item) => idSet.has(itemPrimaryId(item)));
  if (movedItems.length === 0) return 0;
  state.inbox = (state.inbox || []).filter((item) => !idSet.has(itemPrimaryId(item)));
  state.done = [
    ...(state.done || []),
    ...movedItems.map((item) => ({ ...item, completedAt, completedAction: action, approvalAction: action })),
  ];
  return movedItems.length;
}
