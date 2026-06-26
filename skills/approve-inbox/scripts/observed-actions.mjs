export function normalizeObservedAction(action = {}, defaults = {}) {
  const code = String(action.action || action.id || "").trim();
  if (!code) return null;
  const callback = action.callBackExecType || action.execType;
  return {
    action: code,
    label: action.label || action.name || code,
    execType: action.execType,
    callBackExecType: callback,
    enabled: action.enabled !== false,
    buttonIndex: action.buttonIndex,
    kind: action.kind || defaults.kind || "workflow",
    source: action.source || defaults.source || "observed",
    observedAt: action.observedAt || defaults.observedAt,
    requiresRefresh: action.requiresRefresh ?? defaults.requiresRefresh ?? true,
    endpointHint: action.endpointHint || defaults.endpointHint,
  };
}

export function normalizeObservedActions(actions = [], defaults = {}) {
  if (!Array.isArray(actions)) return [];
  return actions
    .map((action) => normalizeObservedAction(action, defaults))
    .filter(Boolean);
}

export function actionMatches(requestedAction, runtimeAction = {}) {
  if (!runtimeAction || runtimeAction.enabled === false) return false;
  const action = String(runtimeAction.action || "").toLowerCase();
  const callback = String(runtimeAction.callBackExecType || runtimeAction.execType || "").toLowerCase();
  if (requestedAction === "approve") return action === "approve" || callback === "agree";
  return action === "reject" || action === "return" || callback === "reject";
}

export function hasRequestedAction(actions = [], requestedAction = "approve") {
  return Array.isArray(actions) && actions.some((runtimeAction) => actionMatches(requestedAction, runtimeAction));
}
