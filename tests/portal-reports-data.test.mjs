import assert from "node:assert/strict";
import test from "node:test";
import { loadReportSource } from "../portal/reports/report-data.js";

const entity = Object.freeze({
  id: "clientes",
  siteKey: "personal",
  listNames: Object.freeze(["CADASTRO CLIENTE"]),
  statusFields: Object.freeze(["STATUS"]),
});

test("carrega somente uma faixa limitada de IDs pela camada SharePoint existente", async () => {
  const calls = [];
  const result = await loadReportSource({
    async resolveList(siteKey, names) { calls.push(["resolve", siteKey, names]); return { status: "resolved", id: "list-1" }; },
    async getColumns(siteKey, listId) { calls.push(["columns", siteKey, listId]); return [{ name: "Title", displayName: "Nome", text: {} }]; },
    async getItems(siteKey, listId, query) { calls.push(["items", siteKey, listId, query]); return [{ id: "201", fields: { Title: "ANA" } }]; },
  }, entity, { cursor: 200, limit: 50 });

  assert.equal(result.state, "ready");
  assert.equal(result.items.length, 1);
  assert.equal(result.columns[0].name, "Title");
  assert.deepEqual(result.dimensions.dateFields, []);
  assert.deepEqual(result.page, { cursor: 200, limit: 50, startId: 201, endId: 250, number: 5 });
  assert.deepEqual(calls.at(-1), ["items", "personal", "list-1", "$expand=fields&$filter=fields/ID ge 201 and fields/ID le 250&$orderby=fields/ID asc"]);
});

test("limita defensivamente o volume mesmo se o transporte devolver itens demais", async () => {
  const returned = Array.from({ length: 500 }, (_, index) => ({ id: String(index + 1), fields: { Title: `ITEM ${index + 1}` } }));
  const result = await loadReportSource({
    async resolveList() { return { status: "resolved", id: "list-1" }; },
    async getColumns() { return [{ name: "Title", displayName: "Nome", text: {} }]; },
    async getItems() { return returned; },
  }, entity, { cursor: 0, limit: 100 });

  assert.equal(result.items.length, 100);
  assert.equal(result.page.limit, 100);
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
