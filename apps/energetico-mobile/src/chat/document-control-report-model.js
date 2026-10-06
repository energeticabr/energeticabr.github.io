const DATE_FIELDS = ["submittedDate", "issuedDate", "expirationDate"];
const FILTER_FIELDS = ["branch", "homologation", "person", "documentType", "stage", "property", "status"];
const REQUIRED_FIELDS = ["id", ...DATE_FIELDS, ...FILTER_FIELDS];
const collator = new Intl.Collator("pt-BR");
const DAY_MS = 86_400_000;

function identifier(value) {
  const raw = typeof value === "string" ? value.trim() : value;
  if (!["string", "number"].includes(typeof raw) || !/^\d+$/.test(String(raw))
    || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) {
    throw new TypeError("ID inválido no controle de documentos.");
  }
  return Number(raw);
}

function text(value) {
  if (value == null) return "";
  if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) {
    throw new TypeError("Campo inválido no controle de documentos.");
  }
  return String(value).trim();
}

function calendarDate(value) {
  if (value == null || typeof value === "string" && !value.trim()) return "";
  if (typeof value !== "string") throw new TypeError("Data inválida no controle de documentos.");
  const raw = value.trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  const iso = /^(\d{4}-\d{2}-\d{2})(?:T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/.exec(raw);
  const day = br ? `${br[3]}-${br[2]}-${br[1]}` : iso?.[1] || "";
  const instant = Date.parse(`${day}T00:00:00Z`);
  if (!day || !Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== day) {
    throw new RangeError("Data de calendário inválida no controle de documentos.");
  }
  // Dates are source calendar days. An offset must never move a document to another day.
  return day;
}

/** Validate the entire base before any filter can hide a malformed record. */
export function normalizeDocumentControlSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !Array.isArray(snapshot.documents)
    || snapshot.complete === false || snapshot.partial || snapshot.incomplete || snapshot.error || snapshot.truncated || snapshot.aborted
    || snapshot.hasMore || snapshot.nextLink) {
    throw new TypeError("Snapshot de documentos inválido ou incompleto.");
  }
  const ids = new Set();
  const documents = Array.from(snapshot.documents, row => {
    if (!row || typeof row !== "object" || Array.isArray(row) || REQUIRED_FIELDS.some(field => !Object.hasOwn(row, field))) {
      throw new TypeError("Registro ou campo incompleto no controle de documentos.");
    }
    const normalized = { id: identifier(row.id) };
    if (ids.has(normalized.id)) throw new TypeError("ID duplicado no controle de documentos.");
    ids.add(normalized.id);
    for (const field of DATE_FIELDS) normalized[field] = calendarDate(row[field]);
    for (const field of FILTER_FIELDS) normalized[field] = text(row[field]);
    return Object.freeze(normalized);
  });
  return Object.freeze({ documents: Object.freeze(documents) });
}

function days(date) {
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}

function sortLabel(order, direction) {
  if (order === "id") return direction === "asc" ? "🔢 MENOR ID" : "🔢 MAIOR ID";
  if (order === "expirationDate") return "📅 VENCIMENTO MAIS PRÓXIMO";
  const labels = { submittedDate: "DATA SUBMETIDO", issuedDate: "DATA", branch: "FILIAL", homologation: "HOMOLOGAÇÃO",
    person: "PESSOA RELACIONADA", documentType: "TIPO DOCUMENTO", stage: "ETAPA", property: "IMÓVEL", status: "STATUS" };
  return `${labels[order]} ${direction === "asc" ? "↑" : "↓"}`;
}

/** Read-only PowerFx equality, sorting, validity counters and calendar-day differences. */
export function buildDocumentControlOverview(snapshot, filters = {}, todayISO) {
  if (typeof todayISO !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(todayISO)) {
    throw new TypeError("A data de hoje deve estar no formato ISO YYYY-MM-DD.");
  }
  const today = days(calendarDate(todayISO));
  const { documents: source } = normalizeDocumentControlSnapshot(snapshot);
  const selections = Object.fromEntries(FILTER_FIELDS.map(field => [field, text(filters[field]).toLocaleUpperCase("pt-BR")]));
  const order = filters.order || "id";
  const direction = filters.direction || "desc";
  if (!REQUIRED_FIELDS.includes(order) || !["asc", "desc"].includes(direction)) {
    throw new TypeError("Ordenação inválida no controle de documentos.");
  }
  const filterOptions = Object.freeze(Object.fromEntries(FILTER_FIELDS.map(field => [field,
    Object.freeze([...new Set(source.map(row => row[field]).filter(Boolean))].sort(collator.compare)),
  ])));
  const documents = source.filter(row => FILTER_FIELDS.every(field => !selections[field]
    || row[field].toLocaleUpperCase("pt-BR") === selections[field])).map(row => Object.freeze({ ...row,
    submittedDays: row.submittedDate ? today - days(row.submittedDate) : null,
    issuedDays: row.issuedDate ? today - days(row.issuedDate) : null,
    daysToExpiry: row.expirationDate ? days(row.expirationDate) - today : null,
  }));
  documents.sort((a, b) => {
    if (order === "expirationDate") {
      return Number(!a.expirationDate) - Number(!b.expirationDate)
        || a.expirationDate.localeCompare(b.expirationDate) || b.id - a.id;
    }
    const comparison = order === "id" ? a.id - b.id : collator.compare(a[order], b[order]);
    return (direction === "asc" ? comparison : -comparison) || b.id - a.id;
  });
  const metrics = Object.freeze({
    submitted: documents.filter(row => row.status.trim().toUpperCase() === "SUBMETIDO").length,
    pending: documents.filter(row => row.status.trim().toUpperCase() === "PENDENTE").length,
    total: documents.length,
    expired: documents.filter(row => row.daysToExpiry !== null && row.daysToExpiry < 0).length,
    expiring15: documents.filter(row => row.daysToExpiry !== null && row.daysToExpiry >= 0 && row.daysToExpiry <= 15).length,
  });
  return Object.freeze({ documents: Object.freeze(documents), metrics, filterOptions, sortLabel: sortLabel(order, direction) });
}
