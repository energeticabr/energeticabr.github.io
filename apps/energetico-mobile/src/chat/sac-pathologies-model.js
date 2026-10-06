import Decimal from "decimal.js";
import { normalizeCommercialMilestonesDate } from "./commercial-milestones-model.js";
import { normalizeCommercialReceiptsAmount } from "./commercial-receipts-model.js";

const FILTER_FIELDS = ["id", "branch", "property", "client", "type", "status"];
const TEXT_FIELDS = ["branch", "property", "client", "type", "status", "description"];
const ROW_FIELDS = ["id", ...TEXT_FIELDS, "startDate", "endDate", "cost"];
const key = value => value.toLocaleUpperCase("pt-BR");
const compare = (left, right) => left.localeCompare(right, "pt-BR");
const DAY = 86_400_000;

function identifier(value) {
  if (!["string", "number"].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new TypeError("ID inválido no snapshot de patologias.");
  }
  return String(value);
}

function text(value) {
  if (value == null) return "";
  if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) {
    throw new TypeError("Campo inválido no snapshot de patologias.");
  }
  return String(value).trim();
}

/** Validate the entire source before a filter or the display cap can hide bad data. */
export function normalizeSacPathologiesSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || snapshot.complete !== true
    || !Array.isArray(snapshot.rows) || snapshot.partial || snapshot.incomplete || snapshot.truncated || snapshot.aborted || snapshot.error) {
    throw new TypeError("Snapshot de patologias inválido ou incompleto.");
  }
  const ids = new Set(); const rows = [];
  for (const source of snapshot.rows) {
    if (!source || typeof source !== "object" || Array.isArray(source) || ROW_FIELDS.some(field => !Object.hasOwn(source, field))) {
      throw new TypeError("Registro ou campo incompleto no snapshot de patologias.");
    }
    const row = { id: identifier(source.id) };
    if (ids.has(row.id)) throw new TypeError("ID duplicado no snapshot de patologias.");
    ids.add(row.id);
    for (const field of TEXT_FIELDS) row[field] = text(source[field]);
    row.startDate = normalizeCommercialMilestonesDate(source.startDate);
    row.endDate = normalizeCommercialMilestonesDate(source.endDate);
    row.cost = normalizeCommercialReceiptsAmount(source.cost);
    rows.push(Object.freeze(row));
  }
  return Object.freeze({ complete: true, rows: Object.freeze(rows) });
}

function normalizeFilters(filters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) throw new TypeError("Filtros inválidos no relatório de patologias.");
  return Object.fromEntries(FILTER_FIELDS.map(field => {
    const value = filters[field];
    if (value == null || typeof value === "string" && !value.trim()) return [field, ""];
    if (field === "id") {
      // PowerFx Value accepts a selected numeric string, including leading zeros.
      const raw = typeof value === "string" ? value.trim() : value;
      if (!["string", "number"].includes(typeof raw) || !/^\d+$/.test(String(raw))) throw new TypeError("Filtro ID inválido.");
      return [field, identifier(Number(raw))];
    }
    if (typeof value !== "string") throw new TypeError("Filtro inválido no relatório de patologias.");
    return [field, value.trim()];
  }));
}

function options(rows, field) {
  const unique = new Map();
  for (const row of rows) if (row[field] && !unique.has(key(row[field]))) unique.set(key(row[field]), row[field]);
  return [...unique.values()].sort(field === "id" ? (left, right) => Number(left) - Number(right) : compare);
}

const calendarOrder = date => date ? Date.parse(`${date}T00:00:00Z`) : -Infinity;
function enrich(row, todayISO) {
  return Object.freeze({ ...row,
    elapsedDays: row.startDate ? (calendarOrder(row.endDate || todayISO) - calendarOrder(row.startDate)) / DAY : null,
    endLabel: row.endDate ? row.endDate.split("-").reverse().join("/") : "EM ANDAMENTO",
    typeLabelUpper: key(row.type || "SEM TIPO"),
    statusLabel: key(row.status || "SEM STATUS"),
    statusTone: key(row.status) === "ATIVO" ? "green" : "red",
  });
}

/** PowerFx totals cover ALL matching rows; only the displayed table uses FirstN(100). */
export function buildSacPathologies(snapshot, filters = {}, todayISO) {
  const { rows } = normalizeSacPathologiesSnapshot(snapshot);
  if (typeof todayISO !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(todayISO)
    || normalizeCommercialMilestonesDate(todayISO) !== todayISO) throw new TypeError("Data de hoje inválida no relatório de patologias.");
  const selected = normalizeFilters(filters);
  const filtered = rows.filter(row => FILTER_FIELDS.every(field => !selected[field] || key(row[field]) === key(selected[field])));
  const costTotal = filtered.reduce((total, row) => total.plus(row.cost ?? 0), new Decimal(0)).toNumber();
  if (!Number.isFinite(costTotal)) throw new RangeError("Total monetário inválido; nenhum total parcial foi disponibilizado.");
  filtered.sort((left, right) => {
    const a = calendarOrder(left.startDate); const b = calendarOrder(right.startDate);
    return a === b ? Number(right.id) - Number(left.id) : a < b ? 1 : -1;
  });
  return Object.freeze({
    rows: Object.freeze(filtered.slice(0, 100).map(row => enrich(row, todayISO))),
    total: filtered.length,
    active: filtered.filter(row => key(row.status) === "ATIVO").length,
    inactive: filtered.filter(row => key(row.status) === "INATIVO").length,
    costTotal,
    filterOptions: Object.freeze(Object.fromEntries(FILTER_FIELDS.map(field => [field, Object.freeze(options(rows, field))]))),
  });
}
