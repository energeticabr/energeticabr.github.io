function normalizedValue(value) {
  return String(value ?? "").trim() || "NÃO INFORMADO";
}
export function createCrossFilterModel(rows = []) {
  const records = Object.freeze([...(rows || [])]);
  const filters = new Map();
  function matches(row, except = "") {
    for (const [dimension, value] of filters) {
      if (dimension !== except && normalizedValue(row?.[dimension]) !== value) return false;
    }
    return true;
  }
  return Object.freeze({
    toggle(dimension, value) {
      const key = String(dimension || "").trim();
      if (!key) throw new TypeError("O filtro requer uma dimensão.");
      const normalized = normalizedValue(value);
      if (filters.get(key) === normalized) filters.delete(key);
      else filters.set(key, normalized);
    },
    clear() { filters.clear(); },
    filtered() { return Object.freeze(records.filter(row => matches(row))); },
    filteredExcept(dimension) { return Object.freeze(records.filter(row => matches(row, dimension))); },
    activeFilters() { return Object.freeze(Object.fromEntries(filters)); },
  });
}

export function buildChartSeries(rows = [], dimension) {
  const counts = new Map();
  for (const row of rows || []) {
    const key = normalizedValue(row?.[dimension]);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.freeze([...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "pt-BR", { numeric: true }))
    .map(([key, value]) => Object.freeze({ key, label: key, value })));
}
