import { buildAuditSummary, summarizeAuditEvents, todayDateKey } from "./audit-model.js";
import { interactiveBarChartMarkup } from "../charts/bar-chart.js";
import { buildChartSeries, createCrossFilterModel } from "../charts/cross-filter.js";
import { escapeHtml } from "../core/utils.js";
import { dashboardRecords, loadDashboardSources } from "../dashboard/dashboard-model.js";

const AUDIT_CHARTS = Object.freeze([
  Object.freeze({ id: "audit-actions", title: "Ação", dimension: "action" }),
  Object.freeze({ id: "audit-sources", title: "Bases", dimension: "sourceId" }),
  Object.freeze({ id: "audit-users", title: "Usuários", dimension: "actorId" }),
]);

function boundedInteger(value, fallback, maximum) {
  const candidate = Number(value);
  if (!Number.isInteger(candidate) || candidate < 1) return fallback;
  return Math.min(candidate, maximum);
}

function accessibleEntities(context) {
  return Object.freeze((context.entities || []).filter(entity => entity.available !== false
    && context.can?.(context.access, entity.moduleId, "view") === true));
}

export async function loadAuditPageData(context = {}, options = {}) {
  const entities = accessibleEntities(context);
  if (typeof context.repository?.getItemsPage !== "function") {
    throw new TypeError("A auditoria requer paginação incremental do repositório SharePoint.");
  }
  const timeZone = options.timeZone || "America/Sao_Paulo";
  const date = String(options.date || todayDateKey(new Date(), timeZone));
  const loadOptions = {
    ...options,
    batchSize: boundedInteger(options.batchSize, 100, 100),
    maxPages: boundedInteger(options.maxPages, 10, 50),
  };
  const concurrency = boundedInteger(options.sourceConcurrency, 4, 8);
  const loadedSources = [];
  for (let index = 0; index < entities.length; index += concurrency) {
    const batch = await loadDashboardSources(context.repository, entities.slice(index, index + concurrency), loadOptions);
    loadedSources.push(...batch);
  }
  const sources = Object.freeze(loadedSources);
  const records = dashboardRecords(sources);
  return Object.freeze({
    date,
    timeZone,
    entities,
    sources,
    records,
    partial: sources.some(source => source.state !== "ready"),
    summary: buildAuditSummary(records, { date, timeZone }),
  });
}

function chartLabels(events, dimension) {
  if (dimension === "action") return new Map([["created", "Criação"], ["edited", "Edição"]]);
  if (dimension === "sourceId") return new Map(events.map(event => [event.sourceId, event.sourceTitle]));
  return new Map(events.map(event => [event.actorId, `${event.actor} · ${event.actorId}`]));
}

export function createAuditCharts(events = []) {
  const records = Object.freeze([...(events || [])]);
  const model = createCrossFilterModel(records);
  function chartMarkup(chart) {
    const labels = chartLabels(records, chart.dimension);
    const series = buildChartSeries(model.filteredExcept(chart.dimension), chart.dimension)
      .map(row => Object.freeze({ ...row, label: labels.get(row.key) || row.label }));
    return interactiveBarChartMarkup({
      ...chart,
      series,
      activeValue: model.activeFilters()[chart.dimension] || "",
    });
  }
  return Object.freeze({
    toggle: (dimension, value) => model.toggle(dimension, value),
    clear: () => model.clear(),
    filtered: () => model.filtered(),
    activeFilters: () => model.activeFilters(),
    markup() {
      const active = Object.entries(model.activeFilters());
      return `<div class="dashboard-section-heading"><div><p class="page-eyebrow">Filtros cruzados</p><h2>Movimentações por dimensão</h2></div><button type="button" class="secondary-button" data-audit-chart-clear${active.length ? "" : " disabled"}>Limpar filtros</button></div>
        ${active.length ? `<p class="dashboard-state" role="status">${active.length} filtro(s) ativo(s)</p>` : ""}
        <div class="dashboard-columns">${AUDIT_CHARTS.map(chartMarkup).join("")}</div>`;
    },
  });
}

function groupRows(rows = []) {
  if (!rows.length) return '<p class="dashboard-empty">Nenhuma movimentação neste recorte.</p>';
  return `<ul class="dashboard-list">${rows.map(row => `<li><strong>${escapeHtml(row.label)}</strong><span>${row.created} criação(ões) · ${row.edited} edição(ões)</span></li>`).join("")}</ul>`;
}

function eventPage(events, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(events.length / pageSize));
  const current = Math.min(boundedInteger(page, 1, totalPages), totalPages);
  const start = (current - 1) * pageSize;
  return { current, totalPages, rows: events.slice(start, start + pageSize) };
}

function idsMarkup(events, kind, options) {
  const page = eventPage(events, options[`${kind}Page`], options.pageSize);
  const label = kind === "created" ? "criados" : "editados";
  const ids = page.rows.length
    ? `<ul class="dashboard-list">${page.rows.map(event => `<li><a href="#/entity/${encodeURIComponent(event.sourceId)}/item/${encodeURIComponent(event.recordId)}"><strong>${escapeHtml(event.sourceTitle)} #${escapeHtml(event.recordId)}</strong></a><span>${escapeHtml(event.actor)}</span></li>`).join("")}</ul>`
    : `<p class="dashboard-empty">Nenhum ID ${label} neste recorte.</p>`;
  return `<section aria-labelledby="audit-${kind}-ids"><h3 id="audit-${kind}-ids">IDs ${label}</h3>${ids}
    <div class="dashboard-section-heading"><span>Página ${page.current} de ${page.totalPages}</span><span>
      <button type="button" class="secondary-button" data-audit-page-kind="${kind}" data-audit-page="${page.current - 1}"${page.current === 1 ? " disabled" : ""}>Anterior</button>
      <button type="button" class="secondary-button" data-audit-page-kind="${kind}" data-audit-page="${page.current + 1}"${page.current === page.totalPages ? " disabled" : ""}>Próxima</button>
    </span></div></section>`;
}

