import assert from "node:assert/strict";
import test from "node:test";

import { createAnalyticsModel } from "../portal/analytics/analytics-model.js";
import { createAnalyticsPage } from "../portal/analytics/analytics-page.js";
import { normalizeAnalyticsDefinition } from "../portal/analytics/definition-normalizer.js";
import { ANALYTICS_DEFINITIONS } from "../portal/analytics/definitions/index.js";

function record(id, sourceId, fields) {
  return Object.freeze({ id, sourceId, fields: Object.freeze(fields) });
}

function rootStub() {
  let markup = "";
  const listeners = new Map();
  return {
    get innerHTML() { return markup; },
    set innerHTML(value) { markup = String(value); },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    dispatch(type, target) { listeners.get(type)?.({ target }); },
  };
}

test("normalizador preserva origem, filtros persistidos, series, interacoes e contratos especializados", () => {
  const normalized = normalizeAnalyticsDefinition({
    id: "etapa-obra",
    filters: [{
      id: "presenca",
      sourceEntityId: "presencas",
      field: "DESCRITIVOPRESENCA.PRESENCA",
      scope: "global",
      operator: "in",
      values: ["PRESENTE"],
      granularity: "month",
    }],
    kpis: [{
      id: "depreciado",
      sourceEntityId: "imobilizados",
      operation: "difference-sum",
      aliases: ["VALORESTIMADO"],
      subtractAliases: ["VLRRESIDUAL"],
    }],
    charts: [{
      id: "cronograma",
      sourceEntityId: "obras",
      type: "gantt",
      dimensions: ["LANCAMENTOOBRA.ETAPA"],
      seriesAliases: ["STATUS"],
      startAliases: ["DATAINICIO"],
      endAliases: ["DATAFIM"],
      durationAliases: ["DIAS"],
      progressAliases: ["PERCENTUAL"],
      crossFilters: { filter: ["custos"], highlight: ["filial"], none: ["total"] },
    }],
    table: {
      id: "detalhes",
      sourceEntityId: "obras",
      columns: [{ id: "etapa", field: "LANCAMENTOOBRA.ETAPA" }],
      views: [{ id: "presencas", title: "PRESENÇAS", sourceEntityId: "presencas", columnIds: ["etapa"] }],
    },
  });

  assert.deepEqual(normalized.filters[0], {
    id: "presenca",
    title: "PRESENCA",
    aliases: ["PRESENCA", "DESCRITIVOPRESENCA.PRESENCA"],
    sourceEntityId: "presencas",
    granularity: "month",
    scope: "global",
    operator: "in",
    values: ["PRESENTE"],
  });
  assert.equal(normalized.kpis[0].sourceEntityId, "imobilizados");
  assert.equal(normalized.kpis[0].operation, "difference-sum");
  assert.deepEqual(normalized.kpis[0].subtractAliases, ["VLRRESIDUAL"]);
  assert.equal(normalized.charts[0].sourceEntityId, "obras");
  assert.deepEqual(normalized.charts[0].seriesAliases, ["STATUS"]);
  assert.deepEqual(normalized.charts[0].startAliases, ["DATAINICIO"]);
  assert.deepEqual(normalized.charts[0].crossFilters, {
    filter: ["custos"], highlight: ["filial"], none: ["total"],
  });
  assert.equal(normalized.tables.length, 2);
  assert.equal(normalized.tables[0].sourceEntityId, "obras");
  assert.equal(normalized.tables[1].sourceEntityId, "presencas");
});

test("modelo calcula cada indicador somente sobre sua fonte e aplica filtros globais sem apagar outras fontes", () => {
  const records = [
    record("l1", "lancamentos", { FILIAL: "001", EFETUADO: 100, DATA: "2026-01-10" }),
    record("l2", "lancamentos", { FILIAL: "002", EFETUADO: 200, DATA: "2026-02-10" }),
    record("p1", "presencas", { FILIAL: "001", PRESENCA: "PRESENTE", VLR: 50 }),
    record("p2", "presencas", { FILIAL: "001", PRESENCA: "AUSENTE", VLR: 999 }),
  ];
  const definition = normalizeAnalyticsDefinition({
    filters: [
      { id: "presenca", sourceEntityId: "presencas", aliases: ["PRESENCA"], scope: "global", operator: "in", values: ["PRESENTE"] },
      { id: "mes", sourceEntityId: "lancamentos", aliases: ["DATA"], granularity: "month" },
    ],
    kpis: [
      { id: "desembolsos", sourceEntityId: "lancamentos", operation: "sum", aliases: ["EFETUADO"] },
      { id: "presencas", sourceEntityId: "presencas", operation: "sum", aliases: ["VLR"] },
    ],
    charts: [],
    table: { sourceEntityId: "lancamentos", columns: [] },
  });
  const model = createAnalyticsModel(records, definition);

  assert.equal(model.metric("desembolsos"), 300);
  assert.equal(model.metric("presencas"), 50);
  assert.deepEqual(model.filterOptions("mes"), ["JANEIRO", "FEVEREIRO"]);
  model.toggleFilter("mes", "JANEIRO");
  assert.deepEqual(model.filterOptions("mes"), ["JANEIRO", "FEVEREIRO"]);
  assert.equal(model.metric("desembolsos"), 100);
  assert.equal(model.metric("presencas"), 50);
});

