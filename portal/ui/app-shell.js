import { escapeHtml } from "../core/utils.js";

const MODULE_ICONS = Object.freeze({
  dashboard: "⌂",
  "audit-details": "≡",
  suprimentos: "▣",
  demandas: "◫",
  comercial: "◇",
  financeiro: "¤",
  "rh-obras": "⌘",
  "patrimonio-locacoes": "⌂",
  "auditoria-compliance": "✓",
  relatorios: "▤",
  "usuarios-acessos": "⚙",
});

const SIDEBAR_STATE_BY_ACCOUNT = new Map();
const AUDIT_NAVIGATION = Object.freeze({ id: "audit-details", title: "Detalhamento/Auditoria" });

function accountEmail(account) {
  return account?.username || account?.idTokenClaims?.preferred_username || account?.email || "";
}

function accountName(account) {
  return account?.name || account?.idTokenClaims?.name || accountEmail(account) || "Conta Microsoft";
}

function visibleModules(session) {
  const access = session.access;
  const can = session.can || (() => false);
  const modules = (session.modules || []).filter(module => {
    if (module.id === "dashboard") return true;
    if (module.id === "usuarios-acessos") return session.isSuperAdmin === true;
    return can(access, module.id, "view");
  });
  const canAudit = (session.entities || []).some(entity => entity.available !== false
    && can(access, entity.moduleId, "view"));
  if (!canAudit) return modules;
  const dashboardIndex = modules.findIndex(module => module.id === "dashboard");
  modules.splice(dashboardIndex < 0 ? 0 : dashboardIndex + 1, 0, AUDIT_NAVIGATION);
  return modules;
}

function moduleHref(module) {
  if (module.id === "dashboard") return "#/dashboard";
  if (module.id === "audit-details") return "#/audit";
  if (module.id === "usuarios-acessos") return "#/access";
  if (module.id === "relatorios") return "#/reports";
  return `#/module/${encodeURIComponent(module.id)}`;
}

function activeModuleId(route, entities = []) {
  if (route?.name === "dashboard") return "dashboard";
  if (route?.name === "audit") return "audit-details";
  if (route?.name === "access") return "usuarios-acessos";
  if (route?.name === "reports") return "relatorios";
  if (route?.name === "analytics") return "relatorios";
  if (route?.name === "module") return route.params?.moduleId || "";
  if (["entity", "item"].includes(route?.name)) {
    return entities.find(entity => entity.id === route.params?.entityId)?.moduleId || "";
  }
  return "";
}

