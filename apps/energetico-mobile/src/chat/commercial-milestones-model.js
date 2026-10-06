const collator = new Intl.Collator("pt-BR", { numeric: false });
const key = value => value.toLocaleUpperCase("pt-BR");
const compare = (left, right) => collator.compare(left, right);
const DAY = 86_400_000;
const BLANK_START_ORDER = Date.parse("1900-01-01T00:00:00Z");
const LABELS = { branch: "SEM FILIAL", property: "SEM IMÓVEL", buyer: "N/A", contractId: "CONTRATO NÃO APONTADO", visualStatus: "SEM STATUS" };
const FIELDS = {
  properties: ["branch", "property", "visualStatus"],
  milestones: ["branch", "property", "buyer", "type", "description", "status"],
};

function identifier(value) {
  if (!["string", "number"].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new TypeError("ID inválido no relatório de marcos comerciais.");
  }
  return String(value);
}

function contractText(value) {
  if (value == null) return "";
  if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) {
    throw new TypeError("Campo de contrato inválido no relatório de marcos comerciais.");
  }
  // IDCONTRATO is SharePoint single-line text, not an item ID or numeric reference.
  return String(value).trim();
}

function parseDate(value) {
  if (value == null) return { date: "" };
  if (typeof value !== "string") throw new TypeError("Data inválida no relatório de marcos comerciais.");
  const raw = value.trim();
  if (!raw) return { date: "" };
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  const iso = /^(\d{4}-\d{2}-\d{2})(?:T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d+)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/.exec(raw);
  const date = br ? `${br[3]}-${br[2]}-${br[1]}` : iso?.[1] || "";
  const calendar = Date.parse(`${date}T00:00:00Z`);
  if (!date || !Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== date) {
    throw new RangeError("Data de calendário inválida no relatório de marcos comerciais.");
  }
  if (!iso?.[2]) return { date };
  // A timezone-free source timestamp is ordered deterministically, never in the device timezone.
  const order = Date.parse(iso[6] ? raw : `${raw}Z`);
  if (!Number.isFinite(order)) throw new RangeError("Data/hora inválida no relatório de marcos comerciais.");
  return { date, order };
}

/** Keep the source calendar day instead of moving an offset timestamp to UTC's day. */
export function normalizeCommercialMilestonesDate(value) {
  return parseDate(value).date;
}

/** Only timestamps need the additive startOrder; date-only public rows retain their fixed shape. */
export function normalizeCommercialMilestonesStart(value) {
  const { date, order } = parseDate(value);
  return { startDate: date, ...(order === undefined ? {} : { startOrder: order }) };
}

function normalizeRows(source, kind) {
  const ids = new Set(); const rows = [];
  for (const row of source) {
    const required = ["id", ...FIELDS[kind], ...(kind === "milestones" ? ["contractId", "startDate", "dueDate"] : [])];
    if (!row || typeof row !== "object" || Array.isArray(row) || required.some(field => !Object.hasOwn(row, field))) {
      throw new TypeError(`Registro ou campo incompleto no snapshot de marcos comerciais (${kind}).`);
    }
    const normalized = { id: identifier(row.id) };
    if (ids.has(normalized.id)) throw new TypeError("ID duplicado no snapshot de marcos comerciais.");
    ids.add(normalized.id);
    for (const field of FIELDS[kind]) {
      if (row[field] != null && typeof row[field] !== "string") throw new TypeError("Campo inválido no snapshot de marcos comerciais.");
      normalized[field] = (row[field] ?? "").trim();
    }
    if (kind === "milestones") {
      normalized.contractId = contractText(row.contractId);
      Object.assign(normalized, normalizeCommercialMilestonesStart(row.startDate));
      normalized.dueDate = normalizeCommercialMilestonesDate(row.dueDate);
      if (Object.hasOwn(row, "startOrder")) {
        if (!normalized.startDate || !Number.isSafeInteger(row.startOrder) || Math.abs(row.startOrder) > 8.64e15
          || normalized.startOrder !== undefined && normalized.startOrder !== row.startOrder) {
          throw new TypeError("Ordem de data inválida no snapshot de marcos comerciais.");
        }
        normalized.startOrder = row.startOrder;
      }
    }
    rows.push(normalized);
  }
  return rows;
}

function normalizeFilters(filters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) throw new TypeError("Filtros inválidos no relatório de marcos comerciais.");
  return Object.fromEntries(Object.keys(LABELS).map(field => {
    const value = filters[field];
    if (value != null && typeof value !== "string" && !(field === "contractId" && typeof value === "number" && Number.isFinite(value))) {
      throw new TypeError("Filtro inválido no relatório de marcos comerciais.");
    }
    return [field, String(value ?? "").trim()];
  }));
}

