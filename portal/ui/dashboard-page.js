import { buildAuditSummary, todayDateKey } from "../audit/audit-model.js";
import { auditPanelMarkup } from "../audit/audit-panel.js";
import { bindDashboardCharts, createDashboardCharts } from "../charts/dashboard-charts.js";
import {
  DASHBOARD_METRIC_DEFINITIONS,
  buildDashboardMetrics,
  dashboardRecords,
  loadDashboardSources,
} from "../dashboard/dashboard-model.js";
import { escapeHtml, formatDateTime } from "../core/utils.js";

function accessibleModules(context) {
  return (context.modules || []).filter(module => {
    if (module.id === "dashboard") return false;
    if (module.id === "usuarios-acessos") return context.isSuperAdmin === true;
    return context.can?.(context.access, module.id, "view") === true;
  });
}

function visibleDashboardEntities(context, modules) {
  const metricIds = new Set(DASHBOARD_METRIC_DEFINITIONS.flatMap(metric => metric.entityIds));
  const moduleIds = new Set(modules.map(module => module.id));
  const accessible = (context.entities || []).filter(entity => entity.available !== false
    && moduleIds.has(entity.moduleId)
    && context.can?.(context.access, entity.moduleId, "view") === true);
  const firstByModule = new Map();
  for (const entity of accessible) if (!firstByModule.has(entity.moduleId)) firstByModule.set(entity.moduleId, entity);
  return Object.freeze([...new Map([
    ...accessible.filter(entity => metricIds.has(entity.id)),
    ...firstByModule.values(),
  ].map(entity => [entity.id, entity])).values()]);
}

function attentionItem(item) {
  return /PENDENTE|AGUARDANDO|ATRASAD|ABERTO|EM ANDAMENTO/i.test(String(item?.status || ""));
}

function legacyIndicators(sources, context) {
  return Object.freeze(sources.map(source => {
    const entity = (context.entities || []).find(candidate => candidate.id === source.entityId);
    const module = (context.modules || []).find(candidate => candidate.id === entity?.moduleId)
      || { id: entity?.moduleId || "", title: entity?.moduleId || "Fonte" };
    const records = dashboardRecords([source]);
    return Object.freeze({
      module,
      entity,
      count: source.items.length,
      attention: records.filter(attentionItem).length,
      updates: records.map(item => Object.freeze({
        title: item.fields?.Title || source.title,
        module: module.title,
        changedAt: item.lastModifiedDateTime || item.createdDateTime,
        attention: attentionItem(item),
      })),
      state: source.state === "partial" ? "ready" : source.state === "error" ? "unavailable" : source.state,
      error: source.state === "ready" ? undefined : new Error(source.diagnostic),
    });
  }));
}

export async function loadDashboardSummary(context, options = {}) {
  const modules = accessibleModules(context);
  const entities = visibleDashboardEntities(context, modules);
  const sources = await loadDashboardSources(context.repository, entities, options);
  const records = dashboardRecords(sources);
  const today = String(options.today || todayDateKey(new Date(), options.timeZone));
  const metrics = buildDashboardMetrics(sources, { today });
  const audit = buildAuditSummary(records, { date: today, timeZone: options.timeZone });
  const indicators = legacyIndicators(sources, context);
  const updates = indicators.flatMap(indicator => indicator.updates)
    .sort((left, right) => new Date(right.changedAt || 0) - new Date(left.changedAt || 0))
    .slice(0, 6);
  return Object.freeze({
    modules,
    sources,
    records,
    metrics,
    audit,
    indicators,
    attention: indicators.reduce((total, indicator) => total + indicator.attention, 0),
    updates,
    online: globalThis.navigator?.onLine !== false,
  });
}

function shortcut(module) {
  const href = module.id === "usuarios-acessos" ? "#/access" : module.id === "relatorios" ? "#/reports" : `#/module/${encodeURIComponent(module.id)}`;
  return `<a class="dashboard-shortcut" href="${href}"><span>${escapeHtml(module.title)}</span><span aria-hidden="true">›</span></a>`;
}

function metricValue(metric) {
  if (metric.kind === "pending-value") {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(metric.value) || 0);
  }
  return new Intl.NumberFormat("pt-BR").format(Number(metric.value) || 0);
}

function metricsMarkup(metrics) {
  return `<section class="dashboard-metrics" aria-label="Indicadores do Power Apps">${(metrics || []).map(metric => `<article class="dashboard-metric${metric.state === "ready" ? "" : " dashboard-metric-attention"}" data-metric-id="${escapeHtml(metric.id)}">
    <span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metricValue(metric))}</strong>${metric.state === "ready" ? "" : `<small>${escapeHtml(metric.state === "partial" ? "Parcial" : "Indisponível")}</small>`}
  </article>`).join("")}</section>`;
}

function sourceStateLabel(state) {
  return ({ ready: "Disponível", partial: "Parcial", forbidden: "Sem permissão", missing: "Não localizada" })[state] || "Indisponível";
}

