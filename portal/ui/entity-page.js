import { escapeHtml } from "../core/utils.js";
import { displayColumnValue, mapSharePointColumns, sortAndFilterItems } from "../data/column-mapper.js";
import { classifyEntityAvailability } from "../data/attachments.js";
import { renderDynamicForm } from "./dynamic-form.js";

export function getEntityActions(entity, access, can) {
  const allowed = action => entity?.capabilities?.[action] === true && can?.(access, entity.moduleId, action) === true;
  return Object.freeze({ create: allowed("create"), edit: allowed("edit"), delete: allowed("delete") });
}

export async function loadEntityData(repository, entity, options = {}) {
  try {
    const list = await repository.resolveList(entity.siteKey, entity.listNames);
    if (list.status !== "resolved") return Object.freeze({ state: "missing", availability: "missing", list, columns: [], rawItems: [], items: sortAndFilterItems([], entity, options) });
    const [rawColumns, rawItems] = await Promise.all([
      repository.getColumns(entity.siteKey, list.id),
      repository.getItems(entity.siteKey, list.id, "$expand=fields"),
    ]);
    const columns = mapSharePointColumns(rawColumns, entity);
    return Object.freeze({ state: "ready", availability: "available", list, columns, rawItems, items: sortAndFilterItems(rawItems, entity, options) });
  } catch (error) {
    const availability = classifyEntityAvailability(error);
    return Object.freeze({ state: availability, availability, error, list: undefined, columns: [], rawItems: [], items: sortAndFilterItems([], entity, options) });
  }
}

function availabilityMessage(availability) {
  if (availability === "forbidden") return "Você não tem permissão Microsoft para consultar esta lista.";
  if (availability === "missing") return "A lista desta área ainda não foi localizada no SharePoint. Verifique o nome da lista e as permissões Microsoft.";
  return "Não foi possível consultar esta lista agora. Tente novamente.";
}

function columnHeaders(columns, state) {
  return columns.filter(column => !column.hidden).slice(0, 8).map(column => {
    const direction = state.sort.field === column.name ? state.sort.direction : "";
    return `<th scope="col"><button type="button" class="entity-sort" data-entity-sort="${escapeHtml(column.name)}">${escapeHtml(column.label)}${direction === "asc" ? " ↑" : direction === "desc" ? " ↓" : ""}</button></th>`;
  }).join("");
}

