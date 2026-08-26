import { escapeHtml } from "../core/utils.js";

const MODULE_ICONS = Object.freeze({
  dashboard: "⌂",
  suprimentos: "▣",
  demandas: "◫",
  comercial: "◇",
  financeiro: "¤",
  "rh-obras": "⌘",
  "patrimonio-locacoes": "⌂",
  "auditoria-compliance": "✓",
  "usuarios-acessos": "⚙",
});

function accountEmail(account) {
  return account?.username || account?.idTokenClaims?.preferred_username || account?.email || "";
}

function accountName(account) {
  return account?.name || account?.idTokenClaims?.name || accountEmail(account) || "Conta Microsoft";
}

function visibleModules(session) {
  const access = session.access;
  const can = session.can || (() => false);
  return (session.modules || []).filter(module => {
    if (module.id === "dashboard") return true;
    if (module.id === "usuarios-acessos") return session.isSuperAdmin === true;
    return can(access, module.id, "view");
  });
}

function moduleHref(module) {
  return module.id === "dashboard" ? "#/dashboard" : module.id === "usuarios-acessos" ? "#/access" : `#/module/${encodeURIComponent(module.id)}`;
}

export function renderAppShell(root, session = {}) {
  if (!root) throw new TypeError("O shell administrativo requer um elemento raiz.");
  const modules = visibleModules(session);
  const email = accountEmail(session.account);
  const name = accountName(session.account);
  const logoSrc = session.logoSrc || root.dataset?.logoSrc || "assets/logo-energetica-oficial.png";

  root.innerHTML = `
    <div class="admin-shell" data-admin-shell>
      <aside class="admin-sidebar" data-shell-drawer aria-label="Navegação administrativa">
        <div class="admin-brand">
          <img class="admin-brand-logo" src="${escapeHtml(logoSrc)}" alt="Energética Construções">
          <button class="admin-drawer-close" data-shell-close type="button" aria-label="Fechar menu">×</button>
        </div>
        <nav class="admin-navigation" data-shell-navigation aria-label="Módulos">
          ${modules.map(module => `<a class="admin-nav-link" data-shell-route="${escapeHtml(module.id)}" href="${moduleHref(module)}"><span class="admin-nav-icon" aria-hidden="true">${MODULE_ICONS[module.id] || "□"}</span><span>${escapeHtml(module.title)}</span></a>`).join("")}
        </nav>
        <div class="admin-sidebar-user">
          <strong>${escapeHtml(name)}</strong>
          <span>${escapeHtml(email)}</span>
        </div>
      </aside>
      <div class="admin-workspace">
        <header class="admin-topbar">
          <button class="admin-menu-button" data-shell-menu type="button" aria-label="Abrir menu">☰</button>
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
  const menuButton = root.querySelector("[data-shell-menu]");
  const closeButton = root.querySelector("[data-shell-close]");
  const connection = root.querySelector("[data-shell-connection]");
  const content = root.querySelector("[data-app-content]");
  const cleanup = [];
  const setDrawer = open => drawer?.classList.toggle("is-open", open);
  const setConnection = online => {
    if (!connection) return;
    connection.classList.toggle("is-offline", !online);
    connection.textContent = online ? "Conectado" : "Sem conexão";
  };

  menuButton?.addEventListener("click", () => setDrawer(true));
  closeButton?.addEventListener("click", () => setDrawer(false));
  root.querySelector("[data-shell-logout]")?.addEventListener("click", () => session.onLogout?.());
  root.querySelectorAll("[data-shell-route]").forEach(link => link.addEventListener("click", () => setDrawer(false)));
  if (globalThis.window?.addEventListener) {
    const setOnline = () => setConnection(true);
    const setOffline = () => setConnection(false);
    globalThis.window.addEventListener("online", setOnline);
    globalThis.window.addEventListener("offline", setOffline);
    cleanup.push(() => globalThis.window.removeEventListener("online", setOnline));
    cleanup.push(() => globalThis.window.removeEventListener("offline", setOffline));
  }
  setConnection(globalThis.navigator?.onLine !== false);

  function setActiveRoute(route) {
    root.querySelectorAll("[data-shell-route]").forEach(link => {
      const target = link.dataset.shellRoute;
      const active = (route.name === "dashboard" && target === "dashboard")
        || (route.name === "access" && target === "usuarios-acessos")
        || (route.name === "module" && target === route.params.moduleId);
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