test("matriz de interacao filtra somente alvos F, preserva N e sinaliza realce H", () => {
  const records = [
    record("v1", "vendas", { FILIAL: "A", VALOR: 10 }),
    record("v2", "vendas", { FILIAL: "B", VALOR: 20 }),
    record("d1", "documentos", { FILIAL: "A", TOTAL: 1 }),
    record("d2", "documentos", { FILIAL: "B", TOTAL: 1 }),
  ];
  const definition = normalizeAnalyticsDefinition({
    charts: [
      { id: "vendas", sourceEntityId: "vendas", dimensionAliases: ["FILIAL"], operation: "sum", valueAliases: ["VALOR"], crossFilters: { filter: ["documentos"], highlight: ["realce"], none: ["sem-interacao"] } },
      { id: "documentos", sourceEntityId: "documentos", dimensionAliases: ["FILIAL"], operation: "sum", valueAliases: ["TOTAL"] },
      { id: "realce", sourceEntityId: "documentos", dimensionAliases: ["FILIAL"], operation: "sum", valueAliases: ["TOTAL"] },
      { id: "sem-interacao", sourceEntityId: "documentos", dimensionAliases: ["FILIAL"], operation: "sum", valueAliases: ["TOTAL"] },
    ],
  });
  const model = createAnalyticsModel(records, definition);

  model.toggleVisualSelection("vendas", "A");
  assert.deepEqual(model.series("documentos").map(point => point.label), ["A"]);
  assert.deepEqual(model.series("sem-interacao").map(point => point.label), ["A", "B"]);
  assert.deepEqual(model.interactionState("realce"), { filteredBy: [], highlightedBy: ["vendas"] });
  assert.deepEqual(model.series("realce").map(point => [point.label, point.highlighted]), [["A", true], ["B", false]]);
  model.toggleVisualSelection("vendas", "A");
  assert.deepEqual(model.series("documentos").map(point => point.label), ["A", "B"]);
});

test("seleção em célula de tabela aplica a interação cruzada declarada aos gráficos", () => {
  const records = [
    record("1", "vendas", { FILIAL: "A", VALOR: 10 }),
    record("2", "vendas", { FILIAL: "B", VALOR: 20 }),
  ];
  const definition = normalizeAnalyticsDefinition({
    charts: [{ id: "totais", sourceEntityId: "vendas", dimensionAliases: ["FILIAL"], operation: "sum", valueAliases: ["VALOR"] }],
    table: {
      id: "detalhes",
      sourceEntityId: "vendas",
      columns: [{ id: "filial", title: "FILIAL", aliases: ["FILIAL"] }],
      crossFilters: { filter: ["totais"], highlight: [], none: [] },
    },
  });
  const model = createAnalyticsModel(records, definition);

  model.toggleVisualSelection("detalhes", "A", ["FILIAL"]);
  assert.deepEqual(model.series("totais").map(point => point.label), ["A"]);
  model.toggleVisualSelection("detalhes", "A", ["FILIAL"]);
  assert.deepEqual(model.series("totais").map(point => point.label), ["B", "A"]);
});

test("modelo produz series segmentadas, percentuais e cronograma sem perder o registro de origem", () => {
  const records = [
    record("1", "ativos", { FILIAL: "A", STATUS: "ATIVO", VALOR: 30 }),
    record("2", "ativos", { FILIAL: "A", STATUS: "INATIVO", VALOR: 70 }),
    record("3", "obras", { ETAPA: "FUNDAÇÃO", INICIO: "2026-01-01", FIM: "2026-01-11", PROGRESSO: 40 }),
  ];
  const definition = normalizeAnalyticsDefinition({
    charts: [
      { id: "ativos", sourceEntityId: "ativos", type: "hundredPercentStackedColumnChart", dimensionAliases: ["FILIAL"], seriesAliases: ["STATUS"], operation: "sum", valueAliases: ["VALOR"] },
      { id: "cronograma", sourceEntityId: "obras", type: "gantt", dimensionAliases: ["ETAPA"], startAliases: ["INICIO"], endAliases: ["FIM"], progressAliases: ["PROGRESSO"] },
    ],
  });
  const model = createAnalyticsModel(records, definition);
  const points = model.series("ativos");

  assert.deepEqual(points.map(point => [point.label, point.seriesLabel, point.value, point.percentage]), [
    ["A", "INATIVO", 70, 70],
    ["A", "ATIVO", 30, 30],
  ]);
  assert.deepEqual(model.timeline("cronograma"), [{
    id: "3",
    label: "FUNDAÇÃO",
    start: "2026-01-01",
    end: "2026-01-11",
    duration: 10,
    progress: 40,
    sourceId: "obras",
  }]);
});

