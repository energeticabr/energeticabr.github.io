import { escapeHtml } from "../core/utils.js";
import { DEFAULT_REPORT_PAGE_SIZE, loadReportSource } from "./report-data.js";
import { buildReportView, reportCellValue, reportViewToCsv } from "./report-model.js";

const EMPTY_FILTERS = Object.freeze({ dateField: "", startDate: "", endDate: "", branch: "", status: "" });

export function availableReportEntities(entities = [], access, can) {
  return Object.freeze((entities || []).filter(entity => entity?.available !== false
    && can?.(access, entity.moduleId, "view") === true));
}

function optionMarkup(values, selected, emptyLabel) {
  const options = [...new Set([...(values || []), ...(selected && !(values || []).includes(selected) ? [selected] : [])])];
  return `<option value="">${escapeHtml(emptyLabel)}</option>${options.map(value => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(value)}</option>`).join("")}`;
}

function sourceOptions(sources, selectedEntityId) {
  return (sources || []).map(source => `<option value="${escapeHtml(source.id)}"${source.id === selectedEntityId ? " selected" : ""}>${escapeHtml(source.title)}</option>`).join("");
}

function dateFieldOptions(fields, selected) {
  return `<option value="">Selecione o campo</option>${(fields || []).map(field => `<option value="${escapeHtml(field.name)}"${field.name === selected ? " selected" : ""}>${escapeHtml(field.label)}</option>`).join("")}`;
}

function stateMessage(state) {
  if (state === "missing") return "A lista selecionada não foi localizada no SharePoint.";
  if (state === "forbidden") return "Sua conta Microsoft não tem permissão para consultar esta lista.";
  return "Não foi possível consultar esta fonte agora. Tente novamente.";
}

function tableMarkup(view, items, className = "") {
  const columns = (view?.columns || []).filter(column => !column.hidden);
  return `<div class="report-table-wrap ${className}"><table class="report-table"><thead><tr>${columns.map(column => `<th scope="col">${escapeHtml(column.label)}</th>`).join("")}</tr></thead><tbody>${items.length
    ? items.map(item => `<tr>${columns.map(column => `<td data-label="${escapeHtml(column.label)}">${escapeHtml(reportCellValue(item, column))}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${Math.max(1, columns.length)}" class="report-empty">Nenhum registro corresponde aos filtros selecionados.</td></tr>`}</tbody></table></div>`;
}

function positiveInteger(value, fallback) {
  const candidate = Number(value);
  return Number.isInteger(candidate) && candidate > 0 ? candidate : fallback;
}

function partialMessage(data) {
  const loaded = new Intl.NumberFormat("pt-BR").format(Number(data.loadedCount) || 0);
  const limit = data.partialReason === "max-pages"
    ? `o limite operacional de ${data.limit?.maxPages || 0} páginas Graph foi atingido`
    : `o limite operacional de ${new Intl.NumberFormat("pt-BR").format(Number(data.limit?.maxItems) || 0)} registros foi atingido`;
  return `Relatório parcial: ${loaded} registros carregados; ${limit}. Refine os filtros para obter uma consulta completa.`;
}

function progressMarkup(progress) {
  if (!progress) return '<p class="reports-loading" role="status">Preparando consulta consolidada no SharePoint...</p>';
  const loaded = new Intl.NumberFormat("pt-BR").format(Number(progress.loadedCount) || 0);
  const pages = Number(progress.pageCount) || 0;
  return `<div class="reports-progress" role="status" aria-live="polite">
    <progress data-report-progress value="${Math.min(Number(progress.loadedCount) || 0, Number(progress.maxItems) || 1)}" max="${Number(progress.maxItems) || 1}"></progress>
    <span>Carregando: ${loaded} registros em ${pages} páginas Graph. Limite seguro: ${new Intl.NumberFormat("pt-BR").format(Number(progress.maxItems) || 0)} registros.</span>
  </div>`;
}

export function reportsPageMarkup(model = {}) {
  const sources = model.sources || [];
  const filters = { ...EMPTY_FILTERS, ...(model.filters || {}) };
  if (!sources.length) {
    return '<section class="reports-page" aria-labelledby="reportsTitle"><header class="reports-heading"><div><p class="page-eyebrow">Dados do SharePoint</p><h1 id="reportsTitle">Relatórios operacionais</h1></div></header><p class="reports-empty" role="status">Nenhuma fonte SharePoint foi liberada para esta conta.</p></section>';
  }

  const data = model.data || {};
  const view = model.view;
  const ready = model.state === "ready" && view;
  const dateFields = data.dimensions?.dateFields || [];
  const activeDateField = ready ? view.activeDateField : null;
  const dateDisabled = !ready || !activeDateField;
  const branchDisabled = !ready || !data.dimensions?.branchField;
  const statusDisabled = !ready || !data.dimensions?.statusField;
  const pageSize = positiveInteger(model.displayPageSize, DEFAULT_REPORT_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil((view?.items?.length || 0) / pageSize));
  const displayPage = Math.min(pageCount, positiveInteger(model.displayPage, 1));
  const start = (displayPage - 1) * pageSize;
  const displayItems = ready ? view.items.slice(start, start + pageSize) : [];
  const completeness = ready
    ? (data.complete === false
      ? `<p class="reports-partial" role="alert">${escapeHtml(partialMessage(data))}</p>`
      : `<p class="reports-page-context">Consulta consolidada concluída: ${new Intl.NumberFormat("pt-BR").format(Number(data.loadedCount) || 0)} registros lidos em ${Number(data.pageCount) || 0} páginas Graph.</p>`)
    : "";
  const loadedLabel = data.complete === false ? "Registros carregados (parcial)" : "Registros consolidados";
  const filteredLabel = data.complete === false ? "Resultados no recorte parcial" : "Resultados da consulta";

  return `<section class="reports-page" aria-labelledby="reportsTitle">
    <header class="reports-heading">
      <div><p class="page-eyebrow">Dados do SharePoint</p><h1 id="reportsTitle">Relatórios operacionais</h1><p>Consulte, filtre e exporte os registros da fonte selecionada.</p></div>
      <div class="reports-actions">${ready ? '<button type="button" class="button-secondary" data-report-print>Imprimir consulta</button><button type="button" class="button-primary" data-report-export>Exportar consulta CSV</button>' : ""}</div>
    </header>
    <section class="reports-controls" aria-label="Fonte e filtros do relatório">
      <label class="report-source-field">Fonte SharePoint<select data-report-source>${sourceOptions(sources, model.selectedEntityId)}</select></label>
      <label>Campo de data<select data-report-date-field${!ready || !dateFields.length ? " disabled" : ""}>${dateFieldOptions(dateFields, filters.dateField)}</select></label>
      <label>De<input type="date" data-report-start value="${escapeHtml(filters.startDate)}"${dateDisabled ? " disabled" : ""}></label>
      <label>Até<input type="date" data-report-end value="${escapeHtml(filters.endDate)}"${dateDisabled ? " disabled" : ""}></label>
      <label>Filial<select data-report-branch${branchDisabled ? " disabled" : ""}>${optionMarkup(view?.options?.branches, filters.branch, branchDisabled ? "Campo não identificado" : "Todas")}</select></label>
      <label>Status<select data-report-status${statusDisabled ? " disabled" : ""}>${optionMarkup(view?.options?.statuses, filters.status, statusDisabled ? "Campo não identificado" : "Todos")}</select></label>
      <button type="button" class="button-secondary reports-clear" data-report-clear${ready ? "" : " disabled"}>Limpar filtros</button>
    </section>
    ${ready ? `<p class="reports-date-context" data-report-active-date>${activeDateField ? `Período aplicado sobre: ${escapeHtml(activeDateField.label)}.` : "Selecione explicitamente o campo de data para aplicar o período."}</p>` : ""}
    ${model.state === "loading" ? progressMarkup(model.progress) : ""}
    ${!ready && model.state !== "loading" ? `<p class="reports-warning" role="${model.state === "forbidden" ? "alert" : "status"}">${escapeHtml(stateMessage(model.state))}</p>` : ""}
    ${ready ? `<section class="report-metrics" aria-label="Indicadores do relatório">
      <article><span>${loadedLabel}</span><strong>${view.metrics.loaded}</strong></article>
      <article><span>${filteredLabel}</span><strong>${view.metrics.filtered}</strong></article>
      <article class="is-pending"><span>Pendentes identificados</span><strong>${view.metrics.pending}</strong></article>
      <article class="is-finalized"><span>Finalizados identificados</span><strong>${view.metrics.finalized}</strong></article>
    </section>${completeness}${tableMarkup(view, displayItems, "report-screen-table")}
    <nav class="entity-pagination" aria-label="Paginação visual do relatório"><button type="button" data-report-prev${displayPage <= 1 ? " disabled" : ""}>Página anterior</button><span>Página ${displayPage} de ${pageCount}</span><button type="button" data-report-next${displayPage >= pageCount ? " disabled" : ""}>Próxima página</button></nav>
    ${model.printing ? `<section class="report-print-dataset"><h2>Consulta consolidada</h2>${data.complete === false ? `<p class="reports-partial">${escapeHtml(partialMessage(data))}</p>` : ""}${tableMarkup(view, view.items, "report-print-table")}</section>` : ""}` : ""}
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
  if (!root) throw new TypeError("A página de relatórios requer um elemento raiz.");
  const sources = availableReportEntities(context.entities, context.access, context.can);
  const state = {
    sources,
    selectedEntityId: sources[0]?.id || "",
    state: sources.length ? "loading" : "empty",
    data: undefined,
    view: undefined,
    filters: { ...EMPTY_FILTERS },
    displayPage: 1,
    displayPageSize: positiveInteger(context.pageSize, DEFAULT_REPORT_PAGE_SIZE),
    progress: undefined,
    printing: false,
  };
  let disposed = false;
  let generation = 0;
  let activeController;
  const loadSource = context.loadSource || loadReportSource;

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
    state.displayPage = 1;
    refresh();
  }

  async function printReport() {
    if (!state.view || !state.data) return;
    if (context.print) {
      await context.print(state.view, state.data);
      return;
    }
    state.printing = true;
    render();
    try {
      globalThis.window?.print?.();
    } finally {
      state.printing = false;
      render();
    }
  }

  function bind() {
    root.querySelector("[data-report-source]")?.addEventListener("change", event => {
      state.selectedEntityId = event.target.value;
      state.filters = { ...EMPTY_FILTERS };
      state.displayPage = 1;
      refresh();
    });
    root.querySelector("[data-report-date-field]")?.addEventListener("change", event => setFilter("dateField", event.target.value));
    root.querySelector("[data-report-start]")?.addEventListener("change", event => setFilter("startDate", event.target.value));
    root.querySelector("[data-report-end]")?.addEventListener("change", event => setFilter("endDate", event.target.value));
    root.querySelector("[data-report-branch]")?.addEventListener("change", event => setFilter("branch", event.target.value));
    root.querySelector("[data-report-status]")?.addEventListener("change", event => setFilter("status", event.target.value));
    root.querySelector("[data-report-clear]")?.addEventListener("click", () => {
      state.filters = { ...EMPTY_FILTERS };
      state.displayPage = 1;
      refresh();
    });
    root.querySelector("[data-report-prev]")?.addEventListener("click", () => {
      state.displayPage = Math.max(1, state.displayPage - 1);
      render();
    });
    root.querySelector("[data-report-next]")?.addEventListener("click", () => {
      const pages = Math.max(1, Math.ceil((state.view?.items?.length || 0) / state.displayPageSize));
      state.displayPage = Math.min(pages, state.displayPage + 1);
      render();
    });
    root.querySelector("[data-report-export]")?.addEventListener("click", () => {
      if (!state.view || !state.data) return;
      const date = new Date().toISOString().slice(0, 10);
      const metadata = {
        complete: state.data.complete,
        partialReason: state.data.partialReason,
        loadedCount: state.data.loadedCount,
        maxItems: state.data.limit?.maxItems,
        maxPages: state.data.limit?.maxPages,
      };
      (context.download || defaultDownload)(`relatorio-${state.selectedEntityId}-${date}.csv`, reportViewToCsv(state.view, metadata));
    });
    root.querySelector("[data-report-print]")?.addEventListener("click", () => { void printReport(); });
  }

  async function refresh() {
    const entity = selectedEntity();
    if (!entity) {
      activeController?.abort();
      state.state = "empty";
      state.data = undefined;
      state.view = undefined;
      render();
      return undefined;
    }
    const token = ++generation;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    state.state = "loading";
    state.data = undefined;
    state.view = undefined;
    state.progress = undefined;
    render();
    try {
      const data = await loadSource(context.repository, entity, {
        filters: { ...state.filters },
        signal: controller.signal,
        onProgress(progress) {
          if (disposed || controller.signal.aborted || token !== generation) return;
          state.progress = progress;
          render();
        },
      });
      if (disposed || controller.signal.aborted || token !== generation) return undefined;
      state.data = data;
      state.state = data.state;
      state.progress = undefined;
      state.displayPage = 1;
      rebuildView();
      render();
      return data;
    } catch (error) {
      if (disposed || controller.signal.aborted || token !== generation || error?.name === "AbortError") return undefined;
      state.state = "error";
      state.data = { state: "error", error };
      state.view = undefined;
      state.progress = undefined;
      render();
      return undefined;
    }
  }

  const ready = sources.length ? refresh() : Promise.resolve(undefined);
  if (!sources.length) render();
  return Object.freeze({
    ready,
    refresh,
    cleanup: () => {
      disposed = true;
      generation += 1;
      activeController?.abort();
    },
  });
}
