import { escapeHtml } from "../core/utils.js";
import { mapSharePointColumns } from "../data/column-mapper.js";
import { classifyEntityAvailability } from "../data/attachments.js";
import { resolvePowerAppsUiContract } from "../catalog/powerapps-ui-contract.js";
import { persistEntityRecord } from "../forms/entity-submit.js";
import { createMultiEntryQueue, multiEntryQueueMarkup } from "../forms/multi-entry.js";
import {
  buildGalleryFilters,
  formatGalleryValue,
  matchesGallerySearchTerms,
  normalizeGallerySearchTerms,
} from "../gallery/gallery-model.js";
import {
  buildEntityGraphRequest,
  canSortEntityColumn,
  createEntityBatchResult,
  createEntityQueryState,
  ENTITY_MAX_INCREMENTAL_PAGES,
  ENTITY_PAGE_SIZES,
  hasActiveEntityFilters,
  itemMatchesEntityQuery,
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
    const uiContract = resolvePowerAppsUiContract(entity, columns);
    const queryEntity = Object.freeze({
      ...entity,
      searchFields: uiContract.searchFields,
      filterFields: uiContract.filterFields,
      statusFields: Object.freeze([]),
    });
    const searchTerms = normalizeGallerySearchTerms(options.search);
    const queryOptions = searchTerms.length > 1 ? { ...options, search: searchTerms[0] } : options;
    const query = buildEntityGraphRequest(queryEntity, columns, queryOptions);
    if (query.blocked) {
      return Object.freeze({ state: "ready", availability: "available", list, columns, uiContract, rawItems: [], items: emptyItems, query, nextLink: "" });
    }
    if (typeof repository.getItemsPage !== "function") {
      throw new TypeError("A galeria requer paginação incremental do Microsoft Graph.");
    }
    const pageOptions = {
      cursor: options.cursor,
      signal: options.signal,
      pageNumber: options.pageNumber,
      maxPages: options.maxPages,
    };
    const page = query.mode === "bounded-multi-field-search"
      ? await repository.searchItemsPage(entity.siteKey, list.id, query.search, pageOptions)
      : await repository.getItemsPage(entity.siteKey, list.id, query.query, pageOptions);
    const batchLimit = createEntityQueryState(options).pageSize;
    if (!Array.isArray(page?.items)) throw new TypeError("O Microsoft Graph retornou um lote de itens inválido.");
    if (page.items.length > batchLimit) {
      throw new RangeError(`A galeria recebeu mais registros que o limite de ${batchLimit}; o lote foi recusado antes da renderização.`);
    }
    const rawItems = searchTerms.length > 1
      ? page.items.filter(item => matchesGallerySearchTerms(item.fields, uiContract.searchFields, searchTerms))
      : page.items;
    const items = createEntityBatchResult(rawItems, options, {
      pageNumber: options.pageNumber,
      loadedBefore: options.loadedBefore,
      hasMore: page.hasMore,
    });
    return Object.freeze({ state: "ready", availability: "available", list, columns, uiContract, rawItems, items, query, nextLink: page.nextLink });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const availability = classifyEntityAvailability(error);
    return Object.freeze({ state: availability, availability, error, list: undefined, columns: [], rawItems: [], items: createEntityBatchResult([], options, { pageNumber: options.pageNumber }) });
  }
}

const MICROSOFT_SESSION_CODES = new Set(["interaction_required", "login_required", "consent_required", "token_unavailable", "user_login_error", "invalid_grant"]);
const SHAREPOINT_SECURITY_CODES = new Set(["inherited_permissions", "unknown_acl_shape", "unknown_effective_permissions", "permission_mismatch", "sharepoint_grant_denied", "portal_grant_denied"]);

function diagnosticCode(data) {
  const raw = String(data?.error?.code || data?.list?.error?.code || data?.error?.name || data?.availability || "unknown_error");
  return /^[A-Za-z0-9_.-]{1,80}$/.test(raw) ? raw : "unknown_error";
}