test("operações compostas reproduzem os cartões patrimoniais e pendências comprovados", () => {
  const records = [
    record("1", "imobilizados", { ESTIMADO: 1000, RESIDUAL: 800, QTD: 2, TAXA: 10 }),
    record("2", "imobilizados", { ESTIMADO: 500, RESIDUAL: 400, QTD: 1, TAXA: 20 }),
    record("3", "diarios", { STATUS: "PENDENTE" }),
    record("4", "diarios", { STATUS: "FINALIZADO" }),
  ];
  const definition = normalizeAnalyticsDefinition({
    kpis: [
      { id: "depreciado", sourceEntityId: "imobilizados", operation: "difference-sum", aliases: ["ESTIMADO"], subtractAliases: ["RESIDUAL"] },
      { id: "taxa", sourceEntityId: "imobilizados", operation: "weighted-rate", aliases: ["RESIDUAL"], quantityAliases: ["QTD"], rateAliases: ["TAXA"] },
      { id: "a-depreciar", sourceEntityId: "imobilizados", operation: "weighted-rate-sum", aliases: ["RESIDUAL"], quantityAliases: ["QTD"], rateAliases: ["TAXA"] },
      { id: "pendentes", sourceEntityId: "diarios", operation: "status-count", statusAliases: ["STATUS"], statusValues: ["PENDENTE"] },
    ],
  });
  const model = createAnalyticsModel(records, definition);

  assert.equal(model.metric("depreciado"), 300);
  assert.equal(model.metric("taxa"), 0.12);
  assert.equal(model.metric("a-depreciar"), 240);
  assert.equal(model.metric("pendentes"), 1);
});

test("contrato possui a contagem de slicers, cartões, visuais e tabelas comprovada no inventário", () => {
  const expected = {
    comercial: [5, 2, 8, 1],
    financeiro: [11, 2, 11, 3],
    "recursos-humanos": [13, 2, 11, 2],
    "etapa-obra": [11, 0, 11, 0],
    auditoria: [4, 2, 9, 2],
    imobilizado: [10, 6, 8, 2],
  };

  for (const definition of ANALYTICS_DEFINITIONS) {
    const normalized = normalizeAnalyticsDefinition(definition);
    assert.deepEqual([
      normalized.filters.length,
      normalized.kpis.length,
      normalized.charts.length,
      normalized.tables.length,
    ], expected[definition.id], definition.id);
  }
});

test("página nega painel sem permissão antes de consultar dados", async () => {
  const root = rootStub();
  let loads = 0;
  const page = createAnalyticsPage(root, {
    definition: { id: "financeiro", title: "FINANCEIRO", sourceEntityIds: [] },
    access: {},
    can: () => false,
    entities: [],
    loadData: async () => { loads += 1; return { records: [], diagnostics: [], complete: true }; },
  });

  await page.ready;
  assert.equal(loads, 0);
  assert.match(root.innerHTML, /sem permissão/i);
  page.dispose();
});

