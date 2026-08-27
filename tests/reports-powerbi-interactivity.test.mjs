import assert from "node:assert/strict";
import test from "node:test";

import { buildReportView } from "../portal/reports/report-model.js";
import { createReportsPage, reportsPageMarkup } from "../portal/reports/reports-page.js";

const columns = [
  { name: "Title", displayName: "Nome", text: {} },
  { name: "FILIAL", displayName: "Filial", text: {} },
  { name: "STATUS", displayName: "Status", text: {} },
];
const dimensions = { dateFields: [], branchField: "FILIAL", statusField: "STATUS" };
const items = [
  { id: "1", fields: { Title: "ZETA", FILIAL: "B", STATUS: "PENDENTE" } },
  { id: "2", fields: { Title: "ALFA", FILIAL: "A", STATUS: "FINALIZADO" } },
];

test("relatório ordena localmente a consulta filtrada sem alterar os dados de origem", () => {
  const before = structuredClone(items);
  const ascending = buildReportView(items, columns, dimensions, { sortField: "Title", sortDirection: "asc" });
  const descending = buildReportView(items, columns, dimensions, { sortField: "Title", sortDirection: "desc" });

  assert.deepEqual(ascending.items.map(item => item.fields.Title), ["ALFA", "ZETA"]);
  assert.deepEqual(descending.items.map(item => item.fields.Title), ["ZETA", "ALFA"]);
  assert.deepEqual(items, before);
  assert.deepEqual(ascending.sort, { field: "Title", direction: "asc" });
});

test("tabela expõe ordenação acessível e facetas clicáveis para filial e status", () => {
  const view = buildReportView(items, columns, dimensions, { sortField: "Title", sortDirection: "asc" });
  const markup = reportsPageMarkup({
    sources: [{ id: "clientes", title: "Clientes" }],
    selectedEntityId: "clientes",
    state: "ready",
    data: { state: "ready", complete: true, loadedCount: 2, pageCount: 1, dimensions },
    view,
    filters: { sortField: "Title", sortDirection: "asc" },
    displayPage: 1,
    displayPageSize: 50,
  });

  assert.match(markup, /data-report-sort="Title"/);
  assert.match(markup, /aria-sort="ascending"/);
  assert.match(markup, /data-report-facet="branch"[^>]*data-report-facet-value="A"/);
  assert.match(markup, /data-report-facet="status"[^>]*data-report-facet-value="FINALIZADO"/);
});

test("relatório revalida a permissão do módulo antes de cada nova leitura", async () => {
  let allowed = true;
  let loads = 0;
  const root = {
    innerHTML: "",
    querySelector() { return null; },
  };
  const entity = { id: "clientes", title: "Clientes", moduleId: "comercial", available: true };
  const data = {
    state: "ready",
    columns: [{ name: "Title", label: "Nome", hidden: false }],
    items: [{ id: "1", fields: { Title: "ANA" } }],
    dimensions: { dateFields: [], branchField: "", statusField: "" },
    complete: true,
    loadedCount: 1,
    pageCount: 1,
  };
  const page = createReportsPage(root, {
    entities: [entity],
    access: {},
    can: () => allowed,
    repository: {},
    discoverSources: (_repository, candidates) => candidates,
    loadSource: async () => { loads += 1; return data; },
  });

  await page.ready;
  assert.equal(loads, 1);
  allowed = false;
  await page.refresh();
  assert.equal(loads, 1);
  assert.match(root.innerHTML, /permissão/i);
  page.cleanup();
});
