import { escapeHtml } from "../core/utils.js";
import { displayColumnValue, mapSharePointColumns } from "../data/column-mapper.js";
import { classifyEntityAvailability } from "../data/attachments.js";
import {
  buildEntityGraphRequest,
  buildEntityFilters,
  createEntityBatchResult,
  createEntityQueryState,
  ENTITY_MAX_INCREMENTAL_PAGES,
  ENTITY_PAGE_SIZES,
  hasActiveEntityFilters,
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
    const emptyItems = createEntityBatchResult([], options, { pageNumber: options.pageNumber });
    if (list.status !== "resolved") return Object.freeze({ state: "missing", availability: "missing", list, columns: [], rawItems: [], items: emptyItems });
    const rawColumns = await repository.getColumns(entity.siteKey, list.id);
    const metadata = new Map(rawColumns.map(column => [column.name, column]));
    const columns = Object.freeze(mapSharePointColumns(rawColumns, entity).map(column => Object.freeze({
      ...column,
      indexed: metadata.get(column.name)?.indexed === true,
    })));
    const query = buildEntityGraphRequest(entity, columns, options);
    if (query.blocked) {
      return Object.freeze({ state: "ready", availability: "available", list, columns, rawItems: [], items: emptyItems, query, nextLink: "" });
    }
    if (typeof repository.getItemsPage !== "function") {
      throw new TypeError("A galeria requer paginação incremental do Microsoft Graph.");
    }
    const page = await repository.getItemsPage(entity.siteKey, list.id, query.query, {
      cursor: options.cursor,
      signal: options.signal,
      pageNumber: options.pageNumber,
      maxPages: options.maxPages,
    });
    const items = createEntityBatchResult(page.items, options, {
      pageNumber: options.pageNumber,
      loadedBefore: options.loadedBefore,
      hasMore: page.hasMore,
    });
    return Object.freeze({ state: "ready", availability: "available", list, columns, rawItems: page.items, items, query, nextLink: page.nextLink });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const availability = classifyEntityAvailability(error);
    return Object.freeze({ state: availability, availability, error, list: undefined, columns: [], rawItems: [], items: createEntityBatchResult([], options, { pageNumber: options.pageNumber }) });
  }
}

function availabilityMessage(availability) {
  if (availability === "forbidden") return "Você não tem permissão Microsoft para consultar esta lista.";
  if (availability === "missing") return "A lista desta área ainda não foi localizada no SharePoint. Verifique o nome da lista e as permissões Microsoft.";
  return "Não foi possível consultar esta lista agora. Tente novamente.";
}

function columnHeaders(columns) {
  return columns.filter(column => !column.hidden).slice(0, 8).map(column => {
    return `<th scope="col"><button type="button" class="entity-sort" data-entity-sort="${escapeHtml(column.name)}" disabled title="A ordenação global não é oferecida pelo endpoint seguro desta lista.">${escapeHtml(column.label)}</button></th>`;
  }).join("");
}

