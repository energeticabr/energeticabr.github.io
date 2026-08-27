import assert from "node:assert/strict";
import test from "node:test";
import { buildSuperAdminAccess, can } from "../portal/access/access-model.js";
import { MODULES } from "../portal/catalog/modules.js";
import { ENTITIES } from "../portal/catalog/entities.js";
import { PORTAL_ROUTES, createRouter } from "../portal/core/router.js";
import { renderModuleLanding } from "../portal/app.js";
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

function createRouteAwareRoot(routeIds) {
  const links = routeIds.map(shellRoute => {
    const classes = new Set();
    const attributes = new Map();
    return {
      dataset: { shellRoute },
      classList: {
        toggle(name, active) {
          if (active) classes.add(name);
          else classes.delete(name);
        },
      },
      setAttribute(name, value) { attributes.set(name, value); },
      removeAttribute(name) { attributes.delete(name); },
      addEventListener() {},
      hasClass(name) { return classes.has(name); },
      attribute(name) { return attributes.get(name); },
    };
  });
  const node = () => ({
    classList: { toggle() {} },
    addEventListener() {},
    textContent: "",
  });

  return {
    innerHTML: "",
    links,
    querySelector() { return node(); },
    querySelectorAll(selector) { return selector === "[data-shell-route]" ? links : []; },
  };
}

