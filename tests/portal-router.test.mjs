import assert from "node:assert/strict";
import test from "node:test";
import { buildSuperAdminAccess, can } from "../portal/access/access-model.js";
import { MODULES } from "../portal/catalog/modules.js";
import { ENTITIES } from "../portal/catalog/entities.js";
import { PORTAL_ROUTES, createRouter } from "../portal/core/router.js";
import { renderDashboard } from "../portal/ui/dashboard-page.js";
import { renderAppShell } from "../portal/ui/app-shell.js";

function createWindow(hash = "#/dashboard") {
  const listeners = new Map();
  return {
    location: { hash },
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
    dispatch(name) {
      listeners.get(name)?.();
    },
  };
}

function createRoot() {
  const nodes = new Map();
  const node = () => ({
    hidden: false,
    textContent: "",
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    addEventListener() {},
    querySelector() { return node(); },
  });

  return {
    innerHTML: "",
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, node());
      return nodes.get(selector);
    },
    querySelectorAll() { return []; },
  };
}

test("o roteador interpreta rotas validas e volta ao painel para hashes desconhecidos", () => {
  const router = createRouter(PORTAL_ROUTES, { window: createWindow() });

  assert.deepEqual(router.parse("#/module/suprimentos"), {
    name: "module",
    params: { moduleId: "suprimentos" },
    hash: "#/module/suprimentos",
  });
  assert.deepEqual(router.parse("#/nao-existe"), {
    name: "dashboard",
    params: {},
    hash: "#/dashboard",
    fallback: true,
  });
});

test("o roteador bloqueia modulo negado mesmo quando a URL e digitada diretamente", () => {
  const router = createRouter(PORTAL_ROUTES, {
    window: createWindow(),
    canRoute(route) {
      return route.name !== "module" || route.params.moduleId !== "financeiro";
    },
  });

  assert.deepEqual(router.parse("#/module/financeiro"), {
    name: "dashboard",
    params: {},
    hash: "#/dashboard",
    fallback: true,
    denied: true,
  });
});

test("o roteador gera URLs seguras para entidade e detalhe", () => {
  const router = createRouter(PORTAL_ROUTES, { window: createWindow() });

  assert.equal(router.href("entity", { entityId: "cadastro de clientes" }), "#/entity/cadastro%20de%20clientes");
  assert.equal(router.href("item", { entityId: "clientes", itemId: "50/1" }), "#/entity/clientes/item/50%2F1");
  assert.equal(router.navigate("module", { moduleId: "suprimentos" }), "#/module/suprimentos");
});

test("o roteador trata codificacao malformada sem lancar erro e notifica assinantes", () => {
  const browser = createWindow("#/entity/%E0%A4%A");
  const router = createRouter(PORTAL_ROUTES, { window: browser });
  const received = [];
  const unsubscribe = router.subscribe(route => received.push(route));

  assert.deepEqual(router.parse(browser.location.hash), {
    name: "dashboard",
    params: {},
    hash: "#/dashboard",
    fallback: true,
  });

  browser.location.hash = "#/access";
  browser.dispatch("hashchange");
  unsubscribe();
  assert.equal(received.at(-1).name, "access");
});

test("o shell mostra somente modulos permitidos e reserva usuarios para superadministrador", () => {
  const root = createRoot();
  const access = buildSuperAdminAccess("bernardonotini@energeticabr.com", "Bernardo", MODULES);
  access.permissions.financeiro.view = false;

  const shell = renderAppShell(root, {
    account: { username: "bernardonotini@energeticabr.com", name: "Bernardo Notini" },
    access,
    modules: MODULES,
    can,
    isSuperAdmin: true,
  });

  assert.ok(shell.content);
  assert.ok(shell.navigation);
  assert.match(root.innerHTML, /Suprimentos/);
  assert.doesNotMatch(root.innerHTML, /Financeiro/);
  assert.match(root.innerHTML, /Usuários e Acessos/);
});

test("o painel carrega indicadores de forma independente quando uma fonte fica indisponivel", async () => {
  const container = createRoot();
  const access = buildSuperAdminAccess("bernardonotini@energeticabr.com", "Bernardo", MODULES);
  const requested = [];
  const repository = {
    async resolveList(_siteKey, aliases) {
      requested.push(aliases[0]);
      if (aliases[0] === "TICKETS CLIENTES") throw new Error("Sem acesso a tickets");
      return { status: "resolved", id: aliases[0] };
    },
    async getItems(_siteKey, id) {
      return [{ id: `${id}-1`, lastModifiedDateTime: "2026-08-26T10:00:00Z", fields: { STATUS: "PENDENTE", Title: `Registro ${id}` } }];
    },
  };

  const dashboard = renderDashboard(container, {
    access,
    modules: MODULES,
    entities: ENTITIES,
    can,
    repository,
    isSuperAdmin: true,
  });
  const summary = await dashboard.ready;

  assert.ok(requested.length > 1);
  assert.ok(summary.modules.some(module => module.id === "usuarios-acessos"));
  assert.ok(summary.indicators.some(indicator => indicator.state === "unavailable"));
  assert.ok(summary.indicators.some(indicator => indicator.count === 1));
  assert.match(container.innerHTML, /Atualizações recentes/);
});