function galleryMarkup(entity, data, state, actions) {
  const statuses = [...new Set((data.rawItems || []).flatMap(item => entity.statusFields.map(field => item.fields?.[field])).filter(Boolean))];
  const visibleColumns = data.columns.filter(column => !column.hidden).slice(0, 8);
  const records = data.items.items;
  return `<section class="entity-page" aria-labelledby="entityPageTitle">
    <header class="entity-heading"><div><p class="page-eyebrow">Dados do SharePoint</p><h1 id="entityPageTitle">${escapeHtml(entity.title)}</h1><p class="entity-meta">${data.items.total} registro(s) encontrado(s)</p></div><div class="entity-actions">${actions.create ? '<button type="button" class="button-primary" data-entity-create>Novo registro</button>' : ""}</div></header>
    <p class="entity-toast ${state.error ? "is-error" : ""}" role="status" aria-live="polite">${escapeHtml(state.error || state.message)}</p>
    <section class="entity-toolbar" aria-label="Filtros"><label>Pesquisar<input type="search" data-entity-search value="${escapeHtml(state.search)}" placeholder="Buscar nos campos cadastrados"></label>${entity.statusFields.length ? `<label>Status<select data-entity-status><option value="">Todos</option>${statuses.map(status => `<option value="${escapeHtml(status)}"${status === state.status ? " selected" : ""}>${escapeHtml(status)}</option>`).join("")}</select></label>` : ""}</section>
    <div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columnHeaders(data.columns, state)}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr>${visibleColumns.map(column => `<td data-label="${escapeHtml(column.label)}">${escapeHtml(displayColumnValue(item.fields, column))}</td>`).join("")}<td class="entity-row-action"><a class="button-secondary" href="#/entity/${encodeURIComponent(entity.id)}/item/${encodeURIComponent(item.id)}">Abrir</a></td></tr>`).join("") || `<tr><td colspan="${visibleColumns.length + 1}" class="entity-empty">Nenhum registro corresponde aos filtros selecionados.</td></tr>`}</tbody></table></div>
    <nav class="entity-pagination" aria-label="Paginação"><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page} de ${data.items.pages}</span><button type="button" data-entity-next ${data.items.page >= data.items.pages ? "disabled" : ""}>Próxima</button></nav>
  </section>`;
}

export function createEntityPage(root, context = {}) {
  if (!root) throw new TypeError("A galeria requer um elemento raiz.");
  const { entity, repository, access, can } = context;
  const state = { search: "", status: "", page: 1, pageSize: 20, sort: { field: "Title", direction: "asc" }, message: context.initialMessage || "", error: "", data: null, formOpen: false, formValues: {} };
  let disposed = false;
  let generation = 0;
  let formController;
  const isCurrent = token => !disposed && token === generation;
  const entityActions = () => getEntityActions(entity, access, can);

  function render() {
    if (disposed || !state.data) return;
    formController?.cleanup?.();
    if (state.formOpen) {
      root.innerHTML = '<section class="entity-page"><div data-entity-form></div></section>';
      formController = renderDynamicForm(root.querySelector("[data-entity-form]"), {
        entity, columns: state.data.columns, mode: "create", values: state.formValues, error: state.error,
        onCancel: () => { state.formOpen = false; render(); },
        onSubmit: save,
      });
      return;
    }
    root.innerHTML = galleryMarkup(entity, state.data, state, entityActions());
    bind();
  }

  async function refresh() {
    const token = ++generation;
    root.innerHTML = '<section class="entity-page" aria-busy="true"><p class="entity-loading">Carregando registros...</p></section>';
    try {
      const data = await loadEntityData(repository, entity, state);
      if (!isCurrent(token)) return undefined;
      state.data = data;
      if (data.availability !== "available") {
        root.innerHTML = `<section class="entity-page"><header class="entity-heading"><div><p class="page-eyebrow">Dados do SharePoint</p><h1>${escapeHtml(entity.title)}</h1></div></header><p class="entity-${data.availability === "error" ? "error" : "empty"}" role="${data.availability === "error" ? "alert" : "status"}">${escapeHtml(availabilityMessage(data.availability))}</p></section>`;
        return data;
      }
      render();
      return data;
    } catch (error) { return undefined; }
  }

  async function save(fields, rawValues = {}) {
    if (!entityActions().create || !state.data?.list) return;
    const token = ++generation;
    try {
      await repository.createItem(entity.siteKey, state.data.list.id, fields);
      if (!isCurrent(token)) return;
      state.formOpen = false;
      state.formValues = {};
      state.message = "Registro criado com sucesso.";
      state.error = "";
      await refresh();
    } catch (error) {
      if (!isCurrent(token)) return;
      state.error = error?.message || "Não foi possível criar o registro.";
      state.formOpen = true;
      state.formValues = rawValues;
      render();
    }
  }

  function bind() {
    const recalculate = () => {
      state.data = { ...state.data, items: sortAndFilterItems(state.data.rawItems, entity, state) };
    };
    root.querySelector("[data-entity-create]")?.addEventListener("click", () => {
      if (entityActions().create) { state.formOpen = true; state.formValues = {}; state.message = ""; state.error = ""; render(); }
    });
    root.querySelector("[data-entity-search]")?.addEventListener("input", event => { state.search = event.target.value; state.page = 1; recalculate(); render(); });
    root.querySelector("[data-entity-status]")?.addEventListener("change", event => { state.status = event.target.value; state.page = 1; recalculate(); render(); });
    root.querySelectorAll("[data-entity-sort]").forEach(button => button.addEventListener("click", () => { const field = button.dataset.entitySort; state.sort = { field, direction: state.sort.field === field && state.sort.direction === "asc" ? "desc" : "asc" }; recalculate(); render(); }));
    root.querySelector("[data-entity-prev]")?.addEventListener("click", () => { state.page -= 1; recalculate(); render(); });
    root.querySelector("[data-entity-next]")?.addEventListener("click", () => { state.page += 1; recalculate(); render(); });
  }

  const ready = refresh();
  return Object.freeze({ ready, refresh, cleanup: () => { disposed = true; generation += 1; formController?.cleanup?.(); } });
}
