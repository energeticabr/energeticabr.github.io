import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReportView,
  detectReportDimensions,
  reportCellValue,
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

test("inclui todo o ultimo dia e exclui o dia seguinte em DateTimeOffset", () => {
  const dateTimeColumns = [
    { name: "Title", displayName: "Descricao", text: {} },
    { name: "MODIFICADO_EM", displayName: "Modificado em", dateTime: { format: "dateTime" } },
  ];
  const dimensions = detectReportDimensions(dateTimeColumns, entity);
  const lastMillisecond = new Date(2026, 7, 31, 23, 59, 59, 999).toISOString();
  const nextDay = new Date(2026, 8, 1, 0, 0, 0, 0).toISOString();
  const view = buildReportView([
    { id: "fim", fields: { Title: "FIM DO DIA", MODIFICADO_EM: lastMillisecond } },
    { id: "seguinte", fields: { Title: "DIA SEGUINTE", MODIFICADO_EM: nextDay } },
  ], dateTimeColumns, dimensions, {
    dateField: "MODIFICADO_EM",
    startDate: "2026-08-31",
    endDate: "2026-08-31",
  });

  assert.deepEqual(view.items.map(item => item.id), ["fim"]);
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

test("indicadores e opcoes representam todos os lotes consolidados", () => {
  const items = Array.from({ length: 250 }, (_, index) => ({
    id: String(index + 1),
    fields: {
      Title: `ITEM ${index + 1}`,
      DATA: "2026-08-12",
      FILIAL: index < 200 ? "MATRIZ" : "FILIAL DO ULTIMO LOTE",
      STATUS: index % 2 === 0 ? "PENDENTE" : "FINALIZADO",
    },
  }));
  const view = buildReportView(items, columns, detectReportDimensions(columns, entity), {});

  assert.deepEqual(view.metrics, { loaded: 250, filtered: 250, pending: 125, finalized: 125 });
  assert.deepEqual(view.options.branches, ["FILIAL DO ULTIMO LOTE", "MATRIZ"]);
});

test("CSV neutraliza formulas ocultas por espacos e caracteres de controle", () => {
  const dangerous = ["=1+1", " +1+1", "\t-1+1", "\r@SOMA(A1)", "\n=CMD()", "\u0000=OCULTA()", "\uFEFF=INVISIVEL()", "\u200B=FORMATO()"];
  const view = buildReportView(dangerous.map((value, index) => ({
    id: String(index + 1),
    fields: { Title: value, STATUS: "PENDENTE" },
  })), columns, detectReportDimensions(columns, entity), {});

  const csv = reportViewToCsv(view);
  const rows = csv.split("\r\n").slice(1);
  assert.equal(rows.length, dangerous.length);
  for (const row of rows) {
    const firstCell = row.match(/^"([^"]|"")*"|^[^;]*/)?.[0] || "";
    assert.match(firstCell, /^["']*'/, `celula perigosa sem neutralizacao: ${JSON.stringify(firstCell)}`);
  }
});

test("CSV parcial inclui aviso de limite e nao afirma total", () => {
  const view = buildReportView([
    { id: "1", fields: { Title: "ANA", STATUS: "PENDENTE" } },
  ], columns, detectReportDimensions(columns, entity), {});
  const csv = reportViewToCsv(view, {
    complete: false,
    loadedCount: 5000,
    maxItems: 5000,
    partialReason: "max-items",
  });

  assert.match(csv, /RELATÓRIO PARCIAL/i);
  assert.match(csv, /5\.000 registros carregados/i);
  assert.doesNotMatch(csv, /\btotal\b/i);
});

test("valores auxiliares do relatorio usam portugues acentuado", () => {
  assert.equal(reportCellValue({ fields: { ATIVO: false } }, { name: "ATIVO" }), "Não");
  assert.equal(reportCellValue({ fields: {} }, { name: "AUSENTE" }), "Não informado");
});
