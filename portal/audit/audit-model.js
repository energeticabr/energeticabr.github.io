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

export function buildAuditSummary(records = [], options = {}) {
  const timeZone = options.timeZone || "America/Sao_Paulo";
  const date = String(options.date || todayDateKey(new Date(), timeZone));
  const events = [];
  for (const record of records || []) {
    const created = dateInTimeZone(record.createdDateTime, timeZone) === date;
    const edited = dateInTimeZone(record.lastModifiedDateTime, timeZone) === date
      && String(record.lastModifiedDateTime || "") !== String(record.createdDateTime || "");
    if (created) events.push({ record, created: true, edited: false, eventActor: actor(record.createdBy) });
    if (edited) events.push({ record, created: false, edited: true, eventActor: actor(record.lastModifiedBy) });
  }
  return Object.freeze({
    date,
    created: events.filter(event => event.created).length,
    edited: events.filter(event => event.edited).length,
    bySource: grouped(events, event => String(event.record.sourceId || "sem-fonte"), event => String(event.record.sourceTitle || event.record.sourceId || "SEM FONTE")),
    byUser: grouped(events, event => event.eventActor.id, event => event.eventActor.label),
  });
}
