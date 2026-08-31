import { escapeHtml } from "../core/utils.js";
import { mapSharePointColumns } from "../data/column-mapper.js";
import { classifyEntityAvailability, createAttachmentActions } from "../data/attachments.js";
import { resolvePowerAppsUiContract } from "../catalog/powerapps-ui-contract.js?v=20260827-sharepoint-e2e-v2";
import { persistEntityRecordWithAttachments } from "../forms/entity-submit.js";
import { powerAppsFormDeclaresAttachments } from "../forms/form-attachments.js";
import { createMultiEntryQueue, multiEntryQueueMarkup } from "../forms/multi-entry.js?v=20260827-queue-gallery";
import { attachmentViewerMarkup, bindAttachmentViewerBackdrop, createAttachmentPreviewController } from "./attachments-panel.js?v=20260831-attachment-viewer-v1";
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
  runEntityQuery,
  updateEntityQueryState,
} from "../entities/entity-query.js";

function galleryQueryEntity(entity, contract) {
  return Object.freeze({
    ...entity,
    searchFields: contract.searchFields,
    searchDefinitions: contract.gallerySearch,
    searchDefinitionsProven: contract.gallerySearchProven,
    filterFields: contract.filterFields,
    filterDefinitions: contract.galleryFilters,
    filterDefinitionsProven: contract.galleryFiltersProven,
    statusFields: Object.freeze([]),
  });
}
import { renderDynamicForm } from "./dynamic-form.js?v=20260827-sharepoint-e2e-v2";

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
    const uiContract = resolvePowerAppsUiContract(entity, columns, {
      galleryVariantId: options.galleryVariantId,
      galleryCatalog: options.galleryCatalog,
    });
    const gallerySort = uiContract.gallerySort
      || (entity.id === "lancamentos" && typeof repository.getItems === "function"
        ? { field: "ID", direction: "desc" }
        : { field: "", direction: "asc" });
    const queryOptions = {
      ...options,
      filters: { ...(options.filters || {}), ...(uiContract.galleryFixedFilters || {}) },
      sort: options.useGallerySort === false
        ? options.sort
        : gallerySort,
    };
    const queryEntity = galleryQueryEntity(entity, uiContract);
    const filterOptionValues = options.filterOptionValues && typeof options.filterOptionValues === "object"
      ? options.filterOptionValues
      : typeof repository.getFilterOptionValues === "function" && uiContract.filterFields.length
        ? await repository.getFilterOptionValues(entity.siteKey, list.id, uiContract.filterFields, { signal: options.signal })
        : Object.freeze({});
    const searchTerms = normalizeGallerySearchTerms(queryOptions.search);
    const graphOptions = searchTerms.length > 1 ? { ...queryOptions, search: searchTerms[0] } : queryOptions;
    const query = buildEntityGraphRequest(queryEntity, columns, graphOptions);
    if (query.blocked) {
      return Object.freeze({ state: "ready", availability: "available", list, columns, uiContract, filterOptionValues, rawItems: [], items: emptyItems, query, nextLink: "" });
    }
    if (query.mode === "bounded-client-query") {
      if (typeof repository.getItems !== "function") {
        throw new TypeError("A avaliação local comprovada requer a paginação integral protegida do Microsoft Graph.");
      }
      const allItems = Array.isArray(queryOptions.clientItems)
        ? queryOptions.clientItems
        : await repository.getItems(entity.siteKey, list.id, "$expand=fields", { signal: queryOptions.signal });
      const clientItems = Object.freeze([...(allItems || [])]);
      const localState = { ...queryOptions, page: queryOptions.pageNumber || queryOptions.page || 1 };
      const metricItems = Object.freeze(clientItems.filter(item => itemMatchesEntityQuery(item, queryEntity, localState)));
      const local = runEntityQuery(clientItems, queryEntity, localState);
      const batchCount = local.items.length;
      const rangeStart = local.total ? ((local.page - 1) * local.pageSize) + 1 : 0;
      const rangeEnd = batchCount ? rangeStart + batchCount - 1 : 0;
      const items = Object.freeze({
        ...local,
        totalKnown: true,
        rangeStart,
        rangeEnd,
        batchCount,
        loadedCount: local.total,
        hasMore: local.page < local.pages,
        hasPrevious: local.page > 1,
        isLastBatch: local.page >= local.pages,
      });
      return Object.freeze({
        state: "ready",
        availability: "available",
        list,
        columns,
        uiContract,
        clientItems,
        metricItems,
        filterOptionValues,
        rawItems: local.items,
        items,
        query,
        queryState: createEntityQueryState(localState),
        nextLink: "",
      });
    }
    if (typeof repository.getItemsPage !== "function") {
      throw new TypeError("A galeria requer paginação incremental do Microsoft Graph.");
    }
    const pageOptions = {
      cursor: queryOptions.cursor,
      signal: queryOptions.signal,
      pageNumber: queryOptions.pageNumber,
      maxPages: queryOptions.maxPages,
    };
    const page = query.mode === "bounded-multi-field-search"
      ? await repository.searchItemsPage(entity.siteKey, list.id, query.search, pageOptions)
      : await repository.getItemsPage(entity.siteKey, list.id, query.query, pageOptions);
    const batchLimit = createEntityQueryState(queryOptions).pageSize;
    if (!Array.isArray(page?.items)) throw new TypeError("O Microsoft Graph retornou um lote de itens inválido.");
    if (page.items.length > batchLimit) {
      throw new RangeError(`A galeria recebeu mais registros que o limite de ${batchLimit}; o lote foi recusado antes da renderização.`);
    }
    const rawItems = searchTerms.length > 1
      ? page.items.filter(item => matchesGallerySearchTerms(item.fields, uiContract.searchFields, searchTerms))
      : page.items;
    const items = createEntityBatchResult(rawItems, queryOptions, {
      pageNumber: queryOptions.pageNumber,
      loadedBefore: queryOptions.loadedBefore,
      hasMore: page.hasMore,
    });
    return Object.freeze({
      state: "ready",
      availability: "available",
      list,
      columns,
      uiContract,
      filterOptionValues,
      rawItems,
      items,
      query,
      queryState: createEntityQueryState(queryOptions),
      nextLink: page.nextLink,
    });
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

function galleryAttachmentActionMarkup(entity, item, { prominent = false } = {}) {
  const itemId = String(item?.id ?? "");
  const attachmentLabel = entity?.id === "lancamentos"
    ? `Abrir PDFs e anexos do lançamento #${itemId}`
    : `Abrir anexos do registro #${itemId}`;
  const className = `entity-gallery-attachment${prominent ? " g1-row-attachment" : ""}`;
  const hidden = prominent && itemHasGalleryAttachment(item) ? "" : " hidden";
  return `<button type="button" class="${className}"${hidden} data-gallery-attachment="${escapeHtml(itemId)}" aria-label="${escapeHtml(attachmentLabel)}" title="Abrir anexos"><span class="entity-gallery-file-icon" aria-hidden="true">PDF</span><span class="sr-only">Abrir anexos</span></button>`;
}

function entityRowActionsMarkup(entity, item, actions, { includeAttachment = true } = {}) {
  const itemId = String(item?.id ?? "");
  const detailHref = `#/entity/${encodeURIComponent(String(entity?.id || ""))}/item/${encodeURIComponent(itemId)}`;
  const attachmentAction = includeAttachment ? galleryAttachmentActionMarkup(entity, item) : "";
  return `${actions.edit ? `<button class="button-primary" type="button" data-entity-edit="${escapeHtml(itemId)}" aria-label="Editar registro #${escapeHtml(itemId)}">Editar</button>` : ""}${attachmentAction}<a class="button-secondary" href="${detailHref}" aria-label="Abrir detalhes do registro #${escapeHtml(itemId)}">Abrir detalhes</a>${actions.approve ? `<button class="button-secondary" type="button" data-entity-approve="${escapeHtml(itemId)}" aria-label="Aprovar registro #${escapeHtml(itemId)}">Aprovar</button>` : ""}`;
}

function fieldValue(fields = {}, names = []) {
  for (const name of names) {
    if (fields[name] !== undefined && fields[name] !== null && String(fields[name]).trim() !== "") return fields[name];
  }
  return "";
}

function taskDisplayValue(value) {
  if (Array.isArray(value)) return value.map(taskDisplayValue).filter(Boolean).join(", ");
  if (!value || typeof value !== "object") return String(value ?? "").trim();
  for (const key of ["displayName", "DisplayName", "lookupValue", "LookupValue", "name", "Name", "email", "Email", "value", "Value"]) {
    if (value[key] !== undefined && value[key] !== null && String(value[key]).trim()) return String(value[key]).trim();
  }
  return "";
}

function metricValue(value) {
  return taskDisplayValue(value).trim().toLocaleUpperCase("pt-BR");
}

function itemHasGalleryAttachment(item) {
  return Object.entries(item?.fields || {}).some(([name, value]) => {
    if (!/(anex|attach|arquivo|documento)/i.test(name)) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "boolean") return value;
    const normalized = metricValue(value);
    return normalized !== "" && !["0", "FALSE", "NÃO", "NAO", "SEM ANEXOS", "NULL", "UNDEFINED"].includes(normalized);
  });
}

function galleryFileKind(file = {}) {
  const type = String(file?.type || "").split(";", 1)[0].trim().toLocaleLowerCase("pt-BR");
  const extension = String(file?.name || "").toLocaleLowerCase("pt-BR").match(/\.([a-z0-9]+)$/)?.[1] || "";
  if (type === "application/pdf" || extension === "pdf") return "pdf";
  if (type.startsWith("image/") || ["jpg", "jpeg", "png", "webp"].includes(extension)) return "image";
  return "file";
}

export function galleryAttachmentButtonMarkup(files = [], thumbnailUrl = "") {
  const imageIndex = galleryFileKind(files[0]) === "image" ? 0 : -1;
  const pdfCount = files.filter(file => galleryFileKind(file) === "pdf").length;
  if (thumbnailUrl && imageIndex === 0) {
    return `<img src="${escapeHtml(thumbnailUrl)}" alt="Prévia do anexo ${escapeHtml(files[0].name)}"><span class="entity-gallery-attachment-count">${files.length}</span>`;
  }
  const icon = pdfCount ? "PDF" : "ARQ";
  return `<span class="entity-gallery-file-icon" aria-hidden="true">${icon}</span><span class="entity-gallery-attachment-count">${files.length}</span><span class="sr-only">${files.length} anexo(s)</span>`;
}

function itemStatusValues(item) {
  return Object.entries(item?.fields || {})
    .filter(([name]) => /(status|conclu|pend|situac|finaliz|agend|pagamento)/i.test(name))
    .map(([, value]) => metricValue(value))
    .filter(Boolean);
}

function itemIsPending(item) {
  return itemStatusValues(item).some(value => /PEND|ABERTO|AGUARD|EM AN[AÁ]LISE|N[ÃA]O CONCLU/.test(value));
}

function dateValue(item, names) {
  for (const name of names) {
    const value = item?.[name] ?? item?.fields?.[name];
    const date = new Date(value || "");
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function itemWasEdited(item) {
  const created = dateValue(item, ["createdDateTime", "Created", "Criado"]);
  const modified = dateValue(item, ["lastModifiedDateTime", "Modified", "Modificado"]);
  return Boolean(created && modified && Math.abs(modified.getTime() - created.getTime()) > 5000);
}

function itemWasCreatedToday(item, today = new Date()) {
  const created = dateValue(item, ["createdDateTime", "Created", "Criado"]);
  return Boolean(created && created.getFullYear() === today.getFullYear() && created.getMonth() === today.getMonth() && created.getDate() === today.getDate());
}

function galleryMetricClustersMarkup(records = []) {
  const statusAvailable = records.some(item => itemStatusValues(item).length > 0);
  const attachments = records.filter(itemHasGalleryAttachment).length;
  const pending = records.filter(itemIsPending).length;
  const edited = records.filter(itemWasEdited).length;
  const createdToday = records.filter(item => itemWasCreatedToday(item)).length;
  const metrics = [
    { id: "records", label: "REGISTROS FILTRADOS", value: records.length, tone: "is-primary" },
    { id: "attachments", label: "COM ANEXOS", value: attachments, tone: "is-attachments" },
    statusAvailable
      ? { id: "pending", label: "PENDENTES", value: pending, tone: "is-pending" }
      : { id: "created-today", label: "CRIADOS HOJE", value: createdToday, tone: "is-created" },
    { id: "updated", label: "EDITADOS FILTRADOS", value: edited, tone: "is-updated" },
  ];
  return `<section class="gallery-metric-clusters" data-gallery-metrics aria-label="Métricas da galeria">${metrics.map(metric => `<article class="gallery-metric-cluster ${metric.tone}" data-gallery-metric="${metric.id}"><span>${metric.label}</span><strong>${metric.value}</strong></article>`).join("")}</section>`;
}

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value || "").replace(/\./g, "").replace(",", ".");
  const number = Number.parseFloat(normalized);
  return Number.isFinite(number) ? number : 0;
}

