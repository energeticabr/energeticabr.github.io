const DATE_FIELDS = ["createdDate", "dueDate"];
const TEXT_FIELDS = ["description", "association", "responsible", "status", "priority", "difficulty"];
const REQUIRED_FIELDS = ["id", ...DATE_FIELDS, ...TEXT_FIELDS];
const EXACT_FILTERS = ["association", "difficulty", "priority"];
const OPTION_FIELDS = { associations: "association", difficulties: "difficulty", priorities: "priority", statuses: "status" };
const PENDING = ["ATIVIDADE CRIADA", "EM ATENDIMENTO"];
const COMPLETED = "CONCLUÍDO";
const EMERGENCY = "ATIVIDADE EMERGENCIAL";
const PRIORITY = "ATIVIDADE PRIORITÁRIA";
const DETAIL_LIMIT = 2000;
const DAY_MS = 86_400_000;
const collator = new Intl.Collator("pt-BR");

function identifier(value) {
  const raw = typeof value === "string" ? value.trim() : value;
  if (!["string", "number"].includes(typeof raw) || !/^\d+$/.test(String(raw))
    || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) {
    throw new TypeError("ID inválido no relatório de tarefas delegadas por prazo.");
  }
  return Number(raw);
}

function text(value) {
  if (value == null) return "";
  if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) {
    throw new TypeError("Campo inválido no relatório de tarefas delegadas por prazo.");
  }
  return String(value).trim();
}
const key = value => text(value).toLocaleUpperCase("pt-BR");

function calendarDate(value) {
  if (value == null || typeof value === "string" && !value.trim()) return null;
  if (typeof value !== "string") throw new TypeError("Data inválida no relatório de tarefas delegadas por prazo.");
  const raw = value.trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  const iso = /^(\d{4}-\d{2}-\d{2})(?:T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/.exec(raw);
  const day = br ? `${br[3]}-${br[2]}-${br[1]}` : iso?.[1] || "";
  const instant = Date.parse(`${day}T00:00:00Z`);
  if (!day || !Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== day) {
    throw new RangeError("Data de calendário inválida no relatório de tarefas delegadas por prazo.");
  }
  // Keep SharePoint's calendar day rather than shifting it through UTC; 1900 is not a blank sentinel.
  return day;
}
const days = date => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const pending = row => PENDING.includes(row.status);
const creationInstant = row => row.createdSort ?? (row.createdDate ? days(row.createdDate) * DAY_MS : 0);
const newestFirst = (a, b) => Number(a.createdDate === null) - Number(b.createdDate === null)
  || creationInstant(b) - creationInstant(a);

function createdSort(row, createdDate) {
  let value;
  if (Object.hasOwn(row, "createdSort")) value = row.createdSort;
  else if (typeof row.createdDate === "string" && row.createdDate.includes("T")) {
    const raw = row.createdDate.trim();
    // SharePoint supplies an offset or Z. Treat a timezone-less ISO fixture consistently as UTC.
    value = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ? raw : `${raw}Z`);
  } else return undefined;
  if (createdDate === null || typeof value !== "number" || !Number.isSafeInteger(value) || Math.abs(value) > 8.64e15) {
    throw new TypeError("Data de ordenação inválida no relatório de tarefas delegadas por prazo.");
  }
  return value;
}

/** Validate the entire base, copy its scalar fields and freeze every returned record. */
export function normalizeDelegatedDeadlineSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !Array.isArray(snapshot.tasks)
    || snapshot.complete === false || snapshot.partial || snapshot.incomplete || snapshot.error || snapshot.truncated
    || snapshot.aborted || snapshot.hasMore || snapshot.nextLink) {
    throw new TypeError("Snapshot de tarefas delegadas inválido ou incompleto.");
  }
  const ids = new Set();
  const tasks = Array.from(snapshot.tasks, row => {
    if (!row || typeof row !== "object" || Array.isArray(row) || REQUIRED_FIELDS.some(field => !Object.hasOwn(row, field))) {
      throw new TypeError("Registro ou campo incompleto no relatório de tarefas delegadas por prazo.");
    }
    const normalized = { id: identifier(row.id) };
    if (ids.has(normalized.id)) throw new TypeError("ID duplicado no relatório de tarefas delegadas por prazo.");
    ids.add(normalized.id);
    for (const field of DATE_FIELDS) normalized[field] = calendarDate(row[field]);
    for (const field of TEXT_FIELDS) normalized[field] = text(row[field]);
    normalized.responsible = key(normalized.responsible) || "SEM RESPONSÁVEL";
    normalized.status = key(normalized.status);
    normalized.priority = key(normalized.priority);
    // PowerFx sorts DATAIDENTIFICACAO before calendar-day normalization and FirstN.
    // Keep the optional epoch-millisecond key across the data layer's repeated normalization.
    const instant = createdSort(row, normalized.createdDate);
    if (instant !== undefined) normalized.createdSort = instant;
    return Object.freeze(normalized);
  });
  return Object.freeze({ tasks: Object.freeze(tasks) });
}