test("o roteador interpreta rotas validas e volta ao painel para hashes desconhecidos", () => {
  const router = createRouter(PORTAL_ROUTES, { window: createWindow() });

  assert.deepEqual(router.parse("#/module/suprimentos"), {
    name: "module",
    params: { moduleId: "suprimentos" },
    hash: "#/module/suprimentos",
  });
  assert.deepEqual(router.parse("#/reports"), {
    name: "reports",
    params: {},
    hash: "#/reports",
  });
  assert.deepEqual(router.parse("#/analytics/financeiro"), {
    name: "analytics",
    params: { panelId: "financeiro" },
    hash: "#/analytics/financeiro",
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
  assert.equal(router.href("entity-create", { entityId: "cadastro de clientes" }), "#/entity/cadastro%20de%20clientes/new");
  assert.equal(router.href("item", { entityId: "clientes", itemId: "50/1" }), "#/entity/clientes/item/50%2F1");
  assert.equal(router.navigate("module", { moduleId: "suprimentos" }), "#/module/suprimentos");
  assert.equal(router.href("analytics", { panelId: "etapa obra" }), "#/analytics/etapa%20obra");
});

test("o menu do modulo separa Galeria e Lancamento como comandos distintos", () => {
  const root = createRoot();
  const access = buildSuperAdminAccess("bernardonotini@energeticabr.com", "Bernardo", MODULES);

  renderModuleLanding(root, "suprimentos", {
    access,
    can,
    entities: [{
      id: "fornecedores",
      moduleId: "suprimentos",
      title: "Fornecedores",
      available: true,
      capabilities: { view: true, create: true },
    }],
    canCreateEntity: () => true,
  });

  assert.match(root.innerHTML, /class="module-entity-command module-entity-gallery"[^>]+href="#\/entity\/fornecedores"/);
  assert.match(root.innerHTML, />Galeria</);
  assert.match(root.innerHTML, /class="module-entity-command module-entity-create"[^>]+href="#\/entity\/fornecedores\/new"/);
  assert.match(root.innerHTML, />Lançamento</);
});

test("o menu do modulo nao oferece Lancamento sem Form comprovado ou permissao", () => {
  const root = createRoot();
  const access = buildSuperAdminAccess("bernardonotini@energeticabr.com", "Bernardo", MODULES);

  renderModuleLanding(root, "suprimentos", {
    access,
    can,
    entities: [{
      id: "somente-consulta",
      moduleId: "suprimentos",
      title: "Somente consulta",
      available: true,
      capabilities: { view: true, create: true },
    }],
    canCreateEntity: () => false,
  });

  assert.match(root.innerHTML, />Galeria</);
  assert.doesNotMatch(root.innerHTML, />Lançamento</);
});

test("o menu oferece Lancamento quando existem variantes comprovadas para escolher", () => {
  const root = createRoot();
  const access = buildSuperAdminAccess("bernardonotini@energeticabr.com", "Bernardo", MODULES);
  const produtos = ENTITIES.find(entity => entity.id === "produtos");

  renderModuleLanding(root, "suprimentos", {
    access,
    can,
    entities: [produtos],
  });

  assert.match(root.innerHTML, /href="#\/entity\/produtos\/new"[^>]*>Lançamento</);
});

test("a tela de Suprimentos oferece um lançamento e uma galeria por operação", () => {
  const root = createRoot();
  const access = buildSuperAdminAccess("bernardonotini@energeticabr.com", "Bernardo", MODULES);

  renderModuleLanding(root, "suprimentos", {
    access,
    can,
    canCreateEntity: () => true,
  });

  for (const label of [
    "Nova cotação",
    "Orçamentos",
    "Despesas recorrentes",
  ]) {
    const row = new RegExp(`<h3>${label}<\\/h3><div class="module-entity-actions">([\\s\\S]*?)<\\/div>`).exec(root.innerHTML);
    assert.ok(row, `A operação ${label} deve estar visível.`);
    assert.equal((row[1].match(/>Lançamento<\/a>/g) || []).length, 1, `${label} deve ter um lançamento.`);
    assert.equal((row[1].match(/>Galeria<\/a>/g) || []).length, 1, `${label} deve ter uma galeria.`);
  }

  const comprovante = /<h3>Comprovante de pagamento<\/h3><div class="module-entity-actions">([\s\S]*?)<\/div>/.exec(root.innerHTML);
  assert.ok(comprovante, "A operação de comprovante deve estar visível.");
  assert.equal((comprovante[1].match(/href="#\/entity\/lancamentos\/new"[^>]*>Lançamento<\/a>/g) || []).length, 1);
  assert.equal((comprovante[1].match(/>Galeria<\/a>/g) || []).length, 0);
});

test("a tela de Suprimentos expõe os lançamentos operacionais ao administrador", () => {
  const root = createRoot();
  const access = buildSuperAdminAccess("bernardonotini@energeticabr.com", "Bernardo", MODULES);

  renderModuleLanding(root, "suprimentos", { access, can });

  for (const entityId of ["novas-cotacoes", "orcamentos", "despesas-recorrentes"]) {
    assert.match(root.innerHTML, new RegExp(`href="#/entity/${entityId}/new"[^>]*>Lançamento<`));
  }
  assert.match(root.innerHTML, /<h3>Comprovante de pagamento<\/h3>[\s\S]*?href="#\/entity\/lancamentos\/new"[^>]*>Lançamento</);
});

test("a tela de RH abre o lançamento de descritivo de presença em formulário próprio", () => {
  const root = createRoot();
  const access = buildSuperAdminAccess("bernardonotini@energeticabr.com", "Bernardo", MODULES);

  renderModuleLanding(root, "rh-obras", { access, can });

  const row = /<h3>Lançamento descritivo presença<\/h3><div class="module-entity-actions">([\s\S]*?)<\/div>/.exec(root.innerHTML);
  assert.ok(row, "O lançamento de descritivo presença deve estar visível em RH.");
  assert.equal((row[1].match(/href="#\/entity\/descricoes-de-presenca\/new"[^>]*>Lançamento<\/a>/g) || []).length, 1);
  assert.equal((row[1].match(/href="#\/entity\/descricoes-de-presenca"[^>]*>Galeria<\/a>/g) || []).length, 1);
});

test("a tela de Auditoria abre Cadastro documentos no formulário DOCUMENTOS_1", () => {
  const root = createRoot();
  const access = buildSuperAdminAccess("bernardonotini@energeticabr.com", "Bernardo", MODULES);

  renderModuleLanding(root, "auditoria-compliance", { access, can });

  const documents = /<h3>Cadastro documentos<\/h3><div class="module-entity-actions">([\s\S]*?)<\/div>/.exec(root.innerHTML);
  assert.ok(documents, "Cadastro documentos deve estar visível em Auditoria.");
  assert.equal((documents[1].match(/href="#\/entity\/documentos-operacionais\/new"[^>]*>Lançamento<\/a>/g) || []).length, 1);
  assert.equal((documents[1].match(/href="#\/entity\/documentos-operacionais"[^>]*>Galeria<\/a>/g) || []).length, 1);
  assert.match(root.innerHTML, /href="#\/entity\/auditorias"[^>]*>Galeria</);
  assert.doesNotMatch(root.innerHTML, /href="#\/entity\/auditorias\/new"/);
});

test("a tela Comercial nunca repete a Galeria no mesmo bloco", () => {
  const root = createRoot();
  const access = buildSuperAdminAccess("bernardonotini@energeticabr.com", "Bernardo", MODULES);

  renderModuleLanding(root, "comercial", { access, can });

  for (const label of [
    "Cadastro cliente",
    "Cadastro corretor",
    "Cadastro tipo marco",
    "Cadastro tipo patologia",
    "Lançamento receita",
    "Apontamentos comerciais",
    "SAC",
    "Cadastro de homologação comercial",
  ]) {
    const row = new RegExp(`<h3>${label}<\\/h3><div class="module-entity-actions">([\\s\\S]*?)<\\/div>`).exec(root.innerHTML);
    assert.ok(row, `A operação ${label} deve estar visível.`);
    assert.ok((row[1].match(/>Galeria<\/a>/g) || []).length <= 1, `${label} repete a galeria.`);
  }
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

test("rotas de entidade e item mantem selecionado o modulo proprietario", () => {
  const root = createRouteAwareRoot(["dashboard", "suprimentos", "demandas"]);
  const access = buildSuperAdminAccess("bernardonotini@energeticabr.com", "Bernardo", MODULES);
  const shell = renderAppShell(root, {
    account: { username: "bernardonotini@energeticabr.com", name: "Bernardo Notini" },
    access,
    modules: MODULES,
    entities: ENTITIES,
    can,
    isSuperAdmin: true,
  });

  shell.setActiveRoute({ name: "entity", params: { entityId: "fornecedores" } });
  assert.equal(root.links.find(link => link.dataset.shellRoute === "suprimentos").hasClass("is-active"), true);
  assert.equal(root.links.find(link => link.dataset.shellRoute === "suprimentos").attribute("aria-current"), "page");

  shell.setActiveRoute({ name: "item", params: { entityId: "tarefas-delegadas", itemId: "1" } });
  assert.equal(root.links.find(link => link.dataset.shellRoute === "demandas").hasClass("is-active"), true);
  assert.equal(root.links.find(link => link.dataset.shellRoute === "suprimentos").hasClass("is-active"), false);
});

test("o painel carrega indicadores de forma independente quando uma fonte fica indisponivel", async () => {
  const container = createRoot();
  const access = buildSuperAdminAccess("bernardonotini@energeticabr.com", "Bernardo", MODULES);
  const requested = [];
  const repository = {
    async resolveList(_siteKey, aliases) {
      requested.push(aliases[0]);
      if (aliases[0] === "NOTASPENDENTES") throw new Error("Sem acesso a notas pendentes");
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
  assert.equal(requested.includes("LANCAMENTOS"), false);
  assert.match(container.innerHTML, /Atualizações recentes/);
});
