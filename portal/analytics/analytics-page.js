import { escapeHtml } from "../core/utils.js";
import { loadAnalyticsData } from "./analytics-data.js";
import { createAnalyticsModel } from "./analytics-model.js";
import { normalizeAnalyticsDefinition } from "./definition-normalizer.js";
import { canViewAnalyticsPanel } from "./analytics-access.js";

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
  const visibleFilters = definition.filters.filter(filter => filter.scope !== "global"
    && !(filter.scope === "page" && (!filter.values || !filter.values.length)));
  if (!visibleFilters.length) return "";
  const active = model.activeFilters();
  return `<section class="reports-controls analytics-filters" aria-label="Filtros do painel">
    ${visibleFilters.map(filter => {
      const selected = Array.isArray(active[filter.id]) ? active[filter.id][0] || "" : String(active[filter.id] || "");
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
  const highlight = point.highlighted === undefined
    ? ""
    : ` data-analytics-highlighted="${point.highlighted ? "true" : "false"}"${point.highlighted ? "" : ' opacity="0.3"'}`;
  return `<g role="button" tabindex="0" aria-label="${escapeHtml(label)}" data-analytics-chart="${escapeHtml(chart.id)}" data-analytics-series="${escapeHtml(point.label)}" data-analytics-filter-target="${escapeHtml(filterId)}"${highlight}>${geometry}<title>${escapeHtml(label)}</title></g>`;
}

function pivotMarkup(chart, series) {
  return `<div class="report-table-wrap" data-analytics-visual-type="pivotTable"><table class="report-table"><thead><tr><th scope="col">Dimensão</th>${series.some(point => point.seriesLabel) ? '<th scope="col">Série</th>' : ""}<th scope="col">Valor</th></tr></thead><tbody>${series.map(point => `<tr><td>${escapeHtml(point.label)}</td>${series.some(item => item.seriesLabel) ? `<td>${escapeHtml(point.seriesLabel || "Não informado")}</td>` : ""}<td>${escapeHtml(formatNumber(point.value, chart.format))}</td></tr>`).join("")}</tbody></table></div>`;
}

function ganttMarkup(chart, model) {
  const rows = model.timeline(chart.id);
  if (!rows.length) return '<p class="report-empty">Nenhum período válido disponível para este cronograma.</p>';
  const starts = rows.map(row => new Date(row.start).getTime()).filter(Number.isFinite);
  const ends = rows.map(row => new Date(row.end || row.start).getTime()).filter(Number.isFinite);
  const minimum = Math.min(...starts);
  const maximum = Math.max(...ends, minimum + 86400000);
  const span = Math.max(86400000, maximum - minimum);
  const width = 720;
  const labelWidth = 180;
  const plotWidth = 500;
  const height = Math.max(120, rows.length * 46 + 35);
  return `<svg viewBox="0 0 ${width} ${height}" role="img" data-analytics-visual-type="gantt" aria-label="Cronograma ${escapeHtml(chart.title)}">${rows.map((row, index) => {
    const start = new Date(row.start).getTime();
    const end = new Date(row.end || row.start).getTime();
    const x = labelWidth + (start - minimum) / span * plotWidth;
    const barWidth = Math.max(8, (Math.max(start, end) - start) / span * plotWidth);
    const y = 15 + index * 46;
    const progress = Math.max(0, Math.min(100, Number(row.progress) || 0));
    return `<text x="0" y="${y + 18}">${escapeHtml(row.label)}</text><rect x="${x}" y="${y}" width="${barWidth}" height="24" rx="3" class="analytics-gantt-track"></rect><rect x="${x}" y="${y}" width="${barWidth * progress / 100}" height="24" rx="3" class="analytics-gantt-progress"></rect><text x="${x + 6}" y="${y + 17}">${escapeHtml(`${progress}%`)}</text>`;
  }).join("")}</svg>`;
}

function stackedMarkup(chart, series, filterId) {
  const categories = [...new Set(series.map(point => point.label))];
  const width = 720;
  const labelWidth = 170;
  const plotWidth = 500;
  const rowHeight = 48;
  const height = Math.max(120, categories.length * rowHeight + 35);
  return `<svg viewBox="0 0 ${width} ${height}" role="img" data-analytics-visual-type="hundredPercentStackedColumnChart" aria-label="${escapeHtml(chart.title)}">${categories.map((category, rowIndex) => {
    let offset = 0;
    const points = series.filter(point => point.label === category);
    return `<text x="0" y="${rowIndex * rowHeight + 31}">${escapeHtml(category)}</text>${points.map(point => {
      const segmentWidth = Math.max(1, plotWidth * Number(point.percentage || 0) / 100);
      const x = labelWidth + offset;
      offset += segmentWidth;
      return seriesNode(chart, point, `<rect x="${x}" y="${rowIndex * rowHeight + 12}" width="${segmentWidth}" height="28" rx="2"></rect><text x="${x + segmentWidth / 2}" y="${rowIndex * rowHeight + 31}" text-anchor="middle">${escapeHtml(`${formatNumber(point.percentage, "number")}%`)}</text>`, filterId);
    }).join("")}`;
  }).join("")}</svg>`;
}

function waterfallMarkup(chart, series, filterId) {
  const width = 720;
  const height = 340;
  const baseline = 265;
  const plotHeight = 210;
  const slot = Math.max(45, Math.floor((width - 70) / Math.max(1, series.length)));
  const barWidth = Math.max(18, Math.min(48, slot - 14));
  let running = 0;
  const steps = series.map(point => {
    const start = running;
    running += Number(point.value) || 0;
    return { ...point, start, end: running };
  });
  const values = steps.flatMap(step => [step.start, step.end, 0]);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = Math.max(1, maximum - minimum);
  const y = value => baseline - (value - minimum) / span * plotHeight;
  return `<svg viewBox="0 0 ${width} ${height}" role="img" data-analytics-visual-type="waterfallChart" aria-label="${escapeHtml(chart.title)}"><line x1="30" y1="${y(0)}" x2="${width - 20}" y2="${y(0)}"></line>${steps.map((step, index) => {
    const x = 42 + index * slot;
    const top = Math.min(y(step.start), y(step.end));
    const barHeight = Math.max(2, Math.abs(y(step.start) - y(step.end)));
    const geometry = `<rect x="${x}" y="${top}" width="${barWidth}" height="${barHeight}" rx="3"></rect><text x="${x + barWidth / 2}" y="${baseline + 22}" text-anchor="middle">${escapeHtml(step.label)}</text><text x="${x + barWidth / 2}" y="${Math.max(14, top - 7)}" text-anchor="middle">${escapeHtml(formatNumber(step.value, chart.format))}</text>`;
    return seriesNode(chart, step, geometry, filterId);
  }).join("")}</svg>`;
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
  if (/gantt|timeline/i.test(chart.type)) svg = ganttMarkup(chart, model);
  else if (/pivot|tableex/i.test(chart.type)) svg = pivotMarkup(chart, series);
  else if (/hundred|100%/i.test(chart.type)) svg = stackedMarkup(chart, series, filterId);
  else if (/waterfall/i.test(chart.type)) svg = waterfallMarkup(chart, series, filterId);
  else if (/line/i.test(chart.type)) svg = lineChart(chart, series, filterId);
  else if (/column/i.test(chart.type)) svg = verticalColumns(chart, series, filterId);
  else svg = horizontalBars(chart, series, filterId);
  const interaction = model.interactionState(chart.id);
  const interactionLabel = interaction.filteredBy.length
    ? `<small>Filtrado por ${interaction.filteredBy.length} visual(is).</small>`
    : interaction.highlightedBy.length ? `<small>Realçado por ${interaction.highlightedBy.length} visual(is).</small>` : "";
  return `<article class="dashboard-chart analytics-chart" data-analytics-chart-card="${escapeHtml(chart.id)}"><h3>${escapeHtml(chart.title)}</h3>${interactionLabel}
    ${series.length ? svg : '<p class="report-empty">Nenhum dado disponível para este gráfico.</p>'}
    ${allSeries.length > SERIES_LIMIT ? `<p class="reports-page-context">Exibindo as ${SERIES_LIMIT} maiores séries de ${allSeries.length}.</p>` : ""}
  </article>`;
}

function chartsMarkup(definition, model) {
  if (!definition.charts.length) return "";
  return `<section class="dashboard-charts analytics-charts" aria-label="Gráficos do painel">${definition.charts.map(chart => chartMarkup(chart, model, definition)).join("")}</section>`;
}

function tableMarkup(table, model, state) {
  const columns = table.columns;
  const rows = model.tableRows(table.id);
  const pageCount = Math.max(1, Math.ceil(rows.length / state.pageSize));
  const page = Math.min(Math.max(1, state.pages[table.id] || 1), pageCount);
  state.pages[table.id] = page;
  const start = (page - 1) * state.pageSize;
  const displayed = rows.slice(start, start + state.pageSize);
  const interactive = Boolean(table.crossFilters?.filter?.length || table.crossFilters?.highlight?.length);
  return `<section class="reports-section analytics-table" aria-labelledby="analyticsTable-${escapeHtml(table.id)}">
    <header class="reports-heading"><div><h2 id="analyticsTable-${escapeHtml(table.id)}">${escapeHtml(table.title)}</h2><p>${new Intl.NumberFormat("pt-BR").format(rows.length)} registros filtrados.</p></div><button type="button" class="button-primary" data-analytics-export data-analytics-table-id="${escapeHtml(table.id)}">Exportar CSV</button></header>
    <div class="report-table-wrap"><table class="report-table"><thead><tr>${columns.map(column => `<th scope="col">${escapeHtml(column.title)}</th>`).join("")}</tr></thead><tbody>
      ${displayed.length ? displayed.map(row => `<tr>${columns.map(column => {
        const formatted = formatCell(row[column.id], column.type);
        const contents = interactive && column.aliases?.length && String(row[column.id] ?? "").trim()
          ? `<button type="button" class="report-facet" data-analytics-table-series="${escapeHtml(row[column.id])}" data-analytics-table-id="${escapeHtml(table.id)}" data-analytics-table-column="${escapeHtml(column.id)}">${escapeHtml(formatted)}</button>`
          : escapeHtml(formatted);
        return `<td data-label="${escapeHtml(column.title)}">${contents}</td>`;
      }).join("")}</tr>`).join("") : `<tr><td colspan="${Math.max(1, columns.length)}" class="report-empty">Nenhum registro corresponde aos filtros selecionados.</td></tr>`}
    </tbody></table></div>
    <nav class="entity-pagination" aria-label="Paginação da tabela"><button type="button" data-analytics-prev data-analytics-table-id="${escapeHtml(table.id)}"${page <= 1 ? " disabled" : ""}>Página anterior</button><span>Página ${page} de ${pageCount}</span><button type="button" data-analytics-next data-analytics-table-id="${escapeHtml(table.id)}"${page >= pageCount ? " disabled" : ""}>Próxima página</button></nav>
  </section>`;
}

function tablesMarkup(definition, model, state) {
  return (definition.tables || [definition.table]).filter(table => table?.columns?.length && !table.visualType).map(table => tableMarkup(table, model, state)).join("");
}

function pageMarkup(definition, data, model, state) {
  const partial = data.complete === false
    ? '<p class="reports-partial" role="alert">Dados parciais: uma ou mais fontes não foram carregadas integralmente. Os indicadores abaixo usam somente os registros disponíveis.</p>'
    : "";
  return `<section class="reports-page analytics-page" aria-labelledby="analyticsTitle">
    <header class="reports-heading"><div><p class="page-eyebrow">Dados do SharePoint</p><h1 id="analyticsTitle">${escapeHtml(definition.title)}</h1><p>Indicadores consolidados, gráficos interativos e dados detalhados.</p></div></header>
    ${partial}${diagnosticsMarkup(data, state.entities)}${filtersMarkup(definition, model)}${kpisMarkup(definition, model)}${chartsMarkup(definition, model)}${tablesMarkup(definition, model, state)}
  </section>`;
}

function safeSpreadsheetValue(value) {
  const source = String(value ?? "");
  let offset = 0;
  for (const character of source) {
    const codePoint = character.codePointAt(0);
    if (!/[\p{White_Space}\p{Cc}\p{Cf}]/u.test(character)
      && codePoint > 31
      && codePoint !== 127) break;
    offset += character.length;
  }
  return /^[=+\-@]/.test(source.slice(offset)) ? `'${source}` : source;
}

