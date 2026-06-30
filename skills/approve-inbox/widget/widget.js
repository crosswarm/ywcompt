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

  // 宿主 origin 推断 + 白名单:只信任本机驾驶舱(http(s)://localhost|127.0.0.1)。
  // 所有 iframe→宿主 postMessage 用 hostOrigin 作 targetOrigin,不用 "*"。
  function allowedOrigin(origin) {
    if (!origin || origin === "null") return false;
    try {
      const u = new URL(origin);
      if (u.protocol !== "https:" && u.protocol !== "http:") return false;
      return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    } catch {
      return false;
    }
  }

  let hostOrigin = "";
  try {
    const rt = returnTo();
    if (rt) hostOrigin = new URL(rt).origin;
  } catch {}

  function tellParent(message) {
    if (!window.parent || window.parent === window) return;
    const target = allowedOrigin(hostOrigin) ? hostOrigin : "*";
    window.parent.postMessage(message, target);
  }

  // 主题跟随:收 approve-inbox:theme,写 :root CSS 变量(widget.css 用 var() 消费)。
  const THEME_MAP = {
    primary: "--primary",
    primaryHover: "--primary-hover",
    bg: "--bg",
    surface: "--surface",
    text: "--text",
    textMuted: "--muted",
    danger: "--risk",
    warning: "--warning",
    success: "--success",
    radius: "--radius",
    fontFamily: "--font",
  };

  function applyTheme(theme) {
    if (!theme || typeof theme !== "object") return;
    const root = document.documentElement;
    Object.entries(THEME_MAP).forEach(([key, cssVar]) => {
      if (theme[key] != null) root.style.setProperty(cssVar, String(theme[key]));
    });
    if (theme.mode) root.setAttribute("data-theme", String(theme.mode));
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
      // 通知宿主 iframe 就绪,宿主可据此推送主题 token。
      tellParent({ type: "approve-inbox:ready" });
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
        '<article class="todo-row risk-' + esc(item.riskLevel || "medium") + '" data-todo-id="' + esc(item.id) + '" tabindex="0">' +
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
      // 宿主环境:通知宿主(由宿主决定开抽屉/新标签);独立预览(无 parent)才自行打开。
      tellParent({ type: "approve-inbox:open-center", url: openUrl });
      if (window.parent === window) window.open(openUrl, "_blank");
    };
  }

  // 宿主消息:主题跟随 + 重载。校验 origin,记住真实宿主 origin。
  window.addEventListener("message", (event) => {
    if (!allowedOrigin(event.origin)) return;
    if (event.origin) hostOrigin = event.origin;
    const type = event.data?.type;
    if (type === "approve-inbox:theme") {
      applyTheme(event.data.theme);
    } else if (type === "approve-inbox:reload" || type === "approve-inbox:refresh-complete") {
      load();
    }
  });

  // 点待办行 → 请宿主开原生抽屉(不在 iframe 小窗内自行展开详情)。
  const todoList = $("todoList");
  if (todoList) {
    todoList.addEventListener("click", (event) => {
      const row = event.target.closest("[data-todo-id]");
      if (!row) return;
      tellParent({ type: "approve-inbox:request-detail", todoId: row.dataset.todoId });
    });
    todoList.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const row = event.target.closest("[data-todo-id]");
      if (!row) return;
      event.preventDefault();
      tellParent({ type: "approve-inbox:request-detail", todoId: row.dataset.todoId });
    });
  }

  load();
})();
