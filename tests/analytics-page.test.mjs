import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyticsPage } from "../portal/analytics/analytics-page.js";

const definition = Object.freeze({
  id: "comercial",
  title: "PAINEL COMERCIAL",
  sourceEntityIds: ["receitas", "filiais"],
  filters: [
    { id: "filial", title: "Filial", aliases: ["FILIAL"] },
  ],
  kpis: [
    { id: "total", title: "Total recebido", operation: "sum", aliases: ["VALOR"], format: "currency" },
  ],
  charts: [
    { id: "por-filial", title: "Receita por filial", type: "barChart", dimensionAliases: ["FILIAL"], operation: "sum", valueAliases: ["VALOR"], format: "currency" },
  ],
  table: {
    id: "receitas",
    title: "Receitas",
    columns: [
      { id: "filial", title: "Filial", aliases: ["FILIAL"], type: "text" },
      { id: "valor", title: "Valor", aliases: ["VALOR"], type: "currency" },
    ],
  },
});

const records = Object.freeze([
  Object.freeze({ id: "1", sourceId: "receitas", fields: Object.freeze({ FILIAL: "OURO PRETO", VALOR: 1500 }) }),
  Object.freeze({ id: "2", sourceId: "receitas", fields: Object.freeze({ FILIAL: "DIVINÓPOLIS", VALOR: 2500 }) }),
]);

const entities = Object.freeze([
  Object.freeze({ id: "receitas", moduleId: "comercial", title: "Receitas" }),
  Object.freeze({ id: "filiais", moduleId: "comercial", title: "Filiais" }),
]);

function analyticsResult(overrides = {}) {
  return Object.freeze({
    records,
    diagnostics: Object.freeze([
      Object.freeze({ sourceId: "receitas", state: "ready", complete: true, loadedCount: 2, pageCount: 1, message: "" }),
      Object.freeze({ sourceId: "filiais", state: "ready", complete: true, loadedCount: 0, pageCount: 1, message: "" }),
    ]),
    complete: true,
    ...overrides,
  });
}

function createRoot() {
  let markup = "";
  const listeners = new Map();
  return {
    get innerHTML() { return markup; },
    set innerHTML(value) { markup = String(value); },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type, target) {
      const event = {
        target,
        preventDefault() {},
        key: target?.key,
      };
      for (const listener of listeners.get(type) || []) listener(event);
    },
    listenerCount() {
      return [...listeners.values()].reduce((total, values) => total + values.size, 0);
    },
  };
}

function context(overrides = {}) {
  return {
    definition,
    repository: {},
    entities,
    access: {},
    can: () => true,
    normalizeDefinition: value => value,
    loadData: async () => analyticsResult(),
    ...overrides,
  };
}

test("carrega múltiplas fontes e apresenta cabeçalho, diagnóstico, KPIs, SVG e tabela", async () => {
  const root = createRoot();
  let received;
  const page = createAnalyticsPage(root, context({
    async loadData(repository, receivedDefinition, catalog, options) {
      received = { repository, receivedDefinition, catalog, options };
      return analyticsResult();
    },
  }));

  await page.ready;

  assert.equal(received.receivedDefinition, definition);
  assert.deepEqual(received.catalog, entities);
  assert.equal(received.options.signal.aborted, false);
  assert.match(root.innerHTML, /PAINEL COMERCIAL/);
  assert.match(root.innerHTML, /Receitas/);
  assert.match(root.innerHTML, /Filiais/);
  assert.match(root.innerHTML, /2 registros/);
  assert.match(root.innerHTML, /R\$\s*4\.000,00/);
  assert.match(root.innerHTML, /<svg[^>]+role="img"/);
  assert.match(root.innerHTML, /OURO PRETO/);
  assert.match(root.innerHTML, /DIVINÓPOLIS/);
  page.dispose();
});

test("clique em série aplica cross-filter no filtro cuja alias cruza a dimensão e permite limpar", async () => {
  const root = createRoot();
  const page = createAnalyticsPage(root, context());
  await page.ready;

  root.dispatch("click", {
    dataset: { analyticsSeries: "OURO PRETO", analyticsChart: "por-filial" },
  });

  assert.match(root.innerHTML, /value="OURO PRETO" selected/);
  assert.match(root.innerHTML, /OURO PRETO/);
  assert.doesNotMatch(root.innerHTML, /<td[^>]*>DIVINÓPOLIS<\/td>/);

  root.dispatch("click", { dataset: { analyticsClear: "" } });
  assert.doesNotMatch(root.innerHTML, /value="OURO PRETO" selected/);
  assert.match(root.innerHTML, /<td[^>]*>DIVINÓPOLIS<\/td>/);
  page.dispose();
});

test("mantém os dados úteis e mostra erro parcial por fonte", async () => {
  const root = createRoot();
  const page = createAnalyticsPage(root, context({
    loadData: async () => analyticsResult({
      complete: false,
      diagnostics: Object.freeze([
        Object.freeze({ sourceId: "receitas", state: "ready", complete: true, loadedCount: 2, pageCount: 1, message: "" }),
        Object.freeze({ sourceId: "filiais", state: "forbidden", complete: false, loadedCount: 0, pageCount: 0, message: "Sem permissão para consultar Filiais." }),
      ]),
    }),
  }));

  await page.ready;

  assert.match(root.innerHTML, /Dados parciais/);
  assert.match(root.innerHTML, /Sem permissão para consultar Filiais\./);
  assert.match(root.innerHTML, /R\$\s*4\.000,00/);
  assert.match(root.innerHTML, /role="alert"/);
  page.dispose();
});

test("exporta para CSV somente as linhas filtradas e escapa células", async () => {
  const root = createRoot();
  let download;
  const page = createAnalyticsPage(root, context({
    download(fileName, contents) { download = { fileName, contents }; },
    loadData: async () => analyticsResult({
      records: Object.freeze([
        Object.freeze({ id: "1", sourceId: "receitas", fields: Object.freeze({ FILIAL: "OURO PRETO; SUL", VALOR: 1500 }) }),
        Object.freeze({ id: "2", sourceId: "receitas", fields: Object.freeze({ FILIAL: "DIVINÓPOLIS; CENTRO", VALOR: 2500 }) }),
      ]),
    }),
  }));
  await page.ready;

  root.dispatch("change", { dataset: { analyticsFilter: "filial" }, value: "OURO PRETO; SUL" });
  root.dispatch("click", { dataset: { analyticsExport: "" } });

  assert.match(download.fileName, /^painel-comercial-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.match(download.contents, /^\uFEFFFilial;Valor/m);
  assert.match(download.contents, /"OURO PRETO; SUL";1500/);
  assert.doesNotMatch(download.contents, /DIVINÓPOLIS/);
  page.dispose();
});

test("dispose aborta a carga, remove eventos e impede renderização tardia", async () => {
  const root = createRoot();
  let resolveLoad;
  let signal;
  const page = createAnalyticsPage(root, context({
    loadData(_repository, _definition, _entities, options) {
      signal = options.signal;
      return new Promise(resolve => { resolveLoad = resolve; });
    },
  }));

  const loadingMarkup = root.innerHTML;
  assert.ok(root.listenerCount() > 0);
  page.dispose();
  assert.equal(signal.aborted, true);
  assert.equal(root.listenerCount(), 0);

  resolveLoad(analyticsResult());
  await page.ready;
  assert.equal(root.innerHTML, loadingMarkup);
});
