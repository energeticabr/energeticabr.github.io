const OPERATION_ALIASES = Object.freeze(new Map([
  ["sum", "sum"],
  ["count", "count"],
  ["countnonnull", "count"],
  ["distinct", "distinct-count"],
  ["distinctcount", "distinct-count"],
  ["average", "average"],
  ["avg", "average"],
  ["pendingsum", "pending-sum"],
  ["min", "min"],
  ["max", "max"],
  ["difference-sum", "difference-sum"],
  ["differencesum", "difference-sum"],
  ["weighted-rate", "weighted-rate"],
  ["weightedrate", "weighted-rate"],
  ["weighted-rate-sum", "weighted-rate-sum"],
  ["weightedratesum", "weighted-rate-sum"],
  ["status-count", "status-count"],
  ["statuscount", "status-count"],
]));

const AGGREGATE_EXPRESSION = /^\s*(sum|count|min|max|count[\s_-]*non[\s_-]*null|distinct(?:[\s_-]*count)?|average|avg)\s*\(\s*([^()]+?)\s*\)\s*$/iu;
const FIELD_REFERENCE = /^[\p{L}\p{N}_%][\p{L}\p{N}_% .()\/-]*$/u;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function list(value) {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const candidate = text(value);
    const key = candidate.toLocaleUpperCase("pt-BR");
    if (!candidate || seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function operationKey(value) {
  return text(value).toLocaleLowerCase("en-US").replace(/[\s_-]+/g, "");
}

function mappedOperation(value) {
  return OPERATION_ALIASES.get(operationKey(value));
}

function parseAggregateExpression(value) {
  const expression = text(value);
  const match = expression.match(AGGREGATE_EXPRESSION);
  if (!match) return null;
  const operation = mappedOperation(match[1]);
  return operation ? { operation, reference: match[2].trim() } : null;
}

function referenceParts(value) {
  if (Array.isArray(value)) return value.flatMap(referenceParts);
  if (value && typeof value === "object") return referenceParts(value.field);

  const reference = text(value);
  if (!reference) return [];
  const aggregate = parseAggregateExpression(reference);
  if (aggregate) return referenceParts(aggregate.reference);
  if (!FIELD_REFERENCE.test(reference)) return [];

  const segments = reference.split(".").map(part => part.trim()).filter(Boolean);
  const leaf = segments.at(-1) || reference;
  return segments.length > 1 ? [leaf, reference] : [reference];
}

function aliasesFrom(...values) {
  return uniqueStrings(values.flatMap(value => list(value).flatMap(referenceParts)));
}

function aggregateSources(contract) {
  const aggregate = contract?.aggregate;
  const aggregateOperation = aggregate && typeof aggregate === "object"
    ? aggregate.operation ?? aggregate.aggregate
    : aggregate;
  const expressions = [contract?.measure, ...list(contract?.measures)];
  return {
    operationCandidates: [contract?.operation, aggregateOperation, ...expressions.map(value => parseAggregateExpression(value)?.operation)],
    referenceCandidates: [
      aggregate && typeof aggregate === "object" ? aggregate.field : undefined,
      ...expressions.map(value => parseAggregateExpression(value)?.reference ?? value),
    ],
  };
}

function operationFor(contract) {
  const { operationCandidates } = aggregateSources(contract);
  for (const candidate of operationCandidates) {
    const operation = mappedOperation(candidate) || mappedOperation(parseAggregateExpression(candidate)?.operation);
    if (operation) return operation;
  }
  return "count";
}

function fallbackId(prefix, index) {
  return `${prefix}-${index + 1}`;
}

function fallbackTitle(prefix, index) {
  return `${prefix} ${index + 1}`;
}

function referenceTitle(value, fallback) {
  const aliases = aliasesFrom(value);
  return aliases[0] || fallback;
}

function slug(value, fallback) {
  const normalized = text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
}

function normalizeFilter(filter, index) {
  const contract = filter && typeof filter === "object" ? filter : { field: filter };
  const id = text(contract.id) || fallbackId("filter", index);
  const result = {
    id,
    title: text(contract.title) || referenceTitle(contract.field, fallbackTitle("FILTRO", index)),
    aliases: aliasesFrom(contract.aliases, contract.field),
  };
  if (text(contract.sourceEntityId)) result.sourceEntityId = text(contract.sourceEntityId);
  const sourceEntityIds = uniqueStrings(list(contract.sourceEntityIds));
  if (sourceEntityIds.length) result.sourceEntityIds = sourceEntityIds;
  if (text(contract.granularity)) result.granularity = text(contract.granularity);
  if (text(contract.scope)) result.scope = text(contract.scope);
  if (text(contract.operator)) result.operator = text(contract.operator);
  const values = uniqueStrings(list(contract.values));
  if (values.length) result.values = values;
  if (text(contract.selectionMode)) result.selectionMode = text(contract.selectionMode);
  if (text(contract.mode)) result.mode = text(contract.mode);
  return result;
}

function normalizeKpi(kpi, index) {
  const contract = kpi && typeof kpi === "object" ? kpi : {};
  const aggregate = aggregateSources(contract);
  const result = {
    id: text(contract.id) || fallbackId("kpi", index),
    title: text(contract.title) || fallbackTitle("KPI", index),
    operation: operationFor(contract),
    aliases: aliasesFrom(contract.aliases, contract.valueAliases, aggregate.referenceCandidates),
    statusAliases: aliasesFrom(contract.statusAliases),
    format: text(contract.format) || "number",
  };
  if (text(contract.sourceEntityId)) result.sourceEntityId = text(contract.sourceEntityId);
  const sourceEntityIds = uniqueStrings(list(contract.sourceEntityIds));
  if (sourceEntityIds.length) result.sourceEntityIds = sourceEntityIds;
  for (const [key, value] of [
    ["subtractAliases", contract.subtractAliases],
    ["quantityAliases", contract.quantityAliases],
    ["rateAliases", contract.rateAliases],
  ]) {
    const aliases = aliasesFrom(value);
    if (aliases.length) result[key] = aliases;
  }
  const statusValues = uniqueStrings(list(contract.statusValues));
  if (statusValues.length) result.statusValues = statusValues;
  return result;
}

function normalizeCrossFilters(value) {
  if (!value || typeof value !== "object") return undefined;
  return {
    filter: uniqueStrings(list(value.filter)),
    highlight: uniqueStrings(list(value.highlight)),
    none: uniqueStrings(list(value.none)),
  };
}

function normalizeChart(chart, index) {
  const contract = chart && typeof chart === "object" ? chart : {};
  const aggregate = aggregateSources(contract);
  const result = {
    id: text(contract.id) || fallbackId("chart", index),
    title: text(contract.title) || fallbackTitle("GRÁFICO", index),
    type: text(contract.type) || "barChart",
    dimensionAliases: aliasesFrom(contract.dimensionAliases, contract.dimension, contract.dimensions, contract.series),
    operation: operationFor(contract),
    valueAliases: aliasesFrom(contract.valueAliases, contract.aliases, aggregate.referenceCandidates),
    format: text(contract.format) || "number",
  };
  if (text(contract.sourceEntityId)) result.sourceEntityId = text(contract.sourceEntityId);
  const sourceEntityIds = uniqueStrings(list(contract.sourceEntityIds));
  if (sourceEntityIds.length) result.sourceEntityIds = sourceEntityIds;
  const seriesAliases = aliasesFrom(contract.seriesAliases, contract.series);
  if (seriesAliases.length) result.seriesAliases = seriesAliases;
  for (const [key, value] of [
    ["startAliases", contract.startAliases],
    ["endAliases", contract.endAliases],
    ["durationAliases", contract.durationAliases],
    ["progressAliases", contract.progressAliases],
  ]) {
    const aliases = aliasesFrom(value);
    if (aliases.length) result[key] = aliases;
  }
  const crossFilters = normalizeCrossFilters(contract.crossFilters);
  if (crossFilters) result.crossFilters = crossFilters;
  if (text(contract.interaction)) result.interaction = text(contract.interaction);
  return result;
}

function normalizeColumn(column, index) {
  const contract = column && typeof column === "object" ? column : { field: column };
  const fallback = fallbackId("column", index);
  const derivedTitle = referenceTitle(contract.field, "");
  const title = text(contract.title) || derivedTitle || fallbackTitle("COLUNA", index);
  return {
    id: text(contract.id) || (text(contract.title) || derivedTitle ? slug(title, fallback) : fallback),
    title,
    aliases: aliasesFrom(contract.aliases, contract.field),
    type: text(contract.type) || "text",
  };
}

function normalizeTable(table, index, inheritedColumns = []) {
  const source = table && typeof table === "object" ? table : {};
  const ownColumns = list(source.columns).length
    ? list(source.columns).map(normalizeColumn)
    : inheritedColumns.filter(column => !Array.isArray(source.columnIds) || source.columnIds.includes(column.id));
  const result = {
    id: text(source.id) || (index ? fallbackId("table", index) : "table"),
    title: text(source.title) || (index ? fallbackTitle("TABELA", index) : "TABELA"),
    columns: ownColumns,
  };
  if (text(source.sourceEntityId)) result.sourceEntityId = text(source.sourceEntityId);
  const sourceEntityIds = uniqueStrings(list(source.sourceEntityIds));
  if (sourceEntityIds.length) result.sourceEntityIds = sourceEntityIds;
  const crossFilters = normalizeCrossFilters(source.crossFilters);
  if (crossFilters) result.crossFilters = crossFilters;
  return result;
}

export function normalizeAnalyticsDefinition(definition = {}) {
  const source = definition && typeof definition === "object" ? definition : {};
  const table = source.table && typeof source.table === "object" ? source.table : {};
  const charts = list(source.charts).map(normalizeChart);
  const normalizedTable = normalizeTable(table, 0);
  const explicitTables = [
    ...(table.viewsOnly === true ? [] : [normalizedTable]),
    ...list(table.views).map((view, index) => normalizeTable(view, index + 1, normalizedTable.columns)),
  ].filter(candidate => candidate.columns.length || candidate.id !== "table" || candidate.title !== "TABELA");
  const visualTables = charts.filter(chart => /pivot|tableex/i.test(chart.type)).map((chart, index) => ({
    id: chart.id,
    title: chart.title,
    columns: [
      { id: "dimensao", title: "DIMENSÃO", aliases: chart.dimensionAliases, type: "text" },
      { id: "serie", title: "SÉRIE", aliases: chart.seriesAliases || [], type: "text" },
      { id: "valor", title: "VALOR", aliases: chart.valueAliases, type: chart.format || "number" },
    ].filter(column => column.aliases.length),
    ...(chart.sourceEntityId ? { sourceEntityId: chart.sourceEntityId } : {}),
    ...(chart.crossFilters ? { crossFilters: chart.crossFilters } : {}),
    visualType: `chart-table-${index + 1}`,
  }));
  const tables = [...explicitTables, ...visualTables].filter((candidate, index, values) => values.findIndex(item => item.id === candidate.id) === index);
  const result = {
    id: text(source.id) || "analytics",
    title: text(source.title) || "ANALYTICS",
    sourceEntityIds: uniqueStrings(list(source.sourceEntityIds)),
    filters: list(source.filters).map(normalizeFilter),
    kpis: list(source.kpis).map(normalizeKpi),
    charts,
    table: normalizedTable,
    tables,
  };
  return deepFreeze(result);
}

export default normalizeAnalyticsDefinition;
