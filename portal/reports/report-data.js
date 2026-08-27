import { classifyEntityAvailability } from "../data/attachments.js";
import { mapSharePointColumns } from "../data/column-mapper.js";
import { detectReportDimensions } from "./report-model.js";

export const DEFAULT_REPORT_PAGE_SIZE = 50;
export const DEFAULT_REPORT_BATCH_SIZE = 200;
export const MAX_REPORT_BATCH_SIZE = 200;
export const MAX_REPORT_ITEMS = 5000;
export const MAX_REPORT_PAGES = 25;

const GRAPH_ORIGIN = "https://graph.microsoft.com";
const SAFE_FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function boundedInteger(value, fallback, maximum) {
  const candidate = Number(value);
  if (!Number.isInteger(candidate) || candidate < 1) return fallback;
  return Math.min(candidate, maximum);
}

function reportLimits(options = {}) {
  return Object.freeze({
    batchSize: boundedInteger(options.batchSize, DEFAULT_REPORT_BATCH_SIZE, MAX_REPORT_BATCH_SIZE),
    maxItems: boundedInteger(options.maxItems, MAX_REPORT_ITEMS, MAX_REPORT_ITEMS),
    maxPages: boundedInteger(options.maxPages, MAX_REPORT_PAGES, MAX_REPORT_PAGES),
  });
}

