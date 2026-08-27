import { escapeHtml } from "../core/utils.js";
import { loadAnalyticsData } from "./analytics-data.js";
import { createAnalyticsModel } from "./analytics-model.js";
import { normalizeAnalyticsDefinition } from "./definition-normalizer.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const SERIES_LIMIT = 20;

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const candidate = Number(value);
  return Number.isInteger(candidate) && candidate > 0 ? Math.min(candidate, maximum) : fallback;
}

function normalized(value) {
  return String(value ?? "").trim().toLocaleUpperCase("pt-BR");
}

function formatNumber(value, format = "number") {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "");
  if (format === "currency") {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(number);
  }
  if (format === "integer") return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(number);
  if (format === "percent" || format === "percentage") {
    const percent = Math.abs(number) <= 1 ? number * 100 : number;
    return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(percent)}%`;
  }
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(number);
}

function formatCell(value, type) {
  if (type === "currency" || type === "number" || type === "integer" || type === "percent" || type === "percentage") {
    return formatNumber(value, type);
  }
  return String(value ?? "");
}

function sourceTitle(sourceId, entities) {
  return entities.find(entity => String(entity?.id) === String(sourceId))?.title || sourceId;
}

function diagnosticStateLabel(state) {
  if (state === "ready") return "Concluída";
  if (state === "partial") return "Parcial";
  if (state === "forbidden") return "Sem permissão";
  if (state === "missing") return "Não localizada";
  if (state === "unknown" || state === "invalid") return "Indisponível";
  return "Erro";
}

function diagnosticsMarkup(data, entities) {
  const diagnostics = data?.diagnostics || [];
  if (!diagnostics.length) return "";
  return `<section class="reports-section analytics-diagnostics" aria-labelledby="analyticsSourcesTitle">
    <h2 id="analyticsSourcesTitle">Fontes consultadas</h2>
    <ul>${diagnostics.map(item => {
      const count = new Intl.NumberFormat("pt-BR").format(Number(item.loadedCount) || 0);
      const pages = Number(item.pageCount) || 0;
      const unit = Number(item.loadedCount) === 1 ? "registro" : "registros";
      const pageUnit = pages === 1 ? "página" : "páginas";
      const message = String(item.message || "").trim();
      const isProblem = item.state !== "ready";
      return `<li class="analytics-diagnostic is-${escapeHtml(item.state || "error")}"${isProblem ? ' role="alert"' : ""}>
        <strong>${escapeHtml(sourceTitle(item.sourceId, entities))}</strong>
        <span>${escapeHtml(diagnosticStateLabel(item.state))} · ${count} ${unit} · ${pages} ${pageUnit}</span>
        ${message ? `<small>${escapeHtml(message)}</small>` : ""}
      </li>`;
    }).join("")}</ul>
  </section>`;
}

function filtersMarkup(definition, model) {
  if (!definition.filters.length) return "";
  const active = model.activeFilters();
  return `<section class="reports-controls analytics-filters" aria-label="Filtros do painel">
    ${definition.filters.map(filter => {
      const selected = String(active[filter.id] || "");
      const options = model.filterOptions(filter.id);
      return `<label>${escapeHtml(filter.title)}<select data-analytics-filter="${escapeHtml(filter.id)}">
        <option value="">Todos</option>
        ${options.map(option => `<option value="${escapeHtml(option)}"${normalized(option) === normalized(selected) ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}
      </select></label>`;
    }).join("")}
    <button type="button" class="button-secondary" data-analytics-clear>Limpar filtros</button>
  </section>`;
}

function kpisMarkup(definition, model) {
  if (!definition.kpis.length) return "";
  return `<section class="report-metrics analytics-kpis" aria-label="Indicadores do painel">
    ${definition.kpis.map(kpi => `<article><span>${escapeHtml(kpi.title)}</span><strong>${escapeHtml(formatNumber(model.metric(kpi.id), kpi.format))}</strong></article>`).join("")}
  </section>`;
}

function chartFilterId(chart, definition) {
  const aliases = new Set((chart.dimensionAliases || []).map(normalized).filter(Boolean));
  return definition.filters.find(filter => (filter.aliases || []).some(alias => aliases.has(normalized(alias))))?.id || "";
}

function seriesNode(chart, point, geometry, filterId) {
  const label = `${point.label}: ${formatNumber(point.value, chart.format)}`;
  return `<g role="button" tabindex="0" aria-label="${escapeHtml(label)}" data-analytics-chart="${escapeHtml(chart.id)}" data-analytics-series="${escapeHtml(point.label)}" data-analytics-filter-target="${escapeHtml(filterId)}">${geometry}<title>${escapeHtml(label)}</title></g>`;
}

function horizontalBars(chart, series, filterId) {
  const width = 720;
  const rowHeight = 38;
  const labelWidth = 190;
  const chartWidth = width - labelWidth - 100;
  const height = Math.max(100, series.length * rowHeight + 30);
  const maximum = Math.max(1, ...series.map(point => Math.abs(Number(point.value) || 0)));
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${escapeHtml(chart.id)}Title ${escapeHtml(chart.id)}Desc">
    <title id="${escapeHtml(chart.id)}Title">${escapeHtml(chart.title)}</title>
    <desc id="${escapeHtml(chart.id)}Desc">Gráfico de barras interativo. Pressione Enter em uma série para filtrar o painel.</desc>
    ${series.map((point, index) => {
      const y = index * rowHeight + 12;
      const barWidth = Math.max(2, Math.round(Math.abs(Number(point.value) || 0) / maximum * chartWidth));
      const geometry = `<text x="0" y="${y + 16}">${escapeHtml(point.label)}</text><rect x="${labelWidth}" y="${y}" width="${barWidth}" height="24" rx="3"></rect><text x="${labelWidth + barWidth + 8}" y="${y + 17}">${escapeHtml(formatNumber(point.value, chart.format))}</text>`;
      return seriesNode(chart, point, geometry, filterId);
    }).join("")}
  </svg>`;
}

function verticalColumns(chart, series, filterId) {
  const width = 720;
  const height = 330;
  const baseline = 265;
  const plotHeight = 210;
  const slot = Math.max(45, Math.floor((width - 60) / Math.max(1, series.length)));
  const barWidth = Math.max(18, Math.min(48, slot - 14));
  const maximum = Math.max(1, ...series.map(point => Math.abs(Number(point.value) || 0)));
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${escapeHtml(chart.id)}Title ${escapeHtml(chart.id)}Desc">
    <title id="${escapeHtml(chart.id)}Title">${escapeHtml(chart.title)}</title>
    <desc id="${escapeHtml(chart.id)}Desc">Gráfico de colunas interativo. Pressione Enter em uma série para filtrar o painel.</desc>
    <line x1="30" y1="${baseline}" x2="${width - 20}" y2="${baseline}"></line>
    ${series.map((point, index) => {
      const x = 42 + index * slot;
      const barHeight = Math.max(2, Math.round(Math.abs(Number(point.value) || 0) / maximum * plotHeight));
      const geometry = `<rect x="${x}" y="${baseline - barHeight}" width="${barWidth}" height="${barHeight}" rx="3"></rect><text x="${x + barWidth / 2}" y="${baseline + 18}" text-anchor="middle">${escapeHtml(point.label)}</text><text x="${x + barWidth / 2}" y="${Math.max(15, baseline - barHeight - 8)}" text-anchor="middle">${escapeHtml(formatNumber(point.value, chart.format))}</text>`;
      return seriesNode(chart, point, geometry, filterId);
    }).join("")}
  </svg>`;
}

function lineChart(chart, series, filterId) {
  const width = 720;
  const height = 330;
  const left = 45;
  const baseline = 265;
  const plotWidth = width - left - 35;
  const plotHeight = 210;
  const maximum = Math.max(1, ...series.map(point => Math.abs(Number(point.value) || 0)));
  const points = series.map((point, index) => ({
    ...point,
    x: left + (series.length === 1 ? plotWidth / 2 : index * plotWidth / (series.length - 1)),
    y: baseline - Math.abs(Number(point.value) || 0) / maximum * plotHeight,
  }));
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${escapeHtml(chart.id)}Title ${escapeHtml(chart.id)}Desc">
    <title id="${escapeHtml(chart.id)}Title">${escapeHtml(chart.title)}</title>
    <desc id="${escapeHtml(chart.id)}Desc">Gráfico de linha interativo. Pressione Enter em um ponto para filtrar o painel.</desc>
    <line x1="${left}" y1="${baseline}" x2="${width - 20}" y2="${baseline}"></line><path d="${path}" fill="none"></path>
    ${points.map(point => seriesNode(chart, point, `<circle cx="${point.x}" cy="${point.y}" r="7"></circle><text x="${point.x}" y="${baseline + 20}" text-anchor="middle">${escapeHtml(point.label)}</text>`, filterId)).join("")}
  </svg>`;
}

function chartMarkup(chart, model, definition) {
  const allSeries = model.series(chart.id);
  const series = allSeries.slice(0, SERIES_LIMIT);
  const filterId = chartFilterId(chart, definition);
  let svg;
  if (/line/i.test(chart.type)) svg = lineChart(chart, series, filterId);
  else if (/column/i.test(chart.type)) svg = verticalColumns(chart, series, filterId);
  else svg = horizontalBars(chart, series, filterId);
  return `<article class="dashboard-chart analytics-chart" data-analytics-chart-card="${escapeHtml(chart.id)}"><h3>${escapeHtml(chart.title)}</h3>
    ${series.length ? svg : '<p class="report-empty">Nenhum dado disponível para este gráfico.</p>'}
    ${allSeries.length > SERIES_LIMIT ? `<p class="reports-page-context">Exibindo as ${SERIES_LIMIT} maiores séries de ${allSeries.length}.</p>` : ""}
  </article>`;
}

function chartsMarkup(definition, model) {
  if (!definition.charts.length) return "";
  return `<section class="dashboard-charts analytics-charts" aria-label="Gráficos do painel">${definition.charts.map(chart => chartMarkup(chart, model, definition)).join("")}</section>`;
}

function tableMarkup(definition, model, state) {
  const columns = definition.table.columns;
  const rows = model.tableRows();
  const pageCount = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(Math.max(1, state.page), pageCount);
  const start = (state.page - 1) * state.pageSize;
  const displayed = rows.slice(start, start + state.pageSize);
  return `<section class="reports-section analytics-table" aria-labelledby="analyticsTableTitle">
    <header class="reports-heading"><div><h2 id="analyticsTableTitle">${escapeHtml(definition.table.title)}</h2><p>${new Intl.NumberFormat("pt-BR").format(rows.length)} registros filtrados.</p></div><button type="button" class="button-primary" data-analytics-export>Exportar CSV</button></header>
    <div class="report-table-wrap"><table class="report-table"><thead><tr>${columns.map(column => `<th scope="col">${escapeHtml(column.title)}</th>`).join("")}</tr></thead><tbody>
      ${displayed.length ? displayed.map(row => `<tr>${columns.map(column => `<td data-label="${escapeHtml(column.title)}">${escapeHtml(formatCell(row[column.id], column.type))}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${Math.max(1, columns.length)}" class="report-empty">Nenhum registro corresponde aos filtros selecionados.</td></tr>`}
    </tbody></table></div>
    <nav class="entity-pagination" aria-label="Paginação da tabela"><button type="button" data-analytics-prev${state.page <= 1 ? " disabled" : ""}>Página anterior</button><span>Página ${state.page} de ${pageCount}</span><button type="button" data-analytics-next${state.page >= pageCount ? " disabled" : ""}>Próxima página</button></nav>
  </section>`;
}

function pageMarkup(definition, data, model, state) {
  const partial = data.complete === false
    ? '<p class="reports-partial" role="alert">Dados parciais: uma ou mais fontes não foram carregadas integralmente. Os indicadores abaixo usam somente os registros disponíveis.</p>'
    : "";
  return `<section class="reports-page analytics-page" aria-labelledby="analyticsTitle">
    <header class="reports-heading"><div><p class="page-eyebrow">Dados do SharePoint</p><h1 id="analyticsTitle">${escapeHtml(definition.title)}</h1><p>Indicadores consolidados, gráficos interativos e dados detalhados.</p></div></header>
    ${partial}${diagnosticsMarkup(data, state.entities)}${filtersMarkup(definition, model)}${kpisMarkup(definition, model)}${chartsMarkup(definition, model)}${tableMarkup(definition, model, state)}
  </section>`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(definition, model) {
  const columns = definition.table.columns;
  const lines = [columns.map(column => csvCell(column.title)).join(";")];
  for (const row of model.exportRows()) lines.push(columns.map(column => csvCell(row[column.id])).join(";"));
  return `\uFEFF${lines.join("\r\n")}`;
}

function slug(value) {
  return String(value || "analytics").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "analytics";
}

function defaultDownload(fileName, contents) {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function datasetTarget(target, key) {
  let current = target;
  while (current) {
    if (current.dataset && Object.prototype.hasOwnProperty.call(current.dataset, key)) return current;
    current = current.parentElement;
  }
  return null;
}

function authorizedCatalog(entities, access, can) {
  return Object.freeze((entities || []).map(entity => {
    if (typeof can !== "function" || !entity?.moduleId || can(access, entity.moduleId, "view") === true) return entity;
    return Object.freeze({ ...entity, available: false });
  }));
}

export function createAnalyticsPage(root, context = {}) {
  if (!root || typeof root.addEventListener !== "function") throw new TypeError("A página analítica requer um elemento raiz interativo.");
  const normalizeDefinition = context.normalizeDefinition || normalizeAnalyticsDefinition;
  const loadData = context.loadData || loadAnalyticsData;
  const definition = normalizeDefinition(context.definition || {});
  const entities = authorizedCatalog(context.entities, context.access, context.can);
  const state = {
    entities,
    page: 1,
    pageSize: positiveInteger(context.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
    data: undefined,
    model: undefined,
  };
  let disposed = false;
  let generation = 0;
  let controller;

  function renderLoading(progress) {
    if (disposed) return;
    const detail = progress ? ` ${new Intl.NumberFormat("pt-BR").format(Number(progress.loadedCount) || 0)} registros carregados.` : "";
    root.innerHTML = `<section class="reports-page analytics-page" aria-labelledby="analyticsTitle"><header class="reports-heading"><div><p class="page-eyebrow">Dados do SharePoint</p><h1 id="analyticsTitle">${escapeHtml(definition.title)}</h1></div></header><p class="reports-loading" role="status" aria-live="polite">Carregando fontes do painel.${escapeHtml(detail)}</p></section>`;
  }

  function render() {
    if (!disposed && state.data && state.model) root.innerHTML = pageMarkup(definition, state.data, state.model, state);
  }

  function rebuild() {
    state.model = createAnalyticsModel(state.data?.records || [], definition);
    state.page = 1;
  }

  function applyFilter(id, value) {
    if (!state.model) return;
    const active = state.model.activeFilters();
    if (active[id]) state.model.toggleFilter(id, active[id]);
    if (String(value ?? "").trim()) state.model.toggleFilter(id, value);
    state.page = 1;
    render();
  }

  function exportCsv() {
    if (!state.model) return;
    const date = new Date().toISOString().slice(0, 10);
    (context.download || defaultDownload)(`${slug(definition.title)}-${date}.csv`, toCsv(definition, state.model));
  }

  function clickHandler(event) {
    if (disposed) return;
    if (datasetTarget(event.target, "analyticsRetry")) {
      void refresh();
      return;
    }
    const series = datasetTarget(event.target, "analyticsSeries");
    if (series) {
      const chart = definition.charts.find(item => item.id === series.dataset.analyticsChart);
      const filterId = series.dataset.analyticsFilterTarget || (chart ? chartFilterId(chart, definition) : "");
      if (filterId) applyFilter(filterId, series.dataset.analyticsSeries);
      return;
    }
    if (datasetTarget(event.target, "analyticsClear")) {
      state.model?.clearFilters();
      state.page = 1;
      render();
      return;
    }
    if (datasetTarget(event.target, "analyticsPrev")) {
      state.page = Math.max(1, state.page - 1);
      render();
      return;
    }
    if (datasetTarget(event.target, "analyticsNext")) {
      const pages = Math.max(1, Math.ceil((state.model?.tableRows().length || 0) / state.pageSize));
      state.page = Math.min(pages, state.page + 1);
      render();
      return;
    }
    if (datasetTarget(event.target, "analyticsExport")) exportCsv();
  }

  function changeHandler(event) {
    const select = datasetTarget(event.target, "analyticsFilter");
    if (!disposed && select) applyFilter(select.dataset.analyticsFilter, select.value);
  }

  function keyHandler(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const series = datasetTarget(event.target, "analyticsSeries");
    if (!series) return;
    event.preventDefault?.();
    clickHandler({ target: series });
  }

  root.addEventListener("click", clickHandler);
  root.addEventListener("change", changeHandler);
  root.addEventListener("keydown", keyHandler);

  async function refresh() {
    const token = ++generation;
    controller?.abort();
    controller = new AbortController();
    renderLoading();
    try {
      const data = await loadData(context.repository, definition, entities, {
        signal: controller.signal,
        onProgress(progress) {
          if (!disposed && !controller.signal.aborted && token === generation) renderLoading(progress);
        },
      });
      if (disposed || controller.signal.aborted || token !== generation) return undefined;
      state.data = data;
      rebuild();
      render();
      return data;
    } catch (error) {
      if (disposed || controller.signal.aborted || token !== generation || error?.name === "AbortError") return undefined;
      root.innerHTML = `<section class="reports-page analytics-page" aria-labelledby="analyticsTitle"><header class="reports-heading"><div><p class="page-eyebrow">Dados do SharePoint</p><h1 id="analyticsTitle">${escapeHtml(definition.title)}</h1></div></header><p class="reports-warning" role="alert">Não foi possível carregar este painel. ${escapeHtml(error?.message || "Tente novamente.")}</p><button type="button" class="button-secondary" data-analytics-retry>Tentar novamente</button></section>`;
      return undefined;
    }
  }

  const ready = refresh();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    controller?.abort();
    root.removeEventListener("click", clickHandler);
    root.removeEventListener("change", changeHandler);
    root.removeEventListener("keydown", keyHandler);
  };
  return Object.freeze({ ready, refresh, dispose, cleanup: dispose });
}

export default createAnalyticsPage;
