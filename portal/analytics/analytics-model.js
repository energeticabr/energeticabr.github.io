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

function metricValue(rows, metric) {
  if (metric.operation === "count") return rows.length;
  if (metric.operation === "distinct-count") {
    return new Set(rows.map(row => normalized(fieldValue(row, metric.aliases))).filter(Boolean)).size;
  }
  const values = rows.map(row => finiteNumber(fieldValue(row, metric.aliases)));
  if (metric.operation === "sum") return values.reduce((total, value) => total + value, 0);
  if (metric.operation === "average") return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
  if (metric.operation === "pending-sum") {
    return rows.reduce((total, row) => {
      const status = normalized(fieldValue(row, metric.statusAliases || ["STATUS"]));
      return /PENDENTE|AGUARDANDO|ATRASAD|ABERTO|EM ANDAMENTO/.test(status)
        ? total + finiteNumber(fieldValue(row, metric.aliases))
        : total;
    }, 0);
  }
  return 0;
}

export function createAnalyticsModel(records = [], definition = {}) {
  const source = Object.freeze([...(records || [])]);
  const filterDefinitions = new Map((definition.filters || []).map(filter => [String(filter.id), filter]));
  const metricDefinitions = new Map((definition.kpis || []).map(metric => [String(metric.id), metric]));
  const chartDefinitions = new Map((definition.charts || []).map(chart => [String(chart.id), chart]));
  const active = new Map();

  function activeFilters() {
    return Object.freeze(Object.fromEntries(active));
  }

  function filteredRecords() {
    return Object.freeze(source.filter(record => [...active].every(([id, selected]) => {
      const filter = filterDefinitions.get(id);
      return normalized(fieldValue(record, filter?.aliases)) === normalized(selected);
    })));
  }

  function toggleFilter(id, value) {
    const key = String(id);
    if (!filterDefinitions.has(key)) throw new RangeError(`Filtro analítico desconhecido: ${key}`);
    if (normalized(active.get(key)) === normalized(value)) active.delete(key);
    else active.set(key, String(value ?? ""));
    return activeFilters();
  }

  function clearFilters() {
    active.clear();
    return activeFilters();
  }

  function metric(id) {
    const contract = metricDefinitions.get(String(id));
    if (!contract) throw new RangeError(`Métrica analítica desconhecida: ${id}`);
    return metricValue(filteredRecords(), contract);
  }

  function series(id) {
    const chart = chartDefinitions.get(String(id));
    if (!chart) throw new RangeError(`Gráfico analítico desconhecido: ${id}`);
    const groups = new Map();
    for (const row of filteredRecords()) {
      const raw = fieldValue(row, chart.dimensionAliases);
      const key = normalized(raw) || "NÃO INFORMADO";
      if (!groups.has(key)) groups.set(key, { key, label: String(raw || "Não informado"), rows: [] });
      groups.get(key).rows.push(row);
    }
    return Object.freeze([...groups.values()]
      .map(group => frozenRow({
        key: group.key,
        label: group.label,
        value: metricValue(group.rows, {
          operation: chart.operation || "count",
          aliases: chart.valueAliases,
          statusAliases: chart.statusAliases,
        }),
      }))
      .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, "pt-BR", { numeric: true })));
  }

  function tableRows() {
    const columns = definition.table?.columns || [];
    return Object.freeze(filteredRecords().map(record => frozenRow(Object.fromEntries([
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
    toggleFilter,
    clearFilters,
    filteredRecords,
    metric,
    series,
    tableRows,
    exportRows: tableRows,
  });
}
