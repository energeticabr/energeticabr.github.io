import assert from "node:assert/strict";
import test from "node:test";
import { availableReportEntities, createReportsPage, reportsPageMarkup } from "../portal/reports/reports-page.js";

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
      dimensions: {
        dateFields: [
          { name: "DATA_VENDA", label: "Data da venda", dateOnly: true },
          { name: "DATA_ASSINATURA", label: "Data da assinatura", dateOnly: true },
        ],
        branchField: "",
        statusField: "STATUS",
      },
      page: { cursor: 0, limit: 100, startId: 1, endId: 100, number: 1 },
    },
    view: {
      items: [{ id: "1", fields: { Title: "ANA", STATUS: "PENDENTE" } }],
      metrics: { loaded: 3, filtered: 1, pending: 1, finalized: 0 },
      options: { branches: [], statuses: ["PENDENTE"] },
      columns: [
        { name: "Title", label: "Nome", hidden: false },
        { name: "STATUS", label: "Status", hidden: false },
      ],
      activeDateField: { name: "DATA_VENDA", label: "Data da venda", dateOnly: true },
    },
    filters: { dateField: "DATA_VENDA", startDate: "", endDate: "", branch: "", status: "" },
  });

  assert.match(markup, /Relatorios operacionais/);
  assert.match(markup, /data-report-source/);
  assert.match(markup, /data-report-date-field/);
  assert.match(markup, /Data da assinatura/);
  assert.match(markup, /Periodo aplicado sobre:/);
  assert.match(markup, /data-report-start/);
  assert.match(markup, /data-report-branch[^>]+disabled/);
  assert.match(markup, /Registros no lote/);
  assert.match(markup, /Resultados filtrados/);
  assert.match(markup, /data-report-export/);
  assert.match(markup, /Exportar lote CSV/);
  assert.match(markup, /data-report-print/);
  assert.match(markup, /ANA/);
  assert.match(markup, /Lote de IDs 1 a 100/);
  assert.match(markup, /exportacao e a impressao consideram somente este lote/i);
});

test("explica quando nenhuma fonte SharePoint foi liberada", () => {
  const markup = reportsPageMarkup({ sources: [], state: "empty", filters: {} });
  assert.match(markup, /Nenhuma fonte SharePoint foi liberada/);
  assert.doesNotMatch(markup, /data-report-export/);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function reportData(title) {
  return {
    state: "ready",
    columns: [{ name: "Title", label: "Nome", hidden: false }],
    rawColumns: [{ name: "Title", displayName: "Nome", text: {} }],
    items: [{ id: "1", fields: { Title: title } }],
    dimensions: { dateFields: [], branchField: "", statusField: "" },
    page: { cursor: 0, limit: 100, startId: 1, endId: 100, number: 1 },
  };
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
          trigger(name, value) { this.value = value; listeners.get(name)?.({ target: this }); },
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
    entities,
    access: {},
    can: () => true,
    repository: {},
    loadSource(_repository, entity, options) {
      calls.push({ entity: entity.id, signal: options.signal });
      return entity.id === "clientes" ? first.promise : Promise.resolve(reportData("FONTE NOVA"));
    },
  });

  root.control("[data-report-source]").trigger("change", "lancamentos");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls[0].signal.aborted, true);
  assert.match(root.innerHTML, /FONTE NOVA/);

  first.resolve(reportData("FONTE ANTIGA"));
  await page.ready;
  assert.doesNotMatch(root.innerHTML, /FONTE ANTIGA/);
  page.cleanup();
});
