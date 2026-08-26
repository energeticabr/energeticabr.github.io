import { displayColumnValue, sortAndFilterItems } from "../data/column-mapper.js";

export const ENTITY_PAGE_SIZES = Object.freeze([10, 20, 50, 100]);

function normalizePageSize(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : 20;
}

function normalizePage(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.max(1, Math.trunc(parsed));
}

function normalizeFilters(filters = {}) {
  return Object.freeze(Object.fromEntries(Object.entries(filters || {})
    .map(([name, value]) => [String(name), String(value ?? "").trim()])
    .filter(([name]) => name)));
}

export function createEntityQueryState(initial = {}) {
  const sort = initial.sort || {};
  return Object.freeze({
    search: String(initial.search || ""),
    page: normalizePage(initial.page),
    pageSize: normalizePageSize(initial.pageSize),
    sort: Object.freeze({
      field: String(sort.field || "Title"),
      direction: sort.direction === "desc" ? "desc" : "asc",
    }),
    filters: normalizeFilters(initial.filters),
  });
}

export function updateEntityQueryState(current = {}, patch = {}) {
  const previous = createEntityQueryState(current);
  const nextFilters = Object.hasOwn(patch, "filters")
    ? { ...previous.filters, ...(patch.filters || {}) }
    : previous.filters;
  const changesResultSet = ["search", "filters", "pageSize"].some(key => Object.hasOwn(patch, key));
  return createEntityQueryState({
    ...previous,
    ...patch,
    filters: nextFilters,
    page: changesResultSet ? 1 : (patch.page ?? previous.page),
    sort: patch.sort || previous.sort,
  });
}

export function hasActiveEntityFilters(state = {}) {
  return Boolean(String(state.search || "").trim())
    || Object.values(state.filters || {}).some(value => String(value || "").trim());
}

function fieldValue(item, name) {
  const value = displayColumnValue(item?.fields || {}, { name });
  return value === "Não informado" ? "" : value;
}

export function buildEntityFilters(items = [], entity = {}, columns = []) {
  const columnMap = new Map((columns || []).map(column => [column.name, column]));
  const names = [...new Set([
    ...(entity.filterFields || []),
    ...(entity.statusFields || []),
    ...(columns || []).filter(column => column.control === "select").map(column => column.name),
  ])].filter(name => columnMap.has(name) && columnMap.get(name)?.hidden !== true);

  return Object.freeze(names.map(name => {
    const column = columnMap.get(name);
    const options = [...new Set([
      ...(column?.choices || []),
      ...(items || []).map(item => fieldValue(item, name)),
    ].map(value => String(value || "").trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, "pt-BR", { numeric: true }));
    return Object.freeze({ name, label: column?.label || name, options: Object.freeze(options) });
  }));
}

export function runEntityQuery(items = [], entity = {}, state = {}) {
  const legacyStatus = String(state?.status || "").trim();
  const legacyStatusField = (entity.statusFields || [])[0];
  const query = createEntityQueryState({
    ...state,
    filters: legacyStatus && legacyStatusField && !state?.filters?.[legacyStatusField]
      ? { ...(state.filters || {}), [legacyStatusField]: legacyStatus }
      : state.filters,
  });
  const filtered = (items || []).filter(item => Object.entries(query.filters).every(([name, expected]) => {
    if (!expected) return true;
    return fieldValue(item, name).localeCompare(expected, "pt-BR", { sensitivity: "accent" }) === 0;
  }));
  const result = sortAndFilterItems(filtered, entity, query);
  const rangeStart = result.total ? ((result.page - 1) * result.pageSize) + 1 : 0;
  const rangeEnd = result.total ? rangeStart + result.items.length - 1 : 0;
  return Object.freeze({ ...result, rangeStart, rangeEnd });
}