export function entityGalleryMarkup(entity, data, state, actions) {
  const filters = buildEntityFilters(data.rawItems, entity, data.columns);
  const visibleColumns = data.columns.filter(column => !column.hidden).slice(0, 8);
  const records = data.items.items;
  const activeFilters = hasActiveEntityFilters(state);
  const pageSizes = [...new Set([...ENTITY_PAGE_SIZES, Number(state.pageSize)])].filter(value => value > 0 && value <= 100).sort((left, right) => left - right);
  const limitations = data.query?.limitations || [];
  const loadedMeta = data.items.totalKnown
    ? `${data.items.total} registro(s) encontrado(s)`
    : `${data.items.loadedCount} registro(s) alcançado(s) até este lote`;
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore
    ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido`
    : data.items.hasMore ? "há mais resultados" : "fim da lista";
  const batchState = `Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`;
  return `<section class="entity-page" aria-labelledby="entityPageTitle">
    <header class="entity-heading"><div><p class="page-eyebrow">Dados do SharePoint</p><h1 id="entityPageTitle">${escapeHtml(entity.title)}</h1><p class="entity-meta">${escapeHtml(loadedMeta)}</p></div><div class="entity-actions">${actions.create ? '<button type="button" class="button-primary" data-entity-create>Novo registro</button>' : ""}</div></header>
    <p class="entity-toast ${state.error ? "is-error" : ""}" role="status" aria-live="polite">${escapeHtml(state.error || state.message)}</p>
    ${limitations.length ? `<div class="entity-state"><p class="entity-error" role="status">${escapeHtml(limitations.join(" "))}</p></div>` : ""}
    <section class="entity-toolbar" aria-label="Filtros">
      <label>Pesquisar<input type="search" data-entity-search value="${escapeHtml(state.search)}" placeholder="Buscar nos campos cadastrados"></label>
      ${filters.map(filter => `<label>${escapeHtml(filter.label)}<select data-entity-filter="${escapeHtml(filter.name)}"><option value="">Todos</option>${filter.options.map(option => `<option value="${escapeHtml(option)}"${option === state.filters?.[filter.name] ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></label>`).join("")}
      <label>Itens por página<select data-entity-page-size>${pageSizes.map(size => `<option value="${size}"${size === Number(state.pageSize) ? " selected" : ""}>${size}</option>`).join("")}</select></label>
      ${activeFilters ? '<button class="button-secondary entity-clear-filters" type="button" data-entity-clear-filters>Limpar filtros</button>' : ""}
    </section>
    <div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columnHeaders(data.columns)}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr>${visibleColumns.map(column => `<td data-label="${escapeHtml(column.label)}">${escapeHtml(displayColumnValue(item.fields, column))}</td>`).join("")}<td class="entity-row-action"><a class="button-secondary" href="#/entity/${encodeURIComponent(entity.id)}/item/${encodeURIComponent(item.id)}">Abrir</a>${actions.approve ? `<button class="button-primary" type="button" data-entity-approve="${escapeHtml(item.id)}">Aprovar</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="${visibleColumns.length + 1}" class="entity-empty">${limitations.length ? "A consulta não foi executada para evitar percorrer a lista inteira." : activeFilters ? 'Nenhum registro corresponde aos filtros selecionados. <button class="button-secondary" type="button" data-entity-clear-filters>Limpar filtros</button>' : "Nenhum registro foi cadastrado nesta lista."}</td></tr>`}</tbody></table></div>
    <nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(batchState)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav>
  </section>`;
}

export function createEntityPage(root, context = {}) {
  if (!root) throw new TypeError("A galeria requer um elemento raiz.");
  const { entity, repository, access, can } = context;
  const state = { ...createEntityQueryState(), message: context.initialMessage || "", error: "", data: null, formOpen: false, formValues: {} };
  let disposed = false;
  let generation = 0;
  let activeController;
  let formController;
  const pageCache = new Map();
  const maxPages = ENTITY_MAX_INCREMENTAL_PAGES;
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

  function abortActive(reason = "Consulta substituída.") {
    activeController?.abort(reason);
    activeController = undefined;
  }

  async function refresh(options = {}) {
    abortActive();
    const controller = new AbortController();
    activeController = controller;
    const token = ++generation;
    root.innerHTML = '<section class="entity-page" aria-busy="true"><p class="entity-loading">Carregando registros...</p></section>';
    try {
      const data = await loadEntityData(repository, entity, {
        ...state,
        cursor: options.cursor || "",
        pageNumber: options.pageNumber || 1,
        loadedBefore: options.loadedBefore || 0,
        maxPages,
        signal: controller.signal,
      });
      if (!isCurrent(token)) return undefined;
      activeController = undefined;
      state.data = data;
      if (data.availability !== "available") {
        root.innerHTML = `<section class="entity-page"><header class="entity-heading"><div><p class="page-eyebrow">Dados do SharePoint</p><h1>${escapeHtml(entity.title)}</h1></div></header><div class="entity-state"><p class="entity-${data.availability === "error" ? "error" : "empty"}" role="${data.availability === "error" ? "alert" : "status"}">${escapeHtml(availabilityMessage(data.availability))}</p><button class="button-secondary" type="button" data-entity-retry>Tentar novamente</button></div></section>`;
        root.querySelector("[data-entity-retry]")?.addEventListener("click", refresh);
        return data;
      }
      state.page = data.items.page;
      pageCache.set(state.page, data);
      render();
      return data;
    } catch (error) {
      if (isCurrent(token) && !controller.signal.aborted) {
        state.error = error?.message || "Não foi possível carregar os registros.";
      }
      return undefined;
    } finally {
      if (activeController === controller) activeController = undefined;
    }
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
      pageCache.clear();
      await refresh({ pageNumber: 1 });
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
      state.data = {
        ...state.data,
        rawItems,
        items: Object.freeze({ ...state.data.items, items: Object.freeze([...rawItems]) }),
      };
      pageCache.set(state.page, state.data);
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
    const restartQuery = patch => {
      updateQuery(patch);
      pageCache.clear();
      return refresh({ pageNumber: 1 });
    };
    root.querySelector("[data-entity-create]")?.addEventListener("click", () => {
      if (entityActions().create) { state.formOpen = true; state.formValues = {}; state.message = ""; state.error = ""; render(); }
    });
    root.querySelectorAll("[data-entity-approve]").forEach(button => button.addEventListener("click", () => approve(button.dataset.entityApprove)));
    root.querySelector("[data-entity-search]")?.addEventListener("input", event => restartQuery({ search: event.target.value }));
    root.querySelectorAll("[data-entity-filter]").forEach(control => control.addEventListener("change", event => restartQuery({ filters: { [control.dataset.entityFilter]: event.target.value } })));
    root.querySelector("[data-entity-page-size]")?.addEventListener("change", event => restartQuery({ pageSize: Number(event.target.value) }));
    root.querySelectorAll("[data-entity-clear-filters]").forEach(button => button.addEventListener("click", () => {
      Object.assign(state, createEntityQueryState({ pageSize: state.pageSize, sort: state.sort }));
      pageCache.clear();
      return refresh({ pageNumber: 1 });
    }));
    root.querySelector("[data-entity-first]")?.addEventListener("click", () => showCachedPage(1));
    root.querySelector("[data-entity-prev]")?.addEventListener("click", () => showCachedPage(state.page - 1));
    root.querySelector("[data-entity-next]")?.addEventListener("click", () => {
      if (!state.data?.items?.hasMore || !state.data?.nextLink || state.page >= maxPages) return undefined;
      const nextPage = state.page + 1;
      if (pageCache.has(nextPage)) return showCachedPage(nextPage);
      return refresh({ cursor: state.data.nextLink, pageNumber: nextPage, loadedBefore: state.data.items.loadedCount });
    });
  }

  function showCachedPage(pageNumber) {
    const data = pageCache.get(pageNumber);
    if (!data) return undefined;
    abortActive();
    generation += 1;
    state.page = pageNumber;
    state.data = data;
    render();
    return data;
  }

  const ready = refresh();
  return Object.freeze({ ready, refresh, cleanup: () => { disposed = true; generation += 1; abortActive("Rota alterada."); formController?.cleanup?.(); } });
}
