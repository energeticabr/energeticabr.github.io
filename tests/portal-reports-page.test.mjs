import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { availableReportEntities, createReportsPage, reportsPageMarkup } from "../portal/reports/reports-page.js";

const adminCss = readFileSync(new URL("../portal/styles/admin.css", import.meta.url), "utf8");

const entities = Object.freeze([
  Object.freeze({ id: "clientes", title: "Clientes", moduleId: "comercial", available: true }),
  Object.freeze({ id: "lancamentos", title: "Lançamentos", moduleId: "suprimentos", available: true }),
  Object.freeze({ id: "legado", title: "Legado indisponível", moduleId: "comercial", available: false }),
]);

const acceptCatalogSources = (_repository, candidates) => candidates;

test("oferece somente fontes disponiveis que o usuario pode visualizar", () => {
  const access = { marker: true };
  const visible = availableReportEntities(entities, access, (_record, moduleId, action) => moduleId === "comercial" && action === "view");

  assert.deepEqual(visible.map(entity => entity.id), ["clientes"]);
  assert.ok(Object.isFrozen(visible));
});

function reportData(titles, overrides = {}) {
  const items = titles.map((title, index) => ({
    id: String(index + 1),
    fields: { Title: title, STATUS: index % 2 === 0 ? "PENDENTE" : "FINALIZADO" },
  }));
  return {
    state: "ready",
    columns: [
      { name: "Title", label: "Nome", hidden: false },
      { name: "STATUS", label: "Status", hidden: false },
    ],
    rawColumns: [
      { name: "Title", displayName: "Nome", text: {} },
      { name: "STATUS", displayName: "Status", text: {} },
    ],
    items,
    dimensions: { dateFields: [], branchField: "", statusField: "STATUS" },
    complete: true,
    partialReason: "",
    loadedCount: items.length,
    pageCount: Math.max(1, Math.ceil(items.length / 2)),
    serverFilterField: "",
    limit: { batchSize: 2, maxItems: 5000, maxPages: 25 },
    ...overrides,
  };
}

test("renderiza indicadores consolidados e pagina somente a tabela visivel", () => {
  const data = reportData(["ANA", "BRUNO", "CARLA"]);
  const markup = reportsPageMarkup({
    sources: entities.slice(0, 2),
    selectedEntityId: "clientes",
    state: "ready",
    data,
    view: {
      items: data.items,
      metrics: { loaded: 3, filtered: 3, pending: 2, finalized: 1 },
      options: { branches: [], statuses: ["FINALIZADO", "PENDENTE"] },
      columns: data.columns,
      activeDateField: null,
    },
    filters: {},
    displayPage: 1,
    displayPageSize: 2,
  });

  assert.match(markup, /Registros consolidados/);
  assert.match(markup, /Resultados da consulta/);
  assert.match(markup, /Exportar consulta CSV/);
  assert.match(markup, /Imprimir consulta/);
  assert.match(markup, /ANA/);
  assert.match(markup, /BRUNO/);
  assert.doesNotMatch(markup, /CARLA/);
  assert.match(markup, /Página 1 de 2/);
  assert.doesNotMatch(markup, /somente este lote|Registros no lote|Exportar lote/i);
});

test("explicita relatorio parcial sem afirmar total", () => {
  const data = reportData(["ANA"], {
    complete: false,
    partialReason: "max-items",
    loadedCount: 5000,
    pageCount: 25,
    limit: { batchSize: 200, maxItems: 5000, maxPages: 25 },
  });
  const markup = reportsPageMarkup({
    sources: [entities[0]],
    selectedEntityId: "clientes",
    state: "ready",
    data,
    view: {
      items: data.items,
      metrics: { loaded: 5000, filtered: 1, pending: 1, finalized: 0 },
      options: { branches: [], statuses: ["PENDENTE"] },
      columns: data.columns,
      activeDateField: null,
    },
    filters: {},
    displayPage: 1,
    displayPageSize: 50,
  });

  assert.match(markup, /Relatório parcial/i);
  assert.match(markup, /5\.000 registros carregados/i);
  assert.match(markup, /limite operacional/i);
  assert.doesNotMatch(markup, /\btotal\b/i);
});

test("explica quando nenhuma fonte SharePoint foi liberada", () => {
  const markup = reportsPageMarkup({ sources: [], state: "empty", filters: {} });
  assert.match(markup, /Nenhuma fonte SharePoint foi liberada/);
  assert.doesNotMatch(markup, /data-report-export/);
});

