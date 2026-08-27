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

  assert.match(markup, /Relatórios operacionais/);
  assert.match(markup, /data-report-source/);
  assert.match(markup, /data-report-date-field/);
  assert.match(markup, /Data da assinatura/);
  assert.match(markup, /Período aplicado sobre:/);
  assert.match(markup, /data-report-start/);
  assert.match(markup, /data-report-branch[^>]+disabled/);
  assert.match(markup, /Registros no lote/);
  assert.match(markup, /Resultados filtrados/);
  assert.match(markup, /data-report-export/);
  assert.match(markup, /Exportar lote CSV/);
  assert.match(markup, /data-report-print/);
  assert.match(markup, /ANA/);
  assert.match(markup, /Lote de IDs 1 a 100/);
  assert.match(markup, /exportação e a impressão consideram somente este lote/i);
  assert.match(markup, /Paginação do relatório/);
  assert.match(markup, /Próximo lote/);
  assert.doesNotMatch(markup, /\b(?:Relatorios|relatorio|Periodo|Paginacao|Proximo|nao|permissao|possivel|Ate)\b/);
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

function reportData(title, { cursor = 0, limit = 100, items } = {}) {
  const reportItems = items ?? [{ id: String(cursor + 1), fields: { Title: title } }];
  return {
    state: "ready",
    columns: [{ name: "Title", label: "Nome", hidden: false }],
    rawColumns: [{ name: "Title", displayName: "Nome", text: {} }],
    items: reportItems,
    dimensions: { dateFields: [], branchField: "", statusField: "" },
    page: {
      cursor,
      limit,
      startId: cursor + 1,
      endId: cursor + limit,
      number: Math.floor(cursor / limit) + 1,
    },
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

test("desabilita o proximo lote quando o lote carregado e o ultimo", async () => {
  const root = interactiveRoot();
  const calls = [];
  const page = createReportsPage(root, {
    entities: [entities[0]],
    access: {},
    can: () => true,
    repository: {},
    pageSize: 2,
    loadSource(_repository, _entity, options) {
      calls.push(options.cursor);
      return Promise.resolve(reportData("ULTIMO", {
        cursor: options.cursor,
        limit: options.limit,
        items: [{ id: "1", fields: { Title: "ULTIMO" } }],
      }));
    },
  });

  await page.ready;
  assert.match(root.innerHTML, /data-report-next disabled/);
  root.control("[data-report-next]").trigger("click");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls, [0]);
  page.cleanup();
});

test("retorna ao lote anterior e bloqueia novas paginas vazias", async () => {
  const root = interactiveRoot();
  const calls = [];
  const page = createReportsPage(root, {
    entities: [entities[0]],
    access: {},
    can: () => true,
    repository: {},
    pageSize: 2,
    loadSource(_repository, _entity, options) {
      calls.push(options.cursor);
      if (options.cursor === 0) {
        return Promise.resolve(reportData("LOTE ANTERIOR", {
          cursor: 0,
          limit: 2,
          items: [
            { id: "1", fields: { Title: "PRIMEIRO" } },
            { id: "2", fields: { Title: "SEGUNDO" } },
          ],
        }));
      }
      return Promise.resolve(reportData("", { cursor: options.cursor, limit: 2, items: [] }));
    },
  });

  await page.ready;
  root.control("[data-report-next]").trigger("click");
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(calls, [0, 2, 0]);
  assert.match(root.innerHTML, /PRIMEIRO/);
  assert.match(root.innerHTML, /<span>Lote 1<\/span>/);
  assert.match(root.innerHTML, /data-report-next disabled/);

  root.control("[data-report-next]").trigger("click");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls, [0, 2, 0]);
  page.cleanup();
});
