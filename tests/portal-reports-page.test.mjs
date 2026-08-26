import assert from "node:assert/strict";
import test from "node:test";
import { availableReportEntities, reportsPageMarkup } from "../portal/reports/reports-page.js";

const entities = Object.freeze([
  Object.freeze({ id: "clientes", title: "Clientes", moduleId: "comercial" }),
  Object.freeze({ id: "lancamentos", title: "Lancamentos", moduleId: "suprimentos" }),
]);

test("oferece somente fontes que o usuario pode visualizar", () => {
  const access = { marker: true };
  const visible = availableReportEntities(entities, access, (_record, moduleId, action) => moduleId === "comercial" && action === "view");

  assert.deepEqual(visible.map(entity => entity.id), ["clientes"]);
  assert.ok(Object.isFrozen(visible));
});

test("renderiza filtros, cartoes, tabela e comandos de exportacao e impressao", () => {
  const markup = reportsPageMarkup({
    sources: entities,
    selectedEntityId: "clientes",
    state: "ready",
    data: {
      columns: [
        { name: "Title", label: "Nome", hidden: false },
        { name: "STATUS", label: "Status", hidden: false },
      ],
      dimensions: { dateField: "lastModifiedDateTime", dateSource: "metadata", branchField: "", statusField: "STATUS" },
    },
    view: {
      items: [{ id: "1", fields: { Title: "ANA", STATUS: "PENDENTE" } }],
      metrics: { loaded: 3, filtered: 1, pending: 1, finalized: 0 },
      options: { branches: [], statuses: ["PENDENTE"] },
      columns: [
        { name: "Title", label: "Nome", hidden: false },
        { name: "STATUS", label: "Status", hidden: false },
      ],
    },
    filters: { startDate: "", endDate: "", branch: "", status: "" },
  });

  assert.match(markup, /Relatorios operacionais/);
  assert.match(markup, /data-report-source/);
  assert.match(markup, /data-report-start/);
  assert.match(markup, /data-report-branch[^>]+disabled/);
  assert.match(markup, /Registros carregados/);
  assert.match(markup, /Resultados filtrados/);
  assert.match(markup, /data-report-export/);
  assert.match(markup, /data-report-print/);
  assert.match(markup, /ANA/);
});

test("explica quando nenhuma fonte SharePoint foi liberada", () => {
  const markup = reportsPageMarkup({ sources: [], state: "empty", filters: {} });
  assert.match(markup, /Nenhuma fonte SharePoint foi liberada/);
  assert.doesNotMatch(markup, /data-report-export/);
});
