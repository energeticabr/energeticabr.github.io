import { escapeHtml, formatDateTime } from "../core/utils.js";

function accessibleModules(context) {
  return (context.modules || []).filter(module => {
    if (module.id === "dashboard") return false;
    if (module.id === "usuarios-acessos") return context.isSuperAdmin === true;
    return context.can?.(context.access, module.id, "view") === true;
  });
}

function moduleEntities(context, moduleId) {
  return (context.entities || []).filter(entity => entity.moduleId === moduleId);
}

function statusValue(item) {
  const fields = item?.fields || {};
  return Object.values(fields).find(value => /PENDENTE|AGUARDANDO|ATRASAD/i.test(String(value))) || "";
}

async function loadModuleIndicator(context, module) {
  const entity = moduleEntities(context, module.id)[0];
  if (!entity || !context.repository) return { module, entity, count: 0, attention: 0, updates: [], state: "ready" };
  try {
    const list = await context.repository.resolveList(entity.siteKey, entity.listNames);
    if (list.status !== "resolved") return { module, entity, count: 0, attention: 0, updates: [], state: "missing" };
    const items = await context.repository.getItems(entity.siteKey, list.id, "$expand=fields&$top=8");
    const updates = items.map(item => ({
      title: item.fields?.Title || entity.title,
      module: module.title,
      changedAt: item.lastModifiedDateTime || item.createdDateTime,
      attention: Boolean(statusValue(item)),
    }));
    return { module, entity, count: items.length, attention: updates.filter(item => item.attention).length, updates, state: "ready" };
  } catch (error) {
    return { module, entity, count: 0, attention: 0, updates: [], state: "unavailable", error };
  }
}

export async function loadDashboardSummary(context) {
  const indicators = await Promise.all(accessibleModules(context).map(module => loadModuleIndicator(context, module)));
  const updates = indicators.flatMap(indicator => indicator.updates)
    .sort((left, right) => new Date(right.changedAt || 0) - new Date(left.changedAt || 0))
    .slice(0, 6);
  return Object.freeze({
    modules: accessibleModules(context),
    indicators,
    attention: indicators.reduce((total, indicator) => total + indicator.attention, 0),
    updates,
    online: globalThis.navigator?.onLine !== false,
  });
}

function shortcut(module) {
  const href = module.id === "usuarios-acessos" ? "#/access" : `#/module/${encodeURIComponent(module.id)}`;
  return `<a class="dashboard-shortcut" href="${href}"><span>${escapeHtml(module.title)}</span><span aria-hidden="true">›</span></a>`;
}

function renderSummary(container, summary) {
  const unavailable = summary.indicators.filter(indicator => indicator.state === "unavailable");
  const total = summary.indicators.reduce((count, indicator) => count + indicator.count, 0);
  container.innerHTML = `
    <section class="dashboard-page" aria-labelledby="dashboardTitle">
      <header class="dashboard-heading">
        <div><p class="page-eyebrow">Painel inicial</p><h1 id="dashboardTitle">Visão geral</h1></div>
        <span class="dashboard-state ${summary.online ? "" : "is-offline"}">${summary.online ? "Conexão ativa" : "Sem conexão"}</span>
      </header>
      <section class="dashboard-metrics" aria-label="Indicadores">
        <article class="dashboard-metric"><span>Registros consultados</span><strong>${total}</strong></article>
        <article class="dashboard-metric dashboard-metric-attention"><span>Itens para acompanhar</span><strong>${summary.attention}</strong></article>
        <article class="dashboard-metric"><span>Fontes indisponíveis</span><strong>${unavailable.length}</strong></article>
      </section>
      <section class="dashboard-section" aria-labelledby="dashboardShortcuts"><div class="dashboard-section-heading"><h2 id="dashboardShortcuts">Áreas disponíveis</h2></div><div class="dashboard-shortcuts">${summary.modules.map(shortcut).join("") || '<p class="dashboard-empty">Nenhuma área liberada para esta conta.</p>'}</div></section>
      <section class="dashboard-columns">
        <section class="dashboard-section" aria-labelledby="dashboardAttention"><div class="dashboard-section-heading"><h2 id="dashboardAttention">Pendências e atenção</h2></div>${summary.attention ? `<ul class="dashboard-list">${summary.indicators.filter(indicator => indicator.attention).map(indicator => `<li><strong>${escapeHtml(indicator.module.title)}</strong><span>${indicator.attention} item(ns) com acompanhamento</span></li>`).join("")}</ul>` : '<p class="dashboard-empty">Nenhuma pendência identificada nas fontes disponíveis.</p>'}</section>
        <section class="dashboard-section" aria-labelledby="dashboardUpdates"><div class="dashboard-section-heading"><h2 id="dashboardUpdates">Atualizações recentes</h2></div>${summary.updates.length ? `<ul class="dashboard-list">${summary.updates.map(update => `<li><strong>${escapeHtml(update.title)}</strong><span>${escapeHtml(update.module)} · ${escapeHtml(formatDateTime(update.changedAt))}</span></li>`).join("")}</ul>` : '<p class="dashboard-empty">Ainda não há atualizações para exibir.</p>'}</section>
      </section>
      ${unavailable.length ? `<p class="dashboard-warning" role="status">Algumas fontes não puderam ser consultadas agora: ${escapeHtml(unavailable.map(indicator => indicator.module.title).join(", "))}.</p>` : ""}
    </section>`;
}

export function renderDashboard(container, context = {}) {
  if (!container) throw new TypeError("O painel requer um elemento de conteudo.");
  let disposed = false;
  container.innerHTML = '<section class="dashboard-page" aria-busy="true"><p class="dashboard-loading">Carregando visão geral...</p></section>';
  const ready = loadDashboardSummary(context)
    .then(summary => {
      if (!disposed) renderSummary(container, summary);
      return summary;
    })
    .catch(error => {
      if (disposed) return undefined;
      container.innerHTML = `<section class="dashboard-page"><h1>Visão geral</h1><p class="dashboard-warning" role="alert">Não foi possível carregar o painel agora: ${escapeHtml(error?.message || "erro desconhecido")}</p></section>`;
      throw error;
    });
  return Object.freeze({
    ready,
    cleanup: () => { disposed = true; },
    refresh: () => (disposed ? undefined : renderDashboard(container, context)),
  });
}
