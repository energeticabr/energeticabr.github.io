import { displayColumnValue, sortAndFilterItems } from "../data/column-mapper.js";

export const ENTITY_PAGE_SIZES = Object.freeze([10, 20, 50, 100]);
export const ENTITY_MAX_INCREMENTAL_PAGES = 100;
export const ENTITY_MAX_SEARCH_FIELDS = 8;

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

function safeFieldName(value) {
  const name = String(value || "");
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : "";
}

function odataString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function exactFilterExpression(column, value) {
  const field = safeFieldName(column?.name);
  if (!field || column?.indexed !== true) return undefined;
  if (["text", "select"].includes(column.control)) return `fields/${field} eq ${odataString(value)}`;
  if (["number", "currency"].includes(column.control)) {
    const numeric = Number(String(value).replace(",", "."));
    return Number.isFinite(numeric) ? `fields/${field} eq ${numeric}` : undefined;
  }
  return undefined;
}

function searchableGraphField(column) {
  const field = safeFieldName(column?.name);
  return field && column?.indexed === true && column.control === "text" ? field : "";
}

function sortableGraphField(column) {
  const field = safeFieldName(column?.name);
  const compatible = ["text", "select", "number", "currency", "date", "toggle"].includes(column?.control);
  return field && column?.indexed === true && compatible ? field : "";
}

export function canSortEntityColumn(column) {
  return Boolean(sortableGraphField(column));
}

export function buildEntityGraphRequest(entity = {}, columns = [], state = {}) {
  const query = createEntityQueryState(state);
  const columnMap = new Map((columns || []).map(column => [column.name, column]));
  const limitations = [];
  const notices = [];
  const expressions = [];
  const filteredFields = new Set();
  let mode = "incremental";
  let searchPlan;
  const activeFilters = Object.entries(query.filters).filter(([, value]) => value);

  for (const [name, value] of activeFilters) {
    const column = columnMap.get(name);
    const expression = exactFilterExpression(column, value);
    if (!expression) {
      limitations.push(`O filtro ${column?.label || name} não pode ser executado com segurança pelo Microsoft Graph porque a coluna não é indexada ou não possui um tipo compatível.`);
      continue;
    }
    expressions.push(expression);
    filteredFields.add(name);
  }

  const search = query.search.trim();
  if (search) {
    const fields = [...new Set(entity.searchFields || ["Title"])];
    const searchableFields = fields.map(name => searchableGraphField(columnMap.get(name))).filter(Boolean);
    if (!searchableFields.length) {
      limitations.push("A pesquisa desta área exige ao menos uma coluna de texto indexada no SharePoint.");
    } else if (searchableFields.length > ENTITY_MAX_SEARCH_FIELDS) {
      limitations.push(`A pesquisa desta área excede o limite seguro de ${ENTITY_MAX_SEARCH_FIELDS} campos indexados.`);
    } else if (searchableFields.length > 1) {
      if (activeFilters.length) {
        limitations.push("A pesquisa em vários campos não pode ser combinada com filtros adicionais sem consultar mais de uma coluna indexada por requisição.");
      } else {
        mode = "bounded-multi-field-search";
        searchPlan = Object.freeze({ fields: Object.freeze(searchableFields), term: search, pageSize: query.pageSize });
        notices.push("A pesquisa em vários campos usa consultas Graph indexadas e limitadas. Para garantir um resultado completo neste lote, refine o texto se houver mais correspondências que o limite selecionado.");
      }
    } else {
      const field = searchableFields[0];
      expressions.push(`startswith(fields/${field},${odataString(search)})`);
      filteredFields.add(field);
    }
  }

  if (filteredFields.size > 1) {
    limitations.push("O Microsoft Graph permite filtrar esta lista por apenas um campo indexado de cada vez.");
  }

  const blocked = limitations.length > 0;
  const parameters = new URLSearchParams();
  parameters.set("$expand", "fields");
  parameters.set("$top", String(query.pageSize));
  if (!blocked && expressions.length) parameters.set("$filter", expressions.join(" and "));
  const sortColumn = columnMap.get(query.sort.field);
  const sortField = sortableGraphField(sortColumn);
  const orderCompatible = sortField
    && mode === "incremental"
    && (filteredFields.size === 0 || (filteredFields.size === 1 && filteredFields.has(sortField)));
  if (!blocked && orderCompatible) {
    parameters.set("$orderby", `fields/${sortField} ${query.sort.direction}`);
  } else if (!blocked && query.sort.field && sortColumn && !orderCompatible) {
    notices.push(`A ordenação por ${sortColumn.label || sortColumn.name} não é suportada com segurança pelo SharePoint nesta consulta.`);
  }
  return Object.freeze({
    blocked,
    mode,
    query: parameters.toString(),
    search: searchPlan,
    limitations: Object.freeze(limitations),
    notices: Object.freeze(notices),
  });
}

export function createEntityBatchResult(items = [], state = {}, options = {}) {
  const query = createEntityQueryState(state);
  const values = Object.freeze([...(items || [])]);
  const page = normalizePage(options.pageNumber);
  const loadedBefore = Math.max(0, Number(options.loadedBefore) || 0);
  const batchCount = values.length;
  const loadedCount = loadedBefore + batchCount;
  const hasMore = options.hasMore === true;
  return Object.freeze({
    items: values,
    total: undefined,
    totalKnown: false,
    page,
    pages: undefined,
    pageSize: query.pageSize,
    rangeStart: batchCount ? loadedBefore + 1 : 0,
    rangeEnd: batchCount ? loadedCount : 0,
    batchCount,
    loadedCount,
    hasMore,
    hasPrevious: page > 1,
    isLastBatch: !hasMore,
  });
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
  const changesResultSet = ["search", "filters", "pageSize", "sort"].some(key => Object.hasOwn(patch, key));
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

export function itemMatchesEntityQuery(item, entity = {}, state = {}) {
  const query = createEntityQueryState(state);
  const filtersMatch = Object.entries(query.filters).every(([name, expected]) => {
    if (!expected) return true;
    return fieldValue(item, name).localeCompare(expected, "pt-BR", { sensitivity: "accent" }) === 0;
  });
  if (!filtersMatch) return false;
  const search = query.search.trim();
  if (!search) return true;
  const expectedPrefix = search.toLocaleUpperCase("pt-BR");
  return [...new Set(entity.searchFields || ["Title"])].some(name => {
    return fieldValue(item, name).toLocaleUpperCase("pt-BR").startsWith(expectedPrefix);
  });
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
