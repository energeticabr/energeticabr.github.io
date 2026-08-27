function fieldValue(record, aliases = []) {
  const fields = record?.fields || {};
  for (const alias of aliases || []) {
    const value = fields[alias];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function normalized(value) {
  return String(value ?? "").trim().toLocaleUpperCase("pt-BR");
}

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let text = String(value ?? "").trim().replace(/\s/g, "");
  if (!text) return 0;
  if (text.includes(",")) text = text.replaceAll(".", "").replace(",", ".");
  const number = Number(text.replace(/[^0-9+\-.]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function calendarDate(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value ?? "");
}

function frozenRow(value) {
  return Object.freeze({ ...value });
}

function sourceMatches(record, contract = {}) {
  const expectedMany = Array.isArray(contract.sourceEntityIds) ? contract.sourceEntityIds.map(String) : [];
  if (expectedMany.length) return expectedMany.includes(String(record?.sourceId || ""));
  const expected = String(contract.sourceEntityId || "").trim();
  return !expected || String(record?.sourceId || "") === expected;
}

function statusMatches(row, metric) {
  const status = normalized(fieldValue(row, metric.statusAliases || ["STATUS"]));
  const values = (metric.statusValues || []).map(normalized).filter(Boolean);
  if (values.length) return values.includes(status);
  return /PENDENTE|AGUARDANDO|ATRASAD|ABERTO|EM ANDAMENTO/.test(status);
}

function metricValue(rows, metric = {}) {
  if (metric.operation === "count") {
    return metric.aliases?.length
      ? rows.filter(row => fieldValue(row, metric.aliases) !== undefined).length
      : rows.length;
  }
  if (metric.operation === "status-count") return rows.filter(row => statusMatches(row, metric)).length;
  if (metric.operation === "distinct-count") {
    return new Set(rows.map(row => normalized(fieldValue(row, metric.aliases))).filter(Boolean)).size;
  }
  const values = rows.map(row => finiteNumber(fieldValue(row, metric.aliases)));
  if (metric.operation === "sum") return values.reduce((total, value) => total + value, 0);
  if (metric.operation === "average") return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
  if (metric.operation === "min" || metric.operation === "max") {
    const raw = rows.map(row => fieldValue(row, metric.aliases)).filter(value => value !== undefined);
    if (!raw.length) return "";
    const numeric = raw.every(value => String(value).trim() !== "" && Number.isFinite(Number(value)));
    const sorted = [...raw].sort((left, right) => numeric
      ? Number(left) - Number(right)
      : String(left).localeCompare(String(right), "pt-BR", { numeric: true }));
    return metric.operation === "min" ? sorted[0] : sorted.at(-1);
  }
  if (metric.operation === "difference-sum") {
    const added = values.reduce((total, value) => total + value, 0);
    const removed = rows.reduce((total, row) => total + finiteNumber(fieldValue(row, metric.subtractAliases)), 0);
    return added - removed;
  }
  if (metric.operation === "weighted-rate" || metric.operation === "weighted-rate-sum") {
    let weightedBase = 0;
    let weightedRate = 0;
    for (const row of rows) {
      const quantity = metric.quantityAliases?.length ? finiteNumber(fieldValue(row, metric.quantityAliases)) : 1;
      const base = finiteNumber(fieldValue(row, metric.aliases));
      const rate = finiteNumber(fieldValue(row, metric.rateAliases)) / 100;
      weightedBase += quantity * base;
      weightedRate += quantity * base * rate;
    }
    return metric.operation === "weighted-rate" ? (weightedBase ? weightedRate / weightedBase : 0) : weightedRate;
  }
  if (metric.operation === "pending-sum") {
    return rows.reduce((total, row) => statusMatches(row, metric)
      ? total + finiteNumber(fieldValue(row, metric.aliases))
      : total, 0);
  }
  return 0;
}

const MONTHS = Object.freeze([
  "JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
  "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO",
]);

function granularValue(value, granularity) {
  const source = String(value ?? "").trim();
  if (!granularity || !source) return source;
  const match = source.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return source;
  if (granularity === "year") return match[1];
  if (granularity === "month") return MONTHS[Number(match[2]) - 1] || source;
  if (granularity === "day") return match[3];
  return source;
}

function filterRecord(record, filter, selectedValues) {
  if (filter?.scope === "global" && filter.sourceEntityId && !sourceMatches(record, filter)) return true;
  const raw = fieldValue(record, filter?.aliases);
  if (raw === undefined) return true;
  const candidate = normalized(granularValue(raw, filter?.granularity));
  const selected = (Array.isArray(selectedValues) ? selectedValues : [selectedValues]).map(normalized).filter(Boolean);
  if (!selected.length) return true;
  return filter?.selectionMode === "inverted" ? !selected.includes(candidate) : selected.includes(candidate);
}

function normalizedCrossFilters(contract = {}) {
  const value = contract.crossFilters || {};
  return {
    filter: value.filter || [],
    highlight: value.highlight || [],
    none: value.none || [],
  };
}

function tableContracts(definition) {
  if (Array.isArray(definition.tables)) return definition.tables;
  return definition.table ? [definition.table] : [];
}

export function createAnalyticsModel(records = [], definition = {}) {
  const source = Object.freeze([...(records || [])]);
  const filters = definition.filters || [];
  const filterDefinitions = new Map(filters.map(filter => [String(filter.id), filter]));
  const metricDefinitions = new Map((definition.kpis || []).map(metric => [String(metric.id), metric]));
  const chartDefinitions = new Map((definition.charts || []).map(chart => [String(chart.id), chart]));
  const tables = tableContracts(definition);
  const tableDefinitions = new Map(tables.map(table => [String(table.id), table]));
  const active = new Map();
  const selections = new Map();
  const presetFilters = filters.filter(filter => filter.scope === "global" && Array.isArray(filter.values) && filter.values.length);

  function activeFilters() {
    return Object.freeze(Object.fromEntries([...active].map(([id, values]) => [id, values.length === 1 ? values[0] : Object.freeze([...values])])));
  }

  function slicerFilteredRecords(rows = source) {
    return rows.filter(record => presetFilters.every(filter => filterRecord(record, filter, filter.values))
      && [...active].every(([id, values]) => filterRecord(record, filterDefinitions.get(id), values)));
  }

  function effectFor(sourceVisualId, targetId) {
    if (sourceVisualId === targetId) return "self";
    const contract = chartDefinitions.get(sourceVisualId) || tableDefinitions.get(sourceVisualId) || {};
    const cross = normalizedCrossFilters(contract);
    if (cross.none.includes(targetId)) return "none";
    if (cross.filter.includes(targetId)) return "filter";
    if (cross.highlight.includes(targetId)) return "highlight";
    const explicit = cross.none.length || cross.filter.length || cross.highlight.length;
    return !explicit && contract.interaction !== "none" ? "filter" : "none";
  }

  function visualRows(contract = {}, targetId = "") {
    let rows = slicerFilteredRecords(source.filter(record => sourceMatches(record, contract)));
    for (const [sourceVisualId, selection] of selections) {
      if (effectFor(sourceVisualId, targetId) !== "filter") continue;
      rows = rows.filter(record => {
        const value = fieldValue(record, selection.aliases);
        return value === undefined || normalized(value) === normalized(selection.value);
      });
    }
    return rows;
  }

  function filteredRecords() {
    return Object.freeze(slicerFilteredRecords());
  }

  function filterOptions(id) {
    const key = String(id);
    const filter = filterDefinitions.get(key);
    if (!filter) throw new RangeError(`Filtro analítico desconhecido: ${key}`);
    const rows = source.filter(record => sourceMatches(record, filter));
    const available = rows.filter(record => presetFilters.every(preset => filterRecord(record, preset, preset.values))
      && [...active].every(([activeId, values]) => activeId === key
        || filterRecord(record, filterDefinitions.get(activeId), values)));
    return Object.freeze([...new Map(available.map(row => {
      const value = granularValue(fieldValue(row, filter.aliases), filter.granularity);
      return [normalized(value), String(value ?? "").trim()];
    }).filter(([keyValue]) => Boolean(keyValue))).values()]
      .sort((left, right) => {
        if (filter.granularity === "month") return MONTHS.indexOf(left) - MONTHS.indexOf(right);
        return left.localeCompare(right, "pt-BR", { numeric: true });
      }));
  }

  function toggleFilter(id, value) {
    const key = String(id);
    if (!filterDefinitions.has(key)) throw new RangeError(`Filtro analítico desconhecido: ${key}`);
    const values = (Array.isArray(value) ? value : [value]).map(item => String(item ?? "").trim()).filter(Boolean);
    const previous = active.get(key) || [];
    if (values.length && previous.length === values.length && values.every((item, index) => normalized(item) === normalized(previous[index]))) active.delete(key);
    else if (values.length) active.set(key, values);
    else active.delete(key);
    return activeFilters();
  }

  function toggleVisualSelection(id, value, aliases) {
    const key = String(id);
    const visual = chartDefinitions.get(key) || tableDefinitions.get(key);
    if (!visual) throw new RangeError(`Visual analítico desconhecido: ${key}`);
    const previous = selections.get(key);
    if (previous && normalized(previous.value) === normalized(value)) selections.delete(key);
    else selections.set(key, Object.freeze({
      value: String(value ?? ""),
      aliases: Object.freeze([...(Array.isArray(aliases) && aliases.length ? aliases : visual.dimensionAliases || [])]),
    }));
    return visualSelections();
  }

  function visualSelections() {
    return Object.freeze(Object.fromEntries([...selections].map(([id, selection]) => [id, selection.value])));
  }

  function interactionState(targetId) {
    const filteredBy = [];
    const highlightedBy = [];
    for (const sourceVisualId of selections.keys()) {
      const effect = effectFor(sourceVisualId, String(targetId));
      if (effect === "filter") filteredBy.push(sourceVisualId);
      if (effect === "highlight") highlightedBy.push(sourceVisualId);
    }
    return Object.freeze({ filteredBy: Object.freeze(filteredBy), highlightedBy: Object.freeze(highlightedBy) });
  }

  function clearFilters() {
    active.clear();
    selections.clear();
    return activeFilters();
  }

  function metric(id) {
    const key = String(id);
    const contract = metricDefinitions.get(key);
    if (!contract) throw new RangeError(`Métrica analítica desconhecida: ${id}`);
    return metricValue(visualRows(contract, key), contract);
  }

  function series(id) {
    const key = String(id);
    const chart = chartDefinitions.get(key);
    if (!chart) throw new RangeError(`Gráfico analítico desconhecido: ${id}`);
    const highlights = [...selections].filter(([sourceVisualId]) => effectFor(sourceVisualId, key) === "highlight");
    const groups = new Map();
    for (const row of visualRows(chart, key)) {
      const raw = fieldValue(row, chart.dimensionAliases);
      const label = String(raw || "Não informado");
      const seriesRaw = fieldValue(row, chart.seriesAliases);
      const seriesLabel = chart.seriesAliases?.length ? String(seriesRaw || "Não informado") : "";
      const groupKey = `${normalized(label) || "NÃO INFORMADO"}\u0000${normalized(seriesLabel)}`;
      if (!groups.has(groupKey)) groups.set(groupKey, { key: groupKey, label, seriesLabel, rows: [] });
      groups.get(groupKey).rows.push(row);
    }
    const totals = new Map();
    for (const group of groups.values()) {
      const value = metricValue(group.rows, {
        operation: chart.operation || "count",
        aliases: chart.valueAliases,
        statusAliases: chart.statusAliases,
      });
      group.value = value;
      totals.set(normalized(group.label), (totals.get(normalized(group.label)) || 0) + finiteNumber(value));
    }
    return Object.freeze([...groups.values()].map(group => {
      const row = {
        key: group.seriesLabel ? group.key : group.key.split("\u0000")[0],
        label: group.label,
        value: group.value,
      };
      if (chart.seriesAliases?.length) {
        row.seriesKey = normalized(group.seriesLabel) || "NÃO INFORMADO";
        row.seriesLabel = group.seriesLabel;
        const total = totals.get(normalized(group.label)) || 0;
        row.percentage = total ? finiteNumber(group.value) / total * 100 : 0;
      }
      if (highlights.length) {
        row.highlighted = highlights.every(([, selection]) => group.rows.some(record => {
          const candidate = fieldValue(record, selection.aliases);
          return candidate !== undefined && normalized(candidate) === normalized(selection.value);
        }));
      }
      return frozenRow(row);
    }).sort((left, right) => right.value - left.value
      || left.label.localeCompare(right.label, "pt-BR", { numeric: true })
      || String(left.seriesLabel || "").localeCompare(String(right.seriesLabel || ""), "pt-BR", { numeric: true })));
  }

  function timeline(id) {
    const key = String(id);
    const chart = chartDefinitions.get(key);
    if (!chart) throw new RangeError(`Gráfico analítico desconhecido: ${id}`);
    return Object.freeze(visualRows(chart, key).map(row => {
      const start = String(fieldValue(row, chart.startAliases) || "");
      const end = String(fieldValue(row, chart.endAliases) || "");
      const explicitDuration = finiteNumber(fieldValue(row, chart.durationAliases));
      const difference = start && end ? Math.max(0, Math.round((new Date(end) - new Date(start)) / 86400000)) : 0;
      return frozenRow({
        id: String(row.id ?? ""),
        label: String(fieldValue(row, chart.dimensionAliases) || "Não informado"),
        start,
        end,
        duration: explicitDuration || difference,
        progress: finiteNumber(fieldValue(row, chart.progressAliases)),
        sourceId: String(row.sourceId || ""),
      });
    }).filter(item => item.start || item.end));
  }

  function tableRows(tableId) {
    const contract = tableId
      ? tableDefinitions.get(String(tableId))
      : tables[0] || definition.table || { columns: [] };
    if (!contract) throw new RangeError(`Tabela analítica desconhecida: ${tableId}`);
    const columns = contract.columns || [];
    return Object.freeze(visualRows(contract, String(contract.id || "table")).map(record => frozenRow(Object.fromEntries([
      ["id", String(record.id ?? "")],
      ["sourceId", String(record.sourceId ?? "")],
      ...columns.map(column => {
        const value = fieldValue(record, column.aliases);
        return [String(column.id), column.type === "date" ? calendarDate(value) : String(value ?? "")];
      }),
    ]))));
  }

  return Object.freeze({
    activeFilters,
    visualSelections,
    interactionState,
    toggleVisualSelection,
    toggleFilter,
    clearFilters,
    filterOptions,
    filteredRecords,
    metric,
    series,
    timeline,
    tableRows,
    exportRows: tableRows,
  });
}
