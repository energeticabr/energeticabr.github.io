import assert from "node:assert/strict";
import test from "node:test";
import { loadAnalyticsData } from "../portal/analytics/analytics-data.js";

const catalog = Object.freeze([
  Object.freeze({
    id: "clientes",
    title: "Clientes",
    moduleId: "comercial",
    siteKey: "personal",
    listNames: Object.freeze(["CADASTRO CLIENTE"]),
    available: true,
    capabilities: Object.freeze({ view: true }),
  }),
  Object.freeze({
    id: "tickets",
    title: "Tickets",
    moduleId: "comercial",
    siteKey: "company",
    listNames: Object.freeze(["TICKETS CLIENTES"]),
    available: true,
    capabilities: Object.freeze({ view: true }),
  }),
  Object.freeze({
    id: "segredos",
    title: "Segredos",
    moduleId: "financeiro",
    siteKey: "personal",
    listNames: Object.freeze(["SEGREDOS"]),
    available: false,
    capabilities: Object.freeze({ view: false }),
  }),
]);

const definition = Object.freeze({
  id: "visao-comercial",
  sourceEntityIds: Object.freeze(["clientes", "tickets"]),
});

function page(items, nextLink = "") {
  return Object.freeze({
    items: Object.freeze(items),
    nextLink,
    hasMore: Boolean(nextLink),
  });
}

function repositoryFromSources(sources, calls = []) {
  return {
    async resolveList(siteKey, listNames, options) {
      calls.push(["resolve", siteKey, listNames, options?.signal]);
      const source = sources[listNames[0]];
      if (source?.resolveError) throw source.resolveError;
      return source?.missing ? { status: "missing" } : { status: "resolved", id: source?.listId || listNames[0] };
    },
    async getItemsPage(siteKey, listId, query, options) {
      calls.push(["page", siteKey, listId, query, { ...options }]);
      const source = Object.values(sources).find(candidate => (candidate.listId || candidate.name) === listId);
      if (source?.pageError) throw source.pageError;
      return source?.pages?.[options.pageNumber - 1] || page([]);
    },
  };
}

test("carrega somente fontes declaradas, catalogadas e permitidas sem inventar listas", async () => {
  const calls = [];
  const repository = repositoryFromSources({
    "CADASTRO CLIENTE": {
      name: "CADASTRO CLIENTE",
      listId: "lista-clientes",
      pages: [page([{ id: "7", fields: { Title: "ANA" } }])],
    },
  }, calls);

  const result = await loadAnalyticsData(repository, {
    sourceEntityIds: ["clientes", "desconhecida", "segredos"],
  }, catalog);

  assert.deepEqual(result.records, [{ id: "7", sourceId: "clientes", fields: { Title: "ANA" } }]);
  assert.deepEqual(calls.filter(call => call[0] === "resolve").map(call => call.slice(1, 3)), [
    ["personal", catalog[0].listNames],
  ]);
  assert.equal(result.diagnostics.find(item => item.sourceId === "clientes").state, "ready");
  assert.equal(result.diagnostics.find(item => item.sourceId === "desconhecida").state, "unknown");
  assert.equal(result.diagnostics.find(item => item.sourceId === "segredos").state, "forbidden");
  assert.equal(result.complete, false);
});

test("pagina cada fonte com limites e preserva IDs iguais em fontes diferentes", async () => {
  const clientesNext = "https://graph.microsoft.com/v1.0/sites/personal/lists/lista-clientes/items?$skiptoken=2";
  const ticketsNext = "https://graph.microsoft.com/v1.0/sites/company/lists/lista-tickets/items?$skiptoken=2";
  const calls = [];
  const repository = repositoryFromSources({
    "CADASTRO CLIENTE": {
      name: "CADASTRO CLIENTE",
      listId: "lista-clientes",
      pages: [
        page([{ id: "1", fields: { Title: "ANA" } }], clientesNext),
        page([{ id: "2", fields: { Title: "BRUNO" } }]),
      ],
    },
    "TICKETS CLIENTES": {
      name: "TICKETS CLIENTES",
      listId: "lista-tickets",
      pages: [
        page([{ id: "1", fields: { Title: "SUPORTE" } }], ticketsNext),
        page([{ id: "2", fields: { Title: "OBRA" } }]),
      ],
    },
  }, calls);

  const result = await loadAnalyticsData(repository, definition, catalog, {
    maxPages: 5,
    maxItems: 10,
    concurrency: 2,
  });

  assert.deepEqual(result.records.map(record => `${record.sourceId}:${record.id}`), [
    "clientes:1",
    "clientes:2",
    "tickets:1",
    "tickets:2",
  ]);
  const pageCalls = calls.filter(call => call[0] === "page");
  assert.equal(pageCalls.length, 4);
  assert.equal(pageCalls.every(call => call[3] === "$expand=fields&$top=200"), true);
  assert.equal(pageCalls.every(call => call[4].maxPages === 5), true);
  assert.equal(result.complete, true);
});

test("marca a fonte como parcial ao atingir maxItems sem ultrapassar o limite", async () => {
  const nextLink = "https://graph.microsoft.com/v1.0/sites/personal/lists/lista-clientes/items?$skiptoken=3";
  const repository = repositoryFromSources({
    "CADASTRO CLIENTE": {
      name: "CADASTRO CLIENTE",
      listId: "lista-clientes",
      pages: [page([
        { id: "1", fields: { Title: "ANA" } },
        { id: "2", fields: { Title: "BRUNO" } },
        { id: "3", fields: { Title: "CARLA" } },
      ], nextLink)],
    },
  });

  const result = await loadAnalyticsData(repository, { sourceEntityIds: ["clientes"] }, catalog, {
    maxItems: 2,
    maxPages: 5,
  });

  assert.deepEqual(result.records.map(record => record.id), ["1", "2"]);
  assert.deepEqual(result.diagnostics[0], {
    sourceId: "clientes",
    state: "partial",
    complete: false,
    loadedCount: 2,
    pageCount: 1,
    partialReason: "max-items",
    message: "Limite de 2 registros atingido.",
  });
  assert.equal(result.complete, false);
});

