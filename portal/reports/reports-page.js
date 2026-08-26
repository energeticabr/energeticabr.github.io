import { escapeHtml } from "../core/utils.js";
import { loadReportSource } from "./report-data.js";
import { buildReportView, reportCellValue, reportViewToCsv } from "./report-model.js";

const EMPTY_FILTERS = Object.freeze({ startDate: "", endDate: "", branch: "", status: "" });

export function availableReportEntities(entities = [], access, can) {
  return Object.freeze((entities || []).filter(entity => can?.(access, entity.moduleId, "view") === true));
}

function optionMarkup(values, selected, emptyLabel) {
  return `<option value="">${escapeHtml(emptyLabel)}</option>${(values || []).map(value => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(value)}</option>`).join("")}`;
}

function sourceOptions(sources, selectedEntityId) {
  return (sources || []).map(source => `<option value="${escapeHtml(source.id)}"${source.id === selectedEntityId ? " selected" : ""}>${escapeHtml(source.title)}</option>`).join("");
}

function stateMessage(state) {
  if (state === "missing") return "A lista selecionada nao foi localizada no SharePoint.";
  if (state === "forbidden") return "Sua conta Microsoft nao tem permissao para consultar esta lista.";
  return "Nao foi possivel consultar esta fonte agora. Tente novamente.";
}

function tableMarkup(view) {
  const columns = (view?.columns || []).filter(column => !column.hidden);
  const items = view?.items || [];
  return `<div class="report-table-wrap"><table class="report-table"><thead><tr>${columns.map(column => `<th scope="col">${escapeHtml(column.label)}</th>`).join("")}</tr></thead><tbody>${items.length
    ? items.map(item => `<tr>${columns.map(column => `<td data-label="${escapeHtml(column.label)}">${escapeHtml(reportCellValue(item, column))}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${Math.max(1, columns.length)}" class="report-empty">Nenhum registro corresponde aos filtros selecionados.</td></tr>`}</tbody></table></div>`;
}

export function reportsPageMarkup(model = {}) {
  const sources = model.sources || [];
  const filters = { ...EMPTY_FILTERS, ...(model.filters || {}) };
  if (!sources.length) {
    return `<section class="reports-page" aria-labelledby="reportsTitle"><header class="reports-heading"><div><p class="page-eyebrow">Dados do SharePoint</p><h1 id="reportsTitle">Relatorios operacionais</h1></div></header><p class="reports-empty" role="status">Nenhuma fonte SharePoint foi liberada para esta conta.</p></section>`;
  }

  const data = model.data || {};
  const view = model.view;
  const ready = model.state === "ready" && view;
  const branchDisabled = !ready || !data.dimensions?.branchField;
  const statusDisabled = !ready || !data.dimensions?.statusField;
  return `<section class="reports-page" aria-labelledby="reportsTitle">
    <header class="reports-heading">
      <div><p class="page-eyebrow">Dados do SharePoint</p><h1 id="reportsTitle">Relatorios operacionais</h1><p>Consulte, filtre e exporte os registros da fonte selecionada.</p></div>
      <div class="reports-actions">${ready ? '<button type="button" class="button-secondary" data-report-print>Imprimir</button><button type="button" class="button-primary" data-report-export>Exportar CSV</button>' : ""}</div>
    </header>
    <section class="reports-controls" aria-label="Fonte e filtros do relatorio">
      <label class="report-source-field">Fonte SharePoint<select data-report-source>${sourceOptions(sources, model.selectedEntityId)}</select></label>
      <label>De<input type="date" data-report-start value="${escapeHtml(filters.startDate)}"${ready ? "" : " disabled"}></label>
      <label>Ate<input type="date" data-report-end value="${escapeHtml(filters.endDate)}"${ready ? "" : " disabled"}></label>
      <label>Filial<select data-report-branch${branchDisabled ? " disabled" : ""}>${optionMarkup(view?.options?.branches, filters.branch, branchDisabled ? "Campo nao identificado" : "Todas")}</select></label>
      <label>Status<select data-report-status${statusDisabled ? " disabled" : ""}>${optionMarkup(view?.options?.statuses, filters.status, statusDisabled ? "Campo nao identificado" : "Todos")}</select></label>
      <button type="button" class="button-secondary reports-clear" data-report-clear${ready ? "" : " disabled"}>Limpar filtros</button>
    </section>
    ${model.state === "loading" ? '<p class="reports-loading" role="status">Carregando dados do SharePoint...</p>' : ""}
    ${!ready && model.state !== "loading" ? `<p class="reports-warning" role="${model.state === "forbidden" ? "alert" : "status"}">${escapeHtml(stateMessage(model.state))}</p>` : ""}
    ${ready ? `<section class="report-metrics" aria-label="Indicadores do relatorio">
      <article><span>Registros carregados</span><strong>${view.metrics.loaded}</strong></article>
      <article><span>Resultados filtrados</span><strong>${view.metrics.filtered}</strong></article>
      <article class="is-pending"><span>Pendentes identificados</span><strong>${view.metrics.pending}</strong></article>
      <article class="is-finalized"><span>Finalizados identificados</span><strong>${view.metrics.finalized}</strong></article>
    </section>${tableMarkup(view)}` : ""}
  </section>`;
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

export function createReportsPage(root, context = {}) {
  if (!root) throw new TypeError("A pagina de relatorios requer um elemento raiz.");
  const sources = availableReportEntities(context.entities, context.access, context.can);
  const state = {
    sources,
    selectedEntityId: sources[0]?.id || "",
    state: sources.length ? "loading" : "empty",
    data: undefined,
    view: undefined,
    filters: { ...EMPTY_FILTERS },
  };
  let disposed = false;
  let generation = 0;

  const selectedEntity = () => sources.find(entity => entity.id === state.selectedEntityId);
  const rebuildView = () => {
    if (state.data?.state !== "ready") return;
    state.view = buildReportView(state.data.items, state.data.columns, state.data.dimensions, state.filters);
  };

  function render() {
    if (disposed) return;
    root.innerHTML = reportsPageMarkup(state);
    bind();
  }

  function setFilter(name, value) {
    state.filters[name] = value;
    rebuildView();
    render();
  }

  function bind() {
    root.querySelector("[data-report-source]")?.addEventListener("change", event => {
      state.selectedEntityId = event.target.value;
      state.filters = { ...EMPTY_FILTERS };
      refresh();
    });
    root.querySelector("[data-report-start]")?.addEventListener("change", event => setFilter("startDate", event.target.value));
    root.querySelector("[data-report-end]")?.addEventListener("change", event => setFilter("endDate", event.target.value));
    root.querySelector("[data-report-branch]")?.addEventListener("change", event => setFilter("branch", event.target.value));
    root.querySelector("[data-report-status]")?.addEventListener("change", event => setFilter("status", event.target.value));
    root.querySelector("[data-report-clear]")?.addEventListener("click", () => {
      state.filters = { ...EMPTY_FILTERS };
      rebuildView();
      render();
    });
    root.querySelector("[data-report-export]")?.addEventListener("click", () => {
      if (!state.view) return;
      const date = new Date().toISOString().slice(0, 10);
      (context.download || defaultDownload)(`relatorio-${state.selectedEntityId}-${date}.csv`, reportViewToCsv(state.view));
    });
    root.querySelector("[data-report-print]")?.addEventListener("click", () => (context.print || (() => globalThis.window?.print?.()))());
  }

  async function refresh() {
    const entity = selectedEntity();
    if (!entity) {
      state.state = "empty";
      render();
      return undefined;
    }
    const token = ++generation;
    state.state = "loading";
    state.data = undefined;
    state.view = undefined;
    render();
    const data = await loadReportSource(context.repository, entity);
    if (disposed || token !== generation) return undefined;
    state.data = data;
    state.state = data.state;
    rebuildView();
    render();
    return data;
  }

  const ready = sources.length ? refresh() : Promise.resolve(undefined);
  if (!sources.length) render();
  return Object.freeze({
    ready,
    refresh,
    cleanup: () => { disposed = true; generation += 1; },
  });
}
