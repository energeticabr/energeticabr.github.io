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

function exactFilterExpression(column, value, operator = "eq") {
  const field = safeFieldName(column?.name);
  if (!field || column?.indexed !== true) return undefined;
  if (operator === "in") {
    let selected;
    try {
      selected = JSON.parse(String(value || ""));
    } catch {
      return undefined;
    }
    if (!Array.isArray(selected) || !selected.length || selected.length > 50) return undefined;
    const expressions = [...new Set(selected.map(entry => String(entry).trim()).filter(Boolean))]
      .map(entry => exactFilterExpression(column, entry, "eq"));
    return expressions.length && expressions.every(Boolean) ? `(${expressions.join(" or ")})` : undefined;
  }
  if (["text", "select"].includes(column.control) && operator === "eq") return `fields/${field} eq ${odataString(value)}`;
  if (["number", "currency"].includes(column.control) && operator === "eq") {
    const numeric = Number(String(value).replace(",", "."));
    return Number.isFinite(numeric) ? `fields/${field} eq ${numeric}` : undefined;
  }
  if (["date", "datetime-local"].includes(column.control) && ["eq", "gte", "lte"].includes(operator)) {
    const normalized = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(normalized)) return undefined;
    const graphOperator = operator === "gte" ? "ge" : operator === "lte" ? "le" : "eq";
    return `fields/${field} ${graphOperator} ${odataString(normalized)}`;
  }
  return undefined;
}

function filterTarget(entity, name) {
  const multiple = (entity.filterDefinitions || []).find(candidate => (
    candidate?.kind === "multiple" && candidate.field === name
  ));
  if (multiple) return { field: name, operator: "in" };
  const range = /^(.*)__(gte|lte)$/.exec(String(name || ""));
  if (!range) return { field: String(name || ""), operator: "eq" };
  const definition = (entity.filterDefinitions || []).find(candidate => (
    candidate?.kind === "date-range" && candidate.field === range[1]
  ));
  return definition ? { field: range[1], operator: range[2] } : { field: String(name || ""), operator: "eq" };
}

function explicitFilterDefinition(entity, name) {
  if (entity.filterDefinitionsProven !== true) return undefined;
  const range = /^(.*)__(gte|lte)$/.exec(String(name || ""));
  const field = range ? range[1] : String(name || "");
  return (entity.filterDefinitions || []).find(candidate => candidate?.field === field);
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
  return String(column?.name || "").trim().toUpperCase() === "ID" || Boolean(sortableGraphField(column));
}

export function buildEntityGraphRequest(entity = {}, columns = [], state = {}) {
  const query = createEntityQueryState(state);
  const columnMap = new Map((columns || []).map(column => [column.name, column]));
  const limitations = [];
  const notices = [];
  const expressions = [];
  const filteredFields = new Set();
  let mode = "incremental";
  let clientRequired = false;
  let searchPlan;
  const activeFilters = Object.entries(query.filters).filter(([, value]) => value);

  for (const [name, value] of activeFilters) {
    const target = filterTarget(entity, name);
    const column = columnMap.get(target.field);
    const expression = exactFilterExpression(column, value, target.operator);
    if (!expression) {
      if (explicitFilterDefinition(entity, name)) clientRequired = true;
      else limitations.push(`O filtro ${column?.label || name} não pode ser executado com segurança pelo Microsoft Graph porque a coluna não é indexada ou não possui um tipo compatível.`);
      continue;
    }
    expressions.push(expression);
    filteredFields.add(target.field);
  }

  const search = query.search.trim();
  if (search) {
    const fields = [...new Set(entity.searchFields || ["Title"])];
    const searchDefinitions = entity.searchDefinitions || [];
    const containsSearch = entity.searchDefinitionsProven === true
      && searchDefinitions.some(definition => definition?.kind === "contains");
    const searchableFields = fields.map(name => searchableGraphField(columnMap.get(name))).filter(Boolean);
    if (containsSearch && searchDefinitions.length) {
      clientRequired = true;
    } else if (!searchableFields.length) {
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
    const allFiltersProven = activeFilters.every(([name]) => Boolean(explicitFilterDefinition(entity, name)));
    if (allFiltersProven) clientRequired = true;
    else limitations.push("O Microsoft Graph permite filtrar esta lista por apenas um campo indexado de cada vez.");
  }

  if (entity.id === "lancamentos" && String(query.sort.field || "").trim().toUpperCase() === "ID") clientRequired = true;

  const blocked = limitations.length > 0;
  if (!blocked && clientRequired) {
    mode = "bounded-client-query";
    notices.push("Esta combinação comprovada pelo Power Apps é avaliada sobre a lista completa protegida pelo limite de paginação do portal.");
  }
  const parameters = new URLSearchParams();
  parameters.set("$expand", "fields");
  parameters.set("$top", String(query.pageSize));
  if (!blocked && mode !== "bounded-client-query" && expressions.length) parameters.set("$filter", expressions.join(" and "));
  const sortColumn = columnMap.get(query.sort.field);
  const sortField = sortableGraphField(sortColumn)
    || (String(query.sort.field || "").trim().toUpperCase() === "ID" ? "ID" : "");
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
  const hasExplicitSortField = Object.hasOwn(sort, "field");
  return Object.freeze({
    search: String(initial.search || ""),
    page: normalizePage(initial.page),
    pageSize: normalizePageSize(initial.pageSize),
    sort: Object.freeze({
      field: hasExplicitSortField ? String(sort.field || "").trim() : "Title",
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
    const target = filterTarget(entity, name);
    const actual = fieldValue(item, target.field);
    if (target.operator === "in") {
      try {
        const selected = JSON.parse(String(expected || ""));
        return Array.isArray(selected) && selected.some(value => actual.localeCompare(String(value), "pt-BR", { sensitivity: "accent" }) === 0);
      } catch {
        return false;
      }
    }
    if (target.operator === "gte") return actual && actual.localeCompare(expected, "pt-BR") >= 0;
    if (target.operator === "lte") return actual && actual.localeCompare(expected, "pt-BR") <= 0;
    return actual.localeCompare(expected, "pt-BR", { sensitivity: "accent" }) === 0;
  });
  if (!filtersMatch) return false;
  const search = query.search.trim();
  if (!search) return true;
  const terms = [...new Set(search.split(/\s+/u).map(value => value.trim().toLocaleUpperCase("pt-BR")).filter(Boolean))];
  const definitions = entity.searchDefinitions?.length
    ? entity.searchDefinitions
    : [...new Set(entity.searchFields || ["Title"])].map(field => ({ kind: "contains", field }));
  return terms.every(expected => definitions.some(definition => {
      const actual = fieldValue(item, definition.field).toLocaleUpperCase("pt-BR");
      return definition.kind === "contains" ? actual.includes(expected) : actual.startsWith(expected);
    }));
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
  const filtered = (items || []).filter(item => itemMatchesEntityQuery(item, entity, query));
  const result = sortAndFilterItems(filtered, { ...entity, searchFields: [] }, { ...query, search: "", status: "" });
  const rangeStart = result.total ? ((result.page - 1) * result.pageSize) + 1 : 0;
  const rangeEnd = result.total ? rangeStart + result.items.length - 1 : 0;
  return Object.freeze({ ...result, rangeStart, rangeEnd });
}