export function auditDetailsMarkup(events = [], options = {}) {
  const pageSize = boundedInteger(options.pageSize, 20, 50);
  const summary = summarizeAuditEvents(events, options.date || "");
  const created = summary.events.filter(event => event.created);
  const edited = summary.events.filter(event => event.edited);
  const paging = { ...options, pageSize };
  return `<section class="dashboard-metrics" aria-label="Totais da auditoria detalhada">
      <article class="dashboard-metric"><span>Total criado no recorte</span><strong>${summary.created}</strong></article>
      <article class="dashboard-metric"><span>Total editado no recorte</span><strong>${summary.edited}</strong></article>
    </section>
    <div class="dashboard-columns">${idsMarkup(created, "created", paging)}${idsMarkup(edited, "edited", paging)}</div>
    <div class="dashboard-columns"><section><h3>Criações e edições por base</h3>${groupRows(summary.bySource)}</section><section><h3>Criações e edições por usuário</h3>${groupRows(summary.byUser)}</section></div>`;
}

function pageMarkup(data, charts, paging) {
  const unavailable = data.sources.filter(source => source.state !== "ready");
  return `<section class="dashboard-page" aria-labelledby="auditPageTitle">
    <header class="dashboard-heading"><div><p class="page-eyebrow">Administração</p><h1 id="auditPageTitle">Detalhamento/Auditoria</h1></div><label>Data <input type="date" data-audit-page-date value="${escapeHtml(data.summary.date)}"></label></header>
    ${data.entities.length ? "" : '<p class="dashboard-empty">Nenhuma entidade foi liberada para esta conta.</p>'}
    ${unavailable.length ? `<p class="dashboard-warning" role="status">Recorte parcial: ${unavailable.length} fonte(s) não foram concluídas. Os totais abaixo representam somente os registros carregados.</p>` : ""}
    <section class="dashboard-section" data-audit-charts>${charts.markup()}</section>
    <section class="dashboard-section" data-audit-details>${auditDetailsMarkup(charts.filtered(), { ...paging, date: data.summary.date })}</section>
  </section>`;
}

export function renderAuditPage(container, context = {}) {
  if (!container) throw new TypeError("A auditoria detalhada requer um elemento de conteúdo.");
  let disposed = false;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const paging = { pageSize: 20, createdPage: 1, editedPage: 1 };
  let data;
  let charts;
  container.innerHTML = '<section class="dashboard-page" aria-busy="true"><p class="dashboard-loading">Carregando auditoria...</p></section>';

  const render = () => {
    if (!disposed) container.innerHTML = pageMarkup(data, charts, paging);
  };
  const ready = loadAuditPageData(context, { ...(context.auditOptions || {}), signal: controller?.signal }).then(result => {
    data = result;
    charts = createAuditCharts(data.summary.events);
    render();
    return result;
  }).catch(error => {
    if (disposed || error?.name === "AbortError") return undefined;
    container.innerHTML = `<section class="dashboard-page"><h1>Detalhamento/Auditoria</h1><p class="dashboard-warning" role="alert">Não foi possível carregar a auditoria: ${escapeHtml(error?.message || "erro desconhecido")}</p></section>`;
    throw error;
  });

  const activate = target => {
    if (!data || !charts) return false;
    if (target?.closest?.("[data-audit-chart-clear]")) {
      charts.clear();
    } else {
      const bar = target?.closest?.("[data-chart-dimension][data-chart-value]");
      if (bar) charts.toggle(bar.dataset.chartDimension, bar.dataset.chartValue);
      else {
        const button = target?.closest?.("[data-audit-page-kind][data-audit-page]");
        if (!button) return false;
        paging[`${button.dataset.auditPageKind}Page`] = boundedInteger(button.dataset.auditPage, 1, Number.MAX_SAFE_INTEGER);
      }
    }
    render();
    return true;
  };
  const click = event => activate(event.target);
  const keydown = event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (activate(event.target)) event.preventDefault();
  };
  const change = event => {
    if (!data || !event.target?.matches?.("[data-audit-page-date]")) return;
    data = Object.freeze({
      ...data,
      date: event.target.value,
      summary: buildAuditSummary(data.records, { date: event.target.value, timeZone: data.timeZone }),
    });
    paging.createdPage = 1;
    paging.editedPage = 1;
    charts = createAuditCharts(data.summary.events);
    render();
  };
  container.addEventListener?.("click", click);
  container.addEventListener?.("keydown", keydown);
  container.addEventListener?.("change", change);

  return Object.freeze({
    ready,
    cleanup() {
      disposed = true;
      controller?.abort();
      container.removeEventListener?.("click", click);
      container.removeEventListener?.("keydown", keydown);
      container.removeEventListener?.("change", change);
    },
  });
}
