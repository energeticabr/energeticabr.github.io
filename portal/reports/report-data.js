import { classifyEntityAvailability } from "../data/attachments.js";
import { mapSharePointColumns } from "../data/column-mapper.js";
import { detectReportDimensions } from "./report-model.js";

export const DEFAULT_REPORT_PAGE_SIZE = 100;
export const MAX_REPORT_PAGE_SIZE = 200;

function pageOptions(options = {}) {
  const cursor = Math.max(0, Number.isInteger(Number(options.cursor)) ? Number(options.cursor) : 0);
  const requestedLimit = Number(options.limit);
  const limit = Math.min(MAX_REPORT_PAGE_SIZE, Math.max(1, Number.isInteger(requestedLimit) ? requestedLimit : DEFAULT_REPORT_PAGE_SIZE));
  return Object.freeze({
    cursor,
    limit,
    startId: cursor + 1,
    endId: cursor + limit,
    number: Math.floor(cursor / limit) + 1,
  });
}

function abortError() {
  const error = new Error("A consulta de relatorio foi cancelada.");
  error.name = "AbortError";
  error.code = "report_aborted";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function boundedItemsQuery(page) {
  return `$expand=fields&$filter=fields/ID ge ${page.startId} and fields/ID le ${page.endId}&$orderby=fields/ID asc`;
}

function boundedItems(items, page) {
  return Object.freeze((items || [])
    .filter(item => {
      const id = Number(item?.id ?? item?.fields?.ID);
      return Number.isInteger(id) && id >= page.startId && id <= page.endId;
    })
    .sort((left, right) => Number(left.id ?? left.fields?.ID) - Number(right.id ?? right.fields?.ID))
    .slice(0, page.limit));
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
    page: extra.page || pageOptions(),
  });
}

export async function loadReportSource(repository, entity, options = {}) {
  if (!repository || !entity) throw new TypeError("O relatorio requer repositorio e fonte SharePoint.");
  const page = pageOptions(options);
  const signal = options.signal;
  try {
    throwIfAborted(signal);
    const list = await repository.resolveList(entity.siteKey, entity.listNames);
    throwIfAborted(signal);
    if (list.status !== "resolved") return emptyResult("missing", { list, entity, page });
    const rawColumns = await repository.getColumns(entity.siteKey, list.id);
    throwIfAborted(signal);
    const items = await repository.getItems(entity.siteKey, list.id, boundedItemsQuery(page));
    throwIfAborted(signal);
    return Object.freeze({
      state: "ready",
      list,
      rawColumns: Object.freeze([...(rawColumns || [])]),
      columns: mapSharePointColumns(rawColumns, entity),
      items: boundedItems(items, page),
      dimensions: detectReportDimensions(rawColumns, entity),
      page,
    });
  } catch (error) {
    if (error?.name === "AbortError" || signal?.aborted) throw abortError();
    const availability = classifyEntityAvailability(error);
    return emptyResult(availability, { error, entity, page });
  }
}
