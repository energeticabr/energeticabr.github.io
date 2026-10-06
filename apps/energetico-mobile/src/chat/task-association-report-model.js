const DATE_FIELDS = ["createdDate", "dueDate"];
const TEXT_FIELDS = ["description", "association", "status", "priority", "difficulty", "supplier"];
const REQUIRED_FIELDS = ["id", ...DATE_FIELDS, ...TEXT_FIELDS];
const EXACT_FILTERS = ["supplier", "difficulty", "priority"];
const OPTION_FIELDS = ["id", ...EXACT_FILTERS, "status"];
const PENDING = ["ATIVIDADE CRIADA", "EM ATENDIMENTO"];
const collator = new Intl.Collator("pt-BR");
const DAY_MS = 86_400_000;
const ASSOCIATION_COLORS = Object.freeze({
  "FINANCEIRO E TRIBUTÁRIO": "#C62828", ENGENHARIA: "#1565C0", SUPRIMENTOS: "#6A1B9A",
  "RH, QSMS E DOCUMENTAL": "#E65100", PLANEJAMENTO: "#2E7D32", "COMERCIAL E MARKETING": "#9E9D24",
  "DEMANDAS PESSOAIS": "#4E342E", "ETAPA OBRA E MEDIÇÃO DE CONTRATOS": "#00838F",
  "ESTOQUE / INVENTÁRIO": "#4527A0", "REBOCO E REPAROS SUPERFÍCIE": "#AD1457",
  "LOCAÇÃO E GABARITO OBRA": "#283593", "TI E ANÁLISE DE DADOS": "#0277BD", COMPLIANCE: "#880E4F",
});

function identifier(value) {
  const raw = typeof value === "string" ? value.trim() : value;
  if (!["string", "number"].includes(typeof raw) || !/^\d+$/.test(String(raw))
    || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) {
    throw new TypeError("ID inválido no relatório de tarefas por associação.");
  }
  return Number(raw);
}

function text(value) {
  if (value == null) return "";
  if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) {
    throw new TypeError("Campo inválido no relatório de tarefas por associação.");
  }
  return String(value).trim();
}
const key = value => text(value).toLocaleUpperCase("pt-BR");

function calendarDate(value) {
  if (value == null || typeof value === "string" && !value.trim()) return "";
  if (typeof value !== "string") throw new TypeError("Data inválida no relatório de tarefas por associação.");
  const raw = value.trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  const iso = /^(\d{4}-\d{2}-\d{2})(?:T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/.exec(raw);
  const day = br ? `${br[3]}-${br[2]}-${br[1]}` : iso?.[1] || "";
  const instant = Date.parse(`${day}T00:00:00Z`);
  if (!day || !Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== day) {
    throw new RangeError("Data de calendário inválida no relatório de tarefas por associação.");
  }
  // Preserve the calendar day supplied by SharePoint, including real 1900 dates.
  return day;
}
const days = date => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const pending = row => PENDING.includes(key(row.status));

/** Validate the complete source before filtering; never mutate or expose partial records. */
export function normalizeTaskAssociationSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !Array.isArray(snapshot.tasks)
    || snapshot.complete === false || snapshot.partial || snapshot.incomplete || snapshot.error || snapshot.truncated
    || snapshot.aborted || snapshot.hasMore || snapshot.nextLink) {
    throw new TypeError("Snapshot de tarefas inválido ou incompleto.");
  }
  const ids = new Set();
  const tasks = Array.from(snapshot.tasks, row => {
    if (!row || typeof row !== "object" || Array.isArray(row) || REQUIRED_FIELDS.some(field => !Object.hasOwn(row, field))) {
      throw new TypeError("Registro ou campo incompleto no relatório de tarefas por associação.");
    }
    const normalized = { id: identifier(row.id) };
    if (ids.has(normalized.id)) throw new TypeError("ID duplicado no relatório de tarefas por associação.");
    ids.add(normalized.id);
    for (const field of DATE_FIELDS) normalized[field] = calendarDate(row[field]);
    for (const field of TEXT_FIELDS) normalized[field] = text(row[field]);
    normalized.association = key(normalized.association) || "SEM ASSOCIAÇÃO";
    return Object.freeze(normalized);
  });
  return Object.freeze({ tasks: Object.freeze(tasks) });
}

