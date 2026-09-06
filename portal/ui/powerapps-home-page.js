import { escapeHtml } from "../core/utils.js";
import { homeAnalyticsDefinition } from "../analytics/home-report-views.js";
import {
  POWERAPPS_HOME_ASSETS,
  POWERAPPS_HOME_QUICK_ACTIONS,
  POWERAPPS_HOME_TILES,
} from "../catalog/powerapps-home-contract.js";

function canView(context, moduleId) {
  if (moduleId === "dashboard") return true;
  return context.can?.(context.access, moduleId, "view") === true;
}

function tileMarkup(tile) {
  return `<a class="powerapps-home-tile" data-home-tile="${escapeHtml(tile.moduleId)}" href="${escapeHtml(tile.href)}" aria-label="Abrir ${escapeHtml(tile.label)}">
    <img src="${escapeHtml(tile.image)}" alt="" aria-hidden="true">
    <span>${escapeHtml(tile.label)}</span>
  </a>`;
}

function quickActionMarkup(action) {
  return `<button class="powerapps-home-quick-action" data-home-quick-action="${escapeHtml(action.id)}" type="button" data-home-report="${escapeHtml(action.report)}" aria-label="${escapeHtml(action.label)}" title="${escapeHtml(action.label)}"><img src="${escapeHtml(action.image)}" alt="" aria-hidden="true"></button>`;
}

function actionEntityId(action) {
  const prefix = "#/entity/";
  return action?.href?.startsWith(prefix) ? action.href.slice(prefix.length) : "";
}

function actionAnalyticsId(action) {
  const prefix = "#/analytics/";
  return action?.href?.startsWith(prefix) ? action.href.slice(prefix.length) : "";
}

export function powerAppsHomeMarkup(context = {}) {
  const tiles = POWERAPPS_HOME_TILES.filter(tile => canView(context, tile.moduleId));
  const quickActions = POWERAPPS_HOME_QUICK_ACTIONS.filter(action => canView(context, action.moduleId));
  return `<section class="powerapps-home-page" aria-labelledby="powerAppsHomeTitle" data-powerapps-home>
    <h1 id="powerAppsHomeTitle" class="sr-only">Tela inicial Energética</h1>
    <div class="powerapps-home-canvas" data-powerapps-home-canvas>
      <div class="powerapps-home-brand"><img src="${escapeHtml(POWERAPPS_HOME_ASSETS.logo)}" alt="Energética Construções"></div>
      ${tiles.map(tileMarkup).join("")}
      ${quickActions.map(quickActionMarkup).join("")}
    </div>
    <div class="powerapps-home-mobile-menu" aria-label="Áreas administrativas">
      ${tiles.map(tile => `<a href="${escapeHtml(tile.href)}"><img src="${escapeHtml(tile.image)}" alt="" aria-hidden="true"><span>${escapeHtml(tile.label)}</span></a>`).join("")}
    </div>
    <div class="powerapps-home-mobile-tools" aria-label="Atalhos da tela inicial">
      ${quickActions.map(action => `<button type="button" data-home-report="${escapeHtml(action.report)}"><img src="${escapeHtml(action.image)}" alt="" aria-hidden="true"><span>${escapeHtml(action.label)}</span></button>`).join("")}
    </div>
    <div class="powerapps-home-report-layer" data-home-report-dialog aria-hidden="true" hidden>
      <button class="powerapps-home-report-backdrop" data-home-report-close type="button" aria-label="Fechar painel"></button>
      <section class="powerapps-home-report" role="dialog" aria-modal="true" aria-labelledby="powerAppsHomeReportTitle">
        <header><h2 id="powerAppsHomeReportTitle" data-home-report-title>Resumo geral</h2><div class="powerapps-home-report-actions"><a class="button-secondary" data-home-report-full hidden>Abrir em tela inteira</a><button class="button-secondary" data-home-report-close type="button">Fechar</button></div></header>
        <div class="powerapps-home-report-content" data-home-report-content></div>
      </section>
    </div>
  </section>`;
}