test("mostra carregamento enquanto descobre as fontes autorizadas", async () => {
  const root = interactiveRoot();
  const discovery = deferred();
  const page = createReportsPage(root, {
    entities: entities.slice(0, 2),
    access: {},
    can: () => true,
    repository: {},
    discoverSources() { return discovery.promise; },
    loadSource() { return Promise.resolve(reportData(["PRONTO"])); },
  });

  assert.match(root.innerHTML, /Verificando fontes SharePoint/i);
  assert.doesNotMatch(root.innerHTML, /Nenhuma fonte SharePoint foi liberada/i);

  discovery.resolve([entities[0]]);
  await page.ready;
  assert.match(root.innerHTML, /Clientes/);
  assert.doesNotMatch(root.innerHTML, /Lançamentos/);
  page.cleanup();
});

test("oculta no seletor listas ausentes ou proibidas apos descoberta autorizada", async () => {
  const root = interactiveRoot();
  const runtimeEntities = [
    { ...entities[0], siteKey: "company", listNames: ["CLIENTES"] },
    { ...entities[1], siteKey: "company", listNames: ["LANCAMENTOS"] },
    { id: "restrita", title: "Fonte restrita", moduleId: "comercial", available: true, siteKey: "company", listNames: ["RESTRITA"] },
  ];
  const calls = [];
  const repository = {
    async resolveList(_siteKey, names, options) {
      calls.push(["resolve", names[0], options?.signal]);
      if (names[0] === "LANCAMENTOS") return { status: "missing" };
      return { status: "resolved", id: names[0].toLowerCase() };
    },
    async getColumns(_siteKey, listId, options) {
      calls.push(["columns", listId, options?.signal]);
      if (listId === "restrita") throw Object.assign(new Error("Negado"), { status: 403 });
      return [];
    },
  };
  const page = createReportsPage(root, {
    entities: runtimeEntities,
    access: {},
    can: () => true,
    repository,
    loadSource() { return Promise.resolve(reportData(["CLIENTE AUTORIZADO"])); },
  });

  await page.ready;

  assert.match(root.innerHTML, /Clientes/);
  assert.doesNotMatch(root.innerHTML, /Lançamentos/);
  assert.doesNotMatch(root.innerHTML, /Fonte restrita/);
  assert.equal(calls.filter(call => call[0] === "resolve").length, 3);
  assert.equal(calls.filter(call => call[0] === "columns").length, 2);
  assert.equal(calls.every(call => call[2] instanceof AbortSignal), true);
  page.cleanup();
});