function dueLabel(count) {
  if (count === null) return "SEM DATA FATAL";
  if (count < 0) return `${Math.abs(count)} ${count === -1 ? "DIA" : "DIAS"} VENCIDA`;
  if (count === 0) return "VENCE HOJE";
  return `FALTAM ${count} ${count === 1 ? "DIA" : "DIAS"}`;
}

function deriveTask(row, today) {
  const completed = key(row.status) === "CONCLUÍDO";
  const priority = key(row.priority);
  const priorityRank = priority === "ATIVIDADE EMERGENCIAL" ? 1 : priority === "ATIVIDADE PRIORITÁRIA" ? 2 : 3;
  const daysToDue = row.dueDate ? days(row.dueDate) - today : null;
  return Object.freeze({ ...row,
    createdDays: row.createdDate ? today - days(row.createdDate) : null, daysToDue, completed, priorityRank,
    rowColor: completed ? "#C8E6C9" : priorityRank === 1 ? "#FFCDD2" : priorityRank === 2 ? "#FFE0B2" : "#FFFFFF",
    priorityColor: priorityRank === 1 ? "#B71C1C" : priorityRank === 2 ? "#E65100" : "#000000",
    dueColor: completed ? "#2E7D32" : daysToDue === null ? "#607D8B" : daysToDue < 0 ? "#C62828" : daysToDue === 0 ? "#EF6C00" : "#2E7D32",
    dueLabel: dueLabel(daysToDue),
  });
}

/** Full-base status metrics and filter options; filtered, sorted PowerFx association groups. */
export function buildTaskAssociationOverview(snapshot, filters = {}, todayISO) {
  if (typeof todayISO !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(todayISO)) {
    throw new TypeError("A data de hoje deve estar no formato ISO YYYY-MM-DD.");
  }
  const today = days(calendarDate(todayISO));
  const { tasks: source } = normalizeTaskAssociationSnapshot(snapshot);
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) throw new TypeError("Filtros de tarefas inválidos.");
  const selectedStatuses = filters.statuses === undefined ? PENDING : filters.statuses;
  if (!Array.isArray(selectedStatuses) || Array.from(selectedStatuses).some(value => typeof value !== "string" || !value.trim())) {
    throw new TypeError("O filtro de status deve ser um array de textos válidos.");
  }
  const statuses = selectedStatuses.map(key);
  const description = key(filters.description);
  const idText = text(filters.id);
  const id = idText ? identifier(idText) : null;
  const dueDate = calendarDate(filters.dueDate);
  const selections = Object.fromEntries(EXACT_FILTERS.map(field => [field, key(filters[field])]));
  const metrics = Object.freeze({ pending: source.filter(pending).length,
    completed: source.filter(row => key(row.status) === "CONCLUÍDO").length, total: source.length });
  const filterOptions = Object.freeze(Object.fromEntries(OPTION_FIELDS.map(field => [field,
    Object.freeze([...new Set(source.map(row => String(row[field])).filter(Boolean))]
      .sort(field === "id" ? (a, b) => Number(a) - Number(b) : collator.compare)),
  ])));
  const grouped = new Map();
  for (const row of source) {
    if (statuses.length && !statuses.includes(key(row.status)) || description && !key(row.description).includes(description)
      || id !== null && row.id !== id || dueDate && row.dueDate !== dueDate
      || EXACT_FILTERS.some(field => selections[field] && key(row[field]) !== selections[field])) continue;
    if (!grouped.has(row.association)) grouped.set(row.association, []);
    grouped.get(row.association).push(deriveTask(row, today));
  }
  const groups = Array.from(grouped, ([association, tasks]) => {
    tasks.sort((a, b) => a.priorityRank - b.priorityRank || Number(!a.dueDate) - Number(!b.dueDate)
      || a.dueDate.localeCompare(b.dueDate) || a.id - b.id);
    return Object.freeze({ association, color: Object.hasOwn(ASSOCIATION_COLORS, association) ? ASSOCIATION_COLORS[association] : "#455A64",
      total: tasks.length, pending: tasks.filter(pending).length, emergencyCount: tasks.filter(row => row.priorityRank === 1).length,
      tasks: Object.freeze(tasks) });
  });
  groups.sort((a, b) => b.emergencyCount - a.emergencyCount || collator.compare(a.association, b.association));
  return Object.freeze({ metrics, filterOptions, groups: Object.freeze(groups) });
}
