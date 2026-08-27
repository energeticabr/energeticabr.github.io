import { escapeHtml } from "../core/utils.js";
import { interactiveBarChartMarkup } from "./bar-chart.js";
import { buildChartSeries, createCrossFilterModel } from "./cross-filter.js";

const CHARTS = Object.freeze([
  Object.freeze({ id: "fontes", title: "Fontes", dimension: "sourceId" }),
  Object.freeze({ id: "situacao", title: "Situação", dimension: "status" }),
  Object.freeze({ id: "usuarios", title: "Usuários", dimension: "actor" }),
]);

function sourceLabels(records) {
  return new Map((records || []).map(record => [String(record.sourceId), String(record.sourceTitle || record.sourceId)]));
}
export function createDashboardCharts(records = []) {
  const model = createCrossFilterModel(records);
  const labels = sourceLabels(records);
  function chartMarkup(chart) {
    const series = buildChartSeries(model.filteredExcept(chart.dimension), chart.dimension).map(row => chart.dimension === "sourceId"
      ? Object.freeze({ ...row, label: labels.get(row.key) || row.label })
      : row);
    return interactiveBarChartMarkup({ ...chart, series, activeValue: model.activeFilters()[chart.dimension] || "" });
  }
  return Object.freeze({
    toggle: (dimension, value) => model.toggle(dimension, value),
    clear: () => model.clear(),
    activeFilters: () => model.activeFilters(),
    filtered: () => model.filtered(),
    markup() {
      const active = Object.entries(model.activeFilters());
      return `<div class="dashboard-section-heading"><div><p class="page-eyebrow">Análise interativa</p><h2>Distribuição dos registros</h2></div><button type="button" class="secondary-button" data-chart-clear${active.length ? "" : " disabled"}>Limpar filtros</button></div>
        ${active.length ? `<p class="dashboard-state" role="status">Filtros: ${active.map(([dimension, value]) => `${escapeHtml(dimension)} = ${escapeHtml(value)}`).join(" · ")}</p>` : ""}
        <div class="dashboard-columns">${CHARTS.map(chartMarkup).join("")}</div>`;
    },
  });
}

export function bindDashboardCharts(container, charts) {
  const render = () => {
    const host = container?.querySelector?.("[data-dashboard-charts]");
    if (host) host.innerHTML = charts.markup();
  };
  const activate = target => {
    if (target?.closest?.("[data-chart-clear]")) {
      charts.clear();
      render();
      return true;
    }
    const bar = target?.closest?.("[data-chart-dimension][data-chart-value]");
    if (!bar) return false;
    charts.toggle(bar.dataset.chartDimension, bar.dataset.chartValue);
    render();
    return true;
  };
  const click = event => activate(event.target);
  const keydown = event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (activate(event.target)) event.preventDefault();
  };
  container?.addEventListener?.("click", click);
  container?.addEventListener?.("keydown", keydown);
  render();
  return () => {
    container?.removeEventListener?.("click", click);
    container?.removeEventListener?.("keydown", keydown);
  };
}