test("interrompe a paginação exatamente em maxPages e diagnostica o recorte", async () => {
  const calls = [];
  const nextOne = "https://graph.microsoft.com/v1.0/sites/personal/lists/lista-clientes/items?$skiptoken=2";
  const nextTwo = "https://graph.microsoft.com/v1.0/sites/personal/lists/lista-clientes/items?$skiptoken=3";
  const repository = repositoryFromSources({
    "CADASTRO CLIENTE": {
      name: "CADASTRO CLIENTE",
      listId: "lista-clientes",
      pages: [
        page([{ id: "1", fields: {} }], nextOne),
        page([{ id: "2", fields: {} }], nextTwo),
        page([{ id: "3", fields: {} }]),
      ],
    },
  }, calls);

  const result = await loadAnalyticsData(repository, { sourceEntityIds: ["clientes"] }, catalog, {
    maxPages: 2,
    maxItems: 10,
  });

  assert.deepEqual(result.records.map(record => record.id), ["1", "2"]);
  assert.equal(calls.filter(call => call[0] === "page").length, 2);
  assert.equal(result.diagnostics[0].state, "partial");
  assert.equal(result.diagnostics[0].partialReason, "max-pages");
  assert.equal(result.diagnostics[0].message, "Limite de 2 páginas atingido.");
  assert.equal(result.complete, false);
});

test("não consulta entidade catalogada sem site e aliases físicos válidos", async () => {
  let calls = 0;
  const repository = {
    async resolveList() {
      calls += 1;
      return { status: "resolved", id: "inventada" };
    },
    async getItemsPage() { return page([]); },
  };
  const invalidCatalog = [{
    id: "invalida",
    available: true,
    capabilities: { view: true },
    siteKey: "",
    listNames: [],
  }];

  const result = await loadAnalyticsData(repository, { sourceEntityIds: ["invalida"] }, invalidCatalog);

  assert.equal(calls, 0);
  assert.equal(result.diagnostics[0].state, "invalid");
  assert.equal(result.complete, false);
});

test("isola falha de uma fonte e mantém os registros das demais", async () => {
  const forbidden = new Error("Acesso negado");
  forbidden.status = 403;
  const repository = repositoryFromSources({
    "CADASTRO CLIENTE": {
      name: "CADASTRO CLIENTE",
      listId: "lista-clientes",
      pages: [page([{ id: "10", fields: { Title: "ANA" } }])],
    },
    "TICKETS CLIENTES": {
      name: "TICKETS CLIENTES",
      resolveError: forbidden,
    },
  });

  const result = await loadAnalyticsData(repository, definition, catalog);

  assert.deepEqual(result.records.map(record => record.id), ["10"]);
  assert.equal(result.diagnostics.find(item => item.sourceId === "clientes").state, "ready");
  assert.equal(result.diagnostics.find(item => item.sourceId === "tickets").state, "forbidden");
  assert.equal(result.complete, false);
});

test("interrompe toda a carga quando o AbortSignal é cancelado", async () => {
  const controller = new AbortController();
  const nextLink = "https://graph.microsoft.com/v1.0/sites/personal/lists/lista-clientes/items?$skiptoken=2";
  const repository = repositoryFromSources({
    "CADASTRO CLIENTE": {
      name: "CADASTRO CLIENTE",
      listId: "lista-clientes",
      pages: [page([{ id: "1", fields: {} }], nextLink)],
    },
  });

  await assert.rejects(loadAnalyticsData(repository, { sourceEntityIds: ["clientes"] }, catalog, {
    signal: controller.signal,
    onProgress() { controller.abort(); },
  }), error => error?.name === "AbortError" && error?.code === "analytics_aborted");
});

test("respeita o teto de concorrência e reporta progresso por fonte", async () => {
  const extendedCatalog = Object.freeze(["a", "b", "c", "d"].map(id => Object.freeze({
    id,
    title: id.toUpperCase(),
    moduleId: "comercial",
    siteKey: "personal",
    listNames: Object.freeze([`LISTA ${id.toUpperCase()}`]),
    available: true,
    capabilities: Object.freeze({ view: true }),
  })));
  let active = 0;
  let peak = 0;
  const progress = [];
  const repository = {
    async resolveList(_siteKey, listNames) {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active -= 1;
      return { status: "resolved", id: listNames[0] };
    },
    async getItemsPage(_siteKey, listId) {
      return page([{ id: "1", fields: { Title: listId } }]);
    },
  };

  const result = await loadAnalyticsData(repository, {
    sourceEntityIds: ["a", "b", "c", "d"],
  }, extendedCatalog, {
    concurrency: 2,
    onProgress(update) { progress.push(update); },
  });

  assert.equal(peak, 2);
  assert.equal(result.records.length, 4);
  assert.equal(progress.some(update => update.sourceId === "a" && update.loadedCount === 1), true);
  assert.equal(progress.at(-1).completedSources, 4);
  assert.equal(progress.at(-1).totalSources, 4);
});

test("rejeita dependências sem paginação incremental", async () => {
  await assert.rejects(
    loadAnalyticsData({ resolveList() {} }, definition, catalog),
    /paginação incremental/i,
  );
});
