import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { can } from "../portal/access/access-model.js";
import { createPageLifecycle } from "../portal/core/page-lifecycle.js";
import { createReportsPage } from "../portal/reports/reports-page.js";

const adminCss = readFileSync(new URL("../portal/styles/admin.css", import.meta.url), "utf8");

let appModule;

function fakeElement() {
  return {
    hidden: false,
    disabled: false,
    dataset: {},
    textContent: "",
    addEventListener() {},
    querySelector() { return fakeElement(); },
  };
}

async function loadApp() {
  if (appModule) return appModule;
  const previousDocument = globalThis.document;
  const previousConsoleError = console.error;
  const root = {
    ...fakeElement(),
    innerHTML: "",
    setAttribute() {},
    querySelector() { return fakeElement(); },
  };
  globalThis.document = { getElementById: () => root };
  console.error = () => {};
  try {
    appModule = await import("../portal/app.js?analytics-integration");
    return appModule;
  } finally {
    console.error = previousConsoleError;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

function accessFor(...moduleIds) {
  return {
    active: true,
    permissions: Object.fromEntries(moduleIds.map(moduleId => [moduleId, { view: true }])),
  };
}

function interactiveRoot() {
  let markup = "";
  const listeners = new Map();
  return {
    get innerHTML() { return markup; },
    set innerHTML(value) { markup = String(value); },
    querySelector() { return null; },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
  };
}

test("a rota analitica exige painel conhecido e permissao no modulo proprietario", async () => {
  const app = await loadApp();
  assert.equal(typeof app.isRouteAllowed, "function");
  const panelModules = [
    ["comercial", "comercial"],
    ["financeiro", "financeiro"],
    ["recursos-humanos", "rh-obras"],
    ["etapa-obra", "rh-obras"],
    ["imobilizado", "patrimonio-locacoes"],
    ["auditoria", "auditoria-compliance"],
  ];

  for (const [panelId, moduleId] of panelModules) {
    assert.equal(app.isRouteAllowed({ name: "analytics", params: { panelId } }, {
      access: accessFor(moduleId),
      isSuperAdmin: false,
    }), true, panelId);
    assert.equal(app.isRouteAllowed({ name: "analytics", params: { panelId } }, {
      access: accessFor("relatorios"),
      isSuperAdmin: false,
    }), false, `${panelId} sem modulo`);
  }
  assert.equal(app.isRouteAllowed({ name: "analytics", params: { panelId: "desconhecido" } }, {
    access: accessFor("financeiro"),
    isSuperAdmin: false,
  }), false);
});

test("o Hub mostra somente cards analiticos autorizados mesmo sem fonte operacional", async () => {
  const root = interactiveRoot();
  const page = createReportsPage(root, {
    entities: [],
    analyticsDefinitions: [
      { id: "comercial", title: "COMERCIAL", sourceEntityIds: ["receitas"] },
      { id: "financeiro", title: "FINANCEIRO", sourceEntityIds: ["lancamentos"] },
      { id: "auditoria", title: "AUDITORIA", sourceEntityIds: ["auditorias", "documentos"] },
    ],
    access: accessFor("comercial", "auditoria-compliance"),
    can,
    repository: {},
  });

  await page.ready;

  assert.match(root.innerHTML, /Pain[eé]is anal[ií]ticos/i);
  assert.match(root.innerHTML, /href="#\/analytics\/comercial"[^>]*>[\s\S]*COMERCIAL/);
  assert.match(root.innerHTML, /href="#\/analytics\/auditoria"[^>]*>[\s\S]*AUDITORIA/);
  assert.doesNotMatch(root.innerHTML, /#\/analytics\/financeiro|>FINANCEIRO</);
  assert.match(root.innerHTML, /Nenhuma fonte SharePoint foi liberada/);
  page.cleanup();
});

test("a montagem do Hub pelo aplicativo entrega os paineis e preserva o filtro de acesso", async () => {
  const app = await loadApp();
  assert.equal(typeof app.createReportsRoutePage, "function");
  const root = interactiveRoot();
  const pending = new Promise(() => {});
  const page = app.createReportsRoutePage(root, {
    access: accessFor("relatorios", "comercial"),
  }, {
    resolveList() { return pending; },
    async getColumns() { return []; },
  });

  assert.match(root.innerHTML, /href="#\/analytics\/comercial"/);
  assert.doesNotMatch(root.innerHTML, /#\/analytics\/(financeiro|recursos-humanos|etapa-obra|imobilizado|auditoria)/);
  page.cleanup();
});

test("a montagem analitica bloqueia fontes sem acesso e preserva o painel parcial", async () => {
  const app = await loadApp();
  assert.equal(typeof app.createAnalyticsRoutePage, "function");
  const root = interactiveRoot();
  let repositoryCalls = 0;
  const page = app.createAnalyticsRoutePage(root, {
    name: "analytics",
    params: { panelId: "financeiro" },
  }, {
    access: accessFor("financeiro"),
  }, {
    async resolveList() { repositoryCalls += 1; return { status: "missing" }; },
    async getItemsPage() { repositoryCalls += 1; return { items: [], nextLink: "" }; },
  });

  await page.ready;

  assert.equal(repositoryCalls, 0);
  assert.match(root.innerHTML, /FINANCEIRO/);
  assert.match(root.innerHTML, /Dados parciais/);
  assert.match(root.innerHTML, /Sem permiss[aã]o/);
  assert.doesNotMatch(root.innerHTML, /N[aã]o foi poss[ií]vel carregar este painel/);
  page.dispose();
});

test("o CSS analitico estabiliza cards, diagnosticos, graficos e o layout movel", () => {
  assert.match(adminCss, /\.analytics-hub-grid\s*\{[^}]*grid-template-columns:/is);
  assert.match(adminCss, /\.analytics-hub-card\s*\{[^}]*min-height:/is);
  assert.match(adminCss, /\.analytics-diagnostics\s+ul\s*\{[^}]*display:\s*grid/is);
  assert.match(adminCss, /\.analytics-charts\s*\{[^}]*grid-template-columns:/is);
  assert.match(adminCss, /\.analytics-chart\s+svg\s*\{[^}]*width:\s*100%/is);
  assert.match(adminCss, /@media\s*\(max-width:\s*640px\)[\s\S]*\.analytics-hub-grid[\s\S]*grid-template-columns:\s*1fr/is);
});

test("a troca de rota descarta o painel e aborta todas as fontes pendentes", async () => {
  const app = await loadApp();
  const root = interactiveRoot();
  const signals = [];
  const pending = new Promise(() => {});
  const page = app.createAnalyticsRoutePage(root, {
    name: "analytics",
    params: { panelId: "financeiro" },
  }, {
    access: accessFor("financeiro", "suprimentos", "rh-obras"),
  }, {
    resolveList(_siteKey, _listNames, options) {
      signals.push(options.signal);
      return pending;
    },
    async getItemsPage() { throw new Error("a fonte pendente nao deve avancar"); },
  });
  const lifecycle = createPageLifecycle();
  lifecycle.activate(page);

  lifecycle.replace(() => {
    root.innerHTML = "NOVA_ROTA";
    return undefined;
  });

  assert.equal(signals.length, 4);
  assert.equal(signals.every(signal => signal.aborted), true);
  assert.equal(root.innerHTML, "NOVA_ROTA");
});