function currencyValue(value) {
  return numberValue(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");
}

function shortDateValue(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("pt-BR");
}

function shortDateTimeValue(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

function hasPowerAppsModification(createdValue, modifiedValue) {
  if (!modifiedValue) return false;
  const created = new Date(createdValue || "");
  const modified = new Date(modifiedValue);
  if (Number.isNaN(modified.getTime())) return false;
  if (Number.isNaN(created.getTime())) return true;
  return Math.trunc((modified.getTime() - created.getTime()) / 1000) > 5;
}

function lancamentoStatusClass(value) {
  const normalized = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (normalized.includes("CONCL") || normalized.includes("FINALIZ") || normalized.includes("PAGO") || normalized.includes("PGTO EFETUADO") || normalized.includes("APROV")) return "is-done";
  if (normalized.includes("PEND") || normalized.includes("ABERTO")) return "is-pending";
  return "is-neutral";
}

function lancamentoCardField(label, value, options = {}) {
  const content = value === undefined || value === null || String(value).trim() === "" ? "-" : value;
  return `<div class="lancamentos-field${options.wide ? " is-wide" : ""}${options.strong ? " is-strong" : ""}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(content)}</strong></div>`;
}

function g1DataLine(label, value, className = "") {
  const content = value === undefined || value === null || String(value).trim() === "" ? "-" : value;
  return `<p${className ? ` class="${className}"` : ""}><span>${escapeHtml(label)}:</span> <strong>${escapeHtml(content)}</strong></p>`;
}

export function buildG1FieldVisitPayload({ filial, valor, createDiary = true, today, now = new Date(), nextGroupId } = {}) {
  const normalizedFilial = String(filial || "").trim().toLocaleUpperCase("pt-BR");
  const localParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  const normalizedDate = String(today || `${localParts.year}-${localParts.month}-${localParts.day}`);
  const amount = numberValue(valor);
  if (!normalizedFilial) throw new Error("Selecione a filial da visita em campo.");
  if (!(amount > 0)) throw new Error("Informe um valor válido para a visita em campo.");
  const lancamento = {
    "VALOR UNITÁRIO": amount,
    QUANTIDADE: 1,
    FORNECEDOR: "BERNARDO",
    FILIAL: normalizedFilial,
    CONTA: "DINHEIRO",
    DATA: normalizedDate,
    "DATA PGTO EFETUADO": normalizedDate,
    "DATA PGTO PREVISTO": normalizedDate,
    "DATA RMS": normalizedDate,
    "TIPO TRANSAÇÃO": "DESPESA",
    ETAPA: "VISITA EM CAMPO",
    "CONCLUÍDO": "PEDIDO FINALIZADO",
    PRODUTO: "VISITA EM CAMPO",
    GERADESEMBOLSO: "SIM",
    "ID 2": Number(nextGroupId) || 1,
  };
  const diario = createDiary ? {
    DATA: normalizedDate,
    FILIAL: normalizedFilial,
    RESPONSAVELTECNICO: "BERNARDO NOTINI MOREIRA BAHIA",
    STATUS: "PENDENTE",
  } : null;
  return Object.freeze({ lancamento: Object.freeze(lancamento), diario: diario ? Object.freeze(diario) : null });
}

function normalizedStatus(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleUpperCase("pt-BR");
}

function g1OperationalMetricsMarkup(records = []) {
  const metric = (id, label, matcher, tone) => ({
    id,
    label,
    tone,
    count: records.filter(item => matcher(normalizedStatus(fieldValue(item.fields, ["CONCLUÍDO", "CONCLUIDO", "STATUS", "field_19"])))).length,
  });
  const statusMetrics = [
    metric("committed", "EMPENHADO", value => value === "PEDIDO EMPENHADO", "is-committed"),
    metric("settlement", "LIQUIDAÇÃO", value => value === "PEDIDO EM LIQUIDACAO", "is-settlement"),
    metric("delivery", "PA", value => value === "PA - PENDENTE ENTREGA", "is-delivery"),
    metric("paid", "PAGO", value => value === "PEDIDO FINALIZADO", "is-paid"),
  ];
  const recordTotal = item => {
    const fields = item.fields || {};
    return (numberValue(fieldValue(fields, ["VALOR UNITÁRIO", "VALORUNITARIO", "field_9"])) * numberValue(fieldValue(fields, ["QUANTIDADE", "field_8"])))
      + numberValue(fieldValue(fields, ["FRETE", "field_10"]));
  };
  const hasDate = (item, names) => Boolean(fieldValue(item.fields || {}, names));
  const hasExpectedPayment = item => hasDate(item, ["DATA PGTO PREVISTO", "DATAPGTOPREVISTO", "field_3"]);
  const hasEffectivePayment = item => hasDate(item, ["DATA PGTO EFETUADO", "DATAPGTOEFETUADO", "field_4"]);
  const sumRecords = matcher => records.reduce((sum, item) => matcher(item) ? sum + recordTotal(item) : sum, 0);
  const financialMetrics = [
    { id: "paid-total", label: "TOTAL", value: sumRecords(hasEffectivePayment), tone: "is-paid-total", title: "Total com data de pagamento efetuado" },
    { id: "commitment", label: "EMPENHO", value: sumRecords(item => !hasExpectedPayment(item) && !hasEffectivePayment(item)), tone: "is-commitment" },
    { id: "settled", label: "LIQUIDADO", value: sumRecords(item => hasExpectedPayment(item) && !hasEffectivePayment(item)), tone: "is-settled" },
    { id: "pending", label: "PENDENTE", value: sumRecords(item => !hasEffectivePayment(item)), tone: "is-pending", title: "Total ainda sem data de pagamento efetuado" },
    { id: "all-total", label: "TOTAL", value: sumRecords(() => true), tone: "is-all-total", title: "Total geral dos lançamentos filtrados" },
  ];
  return `<section class="g1-metrics" aria-label="Resumo dos lançamentos">
    <div class="g1-value-metrics">${financialMetrics.map(item => `<article class="g1-value-metric ${item.tone}"${item.title ? ` title="${escapeHtml(item.title)}"` : ""}><span>${item.label}</span><strong>${escapeHtml(currencyValue(item.value))}</strong></article>`).join("")}</div>
    <div class="g1-status-metrics">${statusMetrics.map(item => `<article class="g1-status-metric ${item.tone}"><span>${item.label}</span><strong>${item.count}</strong></article>`).join("")}<article class="g1-status-metric is-total"><span>TOTAL</span><strong>${records.length}</strong></article></div>
  </section>`;
}

function g1OperationalBarMarkup(records = []) {
  return `<section class="g1-operational-bar" aria-label="Ações da Galeria G1">
    <div class="g1-operational-actions">
      <a class="g1-action is-primary" data-g1-action="new-launch" href="#/entity/lancamentos/new" title="Criar novo lançamento"><span aria-hidden="true">+</span><strong>Novo lançamento</strong></a>
      <button class="g1-action" type="button" data-g1-action="field-visit" title="Criar visita em campo"><span aria-hidden="true">VC</span><strong>Visita em campo</strong></button>
      <a class="g1-action" data-g1-action="presence" href="#/entity/presencas/new" title="Registrar presença"><span aria-hidden="true">PR</span><strong>Presença</strong></a>
      <a class="g1-action" data-g1-action="presence-description" href="#/entity/descricoes-de-presenca/new" title="Registrar descritivo de presença"><span aria-hidden="true">DP</span><strong>Descritivo</strong></a>
      <button class="g1-action" type="button" data-g1-action="refresh" title="Atualizar dados do SharePoint"><span aria-hidden="true">↻</span><strong>Atualizar</strong></button>
    </div>
    ${g1OperationalMetricsMarkup(records)}
  </section>`;
}

function g1FieldVisitDialogMarkup(filters = []) {
  const filialFilter = filters.find(filter => filter.name === "FILIAL");
  const options = (filialFilter?.options || []).map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("");
  return `<dialog class="g1-field-visit-dialog" data-g1-field-visit-dialog aria-labelledby="g1FieldVisitTitle">
    <form method="dialog" data-g1-field-visit-form>
      <header><div><p class="page-eyebrow">G1 · Histórico de lançamentos</p><h2 id="g1FieldVisitTitle">Criar visita em campo</h2></div><button type="button" class="button-secondary" data-g1-field-visit-close aria-label="Fechar">Fechar</button></header>
      <div class="g1-field-visit-grid">
        <label>Filial<select name="filial" required><option value="">Selecione a filial</option>${options}</select></label>
        <label>Valor da visita<input name="valor" type="text" inputmode="decimal" placeholder="0,00" required></label>
      </div>
      <label class="dynamic-check"><input name="createDiary" type="checkbox" checked> Criar também o diário de obras pendente</label>
      <p class="entity-note">O lançamento será gravado como VISITA EM CAMPO e PEDIDO FINALIZADO.</p>
      <p class="entity-toast is-error" data-g1-field-visit-error role="alert"></p>
      <footer><button class="button-secondary" type="button" data-g1-field-visit-cancel>Cancelar</button><button class="button-primary" type="submit">Cadastrar visita</button></footer>
    </form>
  </dialog>`;
}

function lancamentosGalleryResultsMarkup(entity, data, state, actions, records) {
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
  const cards = records.map(item => {
    const fields = item.fields || {};
    const filial = fieldValue(fields, ["FILIAL", "Title"]);
    const tipo = fieldValue(fields, ["TIPO TRANSAÇÃO", "TIPOTRANSACAO", "field_1"]);
    const dataLancamento = fieldValue(fields, ["DATA", "field_2"]);
    const fornecedor = fieldValue(fields, ["FORNECEDOR", "field_5"]);
    const etapa = fieldValue(fields, ["ETAPA", "field_6"]);
    const produto = fieldValue(fields, ["PRODUTO", "field_7"]);
    const quantidade = fieldValue(fields, ["QUANTIDADE", "field_8"]);
    const valorUnitario = fieldValue(fields, ["VALOR UNITÁRIO", "VALORUNITARIO", "field_9"]);
    const frete = fieldValue(fields, ["FRETE", "field_10"]);
    const previsto = fieldValue(fields, ["DATA PGTO PREVISTO", "DATAPGTOPREVISTO", "field_3"]);
    const efetivado = fieldValue(fields, ["DATA PGTO EFETUADO", "DATAPGTOEFETUADO", "field_4"]);
    const rms = fieldValue(fields, ["DATA RMS", "DATARMS", "field_20"]);
    const concluido = fieldValue(fields, ["CONCLUÍDO", "CONCLUIDO", "STATUS", "field_19"]);
    const descricao = fieldValue(fields, ["DESCRIÇÃO", "DESCRICAO", "field_16"]);
    const conta = fieldValue(fields, ["CONTA", "field_11"]);
    const idPedido = fieldValue(fields, ["ID PEDIDO", "IDPEDIDO", "ID 2", "field_18"]);
    const aprovacao = fieldValue(fields, ["APROVACAO", "APROVAÇÃO"]);
    const criadoPor = taskDisplayValue(fieldValue(fields, ["Criado por", "Author"])) || taskDisplayValue(item.createdBy?.user || item.createdBy);
    const criado = fieldValue(fields, ["Criado", "Created"]);
    const modificadoPor = taskDisplayValue(fieldValue(fields, ["Modificado por", "Editor"])) || taskDisplayValue(item.lastModifiedBy?.user || item.lastModifiedBy);
    const modificado = fieldValue(fields, ["Modificado", "Modified"]);
    const criadoPorHistorico = String(criadoPor || "-").toLocaleUpperCase("pt-BR");
    const modificadoPorHistorico = String(modificadoPor || "-").toLocaleUpperCase("pt-BR");
    const foiModificado = hasPowerAppsModification(criado, modificado);
    const total = (numberValue(valorUnitario) * numberValue(quantidade)) + numberValue(frete);
    const attachmentHint = itemHasGalleryAttachment(item);
    return `<article class="g1-list-row ${lancamentoStatusClass(concluido)}">
      <div class="g1-row-file">
        ${galleryAttachmentActionMarkup(entity, item, { prominent: true })}
        <strong class="g1-row-id">${escapeHtml(item.id || "-")}</strong>
        <span data-gallery-attachment-summary="${escapeHtml(item.id || "")}">${attachmentHint ? "COM ANEXOS" : "SEM ANEXOS"}</span>
      </div>
      <div class="g1-row-main">
        <div class="g1-row-title"><strong>PRODUTO: ${escapeHtml(produto || "-")}</strong><strong>ETAPA OBRA: ${escapeHtml(etapa || "-")}</strong></div>
        <div class="g1-row-flow">
          <div class="g1-row-financial">
            ${g1DataLine("FORNECEDOR", fornecedor)}
            ${g1DataLine("FILIAL", filial)}
            ${g1DataLine("VALOR UNITÁRIO", currencyValue(valorUnitario))}
            ${g1DataLine("QUANTIDADE", quantidade)}
            ${g1DataLine("FRETE", currencyValue(frete))}
            ${g1DataLine("VALOR TOTAL", currencyValue(total), "is-total")}
            ${g1DataLine("ID PEDIDO", idPedido)}
          </div>
          <div class="g1-row-history">
            ${g1DataLine("ADICIONADO POR", `${criadoPorHistorico} EM ${shortDateTimeValue(criado)}`, "is-created")}
            ${foiModificado
              ? g1DataLine("MODIFICADO POR", `${modificadoPorHistorico} EM ${shortDateTimeValue(modificado)}`, "is-modified")
              : '<p class="is-unchanged"><strong>SEM MODIFICAÇÕES APÓS CRIAÇÃO</strong></p>'}
            ${g1DataLine("TIPO DE OPERAÇÃO", tipo)}
            ${g1DataLine("FORMA PGTO", conta)}
            <strong class="g1-approval">${escapeHtml(aprovacao || "SEM AVALIAÇÃO")}</strong>
          </div>
        </div>
        ${descricao ? `<p class="g1-row-description"><span>DESCRIÇÃO:</span> ${escapeHtml(descricao)}</p>` : ""}
      </div>
      <aside class="g1-row-side">
        <strong class="g1-row-status">${escapeHtml(concluido || "SEM STATUS")}</strong>
        ${g1DataLine("DATA DE RMS", shortDateValue(rms), "is-rms")}
        ${g1DataLine("DATA DE COMPRA", shortDateValue(dataLancamento), "is-purchase-date")}
        ${g1DataLine("DATA DE LIQUIDAÇÃO", shortDateValue(previsto), "is-settlement-date")}
        ${g1DataLine("DATA DE PAGAMENTO", shortDateValue(efetivado), "is-payment-date")}
        <div class="entity-row-actions g1-row-actions">${entityRowActionsMarkup(entity, item, actions, { includeAttachment: false })}</div>
      </aside>
    </article>`;
  }).join("");
  return `<div class="lancamentos-gallery">${cards || `<p class="entity-empty">${emptyMessage}</p>`}</div>
    <nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(batchState)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav>`;
}

function taskDaysBetween(startValue, endValue = new Date()) {
  const start = new Date(startValue || "");
  const end = new Date(endValue || "");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
}

function taskDeadlineLabel(fatalValue, conclusionValue) {
  if (!fatalValue) return "ATIVIDADE NÃO PRIORIZADA";
  if (conclusionValue) return "";
  const fatal = new Date(fatalValue);
  if (Number.isNaN(fatal.getTime())) return "";
  const days = Math.round((fatal.getTime() - Date.now()) / 86400000);
  if (days < 0) return `VENCIDO HÁ ${Math.abs(days)} DIAS`;
  if (days === 0) return "VENCE HOJE";
  if (days === 1) return "VENCE AMANHÃ";
  return `VENCE EM ${days} DIAS`;
}

function taskStatusClass(priority, conclusion, fatal) {
  if (conclusion) return "is-done";
  if (priority === "ATIVIDADE EMERGENCIAL") return "is-critical";
  if (fatal && taskDeadlineLabel(fatal, conclusion).startsWith("VENCIDO")) return "is-pending";
  return "is-neutral";
}

function taskField(label, value, options = {}) {
  const displayValue = taskDisplayValue(value);
  const content = displayValue === "" ? "-" : displayValue;
  return `<div class="lancamentos-field${options.wide ? " is-wide" : ""}${options.strong ? " is-strong" : ""}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(content)}</strong></div>`;
}

function tarefasGalleryResultsMarkup(entity, data, state, actions, records) {
  const activeFilters = hasActiveEntityFilters(state);
  const limitations = data.query?.limitations || [];
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore
    ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido`
    : data.items.hasMore ? "há mais resultados" : "fim da lista";
  const emptyMessage = limitations.length
    ? "A consulta não foi executada para evitar percorrer a lista inteira."
    : activeFilters ? "Nenhuma tarefa corresponde aos filtros selecionados." : "Nenhuma tarefa foi cadastrada nesta lista.";
  const cards = records.map(item => {
    const fields = item.fields || {};
    const tarefa = fieldValue(fields, ["TAREFA", "field_11"]);
    const filial = fieldValue(fields, ["FILIAL", "field_4"]);
    const associacao = fieldValue(fields, ["ASSOCIAÇÃO", "field_10"]);
    const inicio = fieldValue(fields, ["DATA INÍCIO", "DATAINÍCIO", "field_6"]);
    const fatal = fieldValue(fields, ["DATA FATAL", "DATAFATAL", "field_7"]);
    const conclusao = fieldValue(fields, ["DATA CONCLUSÃO", "DATACONCLUSÃO", "field_8"]);
    const identificacao = fieldValue(fields, ["DATA IDENTIFICAÇÃO", "DATAIDENTIFICAÇÃO", "field_5"]);
    const prioridade = fieldValue(fields, ["PRIORITÁRIA", "PRIORIT_x00c1_RIA"]);
    const cobrar = fieldValue(fields, ["COBRAR"]);
    const observacoes = fieldValue(fields, ["OBSERVAÇÕES CONCLUSÃO", "OBSERVA_x00c7__x00d5_ESCONCLUS_x"]);
    const criadoPor = fieldValue(fields, ["Criado por", "Author"]);
    const criado = fieldValue(fields, ["Criado", "Created"]);
    const modificadoPor = fieldValue(fields, ["Modificado por", "Editor"]);
    const modificado = fieldValue(fields, ["Modificado", "Modified"]);
    const anexos = fieldValue(fields, ["Tem anexos", "Anexos", "Attachments"]);
    const deadline = taskDeadlineLabel(fatal, conclusao);
    const elapsed = conclusao
      ? `CONCLUÍDO EM ${shortDateValue(conclusao)} (${taskDaysBetween(identificacao, conclusao)} DIAS GASTOS)`
      : identificacao ? `CRIADO HÁ ${taskDaysBetween(identificacao)} DIAS` : "";
    return `<article class="lancamentos-card tarefas-card ${taskStatusClass(prioridade, conclusao, fatal)}">
      <div class="lancamentos-card-head">
        <div><span class="lancamentos-id">ID ${escapeHtml(item.id || "-")}</span><h2>${escapeHtml(String(tarefa || "TAREFA SEM DESCRIÇÃO").toLocaleUpperCase("pt-BR"))}</h2></div>
        <div class="lancamentos-head-actions"><span class="lancamentos-status">${escapeHtml(conclusao ? "CONCLUÍDO" : prioridade || "NÃO PRIORITÁRIA")}</span><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></div>
      </div>
      <div class="lancamentos-primary-grid">
        ${taskField("FILIAL", filial, { strong: true })}
        ${taskField("ASSOCIAÇÃO", associacao)}
        ${taskField("ID", item.id)}
        ${taskField("PRAZO", deadline, { strong: true })}
      </div>
      <div class="lancamentos-detail-grid">
        ${taskField("DATA IDENTIFICAÇÃO", shortDateValue(identificacao))}
        ${taskField("DATA INÍCIO", shortDateValue(inicio))}
        ${taskField("DATA FATAL", shortDateValue(fatal))}
        ${taskField("DATA CONCLUSÃO", shortDateValue(conclusao))}
        ${taskField("TEMPO DE EXECUÇÃO", elapsed)}
        ${taskField("COBRAR", cobrar)}
        ${taskField("ANEXOS", anexos || "SEM ANEXOS")}
        ${taskField("OBSERVAÇÕES CONCLUSÃO", observacoes, { wide: true })}
        ${taskField("CRIADO POR", criadoPor)}
        ${taskField("CRIADO EM", shortDateValue(criado))}
        ${taskField("MODIFICADO POR", modificadoPor)}
        ${taskField("MODIFICADO EM", shortDateValue(modificado))}
      </div>
    </article>`;
  }).join("");
  return `<div class="tarefas-gallery">${cards || `<p class="entity-empty">${escapeHtml(emptyMessage)}</p>`}</div>
    <nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav>`;
}

function delegatedTaskScore(difficulty, impact, urgency) {
  const levels = new Map([
    ["MUITO ALTA DIFICULDADE", 5], ["ALTA DIFICULDADE", 4], ["MÉDIA DIFICULDADE", 3],
    ["BAIXA DIFICULDADE", 2], ["MUITO BAIXA DIFICULDADE", 1],
    ["ALTO IMPACTO", 5], ["MÉDIO IMPACTO", 3], ["BAIXO IMPACTO", 1],
    ["ALTA URGÊNCIA", 5], ["MÉDIA URGÊNCIA", 3], ["BAIXA URGÊNCIA", 1],
  ]);
  const value = (item) => levels.get(String(item || "").trim().toLocaleUpperCase("pt-BR")) || 1;
  return Math.round(Math.cbrt(value(difficulty) * value(impact) * value(urgency)));
}

function tarefasDelegadasGalleryResultsMarkup(entity, data, state, actions, records) {
  const activeFilters = hasActiveEntityFilters(state);
  const limitations = data.query?.limitations || [];
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore
    ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido`
    : data.items.hasMore ? "há mais resultados" : "fim da lista";
  const emptyMessage = limitations.length
    ? "A consulta não foi executada para evitar percorrer a lista inteira."
    : activeFilters ? "Nenhuma delegação corresponde aos filtros selecionados." : "Nenhuma tarefa delegada foi cadastrada nesta lista.";
  const cards = records.map(item => {
    const fields = item.fields || {};
    const prioridade = fieldValue(fields, ["PRIORITÁRIA", "PRIORIT_x00c1_RIA"]);
    const conclusao = fieldValue(fields, ["DATA CONCLUSAO", "DATA CONCLUSÃO", "DATACONCLUSAO0"]);
    const concluido = fieldValue(fields, ["CONCLUÍDO", "CONCLU_x00cd_DO"]);
    const identificacao = fieldValue(fields, ["DATAIDENTIFICACAO", "DATA IDENTIFICAÇÃO"]);
    const inicio = fieldValue(fields, ["DATA INÍCIO", "DATAIN_x00cd_CIO"]);
    const fatal = fieldValue(fields, ["DATA FATAL", "DATAFATAL"]);
    const tarefa = fieldValue(fields, ["TAREFA", "Title"]);
    const filial = fieldValue(fields, ["FILIAL"]);
    const associacao = fieldValue(fields, ["ASSOCIAÇÃO", "ASSOCIACAO"]);
    const responsavel = fieldValue(fields, ["RESPONSÁVEL", "RESPONS_x00c1_VEL"]);
    const dificuldade = fieldValue(fields, ["DIFICULDADE"]);
    const impacto = fieldValue(fields, ["IMPACTO"]);
    const urgencia = fieldValue(fields, ["URGENCIA"]);
    const recorrencia = fieldValue(fields, ["RECORRENCIA"]);
    const anexos = fieldValue(fields, ["Tem anexos", "Anexos", "Attachments"]);
    const criadoPor = fieldValue(fields, ["Criado por", "Author"]);
    const criado = fieldValue(fields, ["Criado", "Created"]);
    const modificadoPor = fieldValue(fields, ["Modificado por", "Editor"]);
    const modificado = fieldValue(fields, ["Modificado", "Modified"]);
    const completed = Boolean(conclusao) || ["CONCLUÍDO", "CONCLUIDO"].includes(String(concluido).trim().toLocaleUpperCase("pt-BR"));
    const deadline = taskDeadlineLabel(fatal, conclusao);
    const elapsed = completed && conclusao
      ? `CONCLUÍDO EM ${shortDateValue(conclusao)} (${taskDaysBetween(identificacao, conclusao)} DIAS GASTOS)`
      : identificacao ? `CRIADO HÁ ${taskDaysBetween(inicio || identificacao)} DIAS` : "";
    const score = delegatedTaskScore(dificuldade, impacto, urgencia);
    return `<article class="lancamentos-card tarefas-card tarefas-delegadas-card ${taskStatusClass(prioridade, completed ? "sim" : "", fatal)}">
      <div class="lancamentos-card-head">
        <div><span class="lancamentos-id">ID ${escapeHtml(item.id || "-")}${fieldValue(fields, ["ID 2", "OData__x0049_D2"]) ? ` · ${escapeHtml(taskDisplayValue(fieldValue(fields, ["ID 2", "OData__x0049_D2"])))}` : ""}</span><h2>${escapeHtml(String(tarefa || "TAREFA SEM DESCRIÇÃO").toLocaleUpperCase("pt-BR"))}</h2></div>
        <div class="lancamentos-head-actions"><span class="lancamentos-status">${escapeHtml(completed ? "CONCLUÍDO" : prioridade || "NÃO PRIORITÁRIA")}</span><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></div>
      </div>
      <div class="lancamentos-primary-grid">
        ${taskField("FILIAL", filial, { strong: true })}
        ${taskField("ASSOCIAÇÃO", associacao)}
        ${taskField("RESPONSÁVEL", responsavel)}
        ${taskField("PRAZO", deadline, { strong: true })}
      </div>
      <div class="lancamentos-detail-grid">
        ${taskField("DATA IDENTIFICAÇÃO", shortDateValue(identificacao))}
        ${taskField("DATA INÍCIO", shortDateValue(inicio))}
        ${taskField("DATA FATAL", shortDateValue(fatal))}
        ${taskField("DATA CONCLUSÃO", shortDateValue(conclusao))}
        ${taskField("STATUS", concluido || (completed ? "CONCLUÍDO" : ""))}
        ${taskField("TEMPO DE EXECUÇÃO", elapsed)}
        ${taskField("DIFICULDADE", dificuldade)}
        ${taskField("IMPACTO", impacto)}
        ${taskField("URGÊNCIA", urgencia)}
        ${taskField("PONTUAÇÃO", score)}
        ${taskField("RECORRÊNCIA", recorrencia)}
        ${taskField("ANEXOS", anexos || "SEM ANEXOS")}
        ${taskField("CRIADO POR", criadoPor)}
        ${taskField("CRIADO EM", shortDateValue(criado))}
        ${taskField("MODIFICADO POR", modificadoPor)}
        ${taskField("MODIFICADO EM", shortDateValue(modificado))}
      </div>
    </article>`;
  }).join("");
  return `<div class="tarefas-gallery">${cards || `<p class="entity-empty">${escapeHtml(emptyMessage)}</p>`}</div>
    <nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav>`;
}

function tarefasRecorrentesGalleryResultsMarkup(entity, data, state, actions, records) {
  const activeFilters = hasActiveEntityFilters(state);
  const limitations = data.query?.limitations || [];
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore
    ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido`
    : data.items.hasMore ? "há mais resultados" : "fim da lista";
  const emptyMessage = limitations.length
    ? "A consulta não foi executada para evitar percorrer a lista inteira."
    : activeFilters ? "Nenhuma tarefa recorrente corresponde aos filtros selecionados." : "Nenhuma tarefa recorrente foi cadastrada nesta lista.";
  const cards = records.map(item => {
    const fields = item.fields || {};
    const tarefa = fieldValue(fields, ["TAREFA", "Title"]);
    const fornecedor = fieldValue(fields, ["FORNECEDOR"]);
    const associacao = fieldValue(fields, ["ASSOCIAÇÃO", "ASSOCIA_x00c7__x00c3_O"]);
    const prioridade = fieldValue(fields, ["PRIORITARIA"]);
    const status = fieldValue(fields, ["STATUS"]);
    const cobrar = fieldValue(fields, ["COBRAR"]);
    const filial = fieldValue(fields, ["FILIAL"]);
    const data = fieldValue(fields, ["DATA"]);
    const proximaCriacao = fieldValue(fields, ["DATACRIARNOVAMENTE"]);
    const proximoVencimento = fieldValue(fields, ["DATAVENCIMENTO"]);
    const recorrencia = fieldValue(fields, ["RECORRENCIA"]);
    const criadoPor = fieldValue(fields, ["Criado por", "Author"]);
    const criado = fieldValue(fields, ["Criado", "Created"]);
    const modificadoPor = fieldValue(fields, ["Modificado por", "Editor"]);
    const modificado = fieldValue(fields, ["Modificado", "Modified"]);
    const anexos = fieldValue(fields, ["Tem anexos", "Anexos", "Attachments"]);
    const statusClass = String(status || "").toLocaleUpperCase("pt-BR") === "INATIVO" ? "is-pending" : "is-done";
    return `<article class="lancamentos-card tarefas-card tarefas-recorrentes-card ${statusClass}">
      <div class="lancamentos-card-head">
        <div><span class="lancamentos-id">ID ${escapeHtml(item.id || "-")}</span><h2>${escapeHtml(String(tarefa || "TAREFA SEM DESCRIÇÃO").toLocaleUpperCase("pt-BR"))}</h2></div>
        <div class="lancamentos-head-actions"><span class="lancamentos-status">${escapeHtml(status || "SEM STATUS")}</span><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></div>
      </div>
      <div class="lancamentos-primary-grid">
        ${taskField("FORNECEDOR", fornecedor, { strong: true })}
        ${taskField("ASSOCIAÇÃO", associacao)}
        ${taskField("FILIAL", filial)}
        ${taskField("PRIORIDADE", prioridade, { strong: true })}
      </div>
      <div class="lancamentos-detail-grid">
        ${taskField("DATA INÍCIO", shortDateValue(data))}
        ${taskField("DATA PRÓXIMA CRIAÇÃO", shortDateValue(proximaCriacao))}
        ${taskField("DATA PRÓXIMO VENCIMENTO", shortDateValue(proximoVencimento))}
        ${taskField("RECORRÊNCIA", recorrencia)}
        ${taskField("COBRAR", cobrar)}
        ${taskField("ANEXOS", anexos || "SEM ANEXOS")}
        ${taskField("CRIADO POR", criadoPor)}
        ${taskField("CRIADO EM", shortDateValue(criado))}
        ${taskField("MODIFICADO POR", modificadoPor)}
        ${taskField("MODIFICADO EM", shortDateValue(modificado))}
      </div>
    </article>`;
  }).join("");
  return `<div class="tarefas-gallery">${cards || `<p class="entity-empty">${escapeHtml(emptyMessage)}</p>`}</div>
    <nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav>`;
}

function associacoesGalleryResultsMarkup(entity, data, state, actions, records) {
  const activeFilters = hasActiveEntityFilters(state);
  const limitations = data.query?.limitations || [];
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore
    ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido`
    : data.items.hasMore ? "há mais resultados" : "fim da lista";
  const emptyMessage = limitations.length
    ? "A consulta não foi executada para evitar percorrer a lista inteira."
    : activeFilters ? "Nenhuma associação corresponde aos filtros selecionados." : "Nenhuma associação foi cadastrada nesta lista.";
  const cards = records.map(item => {
    const fields = item.fields || {};
    const associacao = fieldValue(fields, ["ASSOCIAÇÃO", "ASSOCIACAO", "field_1"]);
    const status = fieldValue(fields, ["STATUS", "Title"]);
    const tipo = fieldValue(fields, ["TIPO"]);
    const criadoPor = fieldValue(fields, ["Criado por", "Author"]);
    const criado = fieldValue(fields, ["Criado", "Created"]);
    const modificadoPor = fieldValue(fields, ["Modificado por", "Editor"]);
    const modificado = fieldValue(fields, ["Modificado", "Modified"]);
    const changed = criado && modificado && new Date(modificado).getTime() - new Date(criado).getTime() > 5000;
    return `<article class="lancamentos-card associacao-card ${String(status).toLocaleUpperCase("pt-BR") === "INATIVO" ? "is-pending" : "is-done"}">
      <div class="lancamentos-card-head">
        <div><span class="lancamentos-id">ID ${escapeHtml(item.id || "-")}</span><h2>${escapeHtml(String(associacao || "ASSOCIAÇÃO SEM NOME").toLocaleUpperCase("pt-BR"))}</h2></div>
        <div class="lancamentos-head-actions"><span class="lancamentos-status">${escapeHtml(status || "SEM STATUS")}</span><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></div>
      </div>
      <div class="lancamentos-primary-grid">
        ${taskField("TIPO", tipo, { strong: true })}
        ${taskField("STATUS", status)}
      </div>
      <div class="lancamentos-detail-grid">
        ${taskField("ADICIONADO POR", criadoPor)}
        ${taskField("ADICIONADO EM", shortDateValue(criado))}
        ${taskField("HISTÓRICO", changed ? `MODIFICADO POR ${taskDisplayValue(modificadoPor)} EM ${shortDateValue(modificado)}` : "SEM MODIFICAÇÕES APÓS CRIAÇÃO", { wide: true })}
      </div>
    </article>`;
  }).join("");
  return `<div class="tarefas-gallery associacoes-gallery">${cards || `<p class="entity-empty">${escapeHtml(emptyMessage)}</p>`}</div>
    <nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav>`;
}

function entityGalleryResultsMarkup(entity, data, state, actions) {
  const contract = data.uiContract || resolvePowerAppsUiContract(entity, data.columns);
  const visibleColumns = contract.galleryColumns;
  const queryEntity = galleryQueryEntity(entity, contract);
  const records = data.items.items;
  const metrics = galleryMetricClustersMarkup(data.metricItems || records);
  if (entity.id === "lancamentos") return metrics + lancamentosGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "lancamentos-de-tarefas") return metrics + tarefasGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "tarefas-delegadas") return metrics + tarefasDelegadasGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "tarefas-recorrentes") return metrics + tarefasRecorrentesGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "cadastro-de-tarefas") return metrics + associacoesGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "notas-pendentes") return metrics + notasPendentesGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "provisoes-de-pagamento") return metrics + provisoesGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "despesas-recorrentes") return metrics + despesasRecorrentesGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "cadastro-de-grupos") return metrics + gruposGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "familias") return metrics + familiasGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "cadastro-de-subfamilias") return metrics + subfamiliasGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "produtos") return metrics + produtosGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "unidades-de-medida") return metrics + unidadesMedidaGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "contas") return metrics + contasGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "fornecedores") return metrics + fornecedoresGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "filiais") return metrics + filiaisGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "imoveis") return metrics + imoveisGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "cidades") return metrics + cidadesGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "tipos-de-material") return metrics + tiposMaterialGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "grupos-de-imobilizados") return metrics + gruposImobilizadosGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "cadastro-de-imobilizados") return metrics + cadastroImobilizadosGalleryResultsMarkup(entity, data, state, actions, records);
  if (entity.id === "imobilizados") return metrics + imobilizadosGalleryResultsMarkup(entity, data, state, actions, records);
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
  return `${metrics}<div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columnHeaders(queryEntity, data.columns, visibleColumns, state)}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => {
    const selected = String(state.selectedItemId || "") === String(item.id || "");
    return `<tr${selected ? ' class="is-selected" data-entity-selected="true" aria-current="true"' : ""}>${visibleColumns.map(column => `<td data-label="${escapeHtml(column.label)}">${escapeHtml(formatGalleryValue(item.fields, column))}</td>`).join("")}<td class="entity-row-action"><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></td></tr>`;
  }).join("") || `<tr><td colspan="${visibleColumns.length + 1}" class="entity-empty">${emptyMessage}</td></tr>`}</tbody></table></div>
    <nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(batchState)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav>`;
}

