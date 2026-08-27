import assert from "node:assert/strict";
import test from "node:test";

import { createAnalyticsModel } from "../portal/analytics/analytics-model.js";

const records = Object.freeze([
  Object.freeze({ id: "1", sourceId: "lancamentos", fields: Object.freeze({ FILIAL: "001", STATUS: "PENDENTE", FORNECEDOR: "ACME", VALOR: "1.250,50", DATA: "2026-08-26" }) }),
  Object.freeze({ id: "2", sourceId: "lancamentos", fields: Object.freeze({ FILIAL: "002", STATUS: "CONCLUÍDO", FORNECEDOR: "MINAS", VALOR: 800, DATA: "2026-08-25T03:00:00Z" }) }),
  Object.freeze({ id: "3", sourceId: "provisoes", fields: Object.freeze({ Title: "001", SITUACAO: "AGUARDANDO", FORNECEDOR: "ACME", TOTAL: 250 }) }),
]);

const definition = Object.freeze({
  filters: Object.freeze([
    Object.freeze({ id: "filial", aliases: Object.freeze(["FILIAL", "Title"]) }),
    Object.freeze({ id: "fornecedor", aliases: Object.freeze(["FORNECEDOR"]) }),
  ]),
  kpis: Object.freeze([
    Object.freeze({ id: "registros", operation: "count" }),
    Object.freeze({ id: "valor", operation: "sum", aliases: Object.freeze(["VALOR", "TOTAL"]) }),
    Object.freeze({ id: "fornecedores", operation: "distinct-count", aliases: Object.freeze(["FORNECEDOR"]) }),
    Object.freeze({ id: "media", operation: "average", aliases: Object.freeze(["VALOR", "TOTAL"]) }),
    Object.freeze({ id: "pendente", operation: "pending-sum", aliases: Object.freeze(["VALOR", "TOTAL"]), statusAliases: Object.freeze(["STATUS", "SITUACAO"]) }),
  ]),
  charts: Object.freeze([
    Object.freeze({ id: "por-fornecedor", dimensionAliases: Object.freeze(["FORNECEDOR"]), operation: "sum", valueAliases: Object.freeze(["VALOR", "TOTAL"]) }),
  ]),
  table: Object.freeze({ columns: Object.freeze([
    Object.freeze({ id: "data", aliases: Object.freeze(["DATA"]), type: "date" }),
    Object.freeze({ id: "fornecedor", aliases: Object.freeze(["FORNECEDOR"]) }),
  ]) }),
});

test("modelo aplica filtros cruzados reversíveis sem duplicar nem mutar registros", () => {
  const model = createAnalyticsModel(records, definition);
  const original = JSON.stringify(records);

  assert.equal(model.filteredRecords().length, 3);
  model.toggleFilter("fornecedor", "ACME");
  assert.deepEqual(model.filteredRecords().map(row => row.id), ["1", "3"]);
  model.toggleFilter("filial", "001");
  assert.deepEqual(model.filteredRecords().map(row => row.id), ["1", "3"]);
  model.toggleFilter("fornecedor", "ACME");
  assert.deepEqual(model.activeFilters(), { filial: "001" });
  assert.equal(JSON.stringify(records), original);
});

test("modelo calcula métricas seguras e séries sobre o mesmo recorte", () => {
  const model = createAnalyticsModel(records, definition);

  assert.equal(model.metric("registros"), 3);
  assert.equal(model.metric("valor"), 2300.5);
  assert.equal(model.metric("fornecedores"), 2);
  assert.equal(model.metric("media"), 2300.5 / 3);
  assert.equal(model.metric("pendente"), 1500.5);
  assert.deepEqual(model.series("por-fornecedor"), [
    { key: "ACME", label: "ACME", value: 1500.5 },
    { key: "MINAS", label: "MINAS", value: 800 },
  ]);
});

test("tabela preserva datas de calendário e exporta somente o conjunto filtrado", () => {
  const model = createAnalyticsModel(records, definition);
  model.toggleFilter("fornecedor", "MINAS");

  assert.deepEqual(model.tableRows(), [{ id: "2", sourceId: "lancamentos", data: "25/08/2026", fornecedor: "MINAS" }]);
  assert.deepEqual(model.exportRows(), model.tableRows());
  assert.equal(Object.isFrozen(model.tableRows()[0]), true);
});
