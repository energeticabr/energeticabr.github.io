import assert from "node:assert/strict";
import test from "node:test";
import { loadReportSource } from "../portal/reports/report-data.js";

const entity = Object.freeze({
  id: "clientes",
  siteKey: "personal",
  listNames: Object.freeze(["CADASTRO CLIENTE"]),
  statusFields: Object.freeze(["STATUS"]),
});

const rawColumns = Object.freeze([
  Object.freeze({ name: "Title", displayName: "Nome", text: {}, indexed: true }),
  Object.freeze({ name: "STATUS", displayName: "Status", text: {}, indexed: true }),
  Object.freeze({ name: "FILIAL", displayName: "Filial", text: {}, indexed: false }),
  Object.freeze({ name: "DATA", displayName: "Data", dateTime: { format: "dateOnly" }, indexed: true }),
  Object.freeze({ name: "MODIFICADO_EM", displayName: "Modificado em", dateTime: { format: "dateTime" }, indexed: true }),
]);

function repositoryWithPages(pages, calls = []) {
  return {
    async resolveList(siteKey, names) {
      calls.push(["resolve", siteKey, names]);
      return { status: "resolved", id: "list-1" };
    },
    async getColumns(siteKey, listId) {
      calls.push(["columns", siteKey, listId]);
      return rawColumns;
    },
    async getItems() {
      throw new Error("A consulta consolidada nao pode usar getItems ilimitado.");
    },
    async getItemsPage(siteKey, listId, query, options) {
      calls.push(["page", siteKey, listId, query, options.cursor, options.pageNumber, options.maxPages, options.signal]);
      const page = pages.shift();
      if (!page) throw new Error("Pagina Graph inesperada.");
      return page;
    },
  };
}

test("consolida paginas Graph incrementais e informa progresso sem usar leitura ilimitada", async () => {
  const calls = [];
  const nextLink = "https://graph.microsoft.com/v1.0/sites/company-site/lists/list-1/items?$skiptoken=LOTE-2";
  const progress = [];
  const result = await loadReportSource(repositoryWithPages([
    { items: [{ id: "1", fields: { Title: "ANA" } }, { id: "2", fields: { Title: "BRUNO" } }], nextLink, hasMore: true },
    { items: [{ id: "3", fields: { Title: "CARLA" } }], nextLink: "", hasMore: false },
  ], calls), entity, {
    batchSize: 2,
    maxItems: 10,
    maxPages: 5,
    onProgress(update) { progress.push(update); },
  });

  assert.equal(result.state, "ready");
  assert.deepEqual(result.items.map(item => item.id), ["1", "2", "3"]);
  assert.equal(result.complete, true);
  assert.equal(result.partialReason, "");
  assert.equal(result.loadedCount, 3);
  assert.equal(result.pageCount, 2);
  assert.equal(calls.filter(call => call[0] === "page").length, 2);
  assert.equal(calls.at(-1)[4], nextLink);
  assert.deepEqual(progress.map(update => [update.loadedCount, update.pageCount, update.complete]), [[2, 1, false], [3, 2, true]]);
});

test("aplica somente filtro Graph exato derivado de coluna real e indexada", async () => {
  const calls = [];
  const result = await loadReportSource(repositoryWithPages([
    { items: [{ id: "1", fields: { Title: "ANA", STATUS: "D'AGUA&$top=999", FILIAL: "MATRIZ" } }], nextLink: "", hasMore: false },
  ], calls), entity, {
    filters: { status: "D'AGUA&$top=999", branch: "MATRIZ" },
    batchSize: 100,
  });

  const query = calls.find(call => call[0] === "page")[3];
  const parameters = new URLSearchParams(query);
  assert.deepEqual(parameters.getAll("$top"), ["100"]);
  assert.equal(parameters.get("$filter"), "fields/STATUS eq 'D''AGUA&$top=999'");
  assert.doesNotMatch(parameters.get("$filter"), /fields\/FILIAL/);
  assert.equal(result.serverFilterField, "STATUS");
});

test("preserva datas dateOnly como calendario no filtro Graph", async () => {
  const calls = [];
  await loadReportSource(repositoryWithPages([
    { items: [{ id: "1", fields: { DATA: "2026-08-31" } }], nextLink: "", hasMore: false },
  ], calls), entity, {
    filters: { dateField: "DATA", startDate: "2026-08-01", endDate: "2026-08-31" },
  });

  const query = calls.find(call => call[0] === "page")[3];
  assert.equal(
    new URLSearchParams(query).get("$filter"),
    "fields/DATA ge '2026-08-01' and fields/DATA le '2026-08-31'",
  );
});

