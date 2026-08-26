import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReportView,
  detectReportDimensions,
  reportViewToCsv,
} from "../portal/reports/report-model.js";

const columns = Object.freeze([
  { name: "Title", displayName: "Descricao", text: {} },
  { name: "DATA", displayName: "Data", dateTime: { format: "dateOnly" } },
  { name: "FILIAL", displayName: "Filial", text: {} },
  { name: "STATUS", displayName: "Status", choice: { choices: ["PENDENTE", "FINALIZADO", "ATIVO"] } },
]);

const entity = Object.freeze({ statusFields: Object.freeze(["STATUS"]) });

test("detecta dimensoes somente a partir das colunas reais e metadados SharePoint", () => {
  assert.deepEqual(detectReportDimensions(columns, entity), {
    dateFields: [{ name: "DATA", label: "Data", dateOnly: true }],
    branchField: "FILIAL",
    statusField: "STATUS",
  });

  assert.deepEqual(detectReportDimensions([
    { name: "Created", displayName: "Criado", dateTime: {} },
    { name: "Modified", displayName: "Modificado", dateTime: {} },
    { name: "DATA_VENDA", displayName: "Data da venda", dateTime: { format: "dateOnly" } },
    { name: "DATA_ASSINATURA", displayName: "Data da assinatura", dateTime: {} },
  ], entity), {
    dateFields: [
      { name: "DATA_VENDA", label: "Data da venda", dateOnly: true },
      { name: "DATA_ASSINATURA", label: "Data da assinatura", dateOnly: false },
    ],
    branchField: "",
    statusField: "",
  });
});

test("aplica periodo inclusivo, filial e status sem fabricar classificacoes", () => {
  const items = [
    { id: "1", fields: { Title: "PRIMEIRO", DATA: "2026-08-01", FILIAL: "OURO PRETO", STATUS: "PENDENTE" } },
    { id: "2", fields: { Title: "SEGUNDO", DATA: "2026-08-31", FILIAL: "OURO PRETO", STATUS: "FINALIZADO" } },
    { id: "3", fields: { Title: "TERCEIRO", DATA: "2026-08-10", FILIAL: "DIVINOPOLIS", STATUS: "ATIVO" } },
    { id: "4", fields: { Title: "QUARTO", DATA: "2026-09-01", FILIAL: "OURO PRETO", STATUS: "PENDENTE" } },
  ];
  const view = buildReportView(items, columns, detectReportDimensions(columns, entity), {
    dateField: "DATA",
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    branch: "OURO PRETO",
    status: "",
  });

  assert.deepEqual(view.items.map(item => item.id), ["1", "2"]);
  assert.deepEqual(view.metrics, { loaded: 4, filtered: 2, pending: 1, finalized: 1 });
  assert.deepEqual(view.options.branches, ["DIVINOPOLIS", "OURO PRETO"]);
  assert.deepEqual(view.options.statuses, ["ATIVO", "FINALIZADO", "PENDENTE"]);

  const active = buildReportView(items, columns, detectReportDimensions(columns, entity), { status: "ATIVO" });
  assert.equal(active.metrics.filtered, 1);
  assert.equal(active.metrics.pending, 0);
  assert.equal(active.metrics.finalized, 0);
});

test("mantem no primeiro dia datas dateOnly devolvidas pelo SharePoint em UTC", () => {
  const view = buildReportView([
    { id: "utc", fields: { Title: "LIMITE", DATA: "2026-08-01T00:00:00Z", FILIAL: "MATRIZ", STATUS: "PENDENTE" } },
  ], columns, detectReportDimensions(columns, entity), {
    dateField: "DATA",
    startDate: "2026-08-01",
    endDate: "2026-08-01",
  });

  assert.deepEqual(view.items.map(item => item.id), ["utc"]);
});

test("nao aplica periodo enquanto o usuario nao escolher um campo de data real", () => {
  const view = buildReportView([
    { id: "1", fields: { Title: "FORA", DATA: "2025-01-01" } },
  ], columns, detectReportDimensions(columns, entity), {
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    dateField: "",
  });

  assert.equal(view.items.length, 1);
  assert.equal(view.activeDateField, null);
});

test("gera CSV apenas da visao filtrada, escapa campos e neutraliza formulas", () => {
  const view = buildReportView([
    { id: "7", fields: { Title: "=SOMA(1;1)", DATA: "2026-08-12", FILIAL: "MATRIZ", STATUS: "PENDENTE" } },
  ], columns, detectReportDimensions(columns, entity), { branch: "MATRIZ" });

  const csv = reportViewToCsv(view);

  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /Descricao;Data;Filial;Status/);
  assert.match(csv, /'=SOMA\(1;1\)/);
  assert.doesNotMatch(csv, /DIVINOPOLIS/);
});
