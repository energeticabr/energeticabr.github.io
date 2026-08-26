import { escapeHtml } from "../core/utils.js";
import { displayColumnValue, mapSharePointColumns } from "../data/column-mapper.js";
import { classifyEntityAvailability } from "../data/attachments.js";
import {
  buildEntityFilters,
  createEntityQueryState,
  ENTITY_PAGE_SIZES,
  hasActiveEntityFilters,
  runEntityQuery,
  updateEntityQueryState,
} from "../entities/entity-query.js";
import { renderDynamicForm } from "./dynamic-form.js";

export function getEntityActions(entity, access, can) {
  const allowed = action => entity?.capabilities?.[action] === true && can?.(access, entity.moduleId, action) === true;
  return Object.freeze({ create: allowed("create"), edit: allowed("edit"), delete: allowed("delete"), approve: allowed("approve") });
}

function approvalFields(entity, columns = []) {
  const available = new Set(columns.map(column => column.name));
  const field = (entity?.statusFields || []).find(candidate => available.has(candidate));
  if (!field) throw new Error("Não foi possível identificar o campo de aprovação desta lista.");
  return { [field]: "APROVADO" };
}

export async function loadEntityData(repository, entity, options = {}) {
  try {
    const list = await repository.resolveList(entity.siteKey, entity.listNames);
    if (list.status !== "resolved") return Object.freeze({ state: "missing", availability: "missing", list, columns: [], rawItems: [], items: runEntityQuery([], entity, options) });
    const [rawColumns, rawItems] = await Promise.all([
      repository.getColumns(entity.siteKey, list.id),
      repository.getItems(entity.siteKey, list.id, "$expand=fields"),
    ]);
    const columns = mapSharePointColumns(rawColumns, entity);
    return Object.freeze({ state: "ready", availability: "available", list, columns, rawItems, items: runEntityQuery(rawItems, entity, options) });
  } catch (error) {
    const availability = classifyEntityAvailability(error);
    return Object.freeze({ state: availability, availability, error, list: undefined, columns: [], rawItems: [], items: runEntityQuery([], entity, options) });
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

export function entityGalleryMarkup(entity, data, state, actions) {
  const filters = buildEntityFilters(data.rawItems, entity, data.columns);
  const visibleColumns = data.columns.filter(column => !column.hidden).slice(0, 8);
  const records = data.items.items;
  const activeFilters = hasActiveEntityFilters(state);
  const pageSizes = [...new Set([...ENTITY_PAGE_SIZES, Number(state.pageSize)])].filter(value => value > 0 && value <= 100).sort((left, right) => left - right);
  return `<section class="entity-page" aria-labelledby="entityPageTitle">
    <header class="entity-heading"><div><p class="page-eyebrow">Dados do SharePoint</p><h1 id="entityPageTitle">${escapeHtml(entity.title)}</h1><p class="entity-meta">${data.items.total} registro(s) encontrado(s)</p></div><div class="entity-actions">${actions.create ? '<button type="button" class="button-primary" data-entity-create>Novo registro</button>' : ""}</div></header>
    <p class="entity-toast ${state.error ? "is-error" : ""}" role="status" aria-live="polite">${escapeHtml(state.error || state.message)}</p>
    <section class="entity-toolbar" aria-label="Filtros">
      <label>Pesquisar<input type="search" data-entity-search value="${escapeHtml(state.search)}" placeholder="Buscar nos campos cadastrados"></label>
      ${filters.map(filter => `<label>${escapeHtml(filter.label)}<select data-entity-filter="${escapeHtml(filter.name)}"><option value="">Todos</option>${filter.options.map(option => `<option value="${escapeHtml(option)}"${option === state.filters?.[filter.name] ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></label>`).join("")}
      <label>Itens por página<select data-entity-page-size>${pageSizes.map(size => `<option value="${size}"${size === Number(state.pageSize) ? " selected" : ""}>${size}</option>`).join("")}</select></label>
      ${activeFilters ? '<button class="button-secondary entity-clear-filters" type="button" data-entity-clear-filters>Limpar filtros</button>' : ""}
    </section>
    <div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columnHeaders(data.columns, state)}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr>${visibleColumns.map(column => `<td data-label="${escapeHtml(column.label)}">${escapeHtml(displayColumnValue(item.fields, column))}</td>`).join("")}<td class="entity-row-action"><a class="button-secondary" href="#/entity/${encodeURIComponent(entity.id)}/item/${encodeURIComponent(item.id)}">Abrir</a>${actions.approve ? `<button class="button-primary" type="button" data-entity-approve="${escapeHtml(item.id)}">Aprovar</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="${visibleColumns.length + 1}" class="entity-empty">${activeFilters ? 'Nenhum registro corresponde aos filtros selecionados. <button class="button-secondary" type="button" data-entity-clear-filters>Limpar filtros</button>' : "Nenhum registro foi cadastrado nesta lista."}</td></tr>`}</tbody></table></div>
    <nav class="entity-pagination" aria-label="Paginação"><span>Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd} de ${data.items.total}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page} de ${data.items.pages}</span><button type="button" data-entity-next ${data.items.page >= data.items.pages ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last ${data.items.page >= data.items.pages ? "disabled" : ""}>Última</button></div></nav>
  </section>`;
}

export function createEntityPage(root, context = {}) {
  if (!root) throw new TypeError("A galeria requer um elemento raiz.");
  const { entity, repository, access, can } = context;
  const state = { ...createEntityQueryState(), message: context.initialMessage || "", error: "", data: null, formOpen: false, formValues: {} };
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
    root.innerHTML = entityGalleryMarkup(entity, state.data, state, entityActions());
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
        root.innerHTML = `<section class="entity-page"><header class="entity-heading"><div><p class="page-eyebrow">Dados do SharePoint</p><h1>${escapeHtml(entity.title)}</h1></div></header><div class="entity-state"><p class="entity-${data.availability === "error" ? "error" : "empty"}" role="${data.availability === "error" ? "alert" : "status"}">${escapeHtml(availabilityMessage(data.availability))}</p><button class="button-secondary" type="button" data-entity-retry>Tentar novamente</button></div></section>`;
        root.querySelector("[data-entity-retry]")?.addEventListener("click", refresh);
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

  async function approve(itemId) {
    if (!entityActions().approve || !state.data?.list) return;
    const item = state.data.rawItems.find(candidate => String(candidate.id) === String(itemId));
    if (!item) return;
    const confirmed = context.confirmApprove
      ? await context.confirmApprove(item)
      : globalThis.confirm?.("Aprovar este registro?");
    if (!confirmed) return;
    if (typeof repository.approveItem !== "function") {
      state.error = "A aprovação requer repository.approveItem(siteKey, listId, itemId, fields, { eTag }).";
      render();
      return;
    }
    const token = ++generation;
    try {
      const fields = approvalFields(entity, state.data.columns);
      const approvedItem = await repository.approveItem(entity.siteKey, state.data.list.id, item.id, fields, { eTag: item.eTag || item["@odata.etag"] });
      if (!isCurrent(token)) return;
      const replacement = approvedItem?.fields ? approvedItem : { ...item, fields: { ...(item.fields || {}), ...fields } };
      const rawItems = state.data.rawItems.map(candidate => String(candidate.id) === String(item.id) ? replacement : candidate);
      state.data = { ...state.data, rawItems, items: runEntityQuery(rawItems, entity, state) };
      state.message = "Registro aprovado com sucesso.";
      state.error = "";
      render();
    } catch (error) {
      if (!isCurrent(token)) return;
      state.error = error?.message || "Não foi possível aprovar o registro.";
      render();
    }
  }

  function bind() {
    const updateQuery = patch => Object.assign(state, updateEntityQueryState(state, patch));
    const recalculate = () => {
      state.data = { ...state.data, items: runEntityQuery(state.data.rawItems, entity, state) };
    };
    root.querySelector("[data-entity-create]")?.addEventListener("click", () => {
      if (entityActions().create) { state.formOpen = true; state.formValues = {}; state.message = ""; state.error = ""; render(); }
    });
    root.querySelectorAll("[data-entity-approve]").forEach(button => button.addEventListener("click", () => approve(button.dataset.entityApprove)));
    root.querySelector("[data-entity-search]")?.addEventListener("input", event => { updateQuery({ search: event.target.value }); recalculate(); render(); });
    root.querySelectorAll("[data-entity-filter]").forEach(control => control.addEventListener("change", event => { updateQuery({ filters: { [control.dataset.entityFilter]: event.target.value } }); recalculate(); render(); }));
    root.querySelector("[data-entity-page-size]")?.addEventListener("change", event => { updateQuery({ pageSize: Number(event.target.value) }); recalculate(); render(); });
    root.querySelectorAll("[data-entity-clear-filters]").forEach(button => button.addEventListener("click", () => { Object.assign(state, createEntityQueryState({ pageSize: state.pageSize, sort: state.sort })); recalculate(); render(); }));
    root.querySelectorAll("[data-entity-sort]").forEach(button => button.addEventListener("click", () => { const field = button.dataset.entitySort; updateQuery({ sort: { field, direction: state.sort.field === field && state.sort.direction === "asc" ? "desc" : "asc" } }); recalculate(); render(); }));
    root.querySelector("[data-entity-first]")?.addEventListener("click", () => { updateQuery({ page: 1 }); recalculate(); render(); });
    root.querySelector("[data-entity-prev]")?.addEventListener("click", () => { updateQuery({ page: state.page - 1 }); recalculate(); render(); });
    root.querySelector("[data-entity-next]")?.addEventListener("click", () => { updateQuery({ page: state.page + 1 }); recalculate(); render(); });
    root.querySelector("[data-entity-last]")?.addEventListener("click", () => { updateQuery({ page: state.data.items.pages }); recalculate(); render(); });
  }

  const ready = refresh();
  return Object.freeze({ ready, refresh, cleanup: () => { disposed = true; generation += 1; formController?.cleanup?.(); } });
}