function deadline(daysToDue, pendingCount) {
  if (daysToDue === null) return { dueLabel: "SEM PRAZO DEFINIDO", color: "#ECEFF1", borderColor: "#607D8B" };
  if (daysToDue < 0) {
    return pendingCount ? {
      dueLabel: `${Math.abs(daysToDue)} ${daysToDue === -1 ? "DIA" : "DIAS"} EM ATRASO`, color: "#FFCDD2", borderColor: "#C62828",
    } : { dueLabel: "TODAS AS ATIVIDADES CONCLUÍDAS", color: "#C8E6C9", borderColor: "#2E7D32" };
  }
  if (daysToDue === 0) return { dueLabel: "VENCE HOJE", color: "#FFE0B2", borderColor: "#EF6C00" };
  return { dueLabel: `${daysToDue} ${daysToDue === 1 ? "DIA" : "DIAS"} PARA O PRAZO`, color: "#C8E6C9", borderColor: "#2E7D32" };
}

function rowColor(row) {
  if (row.status === COMPLETED) return "#C8E6C9";
  if (row.priority === EMERGENCY) return "#FFCDD2";
  if (row.priority === PRIORITY) return "#FFE0B2";
  return "#FFFFFF";
}

function responsibleColor(tasks) {
  const unfinished = tasks.filter(row => row.status !== COMPLETED);
  if (!unfinished.length) return "#C8E6C9";
  if (unfinished.some(row => row.priority === EMERGENCY)) return "#FFCDD2";
  if (unfinished.some(row => row.priority === PRIORITY)) return "#FFE0B2";
  return "#F5F5F5";
}

/** Global metrics/options use the full base; only filtered detail receives PowerFx FirstN(2000). */
export function buildDelegatedDeadlineOverview(snapshot, filters = {}, todayISO) {
  if (typeof todayISO !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(todayISO)) {
    throw new TypeError("A data de hoje deve estar no formato ISO YYYY-MM-DD.");
  }
  const today = days(calendarDate(todayISO));
  const { tasks: source } = normalizeDelegatedDeadlineSnapshot(snapshot);
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) throw new TypeError("Filtros de tarefas delegadas inválidos.");
  const selectedStatuses = filters.statuses === undefined ? PENDING : filters.statuses;
  if (!Array.isArray(selectedStatuses) || Array.from(selectedStatuses).some(value => typeof value !== "string" || !value.trim())) {
    throw new TypeError("O filtro de status deve ser um array de textos válidos.");
  }
  const statuses = selectedStatuses.map(key);
  const description = key(filters.description);
  const selections = Object.fromEntries(EXACT_FILTERS.map(field => [field, key(filters[field])]));
  const metrics = Object.freeze({ total: source.length, pending: source.filter(pending).length,
    completed: source.filter(row => row.status === COMPLETED).length });
  const filterOptions = Object.freeze(Object.fromEntries(Object.entries(OPTION_FIELDS).map(([option, field]) => [option,
    Object.freeze([...new Set(source.map(row => row[field]).filter(Boolean))].sort(collator.compare)),
  ])));
  const filtered = source.filter(row => !(statuses.length && !statuses.includes(row.status))
    && !(description && !key(row.description).includes(description))
    && EXACT_FILTERS.every(field => !selections[field] || key(row[field]) === selections[field]));
  filtered.sort(newestFirst);
  const displayed = filtered.slice(0, DETAIL_LIMIT);
  const grouped = new Map();
  for (const row of displayed) {
    if (!grouped.has(row.dueDate)) grouped.set(row.dueDate, []);
    grouped.get(row.dueDate).push(Object.freeze({ ...row, rowColor: rowColor(row) }));
  }
  const groups = Array.from(grouped, ([dueDate, tasks]) => {
    const byResponsible = new Map();
    for (const row of tasks) {
      if (!byResponsible.has(row.responsible)) byResponsible.set(row.responsible, []);
      byResponsible.get(row.responsible).push(row);
    }
    const responsibles = Array.from(byResponsible, ([responsible, rows]) => Object.freeze({
      responsible, color: responsibleColor(rows), tasks: Object.freeze(rows.sort(newestFirst)),
    })).sort((a, b) => collator.compare(a.responsible, b.responsible));
    const pendingCount = tasks.filter(pending).length;
    const daysToDue = dueDate === null ? null : days(dueDate) - today;
    return Object.freeze({ dueDate, daysToDue, ...deadline(daysToDue, pendingCount), total: tasks.length,
      pending: pendingCount, responsibles: Object.freeze(responsibles) });
  }).sort((a, b) => Number(a.dueDate === null) - Number(b.dueDate === null)
    || (a.dueDate || "").localeCompare(b.dueDate || ""));
  return Object.freeze({ metrics, filterOptions, groups: Object.freeze(groups), filteredCount: filtered.length,
    displayedCount: displayed.length, limited: filtered.length > DETAIL_LIMIT });
}