export function renderPowerAppsHome(container, context = {}) {
  if (!container) throw new TypeError("A tela inicial requer um elemento de conteúdo.");
  container.innerHTML = powerAppsHomeMarkup(context);
  const layer = container.querySelector?.("[data-home-report-dialog]");
  const reportHost = container.querySelector?.("[data-home-report-content]");
  const reportTitle = container.querySelector?.("[data-home-report-title]");
  const reportFullLink = container.querySelector?.("[data-home-report-full]");
  const reportTrigger = container.querySelector?.('[data-home-report="resumo-geral"]');
  let activePage;
  let activeReport = "";
  let reportGeneration = 0;
  let disposed = false;
  let reportReturnTarget = reportTrigger;

  const closeReport = () => {
    if (!layer) return;
    reportGeneration += 1;
    activePage?.cleanup?.();
    activePage = undefined;
    activeReport = "";
    if (reportHost) reportHost.innerHTML = "";
    layer.hidden = true;
    layer.setAttribute?.("aria-hidden", "true");
    reportReturnTarget?.focus?.();
  };

  const openReport = async (reportId = "resumo-geral", returnTarget) => {
    if (!layer || disposed) return;
    const action = POWERAPPS_HOME_QUICK_ACTIONS.find(candidate => candidate.report === reportId);
    if (!action || !canView(context, action.moduleId)) return;
    reportReturnTarget = returnTarget || container.querySelector?.(`[data-home-report="${action.report}"]`) || reportTrigger;
    const generation = ++reportGeneration;
    activePage?.cleanup?.();
    activePage = undefined;
    activeReport = action.report;
    layer.hidden = false;
    layer.setAttribute?.("aria-hidden", "false");
    if (reportTitle) reportTitle.textContent = action.label;
    if (reportFullLink) {
      reportFullLink.hidden = !action.href;
      if (action.href) reportFullLink.setAttribute("href", action.href);
      else reportFullLink.removeAttribute("href");
    }
    if (reportHost) reportHost.innerHTML = '<p class="dashboard-loading" role="status">Carregando painel...</p>';
    try {
      if (action.report === "resumo-geral") {
        const { renderDashboard } = await import("./dashboard-page.js?v=20260906-powerapps-home-v2");
        if (disposed || generation !== reportGeneration || activeReport !== action.report) return;
        activePage = renderDashboard(reportHost, context);
      } else if (actionAnalyticsId(action)) {
        const [{ createAnalyticsPage }, { analyticsDefinitionById }] = await Promise.all([
          import("../analytics/analytics-page.js?v=20260906-powerapps-home-panel-v1"),
          import("../analytics/definitions/index.js?v=20260906-powerapps-home-panel-v1"),
        ]);
        if (disposed || generation !== reportGeneration || activeReport !== action.report) return;
        const baseDefinition = analyticsDefinitionById(actionAnalyticsId(action));
        if (!baseDefinition) throw new Error("O painel analítico correspondente não foi localizado no portal.");
        const definition = homeAnalyticsDefinition(action, baseDefinition);
        activePage = createAnalyticsPage(reportHost, {
          definition,
          entities: context.entities,
          repository: context.repository,
          access: context.access,
          can: context.can,
        });
      } else {
        const entityId = actionEntityId(action);
        const entity = context.entities?.find(candidate => candidate.id === entityId);
        if (!entity) throw new Error("A galeria correspondente não foi localizada no portal.");
        const { createEntityPage } = await import("./entity-page.js?v=20260906-powerapps-home-panel-v1");
        if (disposed || generation !== reportGeneration || activeReport !== action.report) return;
        activePage = createEntityPage(reportHost, {
          entity,
          repository: context.repository,
          access: context.access,
          can: context.can,
          isSuperAdmin: context.isSuperAdmin,
        });
      }
      await activePage?.ready;
      if (disposed || generation !== reportGeneration || activeReport !== action.report || layer.hidden) return;
    } catch (error) {
      if (disposed || generation !== reportGeneration || !reportHost) return;
      reportHost.innerHTML = `<p class="dashboard-warning" role="alert">Não foi possível carregar o painel: ${escapeHtml(error?.message || "erro inesperado")}</p>`;
    }
    layer.querySelector?.(".powerapps-home-report [data-home-report-close]")?.focus?.();
  };

  const onClick = event => {
    const trigger = event.target?.closest?.("[data-home-report]");
    if (trigger) {
      void openReport(trigger.dataset.homeReport, trigger);
      return;
    }
    if (event.target?.closest?.("[data-home-report-close]")) closeReport();
  };
  const onKeyDown = event => {
    if (event.key === "Escape" && layer && !layer.hidden) closeReport();
  };

  container.addEventListener?.("click", onClick);
  globalThis.window?.addEventListener?.("keydown", onKeyDown);

  return Object.freeze({
    ready: Promise.resolve(),
    cleanup: () => {
      disposed = true;
      reportGeneration += 1;
      activePage?.cleanup?.();
      container.removeEventListener?.("click", onClick);
      globalThis.window?.removeEventListener?.("keydown", onKeyDown);
    },
    openReport,
    closeReport,
  });
}

export default renderPowerAppsHome;