test("usa o inicio do dia seguinte como limite exclusivo de DateTimeOffset", async () => {
  const calls = [];
  await loadReportSource(repositoryWithPages([
    { items: [{ id: "1", fields: { MODIFICADO_EM: "2026-08-31T23:59:59.999Z" } }], nextLink: "", hasMore: false },
  ], calls), entity, {
    filters: { dateField: "MODIFICADO_EM", startDate: "2026-08-01", endDate: "2026-08-31" },
  });

  const query = calls.find(call => call[0] === "page")[3];
  const start = new Date(2026, 7, 1).toISOString();
  const endExclusive = new Date(2026, 8, 1).toISOString();
  assert.equal(
    new URLSearchParams(query).get("$filter"),
    `fields/MODIFICADO_EM ge '${start}' and fields/MODIFICADO_EM lt '${endExclusive}'`,
  );
});

test("interrompe no limite operacional e nunca apresenta o recorte como total", async () => {
  const nextOne = "https://graph.microsoft.com/v1.0/sites/company-site/lists/list-1/items?$skiptoken=2";
  const nextTwo = "https://graph.microsoft.com/v1.0/sites/company-site/lists/list-1/items?$skiptoken=4";
  const result = await loadReportSource(repositoryWithPages([
    { items: [{ id: "1", fields: {} }, { id: "2", fields: {} }], nextLink: nextOne, hasMore: true },
    { items: [{ id: "3", fields: {} }, { id: "4", fields: {} }], nextLink: nextTwo, hasMore: true },
  ]), entity, { batchSize: 2, maxItems: 3, maxPages: 5 });

  assert.equal(result.complete, false);
  assert.equal(result.partialReason, "max-items");
  assert.equal(result.loadedCount, 3);
  assert.deepEqual(result.items.map(item => item.id), ["1", "2", "3"]);
  assert.equal(result.limit.maxItems, 3);
});

test("rejeita nextLink externo antes de solicitar outra pagina", async () => {
  const calls = [];
  const result = await loadReportSource(repositoryWithPages([
    { items: [{ id: "1", fields: {} }], nextLink: "https://evil.example/roubar?token=segredo", hasMore: true },
  ], calls), entity);

  assert.equal(result.state, "error");
  assert.match(result.error.message, /nextLink|continua[cç][aã]o|Graph/i);
  assert.equal(calls.filter(call => call[0] === "page").length, 1);
});

test("cancela a consolidacao entre paginas quando o sinal e abortado", async () => {
  const controller = new AbortController();
  const nextLink = "https://graph.microsoft.com/v1.0/sites/company-site/lists/list-1/items?$skiptoken=2";
  const repository = repositoryWithPages([
    { items: [{ id: "1", fields: {} }], nextLink, hasMore: true },
  ]);

  await assert.rejects(loadReportSource(repository, entity, {
    signal: controller.signal,
    onProgress() { controller.abort(); },
  }), error => error?.name === "AbortError" && error?.code === "report_aborted");
});

test("encaminha AbortSignal para descoberta da lista e das colunas", async () => {
  const controller = new AbortController();
  const received = [];
  const repository = {
    async resolveList(_siteKey, _names, options) {
      received.push(["resolve", options?.signal]);
      return { status: "resolved", id: "list-1" };
    },
    async getColumns(_siteKey, _listId, options) {
      received.push(["columns", options?.signal]);
      return rawColumns;
    },
    async getItemsPage() {
      return { items: [], nextLink: "", hasMore: false };
    },
  };

  await loadReportSource(repository, entity, { signal: controller.signal });

  assert.deepEqual(received, [
    ["resolve", controller.signal],
    ["columns", controller.signal],
  ]);
});

test("diferencia lista ausente e falta de permissao sem produzir registros", async () => {
  const missing = await loadReportSource({
    async resolveList() { return { status: "missing" }; },
  }, entity);
  assert.equal(missing.state, "missing");
  assert.deepEqual(missing.items, []);

  const forbidden = await loadReportSource({
    async resolveList() { const error = new Error("Negado"); error.status = 403; throw error; },
  }, entity);
  assert.equal(forbidden.state, "forbidden");
  assert.deepEqual(forbidden.items, []);
});

test("mensagens de erro do relatorio usam portugues acentuado", async () => {
  await assert.rejects(loadReportSource(undefined, entity), /relatório requer repositório/);
  await assert.rejects(loadReportSource({}, entity, { signal: { aborted: true } }), /consulta de relatório foi cancelada/);
});
