import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildSuperAdminAccess, can } from "../portal/access/access-model.js";
import { MODULES } from "../portal/catalog/modules.js";
import { renderAppShell } from "../portal/ui/app-shell.js";

function classList() {
  const values = new Set();
  return {
    add(name) { values.add(name); },
    remove(name) { values.delete(name); },
    toggle(name, force) {
      const enabled = force === undefined ? !values.has(name) : Boolean(force);
      if (enabled) values.add(name);
      else values.delete(name);
      return enabled;
    },
    contains(name) { return values.has(name); },
  };
}

function interactiveNode(dataset = {}) {
  const listeners = new Map();
  const attributes = new Map();
  return {
    dataset,
    classList: classList(),
    textContent: "",
    addEventListener(name, listener) { listeners.set(name, listener); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    dispatch(name) { listeners.get(name)?.({ currentTarget: this }); },
    attribute(name) { return attributes.get(name); },
  };
}

function createShellRoot(routeIds = MODULES.map(module => module.id)) {
  const shell = interactiveNode();
  const drawer = interactiveNode();
  const collapse = interactiveNode();
  const routes = routeIds.map(shellRoute => interactiveNode({ shellRoute }));
  const nodes = new Map([
    ["[data-admin-shell]", shell],
    ["[data-shell-drawer]", drawer],
    ["[data-shell-menu]", interactiveNode()],
    ["[data-shell-close]", interactiveNode()],
    ["[data-shell-collapse]", collapse],
    ["[data-shell-connection]", interactiveNode()],
    ["[data-app-content]", interactiveNode()],
    ["[data-shell-navigation]", interactiveNode()],
    ["[data-shell-logout]", interactiveNode()],
  ]);

  return {
    dataset: {},
    innerHTML: "",
    shell,
    collapse,
    routes,
    querySelector(selector) { return nodes.get(selector) || null; },
    querySelectorAll(selector) { return selector === "[data-shell-route]" ? routes : []; },
  };
}

function session(email = "identidade@energeticabr.com") {
  return {
    account: { username: email, name: "Equipe Energética" },
    access: buildSuperAdminAccess(email, "Equipe Energética", MODULES),
    modules: MODULES,
    can,
    isSuperAdmin: true,
  };
}

test("o shell usa a identidade oficial e oferece controles acessiveis para recolher a navegacao", () => {
  const root = createShellRoot();

  renderAppShell(root, session("marca@energeticabr.com"));

  assert.match(root.innerHTML, /assets\/logo-energetica-oficial\.png/);
  assert.match(root.innerHTML, /assets\/mascote-energetica-transparente\.png/);
  assert.match(root.innerHTML, /data-shell-collapse/);
  assert.match(root.innerHTML, /aria-label="Recolher menu"/);
  assert.match(root.innerHTML, /data-tooltip="Suprimentos"/);
});

test("o menu recolhido permanece recolhido ao trocar a rota e ao reconstruir o shell na mesma sessao", () => {
  const email = "estado-shell@energeticabr.com";
  const firstRoot = createShellRoot();
  const firstShell = renderAppShell(firstRoot, session(email));

  firstRoot.collapse.dispatch("click");
  assert.equal(firstRoot.shell.classList.contains("is-sidebar-collapsed"), true);
  assert.equal(firstRoot.collapse.attribute("aria-expanded"), "false");
  assert.equal(firstRoot.collapse.attribute("aria-label"), "Expandir menu");

  firstShell.setActiveRoute({ name: "module", params: { moduleId: "demandas" } });
  assert.equal(firstRoot.shell.classList.contains("is-sidebar-collapsed"), true);
  assert.equal(firstRoot.shell.dataset.activeModule, "demandas");

  const secondRoot = createShellRoot();
  renderAppShell(secondRoot, session(email));
  assert.equal(secondRoot.shell.classList.contains("is-sidebar-collapsed"), true);
});

test("cada modulo ativo aplica sua identidade sem retirar o estado selecionado da navegacao", () => {
  const root = createShellRoot();
  const shell = renderAppShell(root, session("modulos@energeticabr.com"));

  shell.setActiveRoute({ name: "module", params: { moduleId: "comercial" } });

  const active = root.routes.find(link => link.dataset.shellRoute === "comercial");
  assert.equal(active.classList.contains("is-active"), true);
  assert.equal(active.attribute("aria-current"), "page");
  assert.equal(root.shell.dataset.activeModule, "comercial");
});

test("o CSS sustenta os modos compacto e movel e exibe tooltips somente no compacto", async () => {
  const css = await readFile(new URL("../portal/styles/admin.css", import.meta.url), "utf8");

  assert.match(css, /\.admin-shell\.is-sidebar-collapsed\s*\{[^}]*grid-template-columns:\s*76px\s+minmax\(0,\s*1fr\)/i);
  assert.match(css, /\.admin-shell\.is-sidebar-collapsed[\s\S]*?\.admin-nav-link::after\s*\{[^}]*content:\s*attr\(data-tooltip\)/i);
  assert.match(css, /\.admin-shell\[data-active-module="comercial"\][^}]*--module-accent:/i);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.admin-shell\.is-sidebar-collapsed\s*\{[^}]*display:\s*block/i);
});
