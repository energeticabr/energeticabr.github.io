const OPERATION_ALIASES = Object.freeze(new Map([
  ["sum", "sum"],
  ["count", "count"],
  ["countnonnull", "count"],
  ["distinct", "distinct-count"],
  ["distinctcount", "distinct-count"],
  ["average", "average"],
  ["avg", "average"],
  ["pendingsum", "pending-sum"],
]));

const AGGREGATE_EXPRESSION = /^\s*(sum|count|count[\s_-]*non[\s_-]*null|distinct(?:[\s_-]*count)?|average|avg)\s*\(\s*([^()]+?)\s*\)\s*$/iu;
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
  return {
    id,
    title: text(contract.title) || referenceTitle(contract.field, fallbackTitle("FILTRO", index)),
    aliases: aliasesFrom(contract.aliases, contract.field),
  };
}

function normalizeKpi(kpi, index) {
  const contract = kpi && typeof kpi === "object" ? kpi : {};
  const aggregate = aggregateSources(contract);
  return {
    id: text(contract.id) || fallbackId("kpi", index),
    title: text(contract.title) || fallbackTitle("KPI", index),
    operation: operationFor(contract),
    aliases: aliasesFrom(contract.aliases, contract.valueAliases, aggregate.referenceCandidates),
    statusAliases: aliasesFrom(contract.statusAliases),
    format: text(contract.format) || "number",
  };
}

function normalizeChart(chart, index) {
  const contract = chart && typeof chart === "object" ? chart : {};
  const aggregate = aggregateSources(contract);
  return {
    id: text(contract.id) || fallbackId("chart", index),
    title: text(contract.title) || fallbackTitle("GRÁFICO", index),
    type: text(contract.type) || "barChart",
    dimensionAliases: aliasesFrom(contract.dimensionAliases, contract.dimension, contract.dimensions, contract.series),
    operation: operationFor(contract),
    valueAliases: aliasesFrom(contract.valueAliases, contract.aliases, aggregate.referenceCandidates),
    format: text(contract.format) || "number",
  };
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

export function normalizeAnalyticsDefinition(definition = {}) {
  const source = definition && typeof definition === "object" ? definition : {};
  const table = source.table && typeof source.table === "object" ? source.table : {};
  const result = {
    id: text(source.id) || "analytics",
    title: text(source.title) || "ANALYTICS",
    sourceEntityIds: uniqueStrings(list(source.sourceEntityIds)),
    filters: list(source.filters).map(normalizeFilter),
    kpis: list(source.kpis).map(normalizeKpi),
    charts: list(source.charts).map(normalizeChart),
    table: {
      id: text(table.id) || "table",
      title: text(table.title) || "TABELA",
      columns: list(table.columns).map(normalizeColumn),
    },
  };
  return deepFreeze(result);
}

export default normalizeAnalyticsDefinition;