function abortError() {
  const error = new Error("A consulta de relatório foi cancelada.");
  error.name = "AbortError";
  error.code = "report_aborted";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function validatedNextLink(value, listId) {
  const source = String(value || "").trim();
  if (!source) return "";
  let url;
  try {
    url = new URL(source);
  } catch {
    throw new TypeError("O nextLink de continuação Graph é inválido.");
  }
  const match = url.pathname.match(/^\/v1\.0\/sites\/[^/]+\/lists\/([^/]+)\/items$/);
  let cursorListId = "";
  try {
    cursorListId = match ? decodeURIComponent(match[1]) : "";
  } catch {
    throw new TypeError("O nextLink de continuação Graph possui codificação inválida.");
  }
  if (url.origin !== GRAPH_ORIGIN
    || url.username
    || url.password
    || url.hash
    || !match
    || cursorListId !== String(listId)) {
    throw new TypeError("O nextLink de continuação Graph não pertence à lista autorizada.");
  }
  return url.href;
}

function visibleColumn(columns, name) {
  return (columns || []).find(column => column?.hidden !== true && column?.name === name);
}

function safeTextFilter(field, value) {
  const source = String(value || "").trim();
  if (!field || !SAFE_FIELD_NAME.test(field) || !source || source.length > 200 || CONTROL_CHARACTERS.test(source)) return "";
  return `fields/${field} eq '${source.replaceAll("'", "''")}'`;
}

function localDayBoundary(value, dayOffset = 0) {
  const source = String(value || "");
  if (!DATE_ONLY.test(source)) return "";
  const [year, month, day] = source.split("-").map(Number);
  const base = new Date(year, month - 1, day);
  if (base.getFullYear() !== year || base.getMonth() !== month - 1 || base.getDate() !== day) return "";
  return new Date(year, month - 1, day + dayOffset).toISOString();
}

function safeDateFilter(field, startDate, endDate, dateOnly) {
  if (!field || !SAFE_FIELD_NAME.test(field)) return "";
  const clauses = [];
  if (dateOnly) {
    if (DATE_ONLY.test(String(startDate || ""))) clauses.push(`fields/${field} ge '${startDate}'`);
    if (DATE_ONLY.test(String(endDate || ""))) clauses.push(`fields/${field} le '${endDate}'`);
    return clauses.join(" and ");
  }
  const start = localDayBoundary(startDate);
  const endExclusive = localDayBoundary(endDate, 1);
  if (start) clauses.push(`fields/${field} ge '${start}'`);
  if (endExclusive) clauses.push(`fields/${field} lt '${endExclusive}'`);
  return clauses.join(" and ");
}

function serverFilter(rawColumns, dimensions, filters = {}) {
  const dateDimension = (dimensions.dateFields || []).find(field => field.name === filters.dateField);
  const candidates = [
    { field: dimensions.statusField, expression: safeTextFilter(dimensions.statusField, filters.status) },
    { field: dimensions.branchField, expression: safeTextFilter(dimensions.branchField, filters.branch) },
    {
      field: dateDimension?.name || "",
      expression: safeDateFilter(dateDimension?.name, filters.startDate, filters.endDate, dateDimension?.dateOnly === true),
    },
  ];
  const selected = candidates.find(candidate => {
    const column = visibleColumn(rawColumns, candidate.field);
    return candidate.expression && column?.indexed === true;
  });
  return Object.freeze({
    field: selected?.field || "",
    expression: selected?.expression || "",
  });
}

function itemsQuery(limits, filter) {
  const parts = ["$expand=fields", `$top=${limits.batchSize}`];
  if (filter.expression) parts.push(`$filter=${encodeURIComponent(filter.expression)}`);
  parts.push("$orderby=fields/ID asc");
  return parts.join("&");
}

function emptyResult(state, extra = {}) {
  return Object.freeze({
    state,
    list: extra.list,
    error: extra.error,
    columns: Object.freeze([]),
    rawColumns: Object.freeze([]),
    items: Object.freeze([]),
    dimensions: detectReportDimensions([], extra.entity),
    complete: false,
    partialReason: "",
    loadedCount: 0,
    pageCount: 0,
    serverFilterField: "",
    limit: extra.limit || reportLimits(),
  });
}

function progressSnapshot(items, pageCount, limits, complete, partialReason) {
  return Object.freeze({
    loadedCount: items.size,
    pageCount,
    maxItems: limits.maxItems,
    maxPages: limits.maxPages,
    complete,
    partialReason,
  });
}

export async function loadReportSource(repository, entity, options = {}) {
  if (!repository || !entity) throw new TypeError("O relatório requer repositório e fonte SharePoint.");
  const limits = reportLimits(options);
  const signal = options.signal;
  try {
    throwIfAborted(signal);
    const list = await repository.resolveList(entity.siteKey, entity.listNames, { signal });
    throwIfAborted(signal);
    if (list.status !== "resolved") return emptyResult("missing", { list, entity, limit: limits });
    const rawColumns = await repository.getColumns(entity.siteKey, list.id, { signal });
    throwIfAborted(signal);
    if (typeof repository.getItemsPage !== "function") {
      throw new TypeError("O repositório não oferece paginação Graph incremental para relatórios.");
    }

    const dimensions = detectReportDimensions(rawColumns, entity);
    const filter = serverFilter(rawColumns, dimensions, options.filters);
    const query = itemsQuery(limits, filter);
    const items = new Map();
    let cursor = "";
    let pageCount = 0;
    let complete = false;
    let partialReason = "";

    while (!complete && !partialReason) {
      throwIfAborted(signal);
      pageCount += 1;
      const page = await repository.getItemsPage(entity.siteKey, list.id, query, {
        cursor,
        pageNumber: pageCount,
        maxPages: limits.maxPages,
        signal,
      });
      throwIfAborted(signal);
      const nextLink = validatedNextLink(page?.nextLink, list.id);
      if (page?.hasMore && !nextLink) {
        throw new TypeError("A resposta Graph indicou continuação sem um nextLink válido.");
      }

      let omittedByLimit = false;
      for (const item of page?.items || []) {
        const id = String(item?.id ?? item?.fields?.ID ?? "").trim();
        if (!id) throw new TypeError("A paginação Graph retornou um registro sem identificador.");
        if (!items.has(id) && items.size >= limits.maxItems) {
          omittedByLimit = true;
          break;
        }
        items.set(id, item);
      }

      complete = !nextLink && !omittedByLimit;
      if (!complete && (omittedByLimit || items.size >= limits.maxItems)) partialReason = "max-items";
      else if (!complete && pageCount >= limits.maxPages) partialReason = "max-pages";

      options.onProgress?.(progressSnapshot(items, pageCount, limits, complete, partialReason));
      throwIfAborted(signal);
      cursor = nextLink;
    }

    const mappedColumns = mapSharePointColumns(rawColumns, entity);
    const resultItems = Object.freeze([...items.values()]);
    return Object.freeze({
      state: "ready",
      list,
      rawColumns: Object.freeze([...(rawColumns || [])]),
      columns: mappedColumns,
      items: resultItems,
      dimensions,
      complete,
      partialReason,
      loadedCount: resultItems.length,
      pageCount,
      serverFilterField: filter.field,
      limit: limits,
    });
  } catch (error) {
    if (error?.name === "AbortError" || signal?.aborted) throw abortError();
    const availability = classifyEntityAvailability(error);
    return emptyResult(availability, { error, entity, limit: limits });
  }
}