export function renderAppShell(root, session = {}) {
  if (!root) throw new TypeError("O shell administrativo requer um elemento raiz.");
  const modules = visibleModules(session);
  const email = accountEmail(session.account);
  const name = accountName(session.account);
  const logoSrc = session.logoSrc || root.dataset?.logoSrc || "assets/logo-energetica-oficial.png";
  const mascotSrc = session.mascotSrc || root.dataset?.mascotSrc || "assets/mascote-energetica-transparente.png";
  const accountKey = email.trim().toLowerCase() || "anonymous";

  root.innerHTML = `
    <div class="admin-shell" data-admin-shell data-active-module="dashboard">
      <aside class="admin-sidebar" id="adminSidebar" data-shell-drawer aria-label="Navegação administrativa">
        <div class="admin-brand">
          <span class="admin-brand-assets">
            <img class="admin-brand-logo" src="${escapeHtml(logoSrc)}" alt="Energética Construções">
            <img class="admin-brand-logo-compact" src="${escapeHtml(logoSrc)}" alt="">
          </span>
          <button class="admin-sidebar-collapse" data-shell-collapse type="button" aria-controls="adminSidebar" aria-expanded="true" aria-label="Recolher menu" title="Recolher menu"><span aria-hidden="true"></span></button>
          <button class="admin-drawer-close" data-shell-close type="button" aria-label="Fechar menu">×</button>
        </div>
        <nav class="admin-navigation" data-shell-navigation aria-label="Módulos">
          ${modules.map(module => `<a class="admin-nav-link" data-shell-route="${escapeHtml(module.id)}" data-tooltip="${escapeHtml(module.title)}" aria-label="${escapeHtml(module.title)}" href="${moduleHref(module)}"><span class="admin-nav-icon" aria-hidden="true">${MODULE_ICONS[module.id] || "□"}</span><span class="admin-nav-label">${escapeHtml(module.title)}</span></a>`).join("")}
        </nav>
        <div class="admin-sidebar-user">
          <img class="admin-sidebar-mascot" src="${escapeHtml(mascotSrc)}" alt="" aria-hidden="true">
          <span class="admin-sidebar-user-copy">
            <strong>${escapeHtml(name)}</strong>
            <span>${escapeHtml(email)}</span>
          </span>
        </div>
      </aside>
      <button class="admin-drawer-backdrop" data-shell-backdrop type="button" aria-label="Fechar menu" tabindex="-1"></button>
      <div class="admin-workspace">
        <header class="admin-topbar">
          <button class="admin-menu-button" data-shell-menu type="button" aria-controls="adminSidebar" aria-expanded="false" aria-label="Abrir menu">☰</button>
          <div class="admin-connection" data-shell-connection aria-live="polite"><span aria-hidden="true"></span>Conectado</div>
          <div class="admin-topbar-actions">
            <span class="admin-account-name">${escapeHtml(name)}</span>
            <button class="admin-logout-button" data-shell-logout type="button">Sair</button>
          </div>
        </header>
        <main class="admin-content" data-app-content tabindex="-1"></main>
      </div>
    </div>`;

  const drawer = root.querySelector("[data-shell-drawer]");
  const shellElement = root.querySelector("[data-admin-shell]");
  const menuButton = root.querySelector("[data-shell-menu]");
  const closeButton = root.querySelector("[data-shell-close]");
  const collapseButton = root.querySelector("[data-shell-collapse]");
  const backdrop = root.querySelector("[data-shell-backdrop]");
  const connection = root.querySelector("[data-shell-connection]");
  const content = root.querySelector("[data-app-content]");
  const cleanup = [];
  let collapsed = SIDEBAR_STATE_BY_ACCOUNT.get(accountKey) === true;
  const setDrawer = open => {
    drawer?.classList.toggle("is-open", open);
    shellElement?.classList.toggle("is-drawer-open", open);
    menuButton?.setAttribute?.("aria-expanded", String(Boolean(open)));
  };
  const setCollapsed = nextCollapsed => {
    collapsed = Boolean(nextCollapsed);
    SIDEBAR_STATE_BY_ACCOUNT.set(accountKey, collapsed);
    shellElement?.classList.toggle("is-sidebar-collapsed", collapsed);
    if (shellElement?.dataset) shellElement.dataset.sidebarCollapsed = String(collapsed);
    collapseButton?.setAttribute?.("aria-expanded", String(!collapsed));
    collapseButton?.setAttribute?.("aria-label", collapsed ? "Expandir menu" : "Recolher menu");
    collapseButton?.setAttribute?.("title", collapsed ? "Expandir menu" : "Recolher menu");
  };
  const setConnection = online => {
    if (!connection) return;
    connection.classList.toggle("is-offline", !online);
    connection.textContent = online ? "Conectado" : "Sem conexão";
  };

  menuButton?.addEventListener("click", () => setDrawer(true));
  closeButton?.addEventListener("click", () => setDrawer(false));
  backdrop?.addEventListener("click", () => setDrawer(false));
  collapseButton?.addEventListener("click", () => setCollapsed(!collapsed));
  root.querySelector("[data-shell-logout]")?.addEventListener("click", () => session.onLogout?.());
  root.querySelectorAll("[data-shell-route]").forEach(link => link.addEventListener("click", () => setDrawer(false)));
  if (globalThis.window?.addEventListener) {
    const setOnline = () => setConnection(true);
    const setOffline = () => setConnection(false);
    globalThis.window.addEventListener("online", setOnline);
    globalThis.window.addEventListener("offline", setOffline);
    const closeOnEscape = event => {
      if (event.key === "Escape") setDrawer(false);
    };
    globalThis.window.addEventListener("keydown", closeOnEscape);
    cleanup.push(() => globalThis.window.removeEventListener("online", setOnline));
    cleanup.push(() => globalThis.window.removeEventListener("offline", setOffline));
    cleanup.push(() => globalThis.window.removeEventListener("keydown", closeOnEscape));
  }
  setCollapsed(collapsed);
  setConnection(globalThis.navigator?.onLine !== false);

  function setActiveRoute(route) {
    const selectedModuleId = activeModuleId(route, session.entities);
    if (shellElement?.dataset) shellElement.dataset.activeModule = selectedModuleId || "dashboard";
    root.querySelectorAll("[data-shell-route]").forEach(link => {
      const target = link.dataset.shellRoute;
      const active = target === selectedModuleId;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute?.("aria-current");
    });
  }

  return Object.freeze({
    content,
    navigation: root.querySelector("[data-shell-navigation]"),
    setActiveRoute,
    setConnection,
    cleanup: () => cleanup.forEach(dispose => dispose()),
  });
}