function csvCell(value) {
  const text = safeSpreadsheetValue(value);
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(table, model) {
  const columns = table.columns;
  const lines = [columns.map(column => csvCell(column.title)).join(";")];
  for (const row of model.exportRows(table.id)) lines.push(columns.map(column => csvCell(row[column.id])).join(";"));
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
  if (typeof context.can === "function" && !canViewAnalyticsPanel(definition.id, context.access, context.can)) {
    root.innerHTML = `<section class="reports-page analytics-page" aria-labelledby="analyticsTitle"><header class="reports-heading"><div><p class="page-eyebrow">Dados do SharePoint</p><h1 id="analyticsTitle">${escapeHtml(definition.title)}</h1></div></header><p class="reports-warning" role="alert">Sua conta Microsoft está sem permissão para visualizar este painel.</p></section>`;
    const ready = Promise.resolve(undefined);
    const dispose = () => {};
    return Object.freeze({ ready, refresh: () => ready, dispose, cleanup: dispose });
  }
  const entities = authorizedCatalog(context.entities, context.access, context.can);
  const state = {
    entities,
    pages: Object.create(null),
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
    state.pages = Object.create(null);
  }

  function applyFilter(id, value) {
    if (!state.model) return;
    const active = state.model.activeFilters();
    if (active[id]) state.model.toggleFilter(id, active[id]);
    if (String(value ?? "").trim()) state.model.toggleFilter(id, value);
    state.pages = Object.create(null);
    render();
  }

  function exportCsv(tableId = "") {
    if (!state.model) return;
    const tables = definition.tables || [definition.table];
    const table = tables.find(candidate => candidate.id === tableId) || tables.find(candidate => !candidate.visualType) || definition.table;
    if (!table) return;
    const date = new Date().toISOString().slice(0, 10);
    const visibleTables = tables.filter(candidate => !candidate.visualType);
    const title = visibleTables.length > 1 ? `${definition.title}-${table.title}` : definition.title;
    (context.download || defaultDownload)(`${slug(title)}-${date}.csv`, toCsv(table, state.model));
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
      if (chart?.crossFilters) {
        state.model?.toggleVisualSelection(chart.id, series.dataset.analyticsSeries);
        state.pages = Object.create(null);
        render();
      } else if (filterId) applyFilter(filterId, series.dataset.analyticsSeries);
      else if (chart) {
        state.model?.toggleVisualSelection(chart.id, series.dataset.analyticsSeries);
        state.pages = Object.create(null);
        render();
      }
      return;
    }
    const tableSeries = datasetTarget(event.target, "analyticsTableSeries");
    if (tableSeries) {
      const table = definition.tables.find(item => item.id === tableSeries.dataset.analyticsTableId);
      const column = table?.columns.find(item => item.id === tableSeries.dataset.analyticsTableColumn);
      if (table && column) {
        state.model?.toggleVisualSelection(table.id, tableSeries.dataset.analyticsTableSeries, column.aliases);
        state.pages = Object.create(null);
        render();
      }
      return;
    }
    if (datasetTarget(event.target, "analyticsClear")) {
      state.model?.clearFilters();
      state.pages = Object.create(null);
      render();
      return;
    }
    const previous = datasetTarget(event.target, "analyticsPrev");
    if (previous) {
      const tableId = previous.dataset.analyticsTableId || "";
      state.pages[tableId] = Math.max(1, (state.pages[tableId] || 1) - 1);
      render();
      return;
    }
    const next = datasetTarget(event.target, "analyticsNext");
    if (next) {
      const tableId = next.dataset.analyticsTableId || "";
      const pages = Math.max(1, Math.ceil((state.model?.tableRows(tableId).length || 0) / state.pageSize));
      state.pages[tableId] = Math.min(pages, (state.pages[tableId] || 1) + 1);
      render();
      return;
    }
    const exportButton = datasetTarget(event.target, "analyticsExport");
    if (exportButton) exportCsv(exportButton.dataset.analyticsTableId || "");
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