test("estilos diferenciam progresso, parcialidade e impressao consolidada", () => {
  assert.match(adminCss, /\.reports-progress\s*\{/);
  assert.match(adminCss, /\.reports-partial\s*\{/);
  assert.match(adminCss, /\.report-print-dataset\s*\{[^}]*display:\s*none/is);
  assert.match(adminCss, /@media print[\s\S]*\.report-screen-table\s*\{[^}]*display:\s*none/is);
  assert.match(adminCss, /@media print[\s\S]*\.report-print-dataset\s*\{[^}]*display:\s*block/is);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function interactiveRoot() {
  let markup = "";
  let controls = new Map();
  return {
    get innerHTML() { return markup; },
    set innerHTML(value) { markup = value; controls = new Map(); },
    querySelector(selector) {
      if (!controls.has(selector)) {
        const listeners = new Map();
        controls.set(selector, {
          value: "",
          addEventListener(name, listener) { listeners.set(name, listener); },
          trigger(name, value) {
            this.value = value;
            return listeners.get(name)?.({ target: this });
          },
        });
      }
      return controls.get(selector);
    },
    control(selector) { return this.querySelector(selector); },
  };
}

test("troca de fonte aborta e ignora a resposta atrasada da fonte anterior", async () => {
  const root = interactiveRoot();
  const first = deferred();
  const calls = [];
  const page = createReportsPage(root, {
    entities: entities.slice(0, 2),
    access: {},
    can: () => true,
    discoverSources: acceptCatalogSources,
    repository: {},
    loadSource(_repository, entity, options) {
      calls.push({ entity: entity.id, signal: options.signal });
      return entity.id === "clientes" ? first.promise : Promise.resolve(reportData(["FONTE NOVA"]));
    },
  });

  root.control("[data-report-source]").trigger("change", "lancamentos");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls[0].signal.aborted, true);
  assert.match(root.innerHTML, /FONTE NOVA/);

  first.resolve(reportData(["FONTE ANTIGA"]));
  await page.ready;
  assert.doesNotMatch(root.innerHTML, /FONTE ANTIGA/);
  page.cleanup();
});

test("troca de filtro aborta a consulta ativa e reinicia com o filtro novo", async () => {
  const root = interactiveRoot();
  const first = deferred();
  const calls = [];
  const page = createReportsPage(root, {
    entities: [entities[0]],
    access: {},
    can: () => true,
    discoverSources: acceptCatalogSources,
    repository: {},
    loadSource(_repository, _entity, options) {
      calls.push(options);
      return calls.length === 1 ? first.promise : Promise.resolve(reportData(["FILTRADO"]));
    },
  });

  root.control("[data-report-status]").trigger("change", "PENDENTE");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[1].filters.status, "PENDENTE");
  assert.match(root.innerHTML, /FILTRADO/);
  first.resolve(reportData(["ANTIGO"]));
  await page.ready;
  assert.doesNotMatch(root.innerHTML, /ANTIGO/);
  page.cleanup();
});

test("mostra progresso incremental enquanto a consulta continua", async () => {
  const root = interactiveRoot();
  const pending = deferred();
  const page = createReportsPage(root, {
    entities: [entities[0]],
    access: {},
    can: () => true,
    discoverSources: acceptCatalogSources,
    repository: {},
    async loadSource(_repository, _entity, options) {
      options.onProgress({ loadedCount: 400, pageCount: 2, maxItems: 5000, maxPages: 25, complete: false, partialReason: "" });
      return pending.promise;
    },
  });

  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(root.innerHTML, /data-report-progress/);
  assert.match(root.innerHTML, /400 registros/);
  assert.match(root.innerHTML, /2 páginas Graph/);
  pending.resolve(reportData(["PRONTO"]));
  await page.ready;
  page.cleanup();
});

test("CSV, impressao e indicadores recebem a consulta consolidada, nao a pagina visual", async () => {
  const root = interactiveRoot();
  const downloads = [];
  const prints = [];
  const page = createReportsPage(root, {
    entities: [entities[0]],
    access: {},
    can: () => true,
    discoverSources: acceptCatalogSources,
    repository: {},
    pageSize: 2,
    loadSource() { return Promise.resolve(reportData(["ANA", "BRUNO", "CARLA"])); },
    download(name, contents) { downloads.push({ name, contents }); },
    print(view, metadata) { prints.push({ view, metadata }); },
  });

  await page.ready;
  assert.doesNotMatch(root.innerHTML, /CARLA/);
  await root.control("[data-report-export]").trigger("click");
  await root.control("[data-report-print]").trigger("click");
  assert.match(downloads[0].contents, /CARLA/);
  assert.equal(prints[0].view.items.length, 3);
  assert.equal(prints[0].metadata.complete, true);
  page.cleanup();
});

test("paginacao visual nao faz nova consulta Graph", async () => {
  const root = interactiveRoot();
  let loads = 0;
  const page = createReportsPage(root, {
    entities: [entities[0]],
    access: {},
    can: () => true,
    discoverSources: acceptCatalogSources,
    repository: {},
    pageSize: 2,
    loadSource() { loads += 1; return Promise.resolve(reportData(["ANA", "BRUNO", "CARLA"])); },
  });

  await page.ready;
  root.control("[data-report-next]").trigger("click");
  assert.equal(loads, 1);
  assert.match(root.innerHTML, /CARLA/);
  assert.match(root.innerHTML, /Página 2 de 2/);
  page.cleanup();
});

test("troca de rota cancela a consolidacao pendente", async () => {
  const root = interactiveRoot();
  const pending = deferred();
  let signal;
  const page = createReportsPage(root, {
    entities: [entities[0]],
    access: {},
    can: () => true,
    discoverSources: acceptCatalogSources,
    repository: {},
    loadSource(_repository, _entity, options) {
      signal = options.signal;
      return pending.promise;
    },
  });

  page.cleanup();
  assert.equal(signal.aborted, true);
  pending.resolve(reportData(["ATRASADO"]));
  await page.ready;
  assert.doesNotMatch(root.innerHTML, /ATRASADO/);
});

test("troca de rota cancela a descoberta pendente e ignora seu retorno tardio", async () => {
  const root = interactiveRoot();
  const pending = deferred();
  let signal;
  const page = createReportsPage(root, {
    entities: [entities[0]],
    access: {},
    can: () => true,
    repository: {},
    discoverSources(_repository, _candidates, options) {
      signal = options.signal;
      return pending.promise;
    },
    loadSource() {
      throw new Error("Uma fonte descoberta depois do descarte não pode ser carregada.");
    },
  });

  page.cleanup();
  assert.equal(signal.aborted, true);
  pending.resolve([entities[0]]);
  await page.ready;
  assert.doesNotMatch(root.innerHTML, /Clientes/);
});
