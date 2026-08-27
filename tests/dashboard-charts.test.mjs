import assert from "node:assert/strict";
import test from "node:test";
import { buildChartSeries, createCrossFilterModel } from "../portal/charts/cross-filter.js";
import { interactiveBarChartMarkup } from "../portal/charts/bar-chart.js";
import { createDashboardCharts } from "../portal/charts/dashboard-charts.js";

const rows = [
  { sourceId: "tarefas", status: "PENDENTE", actor: "ANA" },
  { sourceId: "tarefas", status: "FINALIZADO", actor: "BRUNO" },
  { sourceId: "documentos", status: "PENDENTE", actor: "ANA" },
];

test("filtros de gráficos são cruzados, reversíveis e podem ser limpos", () => {
  const model = createCrossFilterModel(rows);

  model.toggle("sourceId", "tarefas");
  assert.equal(model.filtered().length, 2);
  model.toggle("status", "PENDENTE");
  assert.deepEqual(model.filtered(), [rows[0]]);
  assert.deepEqual(model.activeFilters(), { sourceId: "tarefas", status: "PENDENTE" });
  model.toggle("status", "PENDENTE");
  assert.equal(model.filtered().length, 2);
  model.clear();
  assert.equal(model.filtered().length, 3);
  assert.deepEqual(model.activeFilters(), {});
});

test("série agrega dimensões após aplicar os demais filtros cruzados", () => {
  const model = createCrossFilterModel(rows);
  model.toggle("actor", "ANA");
  assert.deepEqual(buildChartSeries(model.filteredExcept("sourceId"), "sourceId"), [
    { key: "documentos", label: "documentos", value: 1 },
    { key: "tarefas", label: "tarefas", value: 1 },
  ]);
});

test("gráfico SVG é acessível, clicável e identifica filtro ativo", () => {
  const html = interactiveBarChartMarkup({
    id: "status",
    title: "Situação",
    dimension: "status",
    activeValue: "PENDENTE",
    series: [
      { key: "PENDENTE", label: "Pendente", value: 4 },
      { key: "FINALIZADO", label: "Finalizado", value: 2 },
    ],
  });

  assert.match(html, /<svg/);
  assert.match(html, /data-chart-dimension="status"/);
  assert.match(html, /data-chart-value="PENDENTE"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /role="button"/);
});

test("controlador recompõe todos os gráficos após seleção e limpeza", () => {
  const charts = createDashboardCharts(rows);
  assert.match(charts.markup(), /Situação/);
  assert.match(charts.markup(), /Fontes/);
  assert.match(charts.markup(), /Usuários/);

  charts.toggle("status", "PENDENTE");
  assert.deepEqual(charts.activeFilters(), { status: "PENDENTE" });
  assert.match(charts.markup(), /aria-pressed="true"/);
  charts.clear();
  assert.deepEqual(charts.activeFilters(), {});
});