export function entityAvailabilityDiagnostic(data = {}) {
  const availability = data.availability || "error";
  const error = data.error || data.list?.error || {};
  const code = diagnosticCode(data);
  const status = Number(error.status || 0);
  const rawMessage = String(error.message || "");
  let message;
  if (MICROSOFT_SESSION_CODES.has(code) || status === 401) {
    message = "Sua sessão Microsoft precisa ser renovada. Saia e entre novamente para consultar esta lista.";
  } else if (availability === "forbidden" || status === 403 || code === "accessDenied") {
    message = "Sua conta não tem permissão Microsoft para consultar esta lista. Solicite acesso ao administrador.";
  } else if (SHAREPOINT_SECURITY_CODES.has(code)) {
    message = "A proteção de acesso desta lista não corresponde às permissões do portal. O administrador precisa revisar a segurança no SharePoint.";
  } else if (availability === "missing") {
    message = "A lista desta área não foi localizada no SharePoint. Verifique o nome e o endereço configurados.";
  } else if (/fetch|network|timeout|connection|conexão/i.test(`${code} ${rawMessage}`)) {
    message = "Não foi possível estabelecer conexão com o Microsoft 365. Verifique a internet e tente novamente.";
  } else {
    message = "Não foi possível consultar esta lista agora. Tente novamente.";
  }
  return Object.freeze({ message, code });
}

function canApplyRemoteSort(entity, columns, state, column) {
  if (!canSortEntityColumn(column)) return false;
  const request = buildEntityGraphRequest(entity, columns, {
    ...state,
    sort: { field: column.name, direction: state.sort?.field === column.name ? state.sort.direction : "asc" },
  });
  return !request.blocked && new URLSearchParams(request.query).get("$orderby")?.startsWith(`fields/${column.name} `) === true;
}

function columnHeaders(entity, allColumns, visibleColumns, state) {
  return visibleColumns.map(column => {
    const sortable = canApplyRemoteSort(entity, allColumns, state, column);
    const active = sortable && state.sort?.field === column.name;
    const direction = active ? state.sort.direction : "asc";
    const title = sortable ? `Ordenar remotamente por ${column.label}` : "Esta coluna não oferece ordenação remota segura.";
    return `<th scope="col"${active ? ` aria-sort="${direction === "desc" ? "descending" : "ascending"}"` : ""}><button type="button" class="entity-sort" data-entity-sort="${escapeHtml(column.name)}"${sortable ? "" : " disabled"} title="${escapeHtml(title)}">${escapeHtml(column.label)}</button></th>`;
  }).join("");
}

function galleryMeta(data) {
  return data.items.totalKnown
    ? `${data.items.total} registro(s) encontrado(s)`
    : `${data.items.loadedCount} registro(s) alcançado(s) até este lote`;
}

function queryNotesMarkup(data) {
  const limitations = data.query?.limitations || [];
  const notices = data.query?.notices || [];
  return `${limitations.map(message => `<p class="entity-error" role="status">${escapeHtml(message)}</p>`).join("")}${notices.map(message => `<p class="entity-note" role="status">${escapeHtml(message)}</p>`).join("")}`;
}

function entityRowActionsMarkup(entity, item, actions) {
  const itemId = String(item?.id ?? "");
  const detailHref = `#/entity/${encodeURIComponent(String(entity?.id || ""))}/item/${encodeURIComponent(itemId)}`;
  return `${actions.edit ? `<button class="button-primary" type="button" data-entity-edit="${escapeHtml(itemId)}" aria-label="Editar registro #${escapeHtml(itemId)}">Editar</button>` : ""}<a class="button-secondary" href="${detailHref}" aria-label="Abrir detalhes do registro #${escapeHtml(itemId)}">Abrir detalhes</a>${actions.approve ? `<button class="button-secondary" type="button" data-entity-approve="${escapeHtml(itemId)}" aria-label="Aprovar registro #${escapeHtml(itemId)}">Aprovar</button>` : ""}`;
}

function entityGalleryResultsMarkup(entity, data, state, actions) {
  const contract = data.uiContract || resolvePowerAppsUiContract(entity, data.columns);
  const visibleColumns = contract.galleryColumns;
  const queryEntity = { ...entity, searchFields: contract.searchFields, filterFields: contract.filterFields, statusFields: [] };
  const records = data.items.items;
  const limitations = data.query?.limitations || [];
  const activeFilters = hasActiveEntityFilters(state);
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore
    ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido`
    : data.items.hasMore ? "há mais resultados" : "fim da lista";
  const batchState = `Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`;
  const emptyMessage = limitations.length
    ? "A consulta não foi executada para evitar percorrer a lista inteira."
    : activeFilters
      ? 'Nenhum registro corresponde aos filtros selecionados. <button class="button-secondary" type="button" data-entity-clear-filters>Limpar filtros</button>'
      : data.items.page > 1
        ? "Não há itens neste lote. Volte à página anterior."
        : "Nenhum registro foi cadastrado nesta lista.";
  return `<div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columnHeaders(queryEntity, data.columns, visibleColumns, state)}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr>${visibleColumns.map(column => `<td data-label="${escapeHtml(column.label)}">${escapeHtml(formatGalleryValue(item.fields, column))}</td>`).join("")}<td class="entity-row-action"><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></td></tr>`).join("") || `<tr><td colspan="${visibleColumns.length + 1}" class="entity-empty">${emptyMessage}</td></tr>`}</tbody></table></div>
    <nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(batchState)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav>`;
}

