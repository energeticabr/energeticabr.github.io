function dateInTimeZone(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const field = type => parts.find(part => part.type === type)?.value || "";
  return `${field("year")}-${field("month")}-${field("day")}`;
}
export function todayDateKey(now = new Date(), timeZone = "America/Sao_Paulo") {
  return dateInTimeZone(now, timeZone);
}

function actor(metadata) {
  const user = metadata?.user || metadata || {};
  const label = String(user.displayName || user.email || "NÃO INFORMADO").trim();
  const id = String(user.email || label).trim().toLocaleLowerCase("pt-BR");
  return { id, label };
}

function grouped(rows, keyFor, labelFor) {
  const groups = new Map();
  for (const row of rows) {
    const id = keyFor(row);
    if (!groups.has(id)) groups.set(id, { id, label: labelFor(row), created: 0, edited: 0 });
    const group = groups.get(id);
    group.created += row.created ? 1 : 0;
    group.edited += row.edited ? 1 : 0;
  }
  return Object.freeze([...groups.values()]
    .filter(group => group.created || group.edited)
    .sort((left, right) => left.label.localeCompare(right.label, "pt-BR", { numeric: true }))
    .map(group => Object.freeze(group)));
}

export function buildAuditEvents(records = [], options = {}) {
  const timeZone = options.timeZone || "America/Sao_Paulo";
  const date = String(options.date || todayDateKey(new Date(), timeZone));
  const events = [];
  for (const record of records || []) {
    const created = dateInTimeZone(record.createdDateTime, timeZone) === date;
    const edited = dateInTimeZone(record.lastModifiedDateTime, timeZone) === date
      && String(record.lastModifiedDateTime || "") !== String(record.createdDateTime || "");
    const append = (action, metadata, occurredAt) => {
      const eventActor = actor(metadata);
      events.push(Object.freeze({
        record,
        recordId: String(record.id ?? record.fields?.ID ?? "").trim(),
        sourceId: String(record.sourceId || "sem-fonte"),
        sourceTitle: String(record.sourceTitle || record.sourceId || "SEM FONTE"),
        action,
        actorId: eventActor.id,
        actor: eventActor.label,
        occurredAt,
        created: action === "created",
        edited: action === "edited",
        eventActor,
      }));
    };
    if (created) append("created", record.createdBy, record.createdDateTime);
    if (edited) append("edited", record.lastModifiedBy, record.lastModifiedDateTime);
  }
  return Object.freeze(events);
}

export function summarizeAuditEvents(events = [], date = "") {
  const rows = Object.freeze([...(events || [])]);
  return Object.freeze({
    date,
    events: rows,
    created: rows.filter(event => event.created).length,
    edited: rows.filter(event => event.edited).length,
    createdIds: Object.freeze(rows.filter(event => event.created).map(event => event.recordId)),
    editedIds: Object.freeze(rows.filter(event => event.edited).map(event => event.recordId)),
    bySource: grouped(rows, event => event.sourceId, event => event.sourceTitle),
    byUser: grouped(rows, event => event.actorId, event => event.actor),
  });
}

export function buildAuditSummary(records = [], options = {}) {
  const timeZone = options.timeZone || "America/Sao_Paulo";
  const date = String(options.date || todayDateKey(new Date(), timeZone));
  return summarizeAuditEvents(buildAuditEvents(records, { date, timeZone }), date);
}