const orderOf = row => row.startOrder ?? (row.startDate ? Date.parse(`${row.startDate}T00:00:00Z`) : BLANK_START_ORDER);
const groupKey = row => JSON.stringify([key(row.propertyLabel), key(row.contractLabel)]);
function options(values) {
  const unique = new Map();
  for (const value of values) if (!unique.has(key(value))) unique.set(key(value), value);
  return [...unique.values()].sort(compare);
}

/** Pure PowerFx projection. Validate all source rows before any filter can conceal invalid data. */
export function buildCommercialMilestones(snapshot, filters = {}, today) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || snapshot.complete !== true
    || !Array.isArray(snapshot.properties) || !Array.isArray(snapshot.milestones)
    || snapshot.incomplete || snapshot.partial || snapshot.truncated || snapshot.aborted || snapshot.error) {
    throw new TypeError("Snapshot de marcos comerciais inválido ou incompleto.");
  }
  if (typeof today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(today) || normalizeCommercialMilestonesDate(today) !== today) {
    throw new TypeError("Data de hoje inválida no relatório de marcos comerciais.");
  }
  const properties = normalizeRows(snapshot.properties, "properties");
  const milestones = normalizeRows(snapshot.milestones, "milestones");
  const selection = normalizeFilters(filters);
  const detail = Boolean(selection.contractId || selection.buyer || selection.property);
  // PowerFx LookUp compares PROPERTY NAME only and returns the first match, even a blank status.
  const visualByName = new Map();
  for (const row of properties) if (!visualByName.has(key(row.property))) visualByName.set(key(row.property), row.visualStatus);
  const todayOrder = Date.parse(`${today}T00:00:00Z`);
  const normalized = milestones.map(row => ({ ...row,
    branchLabel: row.branch || LABELS.branch, propertyLabel: row.property || LABELS.property,
    buyerLabel: row.buyer || LABELS.buyer, contractLabel: row.contractId || LABELS.contractId,
    visualStatus: visualByName.get(key(row.property)) || LABELS.visualStatus,
    daysInProgress: row.startDate ? (todayOrder - Date.parse(`${row.startDate}T00:00:00Z`)) / DAY : null,
    daysToDue: row.dueDate ? (Date.parse(`${row.dueDate}T00:00:00Z`) - todayOrder) / DAY : null,
  }));
  const labelField = { branch: "branchLabel", property: "propertyLabel", buyer: "buyerLabel", contractId: "contractLabel", visualStatus: "visualStatus" };
  const filterOptions = Object.fromEntries(Object.entries(labelField).map(([field, label]) => [field, options(normalized.map(row => row[label]))]));
  const filtered = normalized.filter(row => Object.entries(selection).every(([field, value]) => !value
    || key(row[field]) === key(value) || key(row[labelField[field]]) === key(value)));
  const branchGroups = new Map();
  for (const row of filtered) {
    const branchKey = key(row.branchLabel);
    if (!branchGroups.has(branchKey)) branchGroups.set(branchKey, { name: row.branchLabel, rows: [] });
    branchGroups.get(branchKey).rows.push(row);
  }
  const branches = [...branchGroups.values()].sort((a, b) => compare(a.name, b.name)).map(branch => {
    let rows;
    if (detail) {
      const latest = new Map();
      for (const row of branch.rows) latest.set(groupKey(row), Math.max(latest.get(groupKey(row)) ?? -Infinity, orderOf(row)));
      rows = branch.rows.map(row => ({ ...row, isLatest: orderOf(row) === latest.get(groupKey(row)) }))
        .sort((a, b) => compare(a.propertyLabel, b.propertyLabel) || compare(a.buyerLabel, b.buyerLabel)
          || compare(a.contractId || "SEM CONTRATO", b.contractId || "SEM CONTRATO") || orderOf(b) - orderOf(a));
    } else {
      const latest = new Map();
      for (const row of branch.rows) {
        const propertyKey = key(row.propertyLabel);
        if (!latest.has(propertyKey) || orderOf(row) > orderOf(latest.get(propertyKey))) latest.set(propertyKey, row);
      }
      rows = [...latest.values()].map(row => ({ ...row, isLatest: true })).sort((a, b) => compare(a.propertyLabel, b.propertyLabel));
    }
    return { name: branch.name, rows, count: rows.length };
  });
  return { detail, branches, filterOptions };
}
