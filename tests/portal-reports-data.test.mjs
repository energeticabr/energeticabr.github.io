import assert from "node:assert/strict";
import test from "node:test";
import { loadReportSource } from "../portal/reports/report-data.js";

const entity = Object.freeze({
  id: "clientes",
  siteKey: "personal",
  listNames: Object.freeze(["CADASTRO CLIENTE"]),
  statusFields: Object.freeze(["STATUS"]),
});

test("carrega colunas e todos os itens pela camada SharePoint existente", async () => {
  const calls = [];
  const result = await loadReportSource({
    async resolveList(siteKey, names) { calls.push(["resolve", siteKey, names]); return { status: "resolved", id: "list-1" }; },
    async getColumns(siteKey, listId) { calls.push(["columns", siteKey, listId]); return [{ name: "Title", displayName: "Nome", text: {} }]; },
    async getItems(siteKey, listId, query) { calls.push(["items", siteKey, listId, query]); return [{ id: "1", fields: { Title: "ANA" } }]; },
  }, entity);

  assert.equal(result.state, "ready");
  assert.equal(result.items.length, 1);
  assert.equal(result.columns[0].name, "Title");
  assert.equal(result.dimensions.dateSource, "metadata");
  assert.deepEqual(calls.at(-1), ["items", "personal", "list-1", "$expand=fields"]);
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