function provisoesGalleryResultsMarkup(entity, data, state, actions, records) {
  const columns = [
    ["ID", "ID"], ["FORNECEDOR", "FORNECEDOR"], ["DATA", "DATA"],
    ["DATAPREVISTOPGTO", "DATA PREVISTO PGTO"], ["DATAPGTOEFETUADO", "DATA PGTO EFETUADO"],
    ["FILIAL", "FILIAL"], ["IMOVEL", "IMOVEL"], ["PRODUTO", "PRODUTO"],
    ["VALORTOTAL", "VALOR TOTAL"], ["TIPO", "TIPO"], ["STATUS", "STATUS"],
    ["PGTOAGENDADO", "PAGAMENTO"], ["Tem anexos", "ANEXOS"],
  ];
  const columnMap = new Map((data.columns || []).map(column => [column.name, column]));
  const value = (item, name) => name === "ID" ? item.id : formatGalleryValue(item.fields, columnMap.get(name) || { name, label: name });
  const activeFilters = hasActiveEntityFilters(state);
  const emptyMessage = data.query?.limitations?.length
    ? "A consulta não foi executada para evitar percorrer a lista inteira."
    : activeFilters ? "Nenhuma provisão corresponde aos filtros selecionados." : "Nenhuma provisão de pagamento foi cadastrada nesta lista.";
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido` : data.items.hasMore ? "há mais resultados" : "fim da lista";
  return `<div class="provisoes-gallery"><div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columns.map(([, label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr${String(state.selectedItemId || "") === String(item.id || "") ? ' class="is-selected" data-entity-selected="true" aria-current="true"' : ""}>${columns.map(([name, label]) => `<td data-label="${escapeHtml(label)}">${escapeHtml(value(item, name) || "-")}</td>`).join("")}<td class="entity-row-action"><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></td></tr>`).join("") || `<tr><td colspan="${columns.length + 1}" class="entity-empty">${emptyMessage}</td></tr>`}</tbody></table></div><nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav></div>`;
}

function despesasRecorrentesGalleryResultsMarkup(entity, data, state, actions, records) {
  const columns = [["ID", "ID"], ["STATUS", "STATUS"], ["DATAINICIO", "DATA INÍCIO"], ["DATAFIM", "DATA FIM"], ["EQUIPAMENTO", "EQUIPAMENTO"], ["IMOVEL", "IMÓVEL"], ["FILIAL", "FILIAL"], ["FORNECEDOR", "FORNECEDOR"], ["VALORMENSAL", "VALOR MENSAL"], ["FORMAPGTO", "FORMA PGTO"], ["RESPONSAVELLOCACAO", "RESPONSÁVEL PGTO"], ["RECORRENCIA", "RECORRÊNCIA"], ["RECORRENCIADIAS", "DIAS"], ["Tem anexos", "ANEXOS"]];
  const columnMap = new Map((data.columns || []).map(column => [column.name, column]));
  const value = (item, name) => name === "ID" ? item.id : formatGalleryValue(item.fields, columnMap.get(name) || { name, label: name });
  const activeFilters = hasActiveEntityFilters(state);
  const emptyMessage = data.query?.limitations?.length ? "A consulta não foi executada para evitar percorrer a lista inteira." : activeFilters ? "Nenhuma despesa recorrente corresponde aos filtros selecionados." : "Nenhuma despesa recorrente foi cadastrada nesta lista.";
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido` : data.items.hasMore ? "há mais resultados" : "fim da lista";
  return `<div class="despesas-recorrentes-gallery"><div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columns.map(([, label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr${String(state.selectedItemId || "") === String(item.id || "") ? ' class="is-selected" data-entity-selected="true" aria-current="true"' : ""}>${columns.map(([name, label]) => `<td data-label="${escapeHtml(label)}">${escapeHtml(value(item, name) || "-")}</td>`).join("")}<td class="entity-row-action"><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></td></tr>`).join("") || `<tr><td colspan="${columns.length + 1}" class="entity-empty">${emptyMessage}</td></tr>`}</tbody></table></div><nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav></div>`;
}

function gruposGalleryResultsMarkup(entity, data, state, actions, records) {
  const columns = [["ID", "ID"], ["GRUPO", "GRUPO"], ["STATUS", "STATUS"], ["Criado por", "CRIADO POR"], ["Criado", "CRIADO EM"], ["Modificado", "MODIFICADO EM"], ["Modificado por", "MODIFICADO POR"]];
  const columnMap = new Map((data.columns || []).map(column => [column.name, column]));
  const value = (item, name) => name === "ID" ? item.id : formatGalleryValue(item.fields, columnMap.get(name) || { name, label: name });
  const activeFilters = hasActiveEntityFilters(state);
  const emptyMessage = data.query?.limitations?.length ? "A consulta não foi executada para evitar percorrer a lista inteira." : activeFilters ? "Nenhum grupo corresponde aos filtros selecionados." : "Nenhum grupo foi cadastrado nesta lista.";
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido` : data.items.hasMore ? "há mais resultados" : "fim da lista";
  return `<div class="grupos-gallery"><div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columns.map(([, label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr${String(state.selectedItemId || "") === String(item.id || "") ? ' class="is-selected" data-entity-selected="true" aria-current="true"' : ""}>${columns.map(([name, label]) => `<td data-label="${escapeHtml(label)}">${escapeHtml(value(item, name) || "-")}</td>`).join("")}<td class="entity-row-action"><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></td></tr>`).join("") || `<tr><td colspan="${columns.length + 1}" class="entity-empty">${emptyMessage}</td></tr>`}</tbody></table></div><nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav></div>`;
}

function familiasGalleryResultsMarkup(entity, data, state, actions, records) {
  const columns = [["ID", "ID"], ["FAMÍLIA", "FAMÍLIA"], ["Nome", "NOME"], ["GRUPO", "GRUPO"], ["STATUS", "STATUS"], ["Criado por", "CRIADO POR"], ["Criado", "CRIADO EM"], ["Modificado", "MODIFICADO EM"], ["Modificado por", "MODIFICADO POR"]];
  const columnMap = new Map((data.columns || []).map(column => [column.name, column]));
  const value = (item, name) => name === "ID" ? item.id : formatGalleryValue(item.fields, columnMap.get(name) || { name, label: name });
  const activeFilters = hasActiveEntityFilters(state);
  const emptyMessage = data.query?.limitations?.length ? "A consulta não foi executada para evitar percorrer a lista inteira." : activeFilters ? "Nenhuma família corresponde aos filtros selecionados." : "Nenhuma família foi cadastrada nesta lista.";
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido` : data.items.hasMore ? "há mais resultados" : "fim da lista";
  return `<div class="familias-gallery"><div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columns.map(([, label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr${String(state.selectedItemId || "") === String(item.id || "") ? ' class="is-selected" data-entity-selected="true" aria-current="true"' : ""}>${columns.map(([name, label]) => `<td data-label="${escapeHtml(label)}">${escapeHtml(value(item, name) || "-")}</td>`).join("")}<td class="entity-row-action"><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></td></tr>`).join("") || `<tr><td colspan="${columns.length + 1}" class="entity-empty">${emptyMessage}</td></tr>`}</tbody></table></div><nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav></div>`;
}

function subfamiliasGalleryResultsMarkup(entity, data, state, actions, records) {
  const columns = [["ID", "ID", ["ID"]], ["FAMÍLIA", "FAMÍLIA", ["FAMÍLIA", "FAMILIA"]], ["field_1", "SUBFAMÍLIA", ["field_1", "SUBFAMÍLIA", "SUBFAMÍLIAS CADASTRADAS"]], ["field_3", "UNIDADE", ["field_3", "UNIDADE"]], ["STATUS", "STATUS", ["STATUS"]], ["TIPO", "TIPO", ["TIPO"]], ["Criado por", "CRIADO POR", ["Criado por", "Author"]], ["Criado", "CRIADO EM", ["Criado", "Created"]], ["Modificado", "MODIFICADO EM", ["Modificado", "Modified"]], ["Modificado por", "MODIFICADO POR", ["Modificado por", "Editor"]]];
  const columnMap = new Map((data.columns || []).map(column => [column.name, column]));
  const value = (item, name, aliases = []) => {
    if (name === "ID") return item.id;
    const column = columnMap.get(name) || aliases.map(alias => columnMap.get(alias)).find(Boolean) || { name, label: name };
    return formatGalleryValue(item.fields, column);
  };
  const activeFilters = hasActiveEntityFilters(state);
  const emptyMessage = data.query?.limitations?.length ? "A consulta não foi executada para evitar percorrer a lista inteira." : activeFilters ? "Nenhuma subfamília corresponde aos filtros selecionados." : "Nenhuma subfamília foi cadastrada nesta lista.";
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido` : data.items.hasMore ? "há mais resultados" : "fim da lista";
  return `<div class="subfamilias-gallery"><div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columns.map(([, label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr${String(state.selectedItemId || "") === String(item.id || "") ? ' class="is-selected" data-entity-selected="true" aria-current="true"' : ""}>${columns.map(([name, label, aliases]) => `<td data-label="${escapeHtml(label)}">${escapeHtml(value(item, name, aliases) || "-")}</td>`).join("")}<td class="entity-row-action"><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></td></tr>`).join("") || `<tr><td colspan="${columns.length + 1}" class="entity-empty">${emptyMessage}</td></tr>`}</tbody></table></div><nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav></div>`;
}

function produtosGalleryResultsMarkup(entity, data, state, actions, records) {
  const columns = [["ID", "ID", ["ID"]], ["PRODUTO", "PRODUTO", ["PRODUTO", "Title"]], ["SUBFAMÍLIA", "SUBFAMÍLIA", ["SUBFAMÍLIA", "SUBFAMILIA"]], ["STATUS", "STATUS", ["STATUS"]], ["TIPO", "TIPO", ["TIPO"]], ["GERADESEMBOLSO", "GERA DESEMBOLSO", ["GERADESEMBOLSO"]], ["TIPODESPESA", "TIPO DE DESPESA", ["TIPODESPESA"]], ["Criado por", "CRIADO POR", ["Criado por", "Author"]], ["Criado", "CRIADO EM", ["Criado", "Created"]], ["Modificado", "MODIFICADO EM", ["Modificado", "Modified"]], ["Modificado por", "MODIFICADO POR", ["Modificado por", "Editor"]], ["Tem anexos", "ANEXOS", ["Tem anexos"]]];
  const columnMap = new Map((data.columns || []).map(column => [column.name, column]));
  const value = (item, name, aliases = []) => {
    if (name === "ID") return item.id;
    const column = columnMap.get(name) || aliases.map(alias => columnMap.get(alias)).find(Boolean) || { name, label: name };
    return formatGalleryValue(item.fields, column);
  };
  const activeFilters = hasActiveEntityFilters(state);
  const emptyMessage = data.query?.limitations?.length ? "A consulta não foi executada para evitar percorrer a lista inteira." : activeFilters ? "Nenhum produto corresponde aos filtros selecionados." : "Nenhum produto foi cadastrado nesta lista.";
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido` : data.items.hasMore ? "há mais resultados" : "fim da lista";
  return `<div class="produtos-gallery"><div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columns.map(([, label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr${String(state.selectedItemId || "") === String(item.id || "") ? ' class="is-selected" data-entity-selected="true" aria-current="true"' : ""}>${columns.map(([name, label, aliases]) => `<td data-label="${escapeHtml(label)}">${escapeHtml(value(item, name, aliases) || "-")}</td>`).join("")}<td class="entity-row-action"><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></td></tr>`).join("") || `<tr><td colspan="${columns.length + 1}" class="entity-empty">${emptyMessage}</td></tr>`}</tbody></table></div><nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav></div>`;
}

function unidadesMedidaGalleryResultsMarkup(entity, data, state, actions, records) {
  const columns = [["ID", "ID", ["ID"]], ["Title", "UNIDADE MEDIDA", ["Title", "UNIDADE MEDIDA"]], ["STATUS", "STATUS", ["STATUS"]], ["Criado por", "CRIADO POR", ["Criado por", "Author"]], ["Criado", "CRIADO EM", ["Criado", "Created"]], ["Modificado", "MODIFICADO EM", ["Modificado", "Modified"]], ["Modificado por", "MODIFICADO POR", ["Modificado por", "Editor"]]];
  const columnMap = new Map((data.columns || []).map(column => [column.name, column]));
  const value = (item, name, aliases = []) => {
    if (name === "ID") return item.id;
    const column = columnMap.get(name) || aliases.map(alias => columnMap.get(alias)).find(Boolean) || { name, label: name };
    return formatGalleryValue(item.fields, column);
  };
  const activeFilters = hasActiveEntityFilters(state);
  const emptyMessage = data.query?.limitations?.length ? "A consulta não foi executada para evitar percorrer a lista inteira." : activeFilters ? "Nenhuma unidade corresponde aos filtros selecionados." : "Nenhuma unidade de medida foi cadastrada nesta lista.";
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido` : data.items.hasMore ? "há mais resultados" : "fim da lista";
  return `<div class="unidades-medida-gallery"><div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columns.map(([, label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr${String(state.selectedItemId || "") === String(item.id || "") ? ' class="is-selected" data-entity-selected="true" aria-current="true"' : ""}>${columns.map(([name, label, aliases]) => `<td data-label="${escapeHtml(label)}">${escapeHtml(value(item, name, aliases) || "-")}</td>`).join("")}<td class="entity-row-action"><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></td></tr>`).join("") || `<tr><td colspan="${columns.length + 1}" class="entity-empty">${emptyMessage}</td></tr>`}</tbody></table></div><nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav></div>`;
}

function contasGalleryResultsMarkup(entity, data, state, actions, records) {
  const columns = [["ID", "ID", ["ID"]], ["CONTA", "CONTA", ["CONTA", "Title"]], ["STATUS", "STATUS", ["STATUS"]], ["Tem anexos", "ANEXOS", ["Tem anexos"]], ["Criado por", "CRIADO POR", ["Criado por", "Author"]], ["Criado", "CRIADO EM", ["Criado", "Created"]], ["Modificado", "MODIFICADO EM", ["Modificado", "Modified"]], ["Modificado por", "MODIFICADO POR", ["Modificado por", "Editor"]]];
  const columnMap = new Map((data.columns || []).map(column => [column.name, column]));
  const value = (item, name, aliases = []) => {
    if (name === "ID") return item.id;
    const column = columnMap.get(name) || aliases.map(alias => columnMap.get(alias)).find(Boolean) || { name, label: name };
    return formatGalleryValue(item.fields, column);
  };
  const activeFilters = hasActiveEntityFilters(state);
  const emptyMessage = data.query?.limitations?.length ? "A consulta não foi executada para evitar percorrer a lista inteira." : activeFilters ? "Nenhuma conta corresponde aos filtros selecionados." : "Nenhuma conta foi cadastrada nesta lista.";
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido` : data.items.hasMore ? "há mais resultados" : "fim da lista";
  return `<div class="contas-gallery"><div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columns.map(([, label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr${String(state.selectedItemId || "") === String(item.id || "") ? ' class="is-selected" data-entity-selected="true" aria-current="true"' : ""}>${columns.map(([name, label, aliases]) => `<td data-label="${escapeHtml(label)}">${escapeHtml(value(item, name, aliases) || "-")}</td>`).join("")}<td class="entity-row-action"><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></td></tr>`).join("") || `<tr><td colspan="${columns.length + 1}" class="entity-empty">${emptyMessage}</td></tr>`}</tbody></table></div><nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav></div>`;
}

function fornecedoresGalleryResultsMarkup(entity, data, state, actions, records) {
  const columns = [["ID", "ID", ["ID"]], ["CADASTRO", "FORNECEDOR", ["CADASTRO", "Title"]], ["ATIVIDADE EXERCIDA", "ATIVIDADE EXERCIDA", ["ATIVIDADE EXERCIDA"]], ["STATUS", "STATUS", ["STATUS"]], ["FILIAL", "FILIAL", ["FILIAL"]], ["CIDADE", "CIDADE", ["CIDADE"]], ["TIPO", "TIPO", ["TIPO"]], ["HOMOLOGACAO", "HOMOLOGAÇÃO", ["HOMOLOGACAO"]], ["TIPODOCUMENTO", "TIPO DOCUMENTO", ["TIPODOCUMENTO"]], ["DOCUMENTO FORNECEDOR", "DOCUMENTO", ["DOCUMENTO FORNECEDOR"]], ["TELEFONECONTATO", "TELEFONE", ["TELEFONECONTATO"]], ["WHATSAPP", "WHATSAPP", ["WHATSAPP"]], ["EMPREITEIRO", "EMPREITEIRO", ["EMPREITEIRO"]], ["Criado por", "CRIADO POR", ["Criado por", "Author"]], ["Criado", "CRIADO EM", ["Criado", "Created"]], ["Modificado", "MODIFICADO EM", ["Modificado", "Modified"]], ["Modificado por", "MODIFICADO POR", ["Modificado por", "Editor"]]];
  const columnMap = new Map((data.columns || []).map(column => [column.name, column]));
  const value = (item, name, aliases = []) => {
    if (name === "ID") return item.id;
    const column = columnMap.get(name) || aliases.map(alias => columnMap.get(alias)).find(Boolean) || { name, label: name };
    return formatGalleryValue(item.fields, column);
  };
  const activeFilters = hasActiveEntityFilters(state);
  const emptyMessage = data.query?.limitations?.length ? "A consulta não foi executada para evitar percorrer a lista inteira." : activeFilters ? "Nenhum fornecedor corresponde aos filtros selecionados." : "Nenhum fornecedor foi cadastrado nesta lista.";
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido` : data.items.hasMore ? "há mais resultados" : "fim da lista";
  return `<div class="fornecedores-gallery"><div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columns.map(([, label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr${String(state.selectedItemId || "") === String(item.id || "") ? ' class="is-selected" data-entity-selected="true" aria-current="true"' : ""}>${columns.map(([name, label, aliases]) => `<td data-label="${escapeHtml(label)}">${escapeHtml(value(item, name, aliases) || "-")}</td>`).join("")}<td class="entity-row-action"><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></td></tr>`).join("") || `<tr><td colspan="${columns.length + 1}" class="entity-empty">${emptyMessage}</td></tr>`}</tbody></table></div><nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav></div>`;
}

function filiaisGalleryResultsMarkup(entity, data, state, actions, records) {
  const columns = [["ID", "ID", ["ID"]], ["FILIAL", "FILIAL", ["FILIAL", "Title"]], ["UN", "NÚMERO UNIDADES", ["UN"]], ["STATUS", "STATUS", ["STATUS"]], ["VALORVISITA", "VALOR VISITA", ["VALORVISITA"]], ["CIDADE", "CIDADE", ["CIDADE"]], ["Tem anexos", "ANEXOS", ["Tem anexos"]], ["Criado por", "CRIADO POR", ["Criado por", "Author"]], ["Criado", "CRIADO EM", ["Criado", "Created"]], ["Modificado", "MODIFICADO EM", ["Modificado", "Modified"]], ["Modificado por", "MODIFICADO POR", ["Modificado por", "Editor"]]];
  const columnMap = new Map((data.columns || []).map(column => [column.name, column]));
  const value = (item, name, aliases = []) => {
    if (name === "ID") return item.id;
    const column = columnMap.get(name) || aliases.map(alias => columnMap.get(alias)).find(Boolean) || { name, label: name };
    return formatGalleryValue(item.fields, column);
  };
  const activeFilters = hasActiveEntityFilters(state);
  const emptyMessage = data.query?.limitations?.length ? "A consulta não foi executada para evitar percorrer a lista inteira." : activeFilters ? "Nenhuma filial corresponde aos filtros selecionados." : "Nenhuma filial foi cadastrada nesta lista.";
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido` : data.items.hasMore ? "há mais resultados" : "fim da lista";
  return `<div class="filiais-gallery"><div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columns.map(([, label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr${String(state.selectedItemId || "") === String(item.id || "") ? ' class="is-selected" data-entity-selected="true" aria-current="true"' : ""}>${columns.map(([name, label, aliases]) => `<td data-label="${escapeHtml(label)}">${escapeHtml(value(item, name, aliases) || "-")}</td>`).join("")}<td class="entity-row-action"><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></td></tr>`).join("") || `<tr><td colspan="${columns.length + 1}" class="entity-empty">${emptyMessage}</td></tr>`}</tbody></table></div><nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav></div>`;
}

function imoveisGalleryResultsMarkup(entity, data, state, actions, records) {
  const columns = [
    ["ID", "ID", ["ID"]],
    ["IMOVEL", "IMÓVEL", ["IMOVEL", "Title"]],
    ["FILIAL", "FILIAL", ["FILIAL"]],
    ["STATUS", "STATUS", ["STATUS"]],
    ["Tem anexos", "ANEXOS", ["Tem anexos"]],
    ["CONTRATO", "CONTRATO", ["CONTRATO"]],
    ["STATUSVISUAL", "STATUS VISUAL", ["STATUSVISUAL"]],
    ["Criado por", "CRIADO POR", ["Criado por", "Author"]],
    ["Criado", "CRIADO EM", ["Criado", "Created"]],
    ["Modificado", "MODIFICADO EM", ["Modificado", "Modified"]],
    ["Modificado por", "MODIFICADO POR", ["Modificado por", "Editor"]],
  ];
  const columnMap = new Map((data.columns || []).map(column => [column.name, column]));
  const value = (item, name, aliases = []) => {
    if (name === "ID") return item.id;
    const column = columnMap.get(name) || aliases.map(alias => columnMap.get(alias)).find(Boolean) || { name, label: name };
    return formatGalleryValue(item.fields, column);
  };
  const activeFilters = hasActiveEntityFilters(state);
  const emptyMessage = data.query?.limitations?.length
    ? "A consulta não foi executada para evitar percorrer a lista inteira."
    : activeFilters ? "Nenhum imóvel corresponde aos filtros selecionados." : "Nenhum imóvel foi cadastrado nesta lista.";
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore
    ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido`
    : data.items.hasMore ? "há mais resultados" : "fim da lista";
  return `<div class="imoveis-gallery"><div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columns.map(([, label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr${String(state.selectedItemId || "") === String(item.id || "") ? ' class="is-selected" data-entity-selected="true" aria-current="true"' : ""}>${columns.map(([name, label, aliases]) => `<td data-label="${escapeHtml(label)}">${escapeHtml(value(item, name, aliases) || "-")}</td>`).join("")}<td class="entity-row-action"><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></td></tr>`).join("") || `<tr><td colspan="${columns.length + 1}" class="entity-empty">${emptyMessage}</td></tr>`}</tbody></table></div><nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav></div>`;
}

function cidadesGalleryResultsMarkup(entity, data, state, actions, records) {
  const columns = [
    ["ID", "ID", ["ID"]],
    ["Nome", "NOME", ["Nome", "Title"]],
    ["Criado por", "CRIADO POR", ["Criado por", "Author"]],
    ["Criado", "CRIADO EM", ["Criado", "Created"]],
    ["Modificado", "MODIFICADO EM", ["Modificado", "Modified"]],
    ["Modificado por", "MODIFICADO POR", ["Modificado por", "Editor"]],
  ];
  const columnMap = new Map((data.columns || []).map(column => [column.name, column]));
  const value = (item, name, aliases = []) => {
    if (name === "ID") return item.id;
    const column = columnMap.get(name) || aliases.map(alias => columnMap.get(alias)).find(Boolean) || { name, label: name };
    return formatGalleryValue(item.fields, column);
  };
  const activeFilters = hasActiveEntityFilters(state);
  const emptyMessage = data.query?.limitations?.length
    ? "A consulta não foi executada para evitar percorrer a lista inteira."
    : activeFilters ? "Nenhuma cidade corresponde aos filtros selecionados." : "Nenhuma cidade foi cadastrada nesta lista.";
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore
    ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido`
    : data.items.hasMore ? "há mais resultados" : "fim da lista";
  return `<div class="cidades-gallery"><div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columns.map(([, label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr${String(state.selectedItemId || "") === String(item.id || "") ? ' class="is-selected" data-entity-selected="true" aria-current="true"' : ""}>${columns.map(([name, label, aliases]) => `<td data-label="${escapeHtml(label)}">${escapeHtml(value(item, name, aliases) || "-")}</td>`).join("")}<td class="entity-row-action"><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></td></tr>`).join("") || `<tr><td colspan="${columns.length + 1}" class="entity-empty">${emptyMessage}</td></tr>`}</tbody></table></div><nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav></div>`;
}

function tiposMaterialGalleryResultsMarkup(entity, data, state, actions, records) {
  const columns = [
    ["ID", "ID", ["ID"]],
    ["TIPO", "TIPO", ["TIPO", "Title"]],
    ["STATUS", "STATUS", ["STATUS"]],
    ["Criado por", "CRIADO POR", ["Criado por", "Author"]],
    ["Criado", "CRIADO EM", ["Criado", "Created"]],
    ["Modificado", "MODIFICADO EM", ["Modificado", "Modified"]],
    ["Modificado por", "MODIFICADO POR", ["Modificado por", "Editor"]],
  ];
  const columnMap = new Map((data.columns || []).map(column => [column.name, column]));
  const value = (item, name, aliases = []) => {
    if (name === "ID") return item.id;
    const column = columnMap.get(name) || aliases.map(alias => columnMap.get(alias)).find(Boolean) || { name, label: name };
    return formatGalleryValue(item.fields, column);
  };
  const activeFilters = hasActiveEntityFilters(state);
  const emptyMessage = data.query?.limitations?.length
    ? "A consulta não foi executada para evitar percorrer a lista inteira."
    : activeFilters ? "Nenhum tipo de material corresponde aos filtros selecionados." : "Nenhum tipo de material foi cadastrado nesta lista.";
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore
    ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido`
    : data.items.hasMore ? "há mais resultados" : "fim da lista";
  return `<div class="tipos-material-gallery"><div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columns.map(([, label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr${String(state.selectedItemId || "") === String(item.id || "") ? ' class="is-selected" data-entity-selected="true" aria-current="true"' : ""}>${columns.map(([name, label, aliases]) => `<td data-label="${escapeHtml(label)}">${escapeHtml(value(item, name, aliases) || "-")}</td>`).join("")}<td class="entity-row-action"><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></td></tr>`).join("") || `<tr><td colspan="${columns.length + 1}" class="entity-empty">${emptyMessage}</td></tr>`}</tbody></table></div><nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav></div>`;
}

function gruposImobilizadosGalleryResultsMarkup(entity, data, state, actions, records) {
  const columns = [
    ["ID", "ID", ["ID"]],
    ["GRUPOIMOBILIZADOS", "GRUPO DE IMOBILIZADOS", ["GRUPOIMOBILIZADOS", "Title"]],
    ["Criado por", "CRIADO POR", ["Criado por", "Author"]],
    ["Criado", "CRIADO EM", ["Criado", "Created"]],
    ["Modificado", "MODIFICADO EM", ["Modificado", "Modified"]],
    ["Modificado por", "MODIFICADO POR", ["Modificado por", "Editor"]],
  ];
  const columnMap = new Map((data.columns || []).map(column => [column.name, column]));
  const value = (item, name, aliases = []) => {
    if (name === "ID") return item.id;
    const column = columnMap.get(name) || aliases.map(alias => columnMap.get(alias)).find(Boolean) || { name, label: name };
    return formatGalleryValue(item.fields, column);
  };
  const activeFilters = hasActiveEntityFilters(state);
  const emptyMessage = data.query?.limitations?.length
    ? "A consulta não foi executada para evitar percorrer a lista inteira."
    : activeFilters ? "Nenhum grupo de imobilizados corresponde aos filtros selecionados." : "Nenhum grupo de imobilizados foi cadastrado nesta lista.";
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore
    ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido`
    : data.items.hasMore ? "há mais resultados" : "fim da lista";
  return `<div class="grupos-imobilizados-gallery"><div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columns.map(([, label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr${String(state.selectedItemId || "") === String(item.id || "") ? ' class="is-selected" data-entity-selected="true" aria-current="true"' : ""}>${columns.map(([name, label, aliases]) => `<td data-label="${escapeHtml(label)}">${escapeHtml(value(item, name, aliases) || "-")}</td>`).join("")}<td class="entity-row-action"><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></td></tr>`).join("") || `<tr><td colspan="${columns.length + 1}" class="entity-empty">${emptyMessage}</td></tr>`}</tbody></table></div><nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav></div>`;
}

function cadastroImobilizadosGalleryResultsMarkup(entity, data, state, actions, records) {
  const columns = [
    ["IMOBILIZADO", "IMOBILIZADO", ["IMOBILIZADO", "ITEM", "Title"]],
    ["GRUPOIMOBILIZADO", "GRUPO DE IMOBILIZADO", ["GRUPOIMOBILIZADO"]],
    ["FUNCAO", "FUNÇÃO", ["FUNCAO", "FUN_x00c7__x00c3_O"]],
    ["ID", "ID", ["ID"]],
    ["Criado por", "CRIADO POR", ["Criado por", "Author"]],
    ["Criado", "CRIADO EM", ["Criado", "Created"]],
    ["Modificado", "MODIFICADO EM", ["Modificado", "Modified"]],
    ["Modificado por", "MODIFICADO POR", ["Modificado por", "Editor"]],
  ];
  const columnMap = new Map((data.columns || []).map(column => [column.name, column]));
  const value = (item, name, aliases = []) => {
    if (name === "ID") return item.id;
    const column = columnMap.get(name) || aliases.map(alias => columnMap.get(alias)).find(Boolean) || { name, label: name };
    return formatGalleryValue(item.fields, column);
  };
  const activeFilters = hasActiveEntityFilters(state);
  const emptyMessage = data.query?.limitations?.length
    ? "A consulta não foi executada para evitar percorrer a lista inteira."
    : activeFilters ? "Nenhum imobilizado corresponde aos filtros selecionados." : "Nenhum imobilizado foi cadastrado nesta lista.";
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore
    ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido`
    : data.items.hasMore ? "há mais resultados" : "fim da lista";
  return `<div class="cadastro-imobilizados-gallery"><div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columns.map(([, label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr${String(state.selectedItemId || "") === String(item.id || "") ? ' class="is-selected" data-entity-selected="true" aria-current="true"' : ""}>${columns.map(([name, label, aliases]) => `<td data-label="${escapeHtml(label)}">${escapeHtml(value(item, name, aliases) || "-")}</td>`).join("")}<td class="entity-row-action"><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></td></tr>`).join("") || `<tr><td colspan="${columns.length + 1}" class="entity-empty">${emptyMessage}</td></tr>`}</tbody></table></div><nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav></div>`;
}

function imobilizadosGalleryResultsMarkup(entity, data, state, actions, records) {
  const columns = [
    ["Anexos", "ANEXOS", ["Anexos", "Attachments"]],
    ["ID", "ID", ["ID"]],
    ["NÚMEROIMOBILIZADO", "NÚMERO PATRIMÔNIO", ["NÚMEROIMOBILIZADO", "N_x00da_MEROIMOBILIZADO"]],
    ["IMOBILIZADO", "IMOBILIZADO", ["IMOBILIZADO", "ITEM", "Title"]],
    ["FORNECEDOR", "FORNECEDOR", ["FORNECEDOR"]],
    ["FILIAL", "FILIAL", ["FILIAL"]],
    ["QTD", "QUANTIDADE", ["QTD"]],
    ["VALOR ESTIMADO", "VALOR ESTIMADO", ["VALOR ESTIMADO"]],
    ["VALOR RESIDUAL", "VALOR RESIDUAL", ["VALOR RESIDUAL"]],
    ["DATADEPRECIAÇÃO", "DATA DEPRECIAÇÃO", ["DATADEPRECIAÇÃO", "DATADEPRECIA_x00c7__x00c3_O"]],
    ["DATA CADASTRO", "DATA CADASTRO", ["DATA CADASTRO"]],
    ["DATA COMPRA", "DATA COMPRA", ["DATA COMPRA"]],
    ["DEPRECIAR", "DEPRECIAR", ["DEPRECIAR"]],
    ["Criado por", "CRIADO POR", ["Criado por", "Author"]],
    ["Criado", "CRIADO EM", ["Criado", "Created"]],
    ["Modificado", "MODIFICADO EM", ["Modificado", "Modified"]],
    ["Modificado por", "MODIFICADO POR", ["Modificado por", "Editor"]],
  ];
  const columnMap = new Map((data.columns || []).map(column => [column.name, column]));
  const value = (item, name, aliases = []) => {
    if (name === "ID") return item.id;
    const column = columnMap.get(name) || aliases.map(alias => columnMap.get(alias)).find(Boolean) || { name, label: name };
    return formatGalleryValue(item.fields, column);
  };
  const activeFilters = hasActiveEntityFilters(state);
  const emptyMessage = data.query?.limitations?.length
    ? "A consulta não foi executada para evitar percorrer a lista inteira."
    : activeFilters ? "Nenhum imobilizado corresponde aos filtros selecionados." : "Nenhum imobilizado foi cadastrado nesta lista.";
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore
    ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido`
    : data.items.hasMore ? "há mais resultados" : "fim da lista";
  return `<div class="imobilizados-gallery"><div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columns.map(([, label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr${String(state.selectedItemId || "") === String(item.id || "") ? ' class="is-selected" data-entity-selected="true" aria-current="true"' : ""}>${columns.map(([name, label, aliases]) => `<td data-label="${escapeHtml(label)}">${escapeHtml(value(item, name, aliases) || "-")}</td>`).join("")}<td class="entity-row-action"><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></td></tr>`).join("") || `<tr><td colspan="${columns.length + 1}" class="entity-empty">${emptyMessage}</td></tr>`}</tbody></table></div><nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav></div>`;
}

function notasPendentesGalleryResultsMarkup(entity, data, state, actions, records) {
  const columns = [["ID", "ID"], ["FILIAL", "FILIAL"], ["FORNECEDOR", "FORNECEDOR"], ["STATUS", "STATUS"], ["VALORTOTAL", "VALOR TOTAL"], ["FORMAPGTO", "FORMA DE PAGAMENTO"], ["NOTA FISCAL", "NOTA FISCAL"], ["DATAPGTOEFETUADO", "DATA PGTO EFETUADO"], ["CONSTACNO", "CONSTACNO"], ["Tem anexos", "ANEXOS"]];
  const columnMap = new Map((data.columns || []).map(column => [column.name, column]));
  const value = (item, name) => name === "ID" ? item.id : formatGalleryValue(item.fields, columnMap.get(name) || { name, label: name });
  const activeFilters = hasActiveEntityFilters(state);
  const emptyMessage = data.query?.limitations?.length ? "A consulta não foi executada para evitar percorrer a lista inteira." : activeFilters ? "Nenhuma nota corresponde aos filtros selecionados." : "Nenhuma nota pendente foi cadastrada nesta lista.";
  const atPageLimit = data.items.page >= ENTITY_MAX_INCREMENTAL_PAGES;
  const continuationState = atPageLimit && data.items.hasMore ? `limite seguro de ${ENTITY_MAX_INCREMENTAL_PAGES} páginas atingido` : data.items.hasMore ? "há mais resultados" : "fim da lista";
  return `<div class="notas-pendentes-gallery"><div class="entity-table-wrap"><table class="entity-table"><thead><tr>${columns.map(([, label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${records.map(item => `<tr${String(state.selectedItemId || "") === String(item.id || "") ? ' class="is-selected" data-entity-selected="true" aria-current="true"' : ""}>${columns.map(([name, label]) => `<td data-label="${escapeHtml(label)}">${escapeHtml(value(item, name) || "-")}</td>`).join("")}<td class="entity-row-action"><div class="entity-row-actions">${entityRowActionsMarkup(entity, item, actions)}</div></td></tr>`).join("") || `<tr><td colspan="${columns.length + 1}" class="entity-empty">${escapeHtml(emptyMessage)}</td></tr>`}</tbody></table></div><nav class="entity-pagination" aria-label="Paginação"><span>${escapeHtml(`Último lote: ${data.items.batchCount} registro(s) · ${continuationState}`)}${data.items.batchCount ? ` · Exibindo ${data.items.rangeStart} a ${data.items.rangeEnd}` : ""}</span><div><button type="button" data-entity-first ${data.items.page <= 1 ? "disabled" : ""}>Primeira</button><button type="button" data-entity-prev ${data.items.page <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${data.items.page}</span><button type="button" data-entity-next ${!data.items.hasMore || atPageLimit ? "disabled" : ""}>Próxima</button><button type="button" data-entity-last disabled title="O último lote não é buscado automaticamente para evitar carregar a lista inteira.">Última</button></div></nav></div>`;
}

function actionsForFormModes(entity, data, actions) {
  if (data.uiContract && !data.uiContract.mode) {
    const writable = data.uiContract.hasForm === true
      && (data.uiContract.readOnly !== true || data.uiContract.requiresVariantSelection === true);
    return { ...actions, create: actions.create === true && writable, edit: actions.edit === true && writable };
  }
  const createContract = resolvePowerAppsUiContract(entity, data.columns, { mode: "create" });
  const editContract = resolvePowerAppsUiContract(entity, data.columns, { mode: "edit" });
  return {
    ...actions,
    create: actions.create === true && createContract.hasForm === true
      && (createContract.readOnly !== true || createContract.requiresVariantSelection === true),
    edit: actions.edit === true && editContract.hasForm === true
      && (editContract.readOnly !== true || editContract.requiresVariantSelection === true),
  };
}

function galleryVariantSelectorMarkup(contract) {
  if (!contract || !Array.isArray(contract.galleryVariants) || contract.galleryVariants.length < 2) return "";
  const placeholder = contract.requiresGallerySelection
    ? '<option value="" selected disabled>Selecione a visualização</option>'
    : "";
  return `<label>Visualização<select data-entity-gallery-variant>${placeholder}${contract.galleryVariants.map(variant => `<option value="${escapeHtml(variant.id)}"${variant.id === contract.galleryVariant?.id ? " selected" : ""}>${escapeHtml(variant.label)}</option>`).join("")}</select></label>`;
}

function galleryFilterControlsMarkup(filters, contract, state, columns) {
  const byField = new Map(filters.map(filter => [filter.name, filter]));
  const byColumn = new Map((columns || []).map(column => [column.name, column]));
  const definitions = contract.galleryFilters?.length
    ? contract.galleryFilters
    : contract.filterFields.map(field => ({ kind: "equals", field }));
  return definitions.map(definition => {
    const column = byColumn.get(definition.field);
    const label = column?.label || definition.field;
    if (definition.kind === "date-range") {
      const fromKey = `${definition.field}__gte`;
      const toKey = `${definition.field}__lte`;
      return `<fieldset class="entity-filter-range"><legend>${escapeHtml(label)}</legend><label>De<input data-entity-filter="${escapeHtml(fromKey)}" type="date" value="${escapeHtml(state.filters?.[fromKey] || "")}"></label><label>Até<input data-entity-filter="${escapeHtml(toKey)}" type="date" value="${escapeHtml(state.filters?.[toKey] || "")}"></label></fieldset>`;
    }
    if (definition.kind === "fixed-toggle") {
      const checked = String(state.filters?.[definition.field] || "") === String(definition.value);
      return `<label class="entity-filter-toggle"><input type="checkbox" data-entity-filter="${escapeHtml(definition.field)}" data-entity-filter-value="${escapeHtml(definition.value)}"${checked ? " checked" : ""}><span>Somente ${escapeHtml(label)}: ${escapeHtml(definition.value)}</span></label>`;
    }
    const filter = byField.get(definition.field);
    if (!filter) return "";
    if (definition.kind === "multiple") {
      let selected = [];
      try {
        const parsed = JSON.parse(state.filters?.[filter.name] || "[]");
        if (Array.isArray(parsed)) selected = parsed.map(String);
      } catch {
        selected = [];
      }
      const selectedValues = new Set(selected);
      const size = Math.max(2, Math.min(6, filter.options.length || 2));
      return `<label>${escapeHtml(filter.label)}<select data-entity-filter="${escapeHtml(filter.name)}" multiple size="${size}">${filter.options.map(option => `<option value="${escapeHtml(option)}"${selectedValues.has(option) ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select><small>Use Ctrl para selecionar mais de uma opção.</small></label>`;
    }
    return `<label>${escapeHtml(filter.label)}<select data-entity-filter="${escapeHtml(filter.name)}"><option value="">Todos</option>${filter.options.map(option => `<option value="${escapeHtml(option)}"${option === state.filters?.[filter.name] ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></label>`;
  }).join("");
}

export function entityGalleryMarkup(entity, data, state, actions) {
  const contract = data.uiContract || resolvePowerAppsUiContract(entity, data.columns);
  const availableActions = actionsForFormModes(entity, data, actions);
  const galleryCommandDisabled = entity.id !== "lancamentos";
  const createCommandDisabled = true;
  const commandAttributes = disabled => disabled
    ? ' aria-disabled="true" tabindex="-1" data-entry-command-disabled="true" title="Indisponível no momento"'
    : "";
  const galleryCommandClass = `entity-view-command${galleryCommandDisabled ? " is-disabled" : ""}`;
  const createCommandClass = `entity-view-command${createCommandDisabled ? " is-disabled" : ""}`;
  const filters = buildGalleryFilters(data.rawItems, data.columns, contract.filterFields, data.filterOptionValues);
  const activeFilters = hasActiveEntityFilters(state);
  const hasFormPanel = state.formOpen === true && (availableActions.create || availableActions.edit);
  const galleryActive = !hasFormPanel;
  const formMode = state.formMode === "edit" ? "edit" : "create";
  const activeFormContract = hasFormPanel
    ? resolvePowerAppsUiContract(entity, data.columns, {
      mode: formMode,
      formVariantId: state.formVariantIds?.[formMode],
    })
    : null;
  const pageSizes = [...new Set([...ENTITY_PAGE_SIZES, Number(state.pageSize)])].filter(value => value > 0 && value <= 100).sort((left, right) => left - right);
  return `<section class="entity-page${entity.id === "lancamentos" ? " is-g1" : ""}" aria-labelledby="entityPageTitle">
    <header class="entity-heading"><div><p class="page-eyebrow">Dados do SharePoint</p><h1 id="entityPageTitle">${escapeHtml(entity.title)}</h1><p class="entity-meta" data-entity-meta>${escapeHtml(galleryMeta(data))}</p></div><nav class="entity-view-switch" aria-label="Modo de trabalho"><button type="button" class="${galleryCommandClass}" data-entity-gallery-view aria-pressed="${galleryActive}"${commandAttributes(galleryCommandDisabled)}>Galeria</button>${availableActions.create ? `<button type="button" class="${createCommandClass}" data-entity-create aria-pressed="${!galleryActive}"${commandAttributes(createCommandDisabled)}>Lançamento</button>` : ""}</nav></header>
    <p class="entity-toast ${state.error ? "is-error" : ""}" data-entity-toast role="status" aria-live="polite">${escapeHtml(state.error || state.message)}</p>
    <div class="entity-state" data-entity-query-notes>${queryNotesMarkup(data)}</div>
    <div class="entity-split-workspace" data-entity-workspace>
      ${hasFormPanel ? `<section class="entity-form-panel" data-entity-form-panel><div data-entity-form></div><div data-multi-entry-host></div></section>` : `<section class="entity-gallery-panel" data-entity-gallery>
        ${entity.id === "lancamentos" ? g1OperationalBarMarkup(data.metricItems || data.items?.items || data.rawItems) : ""}
        ${entity.id === "lancamentos" ? g1FieldVisitDialogMarkup(filters) : ""}
        <section class="entity-toolbar${entity.id === "lancamentos" ? " g1-filter-grid" : ""}" data-entity-toolbar${entity.id === "lancamentos" ? " data-g1-filter-grid" : ""} aria-label="Filtros">
          ${galleryVariantSelectorMarkup(contract)}
          ${gallerySortControlsMarkup(contract, data.columns, state)}
          ${contract.searchFields.length ? `<label>Pesquisar<input type="search" data-entity-search value="${escapeHtml(state.search)}" placeholder="Buscar nos campos cadastrados"></label>` : ""}
          ${galleryFilterControlsMarkup(filters, contract, state, data.columns)}
          <label>Itens por página<select data-entity-page-size>${pageSizes.map(size => `<option value="${size}"${size === Number(state.pageSize) ? " selected" : ""}>${size}</option>`).join("")}</select></label>
          <button class="button-secondary entity-clear-filters" type="button" data-entity-clear-filters${activeFilters ? "" : " hidden"}>Limpar filtros</button>
        </section>
        <div data-entity-results>${entityGalleryResultsMarkup(entity, data, state, availableActions)}</div>
        <div data-gallery-attachment-viewer-host></div>
      </section>`}
    </div>
  </section>`;
}

function gallerySortOptions(contract, columns = []) {
  const visibleFields = new Set((contract?.galleryColumns || []).map(column => column.name));
  const options = [{ name: "ID", label: "ID", control: "number", indexed: true }];
  for (const column of columns) {
    if (column.hidden || !visibleFields.has(column.name) || !canSortEntityColumn(column)) continue;
    if (options.some(option => option.name === column.name)) continue;
    options.push(column);
  }
  return options;
}

function gallerySortControlsMarkup(contract, columns, state) {
  const defaultSort = contract?.gallerySort || { field: "", direction: "asc" };
  const usingDefault = state.gallerySortOverride !== true;
  const activeSort = usingDefault ? defaultSort : state.sort;
  const activeField = activeSort?.field || "";
  const activeDirection = activeSort?.direction === "desc" ? "desc" : "asc";
  const options = gallerySortOptions(contract, columns);
  const defaultColumn = options.find(column => column.name === defaultSort.field);
  const defaultDescription = defaultSort.field
    ? `Ordem padrão do Power Apps: ${defaultColumn?.label || defaultSort.field} (${defaultSort.direction === "desc" ? "decrescente" : "crescente"})`
    : "Ordem padrão do Power Apps";
  const directionTitle = activeDirection === "desc" ? "Usar ordem crescente" : "Usar ordem decrescente";
  return `<div class="entity-sort-picker" data-entity-sort-picker><label><span class="entity-sort-picker-icon" aria-hidden="true">↕</span><span class="sr-only">Ordenar galeria por</span><select data-entity-sort-field aria-label="Ordenar galeria por"><option value=""${usingDefault ? " selected" : ""}>${escapeHtml(defaultDescription)}</option>${options.map(column => `<option value="${escapeHtml(column.name)}"${!usingDefault && activeField === column.name ? " selected" : ""}>${escapeHtml(column.label)}</option>`).join("")}</select></label><button type="button" class="entity-sort-direction" data-entity-sort-direction${activeField ? "" : " disabled"} title="${escapeHtml(directionTitle)}" aria-label="${escapeHtml(directionTitle)}">${activeDirection === "desc" ? "↓" : "↑"}</button></div>`;
}

export function createEntityPage(root, context = {}) {
  if (!root) throw new TypeError("A galeria requer um elemento raiz.");
  const { entity, repository, access, can } = context;
  const state = {
    ...createEntityQueryState(context.initialQuery),
    message: context.initialMessage || "",
    error: "",
    data: null,
    formOpen: context.initialFormOpen === true,
    formMode: "create",
    editingItem: null,
    formValues: {},
    formRelationshipLabels: {},
    formVariantIds: { create: "", edit: "" },
    formVariantLocked: false,
    formAttachmentFiles: [],
    galleryVariantId: String(context.initialGalleryVariantId || ""),
    gallerySortOverride: Boolean(context.initialQuery?.sort),
    selectedItemId: "",
    filterOptionValues: null,
    clientItems: null,
  };
  let disposed = false;
  let generation = 0;
  let activeController;
  let formController;
  let galleryPreviewController;
  let galleryAttachmentGeneration = 0;
  let galleryAttachmentRecords = new Map();
  let galleryThumbnailUrls = new Set();
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

  function clearGalleryAttachments() {
    galleryAttachmentGeneration += 1;
    galleryPreviewController?.cleanup?.();
    galleryPreviewController = undefined;
    galleryAttachmentRecords = new Map();
    galleryThumbnailUrls.forEach(url => globalThis.URL?.revokeObjectURL?.(url));
    galleryThumbnailUrls = new Set();
    const host = root.querySelector?.("[data-gallery-attachment-viewer-host]");
    if (host) host.innerHTML = "";
  }

  function render(options = {}) {
    if (disposed || !state.data) return;
    clearGalleryAttachments();
    state.formVariantLocked = state.formMode === "create" && multiQueue.snapshot().length > 0;
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
      results.innerHTML = entityGalleryResultsMarkup(entity, state.data, state, actionsForFormModes(entity, state.data, entityActions()));
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

  function powerAppsOptionSearch(_column, source, term, dependencies, options) {
    if (typeof repository.searchPowerAppsOptions !== "function") throw new Error("A origem Power Apps do SharePoint não está disponível.");
    return repository.searchPowerAppsOptions(entity.siteKey, source, term, dependencies, options);
  }

  function resetForm() {
    state.formMode = "create";
    state.editingItem = null;
    state.formValues = {};
    state.formRelationshipLabels = {};
    state.formVariantIds.create = "";
    state.formAttachmentFiles = [];
    state.error = "";
  }

  function closeForm() {
    state.formOpen = false;
    resetForm();
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
    const mode = editing ? "edit" : "create";
    const contract = resolvePowerAppsUiContract(entity, state.data.columns, {
      mode,
      formVariantId: state.formVariantIds[mode],
    });
    state.formVariantIds[mode] = contract.formVariant?.id || "";
    if (contract.requiresVariantSelection) {
      host.innerHTML = '<p class="entity-empty">Selecione uma variante comprovada para abrir este formulário.</p>';
      return;
    }
    if (contract.readOnly || !contract.hasForm) {
      host.innerHTML = '<p class="entity-empty">Não há uma variante Power Apps comprovada para este formulário.</p>';
      return;
    }
    formController = renderDynamicForm(host, {
      entity,
      columns: contract.formColumns,
      mode,
      values: state.formValues,
      relationshipLabels: state.formRelationshipLabels,
      error: state.error,
      submitLabel: !editing && contract.multiple ? "Adicionar à lista" : undefined,
      relationshipDebounceMs: context.relationshipDebounceMs,
      relationshipSearch,
      powerAppsOptionDebounceMs: context.powerAppsOptionDebounceMs,
      powerAppsOptionSearch,
      attachments: {
        enabled: powerAppsFormDeclaresAttachments(contract),
        canView: powerAppsFormDeclaresAttachments(contract) && (!editing || actions.view === true),
        canEdit: powerAppsFormDeclaresAttachments(contract) && actions.edit === true && (editing || actions.create === true),
        existingFiles: editing ? state.formAttachmentFiles : [],
        readExisting: editing && typeof repository.downloadAttachment === "function"
          ? file => repository.downloadAttachment(entity.siteKey, state.data.list.id, state.editingItem.id, file?.name)
          : undefined,
      },
      onCancel: () => {
        closeForm();
        if (typeof context.onFormCancel === "function") context.onFormCancel();
        else render();
      },
      onSubmit: editing ? saveRecord : contract.multiple ? queueRecord : saveRecord,
    });
  }

  function renderMultiEntryQueue() {
    if (!state.data || disposed) return;
    const host = root.querySelector("[data-multi-entry-host]");
    const contract = resolvePowerAppsUiContract(entity, state.data.columns, {
      mode: "create",
      formVariantId: state.formVariantIds.create,
    });
    if (!host || !state.formOpen || !contract.multiple || state.formMode === "edit") {
      if (host) host.innerHTML = "";
      return;
    }
    host.innerHTML = multiEntryQueueMarkup(multiQueue.snapshot(), contract.formColumns, {
      mode: entity.id === "lancamentos" ? "lancamentos-gallery3-1" : "default",
    });
    host.querySelectorAll?.("[data-multi-entry-remove]").forEach(button => button.addEventListener("click", () => multiQueue.remove(button.dataset.multiEntryRemove)));
    host.querySelector?.("[data-multi-entry-submit]")?.addEventListener("click", submitMultiEntryQueue);
  }

  async function queueRecord(fields, rawValues = {}, relationshipLabels = {}, attachments = {}) {
    multiQueue.add(fields, rawValues, relationshipLabels, attachments);
    state.formValues = {};
    state.formRelationshipLabels = {};
    state.message = "Item adicionado à lista de lançamentos.";
    state.error = "";
    render();
  }

  async function submitMultiEntryQueue() {
    if (!entityActions().create || !state.data?.list) return;
    const result = await multiQueue.submitAll(row => persistEntityRecordWithAttachments(repository, entity, state.data.list, {
      mode: "create",
      fields: row.fields,
      attachments: row.attachments,
    }));
    const successes = result.filter(row => row.status === "success").length;
    const failures = result.filter(row => row.status === "error").length;
    state.message = `${successes} registro(s) criado(s)${failures ? ` e ${failures} com falha` : ""}.`;
    state.error = failures ? `${state.message} Revise as linhas com falha e submeta novamente.` : "";
    if (successes) multiQueue.clearSuccessful();
    if (!failures) {
      closeForm();
    }
    if (successes) {
      state.filterOptionValues = null;
      state.clientItems = null;
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
        galleryCatalog: context.galleryCatalog,
        useGallerySort: !state.gallerySortOverride,
        cursor: options.cursor || "",
        pageNumber: options.pageNumber || 1,
        loadedBefore: options.loadedBefore || 0,
        maxPages,
        signal: controller.signal,
        filterOptionValues: state.filterOptionValues,
        clientItems: state.clientItems,
      });
      if (!isCurrent(token)) return undefined;
      activeController = undefined;
      state.data = data;
      state.filterOptionValues = data.filterOptionValues || state.filterOptionValues;
      state.clientItems = data.clientItems || state.clientItems;
      if (data.availability !== "available") {
        const diagnostic = entityAvailabilityDiagnostic(data);
        root.innerHTML = `<section class="entity-page"><header class="entity-heading"><div><p class="page-eyebrow">Dados do SharePoint</p><h1>${escapeHtml(entity.title)}</h1></div></header><div class="entity-state"><p class="entity-${data.availability === "error" ? "error" : "empty"}" role="${data.availability === "error" ? "alert" : "status"}">${escapeHtml(diagnostic.message)}</p><p class="entity-diagnostic-code">Diagnóstico: ${escapeHtml(diagnostic.code)}</p><button class="button-secondary" type="button" data-entity-retry>Tentar novamente</button></div></section>`;
        root.querySelector("[data-entity-retry]")?.addEventListener("click", () => {
          repository.clearCache?.();
          state.clientItems = null;
          pageCache.clear();
          refresh({ pageNumber: 1 });
        });
        return data;
      }
      state.page = data.items.page;
      state.galleryVariantId = data.uiContract?.galleryVariant?.id || state.galleryVariantId;
      if (!state.gallerySortOverride && data.queryState?.sort) state.sort = data.queryState.sort;
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

  async function saveRecord(fields, rawValues = {}, relationshipLabels = {}, attachments = {}) {
    const editing = state.formMode === "edit" && state.editingItem;
    if ((!editing && !entityActions().create) || (editing && !entityActions().edit) || !state.data?.list) return;
    const token = ++generation;
    try {
      const savedItem = await persistEntityRecordWithAttachments(repository, entity, state.data.list, {
        mode: editing ? "edit" : "create",
        item: editing ? state.editingItem : undefined,
        fields,
        attachments,
      });
      if (!isCurrent(token)) return;
      const warnings = Array.isArray(savedItem?.warnings) && savedItem.warnings.length ? ` ${savedItem.warnings.join(" ")}` : "";
      state.message = `${editing ? "Registro atualizado com sucesso." : "Registro criado com sucesso."}${warnings}`;
      state.error = "";
      if (editing) {
        const previous = state.editingItem;
        const replacement = savedItem?.fields
          ? savedItem
          : { ...previous, fields: { ...(previous?.fields || {}), ...fields } };
        const updatedItems = state.data.rawItems.map(candidate => String(candidate.id) === String(previous.id) ? replacement : candidate);
        if (Array.isArray(state.clientItems)) {
          state.clientItems = Object.freeze(state.clientItems.map(candidate => (
            String(candidate.id) === String(previous.id) ? replacement : candidate
          )));
        }
        const refreshedFilterOptionValues = typeof repository.getFilterOptionValues === "function" && state.data.uiContract.filterFields.length
          ? await repository.getFilterOptionValues(entity.siteKey, state.data.list.id, state.data.uiContract.filterFields)
          : Object.freeze({});
        if (!isCurrent(token)) return;
        state.filterOptionValues = refreshedFilterOptionValues;
        const queryEntity = galleryQueryEntity(entity, state.data.uiContract);
        const rawItems = updatedItems.filter(candidate => itemMatchesEntityQuery(candidate, queryEntity, { ...state, search: "" }));
        const loadedBefore = state.data.items.rangeStart > 0
          ? state.data.items.rangeStart - 1
          : Math.max(0, state.data.items.loadedCount - state.data.items.batchCount);
        state.data = {
          ...state.data,
          clientItems: state.clientItems,
          filterOptionValues: refreshedFilterOptionValues,
          rawItems,
          items: createEntityBatchResult(rawItems, state, {
            pageNumber: state.page,
            loadedBefore,
            hasMore: state.data.items.hasMore,
          }),
        };
        state.selectedItemId = rawItems.some(candidate => String(candidate.id) === String(replacement.id)) ? String(replacement.id) : "";
        pageCache.set(state.page, state.data);
        closeForm();
        render();
        return;
      }
      closeForm();
      state.filterOptionValues = null;
      state.clientItems = null;
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

  async function editRecord(itemId) {
    if (!entityActions().edit) return;
    const item = state.data?.rawItems?.find(candidate => String(candidate.id) === String(itemId));
    if (!item) {
      state.error = "O registro selecionado não está mais disponível neste lote.";
      render({ preserveToolbar: true });
      return;
    }
    state.formOpen = true;
    state.formMode = "edit";
    state.editingItem = item;
    state.selectedItemId = String(item.id);
    state.formValues = { ...(item.fields || {}) };
    state.formRelationshipLabels = {};
    state.formAttachmentFiles = [];
    state.formVariantIds.edit = "";
    state.message = `Editando o registro #${item.id}.`;
    state.error = "";
    const contract = resolvePowerAppsUiContract(entity, state.data.columns, { mode: "edit" });
    if (powerAppsFormDeclaresAttachments(contract) && typeof repository.listAttachments === "function") {
      try {
        state.formAttachmentFiles = await repository.listAttachments(entity.siteKey, state.data.list.id, item.id);
      } catch (error) {
        state.error = error?.message || "Não foi possível consultar os anexos deste registro.";
      }
    }
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
      if (Array.isArray(state.clientItems)) {
        state.clientItems = Object.freeze(state.clientItems.map(candidate => (
          String(candidate.id) === String(item.id) ? replacement : candidate
        )));
      }
      const refreshedFilterOptionValues = typeof repository.getFilterOptionValues === "function" && state.data.uiContract.filterFields.length
        ? await repository.getFilterOptionValues(entity.siteKey, state.data.list.id, state.data.uiContract.filterFields)
        : Object.freeze({});
      if (!isCurrent(token)) return;
      state.filterOptionValues = refreshedFilterOptionValues;
      const queryEntity = galleryQueryEntity(entity, state.data.uiContract);
      const rawItems = updatedItems.filter(candidate => itemMatchesEntityQuery(candidate, queryEntity, state));
      const loadedBefore = state.data.items.rangeStart > 0 ? state.data.items.rangeStart - 1 : Math.max(0, state.data.items.loadedCount - state.data.items.batchCount);
      state.data = {
        ...state.data,
        clientItems: state.clientItems,
        filterOptionValues: refreshedFilterOptionValues,
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
      state.gallerySortOverride = true;
      return restartQuery({ sort: { field, direction } }, { preserveToolbar: true });
    }));
    resultsRoot?.querySelectorAll("[data-entity-clear-filters]").forEach(button => button.addEventListener("click", clearFilters));
    resultsRoot?.querySelector("[data-entity-first]")?.addEventListener("click", () => showCachedPage(1));
    resultsRoot?.querySelector("[data-entity-prev]")?.addEventListener("click", () => showCachedPage(state.page - 1));
    resultsRoot?.querySelector("[data-entity-next]")?.addEventListener("click", () => {
      if (!state.data?.items?.hasMore || state.page >= maxPages) return undefined;
      const nextPage = state.page + 1;
      if (pageCache.has(nextPage)) return showCachedPage(nextPage);
      if (state.data.query?.mode === "bounded-client-query") {
        return refresh({ pageNumber: nextPage, preserveToolbar: true });
      }
      if (!state.data?.nextLink) return undefined;
      return refresh({ cursor: state.data.nextLink, pageNumber: nextPage, loadedBefore: state.data.items.loadedCount, preserveToolbar: true });
    });
    hydrateGalleryAttachments(resultsRoot);
  }

  async function openGalleryAttachment(itemId, selectedIndex = 0) {
    const record = galleryAttachmentRecords.get(String(itemId));
    if (!record?.files?.length) return;
    galleryPreviewController?.cleanup?.();
    let visibleFiles = [...record.files];
    galleryPreviewController = createAttachmentPreviewController({ files: visibleFiles, actions: record.actions });
    const safeIndex = Math.max(0, Math.min(visibleFiles.length - 1, Number(selectedIndex) || 0));
    try {
      await galleryPreviewController.open(safeIndex);
      const host = root.querySelector("[data-gallery-attachment-viewer-host]");
      if (!host) return;
      const close = () => {
        galleryPreviewController?.close?.();
        host.innerHTML = "";
      };
      const refreshGalleryTrigger = async () => {
        const button = [...(root.querySelectorAll?.("[data-gallery-attachment]") || [])]
          .find(candidate => String(candidate.dataset?.galleryAttachment || "") === String(itemId));
        if (!button) return;
        const summary = button.closest?.(".g1-row-file")?.querySelector?.("[data-gallery-attachment-summary]");
        button.hidden = visibleFiles.length === 0;
        button.innerHTML = galleryAttachmentButtonMarkup(visibleFiles);
        if (summary) summary.textContent = visibleFiles.length ? `QUANTIDADE DE ANEXOS: ${visibleFiles.length}` : "SEM ANEXOS";
        if (galleryFileKind(visibleFiles[0]) !== "image" || Number(visibleFiles[0]?.size || 0) > 4 * 1024 * 1024) return;
        try {
          const bytes = await record.actions.downloadAttachment(visibleFiles[0].name);
          const url = globalThis.URL?.createObjectURL?.(bytes instanceof Blob ? bytes : new Blob([bytes], { type: visibleFiles[0].type || "image/jpeg" }));
          if (!url || disposed) return;
          galleryThumbnailUrls.add(url);
          button.innerHTML = galleryAttachmentButtonMarkup(visibleFiles, url);
        } catch {
          button.innerHTML = galleryAttachmentButtonMarkup(visibleFiles);
        }
      };
      const renderViewer = () => {
        const preview = galleryPreviewController.getState();
        host.innerHTML = attachmentViewerMarkup({
          files: visibleFiles,
          activeIndex: preview.activeIndex,
          preview: preview.preview,
          canEdit: record.actions.canEdit(),
        });
        const dialog = host.querySelector?.("[data-attachment-viewer]");
        bindAttachmentViewerBackdrop(dialog, close);
        dialog?.querySelector?.("[data-attachment-preview-close]")?.addEventListener("click", close);
        dialog?.querySelector?.("[data-attachment-previous]")?.addEventListener("click", async () => { await galleryPreviewController.previous(); renderViewer(); });
        dialog?.querySelector?.("[data-attachment-next]")?.addEventListener("click", async () => { await galleryPreviewController.next(); renderViewer(); });
        dialog?.querySelector?.("[data-attachment-preview-download]")?.addEventListener("click", () => {
          const file = visibleFiles[galleryPreviewController.getState().activeIndex];
          if (!file) return;
          record.actions.downloadAttachment(file.name).then(bytes => {
            const url = globalThis.URL?.createObjectURL?.(bytes instanceof Blob ? bytes : new Blob([bytes], { type: file.type || "application/octet-stream" }));
            if (!url) return;
            const link = root.ownerDocument?.createElement?.("a");
            if (!link) return;
            link.href = url;
            link.download = file.name;
            link.click();
            globalThis.setTimeout(() => globalThis.URL?.revokeObjectURL?.(url), 30000);
          }).catch(() => undefined);
        });
        dialog?.querySelector?.("[data-attachment-preview-upload]")?.addEventListener("submit", async event => {
          event.preventDefault();
          const input = event.currentTarget?.querySelector?.("[data-attachment-preview-file]");
          const status = event.currentTarget?.querySelector?.("[data-attachment-preview-upload-status]");
          const selected = input?.files?.[0];
          if (!selected) {
            if (status) status.textContent = "Selecione um arquivo para enviar.";
            return;
          }
          try {
            if (status) status.textContent = "Enviando anexo...";
            await record.actions.uploadAttachment(selected);
            visibleFiles = [...await record.actions.listAttachments()];
            record.files = visibleFiles;
            await refreshGalleryTrigger();
            galleryPreviewController?.cleanup?.();
            galleryPreviewController = createAttachmentPreviewController({ files: visibleFiles, actions: record.actions });
            const uploadedIndex = Math.max(0, visibleFiles.findIndex(file => file.name === selected.name));
            await galleryPreviewController.open(uploadedIndex);
            renderViewer();
          } catch {
            if (status) status.textContent = record.actions.getState?.().error || "Não foi possível enviar o anexo.";
          }
        });
        try { dialog?.showModal?.(); } catch { dialog?.setAttribute?.("open", ""); }
      };
      renderViewer();
    } catch {
      state.error = "Não foi possível abrir o anexo selecionado.";
      render({ preserveToolbar: true });
    }
  }

  function hydrateGalleryAttachments(resultsRoot) {
    if (!resultsRoot || !state.data?.list || typeof repository.listAttachments !== "function") return;
    const buttons = [...(resultsRoot.querySelectorAll?.("[data-gallery-attachment]") || [])];
    if (!buttons.length || entity?.capabilities?.view !== true || can?.(access, entity.moduleId, "view") !== true) return;
    const byId = new Map((state.data.items?.items || []).map(item => [String(item.id), item]));
    const token = ++galleryAttachmentGeneration;
    const pending = buttons.map(button => ({ button, item: byId.get(String(button.dataset.galleryAttachment || "")) })).filter(entry => entry.item);
    const workers = Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (pending.length && !disposed && token === galleryAttachmentGeneration) {
        const entry = pending.shift();
        const actions = createAttachmentActions({ repository, entity, access, can, listId: state.data.list.id, itemId: entry.item.id });
        try {
          const files = await actions.listAttachments();
          if (disposed || token !== galleryAttachmentGeneration) continue;
          const summary = entry.button.closest?.(".g1-row-file")?.querySelector?.("[data-gallery-attachment-summary]");
          if (!files.length) {
            entry.button.hidden = true;
            if (summary) summary.textContent = "SEM ANEXOS";
            continue;
          }
          galleryAttachmentRecords.set(String(entry.item.id), { files, actions });
          entry.button.hidden = false;
          entry.button.innerHTML = galleryAttachmentButtonMarkup(files);
          if (summary) summary.textContent = `QUANTIDADE DE ANEXOS: ${files.length}`;
          const firstFileIsImage = galleryFileKind(files[0]) === "image" && Number(files[0]?.size || 0) <= 4 * 1024 * 1024;
          if (firstFileIsImage) {
            actions.downloadAttachment(files[0].name).then(bytes => {
              if (disposed || token !== galleryAttachmentGeneration) return;
              const url = globalThis.URL?.createObjectURL?.(bytes instanceof Blob ? bytes : new Blob([bytes], { type: files[0].type || "image/jpeg" }));
              if (!url) return;
              galleryThumbnailUrls.add(url);
              entry.button.innerHTML = galleryAttachmentButtonMarkup(files, url);
            }).catch(() => undefined);
          }
          entry.button.addEventListener("click", () => openGalleryAttachment(entry.item.id, 0));
        } catch {
          entry.button.hidden = true;
        }
      }
    });
    Promise.all(workers).catch(() => undefined);
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

  function closeG1FieldVisit() {
    const dialog = root.querySelector?.("[data-g1-field-visit-dialog]");
    try { dialog?.close?.(); } catch { dialog?.removeAttribute?.("open"); }
  }

  async function submitG1FieldVisit(form) {
    const errorHost = form?.querySelector?.("[data-g1-field-visit-error]") || root.querySelector?.("[data-g1-field-visit-error]");
    const submit = form?.querySelector?.('[type="submit"]');
    if (errorHost) errorHost.textContent = "";
    if (submit) submit.disabled = true;
    try {
      if (!state.data?.list?.id) throw new Error("A lista LANCAMENTOS ainda não está disponível.");
      const filial = form?.elements?.namedItem?.("filial")?.value || "";
      const valor = form?.elements?.namedItem?.("valor")?.value || "";
      const createDiary = Boolean(form?.elements?.namedItem?.("createDiary")?.checked);
      const nextGroupId = Math.max(0, ...(state.data.rawItems || []).map(item => Number(item.id) || 0)) + 1;
      const payload = buildG1FieldVisitPayload({ filial, valor, createDiary, nextGroupId });
      let diaryList = null;
      if (payload.diario) {
        diaryList = await repository.resolveList(entity.siteKey, ["DIÁRIO DE OBRAS", "DIARIO DE OBRAS"]);
        if (diaryList?.status !== "resolved" || !diaryList.id) throw new Error("A lista DIÁRIO DE OBRAS não foi localizada no SharePoint.");
      }
      await repository.createItem(entity.siteKey, state.data.list.id, payload.lancamento);
      if (payload.diario) await repository.createItem(entity.siteKey, diaryList.id, payload.diario);
      closeG1FieldVisit();
      state.message = payload.diario
        ? "Visita em campo e diário de obras criados com sucesso."
        : "Visita em campo criada com sucesso.";
      state.error = "";
      await refresh({ pageNumber: 1 });
    } catch (error) {
      if (errorHost) errorHost.textContent = error?.message || "Não foi possível cadastrar a visita em campo.";
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function bind() {
    root.querySelector('[data-g1-action="refresh"]')?.addEventListener("click", () => refresh({ pageNumber: 1 }));
    root.querySelector('[data-g1-action="field-visit"]')?.addEventListener("click", () => {
      const dialog = root.querySelector?.("[data-g1-field-visit-dialog]");
      try { dialog?.showModal?.(); } catch { dialog?.setAttribute?.("open", ""); }
    });
    root.querySelector("[data-g1-field-visit-close]")?.addEventListener("click", closeG1FieldVisit);
    root.querySelector("[data-g1-field-visit-cancel]")?.addEventListener("click", closeG1FieldVisit);
    root.querySelector("[data-g1-field-visit-form]")?.addEventListener("submit", event => {
      event.preventDefault();
      submitG1FieldVisit(event.currentTarget);
    });
    root.querySelector("[data-entity-gallery-view]")?.addEventListener("click", () => {
      if (!state.formOpen) return;
      closeForm();
      state.message = "";
      render();
    });
    root.querySelector("[data-entity-create]")?.addEventListener("click", () => {
      if (entityActions().create) { resetForm(); state.formOpen = true; state.message = ""; render(); }
    });
    root.querySelector("[data-entity-gallery-variant]")?.addEventListener("change", event => {
      state.galleryVariantId = event.target.value;
      state.gallerySortOverride = false;
      state.search = "";
      state.filters = {};
      state.filterOptionValues = null;
      pageCache.clear();
      refresh({ pageNumber: 1 });
    });
    root.querySelector("[data-entity-sort-field]")?.addEventListener("change", event => {
      const field = event.target.value;
      if (!field) {
        state.gallerySortOverride = false;
        return restartQuery({ sort: { field: "", direction: "asc" } }, { preserveToolbar: true });
      }
      const defaultSort = state.data?.uiContract?.gallerySort;
      const direction = state.gallerySortOverride && state.sort.field === field
        ? state.sort.direction
        : defaultSort?.field === field ? defaultSort.direction : "asc";
      state.gallerySortOverride = true;
      return restartQuery({ sort: { field, direction } }, { preserveToolbar: true });
    });
    root.querySelector("[data-entity-sort-direction]")?.addEventListener("click", () => {
      const selectedField = root.querySelector("[data-entity-sort-field]")?.value || "";
      const defaultSort = state.data?.uiContract?.gallerySort;
      const field = selectedField || defaultSort?.field;
      if (!field) return undefined;
      const activeSort = state.gallerySortOverride && state.sort.field === field ? state.sort : defaultSort;
      const direction = activeSort?.direction === "desc" ? "asc" : "desc";
      state.gallerySortOverride = true;
      return restartQuery({ sort: { field, direction } }, { preserveToolbar: true });
    });
    root.querySelector("[data-entity-search]")?.addEventListener("input", event => scheduleSearch(event.target.value));
    root.querySelectorAll("[data-entity-filter]").forEach(control => control.addEventListener("change", event => {
      const value = event.target.multiple
        ? (() => {
          const selected = [...event.target.selectedOptions].map(option => option.value);
          return selected.length ? JSON.stringify(selected) : "";
        })()
        : event.target.type === "checkbox"
          ? event.target.checked ? event.target.dataset.entityFilterValue || "true" : ""
          : event.target.value;
      return restartQuery({ filters: { [control.dataset.entityFilter]: value } });
    }));
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
