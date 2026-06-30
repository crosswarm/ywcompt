(function () {
  const state = {
    data: null,
    error: null,
    loading: true,
  };

  const $ = (id) => document.getElementById(id);

  function text(value) {
    return value == null ? "" : String(value);
  }

  function esc(value) {
    return text(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function returnTo() {
    const params = new URLSearchParams(window.location.search);
    return params.get("returnTo") || document.referrer || "";
  }

  function apiUrl() {
    const url = new URL("/api/widget/todos", window.location.origin);
    url.searchParams.set("limit", "3");
    const rt = returnTo();
    if (rt) url.searchParams.set("returnTo", rt);
    return url.toString();
  }

  async function load() {
    state.loading = true;
    state.error = null;
    render();
    try {
      const response = await fetch(apiUrl(), { credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.error || "待办数据暂不可用");
      state.data = data;
    } catch (error) {
      state.error = error.message || "待办数据暂不可用";
    } finally {
      state.loading = false;
      render();
    }
  }

  function tagClass(kind) {
    if (kind === "risk") return "tag tag-risk";
    if (kind === "rule") return "tag tag-rule";
    if (kind === "advice") return "tag tag-advice";
    return "tag";
  }

  function renderItems(items) {
    if (state.loading) return '<div class="loading-row">加载中...</div>';
    if (state.error) return '<div class="error-row">' + esc(state.error) + '</div>';
    if (!items || items.length === 0) return '<div class="empty-row">当前没有待处理事项。</div>';
    return items.map((item) => {
      const tags = (item.tags || []).map((tag) => (
        '<span class="' + tagClass(tag.kind) + '">' + esc(tag.label) + '</span>'
      )).join("");
      return (
        '<article class="todo-row risk-' + esc(item.riskLevel || "medium") + '">' +
          '<div class="todo-title"><i class="risk-dot"></i><strong>' + esc(item.title) + '</strong></div>' +
          (item.subtitle ? '<p class="todo-subtitle">' + esc(item.subtitle) + '</p>' : '') +
          (tags ? '<div class="tag-row">' + tags + '</div>' : '') +
        '</article>'
      );
    }).join("");
  }

  function render() {
    const data = state.data || {};
    const summary = data.summary || {};
    $("pendingCount").textContent = state.loading ? "-" : String(summary.pendingCount || 0);
    $("priorityCount").textContent = state.loading ? "-" : String(summary.highPriorityCount || 0);
    $("attentionCount").textContent = state.loading ? "-" : String(summary.attentionCount || 0);
    $("todoList").innerHTML = renderItems(data.items || []);
    $("magicSummary").textContent = state.error ? "待办中心可继续查看完整数据与同步状态。" : (data.magicSummary || "当前没有待处理事项。");
    const openUrl = data.actions?.openCenterUrl || "/";
    const link = $("openCenter");
    link.href = openUrl;
    link.onclick = (event) => {
      event.preventDefault();
      window.parent?.postMessage?.({ type: "approve-inbox:open-center", url: openUrl }, "*");
      window.open(openUrl, "_top");
    };
  }

  window.addEventListener("message", (event) => {
    if (event.data?.type === "approve-inbox:reload" || event.data?.type === "approve-inbox:refresh-complete") {
      load();
    }
  });

  load();
})();