export function entityGalleryMarkup(entity, data, state, actions) {
  const contract = data.uiContract || resolvePowerAppsUiContract(entity, data.columns);
  const filters = buildGalleryFilters(data.rawItems, data.columns, contract.filterFields);
  const activeFilters = hasActiveEntityFilters(state);
  const hasFormPanel = actions.create || actions.edit;
  const pageSizes = [...new Set([...ENTITY_PAGE_SIZES, Number(state.pageSize)])].filter(value => value > 0 && value <= 100).sort((left, right) => left - right);
  return `<section class="entity-page" aria-labelledby="entityPageTitle">
    <header class="entity-heading"><div><p class="page-eyebrow">Dados do SharePoint</p><h1 id="entityPageTitle">${escapeHtml(entity.title)}</h1><p class="entity-meta" data-entity-meta>${escapeHtml(galleryMeta(data))}</p></div><div class="entity-actions">${actions.create ? '<button type="button" class="button-primary" data-entity-create>Novo registro</button>' : ""}</div></header>
    <p class="entity-toast ${state.error ? "is-error" : ""}" data-entity-toast role="status" aria-live="polite">${escapeHtml(state.error || state.message)}</p>
    <div class="entity-state" data-entity-query-notes>${queryNotesMarkup(data)}</div>
    <div class="entity-split-workspace${hasFormPanel ? " access-grid" : ""}" data-entity-workspace>
      ${hasFormPanel ? '<section class="entity-form-panel" data-entity-form-panel><div data-entity-form></div><div data-multi-entry-host></div></section>' : ""}
      <section class="entity-gallery-panel" data-entity-gallery>
        <section class="entity-toolbar" data-entity-toolbar aria-label="Filtros">
          <label>Pesquisar<input type="search" data-entity-search value="${escapeHtml(state.search)}" placeholder="Buscar nos campos cadastrados"></label>
          ${filters.map(filter => `<label>${escapeHtml(filter.label)}<select data-entity-filter="${escapeHtml(filter.name)}"><option value="">Todos</option>${filter.options.map(option => `<option value="${escapeHtml(option)}"${option === state.filters?.[filter.name] ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></label>`).join("")}
          <label>Itens por página<select data-entity-page-size>${pageSizes.map(size => `<option value="${size}"${size === Number(state.pageSize) ? " selected" : ""}>${size}</option>`).join("")}</select></label>
          <button class="button-secondary entity-clear-filters" type="button" data-entity-clear-filters${activeFilters ? "" : " hidden"}>Limpar filtros</button>
        </section>
        <div data-entity-results>${entityGalleryResultsMarkup(entity, data, state, actions)}</div>
      </section>
    </div>
  </section>`;
}

export function createEntityPage(root, context = {}) {
  if (!root) throw new TypeError("A galeria requer um elemento raiz.");
  const { entity, repository, access, can } = context;
  const state = {
    ...createEntityQueryState(context.initialQuery),
    message: context.initialMessage || "",
    error: "",
    data: null,
    formMode: "create",
    editingItem: null,
    formValues: {},
    formRelationshipLabels: {},
  };
  let disposed = false;
  let generation = 0;
  let activeController;
  let formController;
  let searchTimer;
  let settleScheduledSearch;
  const requestedDebounce = Number(context.searchDebounceMs ?? 300);
  const searchDebounceMs = Number.isFinite(requestedDebounce) ? Math.max(0, Math.min(2000, requestedDebounce)) : 300;
  const pageCache = new Map();
  const maxPages = ENTITY_MAX_INCREMENTAL_PAGES;
  const multiQueue = createMultiEntryQueue({ onChange: () => renderMultiEntryQueue() });
  const isCurrent = token => !disposed && token === generation;
  const entityActions = () => getEntityActions(entity, access, can);
  const updateQuery = patch => Object.assign(state, updateEntityQueryState(state, patch));
  const restartQuery = (patch, options = {}) => {
    updateQuery(patch);
    pageCache.clear();
    return refresh({ pageNumber: 1, preserveToolbar: options.preserveToolbar });
  };

  function canRenderStableGallery() {
    return Boolean(root.ownerDocument?.createElement && root.querySelector("[data-entity-search]") && root.querySelector("[data-entity-results]"));
  }

  function render(options = {}) {
    if (disposed || !state.data) return;
    if (options.preserveToolbar && canRenderStableGallery()) {
      const meta = root.querySelector("[data-entity-meta]");
      const toast = root.querySelector("[data-entity-toast]");
      const notes = root.querySelector("[data-entity-query-notes]");
      const results = root.querySelector("[data-entity-results]");
      const clear = root.querySelector("[data-entity-toolbar] [data-entity-clear-filters]");
      if (meta) meta.textContent = galleryMeta(state.data);
      if (toast) {
        toast.textContent = state.error || state.message;
        toast.classList.toggle("is-error", Boolean(state.error));
      }
      if (notes) notes.innerHTML = queryNotesMarkup(state.data);
      if (clear) clear.hidden = !hasActiveEntityFilters(state);
      results.innerHTML = entityGalleryResultsMarkup(entity, state.data, state, entityActions());
      root.querySelector(".entity-page")?.removeAttribute("aria-busy");
      bindResults();
      return;
    }
    formController?.cleanup?.();
    formController = undefined;
    root.innerHTML = entityGalleryMarkup(entity, state.data, state, entityActions());
    bind();
    mountForm();
    renderMultiEntryQueue();
  }

  function relationshipSearch(column, term, options) {
    if (typeof repository.searchRelationshipOptions !== "function") throw new Error("A pesquisa relacional do SharePoint não está disponível.");
    return repository.searchRelationshipOptions(entity.siteKey, state.data.list.id, column.relation, term, options);
  }

  function resetForm() {
    state.formMode = "create";
    state.editingItem = null;
    state.formValues = {};
    state.formRelationshipLabels = {};
    state.error = "";
  }

  function mountForm() {
    const host = root.querySelector("[data-entity-form]");
    if (!host || typeof host.querySelector !== "function") return;
    const actions = entityActions();
    const editing = state.formMode === "edit" && state.editingItem;
    if ((!editing && !actions.create) || (editing && !actions.edit)) {
      host.innerHTML = '<p class="entity-empty">Selecione um registro que você tenha permissão para editar.</p>';
      return;
    }
    const contract = state.data.uiContract || resolvePowerAppsUiContract(entity, state.data.columns);
    formController = renderDynamicForm(host, {
      entity,
      columns: contract.formColumns,
      mode: editing ? "edit" : "create",
      values: state.formValues,
      relationshipLabels: state.formRelationshipLabels,
      error: state.error,
      submitLabel: !editing && contract.multiple ? "Adicionar à lista" : undefined,
      relationshipDebounceMs: context.relationshipDebounceMs,
      relationshipSearch,
      onCancel: () => { resetForm(); render(); },
      onSubmit: editing ? saveRecord : contract.multiple ? queueRecord : saveRecord,
    });
  }

  function renderMultiEntryQueue() {
    if (!state.data || disposed) return;
    const host = root.querySelector("[data-multi-entry-host]");
    const contract = state.data.uiContract || resolvePowerAppsUiContract(entity, state.data.columns);
    if (!host || !contract.multiple || state.formMode === "edit") {
      if (host) host.innerHTML = "";
      return;
    }
    host.innerHTML = multiEntryQueueMarkup(multiQueue.snapshot(), contract.formColumns);
    host.querySelectorAll?.("[data-multi-entry-remove]").forEach(button => button.addEventListener("click", () => multiQueue.remove(button.dataset.multiEntryRemove)));
    host.querySelector?.("[data-multi-entry-submit]")?.addEventListener("click", submitMultiEntryQueue);
  }

  async function queueRecord(fields, rawValues = {}, relationshipLabels = {}) {
    multiQueue.add(fields, rawValues, relationshipLabels);
    state.formValues = {};
    state.formRelationshipLabels = {};
    state.message = "Item adicionado à lista de lançamentos.";
    state.error = "";
    render();
  }

  async function submitMultiEntryQueue() {
    if (!entityActions().create || !state.data?.list) return;
    const result = await multiQueue.submitAll(row => persistEntityRecord(repository, entity, state.data.list, {
      mode: "create",
      fields: row.fields,
    }));
    const successes = result.filter(row => row.status === "success").length;
    const failures = result.filter(row => row.status === "error").length;
    state.message = `${successes} registro(s) criado(s)${failures ? ` e ${failures} com falha` : ""}.`;
    state.error = failures ? "Revise as linhas com falha e submeta novamente." : "";
    if (successes) {
      pageCache.clear();
      await refresh({ pageNumber: 1 });
    } else {
      renderMultiEntryQueue();
    }
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
    const preserveToolbar = options.preserveToolbar && canRenderStableGallery();
    if (preserveToolbar) root.querySelector(".entity-page")?.setAttribute("aria-busy", "true");
    else root.innerHTML = '<section class="entity-page" aria-busy="true"><p class="entity-loading">Carregando registros...</p></section>';
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
        const diagnostic = entityAvailabilityDiagnostic(data);
        root.innerHTML = `<section class="entity-page"><header class="entity-heading"><div><p class="page-eyebrow">Dados do SharePoint</p><h1>${escapeHtml(entity.title)}</h1></div></header><div class="entity-state"><p class="entity-${data.availability === "error" ? "error" : "empty"}" role="${data.availability === "error" ? "alert" : "status"}">${escapeHtml(diagnostic.message)}</p><p class="entity-diagnostic-code">Diagnóstico: ${escapeHtml(diagnostic.code)}</p><button class="button-secondary" type="button" data-entity-retry>Tentar novamente</button></div></section>`;
        root.querySelector("[data-entity-retry]")?.addEventListener("click", () => {
          repository.clearCache?.();
          pageCache.clear();
          refresh({ pageNumber: 1 });
        });
        return data;
      }
      state.page = data.items.page;
      pageCache.set(state.page, data);
      render({ preserveToolbar });
      return data;
    } catch (error) {
      if (isCurrent(token) && !controller.signal.aborted) {
        state.error = error?.message || "Não foi possível carregar os registros.";
        if (state.data) render({ preserveToolbar });
      }
      return undefined;
    } finally {
      if (activeController === controller) activeController = undefined;
    }
  }

  async function saveRecord(fields, rawValues = {}, relationshipLabels = {}) {
    const editing = state.formMode === "edit" && state.editingItem;
    if ((!editing && !entityActions().create) || (editing && !entityActions().edit) || !state.data?.list) return;
    const token = ++generation;
    try {
      await persistEntityRecord(repository, entity, state.data.list, {
        mode: editing ? "edit" : "create",
        item: editing ? state.editingItem : undefined,
        fields,
      });
      if (!isCurrent(token)) return;
      state.message = editing ? "Registro atualizado com sucesso." : "Registro criado com sucesso.";
      state.error = "";
      resetForm();
      pageCache.clear();
      await refresh({ pageNumber: 1 });
    } catch (error) {
      if (!isCurrent(token)) return;
      state.error = error?.message || (editing ? "Não foi possível atualizar o registro." : "Não foi possível criar o registro.");
      state.formValues = rawValues;
      state.formRelationshipLabels = relationshipLabels;
      render();
    }
  }

  function editRecord(itemId) {
    if (!entityActions().edit) return;
    const item = state.data?.rawItems?.find(candidate => String(candidate.id) === String(itemId));
    if (!item) {
      state.error = "O registro selecionado não está mais disponível neste lote.";
      render({ preserveToolbar: true });
      return;
    }
    state.formMode = "edit";
    state.editingItem = item;
    state.formValues = { ...(item.fields || {}) };
    state.formRelationshipLabels = {};
    state.message = `Editando o registro #${item.id}.`;
    state.error = "";
    render();
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
      const updatedItems = state.data.rawItems.map(candidate => String(candidate.id) === String(item.id) ? replacement : candidate);
      const rawItems = updatedItems.filter(candidate => itemMatchesEntityQuery(candidate, entity, state));
      const loadedBefore = state.data.items.rangeStart > 0 ? state.data.items.rangeStart - 1 : Math.max(0, state.data.items.loadedCount - state.data.items.batchCount);
      state.data = {
        ...state.data,
        rawItems,
        items: createEntityBatchResult(rawItems, state, {
          pageNumber: state.page,
          loadedBefore,
          hasMore: state.data.items.hasMore,
        }),
      };
      pageCache.set(state.page, state.data);
      state.message = "Registro aprovado com sucesso.";
      state.error = "";
      render({ preserveToolbar: true });
    } catch (error) {
      if (!isCurrent(token)) return;
      state.error = error?.message || "Não foi possível aprovar o registro.";
      render();
    }
  }

  function bindResults() {
    const resultsRoot = root.ownerDocument?.createElement ? root.querySelector("[data-entity-results]") : root;
    resultsRoot?.querySelectorAll("[data-entity-edit]").forEach(button => button.addEventListener("click", () => editRecord(button.dataset.entityEdit)));
    resultsRoot?.querySelectorAll("[data-entity-approve]").forEach(button => button.addEventListener("click", () => approve(button.dataset.entityApprove)));
    resultsRoot?.querySelectorAll("[data-entity-sort]").forEach(button => button.addEventListener("click", () => {
      const field = button.dataset.entitySort;
      const direction = state.sort.field === field && state.sort.direction === "asc" ? "desc" : "asc";
      return restartQuery({ sort: { field, direction } }, { preserveToolbar: true });
    }));
    resultsRoot?.querySelectorAll("[data-entity-clear-filters]").forEach(button => button.addEventListener("click", clearFilters));
    resultsRoot?.querySelector("[data-entity-first]")?.addEventListener("click", () => showCachedPage(1));
    resultsRoot?.querySelector("[data-entity-prev]")?.addEventListener("click", () => showCachedPage(state.page - 1));
    resultsRoot?.querySelector("[data-entity-next]")?.addEventListener("click", () => {
      if (!state.data?.items?.hasMore || !state.data?.nextLink || state.page >= maxPages) return undefined;
      const nextPage = state.page + 1;
      if (pageCache.has(nextPage)) return showCachedPage(nextPage);
      return refresh({ cursor: state.data.nextLink, pageNumber: nextPage, loadedBefore: state.data.items.loadedCount, preserveToolbar: true });
    });
  }

  function clearFilters() {
    Object.assign(state, createEntityQueryState({ pageSize: state.pageSize, sort: state.sort }));
    pageCache.clear();
    return refresh({ pageNumber: 1 });
  }

  function scheduleSearch(value) {
    updateQuery({ search: value });
    pageCache.clear();
    if (searchTimer !== undefined) {
      globalThis.clearTimeout(searchTimer);
      searchTimer = undefined;
      settleScheduledSearch?.(undefined);
    }
    return new Promise(resolve => {
      settleScheduledSearch = resolve;
      searchTimer = globalThis.setTimeout(async () => {
        searchTimer = undefined;
        const settle = settleScheduledSearch;
        settleScheduledSearch = undefined;
        try {
          settle?.(await refresh({ pageNumber: 1, preserveToolbar: true }));
        } catch (error) {
          settle?.(undefined);
          throw error;
        }
      }, searchDebounceMs);
    });
  }

  function bind() {
    root.querySelector("[data-entity-create]")?.addEventListener("click", () => {
      if (entityActions().create) { resetForm(); state.message = ""; render(); }
    });
    root.querySelector("[data-entity-search]")?.addEventListener("input", event => scheduleSearch(event.target.value));
    root.querySelectorAll("[data-entity-filter]").forEach(control => control.addEventListener("change", event => restartQuery({ filters: { [control.dataset.entityFilter]: event.target.value } })));
    root.querySelector("[data-entity-page-size]")?.addEventListener("change", event => restartQuery({ pageSize: Number(event.target.value) }));
    root.querySelector("[data-entity-toolbar] [data-entity-clear-filters]")?.addEventListener("click", clearFilters);
    bindResults();
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
  return Object.freeze({ ready, refresh, cleanup: () => {
    disposed = true;
    generation += 1;
    abortActive("Rota alterada.");
    if (searchTimer !== undefined) globalThis.clearTimeout(searchTimer);
    settleScheduledSearch?.(undefined);
    searchTimer = undefined;
    settleScheduledSearch = undefined;
    formController?.cleanup?.();
  } });
}