test("página materializa empilhado, Gantt, pivô e múltiplas tabelas com tecnologia nativa", async () => {
  const root = rootStub();
  const definition = {
    id: "comercial",
    title: "COMERCIAL",
    sourceEntityIds: ["ativos", "obras"],
    filters: [],
    kpis: [],
    charts: [
      { id: "status", title: "STATUS", sourceEntityId: "ativos", type: "hundredPercentStackedColumnChart", dimensionAliases: ["FILIAL"], seriesAliases: ["STATUS"], operation: "sum", valueAliases: ["VALOR"] },
      { id: "gantt", title: "CRONOGRAMA", sourceEntityId: "obras", type: "gantt", dimensionAliases: ["ETAPA"], startAliases: ["INICIO"], endAliases: ["FIM"], progressAliases: ["PROGRESSO"] },
      { id: "pivo", title: "MATRIZ", sourceEntityId: "ativos", type: "pivotTable", dimensionAliases: ["FILIAL"], operation: "sum", valueAliases: ["VALOR"] },
      { id: "cascata", title: "CASCATA", sourceEntityId: "ativos", type: "waterfallChart", dimensionAliases: ["FILIAL"], operation: "sum", valueAliases: ["VALOR"] },
    ],
    table: {
      id: "ativos",
      title: "ATIVOS DETALHADOS",
      sourceEntityId: "ativos",
      columns: [{ id: "filial", title: "FILIAL", aliases: ["FILIAL"] }],
      views: [{ id: "obras", title: "OBRAS DETALHADAS", sourceEntityId: "obras", columns: [{ id: "etapa", title: "ETAPA", aliases: ["ETAPA"] }] }],
    },
  };
  const records = [
    record("1", "ativos", { FILIAL: "A", STATUS: "ATIVO", VALOR: 10 }),
    record("2", "obras", { ETAPA: "FUNDAÇÃO", INICIO: "2026-01-01", FIM: "2026-01-10", PROGRESSO: 50 }),
  ];
  const page = createAnalyticsPage(root, {
    definition,
    access: {},
    can: () => true,
    entities: [],
    loadData: async () => ({ records, diagnostics: [], complete: true }),
  });

  await page.ready;
  assert.match(root.innerHTML, /data-analytics-visual-type="hundredPercentStackedColumnChart"/);
  assert.match(root.innerHTML, /data-analytics-visual-type="gantt"/);
  assert.match(root.innerHTML, /data-analytics-visual-type="pivotTable"/);
  assert.match(root.innerHTML, /data-analytics-visual-type="waterfallChart"/);
  assert.match(root.innerHTML, /ATIVOS DETALHADOS/);
  assert.match(root.innerHTML, /OBRAS DETALHADAS/);
  page.dispose();
});

test("página torna células interativas e pagina cada tabela de forma independente", async () => {
  const root = rootStub();
  const records = [
    ...Array.from({ length: 3 }, (_, index) => record(`a${index}`, "ativos", { FILIAL: `A${index}` })),
    ...Array.from({ length: 5 }, (_, index) => record(`o${index}`, "obras", { ETAPA: `E${index}` })),
  ];
  const page = createAnalyticsPage(root, {
    definition: {
      id: "comercial",
      title: "COMERCIAL",
      sourceEntityIds: ["ativos", "obras"],
      charts: [{ id: "totais", sourceEntityId: "ativos", dimensionAliases: ["FILIAL"] }],
      table: {
        viewsOnly: true,
        columns: [],
        views: [
          { id: "ativos", title: "ATIVOS", sourceEntityId: "ativos", columns: [{ id: "filial", title: "FILIAL", aliases: ["FILIAL"] }], crossFilters: { filter: ["totais"] } },
          { id: "obras", title: "OBRAS", sourceEntityId: "obras", columns: [{ id: "etapa", title: "ETAPA", aliases: ["ETAPA"] }] },
        ],
      },
    },
    access: {},
    can: () => true,
    entities: [],
    pageSize: 2,
    loadData: async () => ({ records, diagnostics: [], complete: true }),
  });

  await page.ready;
  assert.match(root.innerHTML, /data-analytics-table-series="A0"/);
  root.dispatch("click", { dataset: { analyticsNext: "", analyticsTableId: "obras" }, parentElement: null });
  assert.match(root.innerHTML, /analyticsTable-ativos[\s\S]*Página 1 de 2[\s\S]*analyticsTable-obras[\s\S]*Página 2 de 3/);
  page.dispose();
});

test("exportação CSV neutraliza fórmulas mesmo após espaços e controles", async () => {
  const root = rootStub();
  let download;
  const page = createAnalyticsPage(root, {
    definition: {
      id: "comercial",
      title: "COMERCIAL",
      sourceEntityIds: ["dados"],
      table: {
        id: "dados",
        sourceEntityId: "dados",
        columns: [{ id: "valor", title: "VALOR", aliases: ["VALOR"] }],
      },
    },
    access: {},
    can: () => true,
    entities: [],
    download(fileName, content) { download = { fileName, content }; },
    loadData: async () => ({
      records: [record("1", "dados", { VALOR: "\u0000 \t=HYPERLINK(\"https://invalid\")" })],
      diagnostics: [],
      complete: true,
    }),
  });

  await page.ready;
  root.dispatch("click", { dataset: { analyticsExport: "", analyticsTableId: "dados" }, parentElement: null });
  assert.match(download.fileName, /^comercial-/);
  assert.match(download.content, /'\u0000 \t=HYPERLINK/);
  page.dispose();
});