function sourcesMarkup(sources) {
  return `<section class="dashboard-section" aria-labelledby="dashboardSources"><div class="dashboard-section-heading"><h2 id="dashboardSources">Saúde das fontes</h2></div><ul class="dashboard-list">${(sources || []).map(source => `<li data-source-state="${escapeHtml(source.state)}"><strong>${escapeHtml(source.title)}</strong><span>${escapeHtml(sourceStateLabel(source.state))} · ${source.items.length} registro(s) carregado(s)${source.diagnostic ? ` · ${escapeHtml(source.diagnostic)}` : ""}</span></li>`).join("") || "<li><span>Nenhuma fonte foi liberada para esta conta.</span></li>"}</ul></section>`;
}

function renderSummary(container, summary) {
  const unavailable = summary.sources.filter(source => source.state !== "ready");
  const charts = createDashboardCharts(summary.records);
  container.innerHTML = `<section class="dashboard-page" aria-labelledby="dashboardTitle">
    <header class="dashboard-heading"><div><p class="page-eyebrow">Painel inicial</p><h1 id="dashboardTitle">Visão geral</h1></div><span class="dashboard-state ${summary.online ? "" : "is-offline"}">${summary.online ? "Conexão ativa" : "Sem conexão"}</span></header>
    ${metricsMarkup(summary.metrics)}
    <section class="dashboard-section" aria-labelledby="dashboardShortcuts"><div class="dashboard-section-heading"><h2 id="dashboardShortcuts">Áreas disponíveis</h2></div><div class="dashboard-shortcuts">${summary.modules.map(shortcut).join("") || '<p class="dashboard-empty">Nenhuma área liberada para esta conta.</p>'}</div></section>
    <section class="dashboard-section" data-dashboard-charts>${charts.markup()}</section>
    <div data-dashboard-audit-host>${auditPanelMarkup(summary.audit)}</div>
    ${sourcesMarkup(summary.sources)}
    <section class="dashboard-columns"><section class="dashboard-section" aria-labelledby="dashboardAttention"><div class="dashboard-section-heading"><h2 id="dashboardAttention">Pendências e atenção</h2></div>${summary.attention ? `<ul class="dashboard-list">${summary.indicators.filter(indicator => indicator.attention).map(indicator => `<li><strong>${escapeHtml(indicator.module.title)}</strong><span>${indicator.attention} item(ns) com acompanhamento</span></li>`).join("")}</ul>` : '<p class="dashboard-empty">Nenhuma pendência identificada nas fontes disponíveis.</p>'}</section>
    <section class="dashboard-section" aria-labelledby="dashboardUpdates"><div class="dashboard-section-heading"><h2 id="dashboardUpdates">Atualizações recentes</h2></div>${summary.updates.length ? `<ul class="dashboard-list">${summary.updates.map(update => `<li><strong>${escapeHtml(update.title)}</strong><span>${escapeHtml(update.module)} · ${escapeHtml(formatDateTime(update.changedAt))}</span></li>`).join("")}</ul>` : '<p class="dashboard-empty">Ainda não há atualizações para exibir.</p>'}</section></section>
    ${unavailable.length ? `<p class="dashboard-warning" role="status">${unavailable.length} fonte(s) precisam de atenção. Consulte Saúde das fontes para o diagnóstico.</p>` : ""}
  </section>`;
  return charts;
}

export function renderDashboard(container, context = {}) {
  if (!container) throw new TypeError("O painel requer um elemento de conteúdo.");
  let disposed = false;
  let cleanupInteractive = () => {};
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  container.innerHTML = '<section class="dashboard-page" aria-busy="true"><p class="dashboard-loading">Carregando visão geral...</p></section>';
  const options = { ...(context.dashboardOptions || {}), signal: controller?.signal };
  const ready = loadDashboardSummary(context, options).then(summary => {
    if (disposed) return summary;
    const charts = renderSummary(container, summary);
    const cleanupCharts = bindDashboardCharts(container, charts);
    const change = event => {
      if (!event.target?.matches?.("[data-audit-date]")) return;
      const audit = buildAuditSummary(summary.records, { date: event.target.value, timeZone: options.timeZone });
      const host = container.querySelector?.("[data-dashboard-audit-host]");
      if (host) host.innerHTML = auditPanelMarkup(audit);
    };
    container.addEventListener?.("change", change);
    cleanupInteractive = () => {
      cleanupCharts();
      container.removeEventListener?.("change", change);
    };
    return summary;
  }).catch(error => {
    if (disposed || error?.name === "AbortError") return undefined;
    container.innerHTML = `<section class="dashboard-page"><h1>Visão geral</h1><p class="dashboard-warning" role="alert">Não foi possível carregar o painel agora: ${escapeHtml(error?.message || "erro desconhecido")}</p></section>`;
    throw error;
  });
  return Object.freeze({
    ready,
    cleanup: () => {
      disposed = true;
      controller?.abort();
      cleanupInteractive();
    },
    refresh: () => (disposed ? undefined : renderDashboard(container, context)),
  });
}
