import { buildRhidAttendanceTable, isValidRhidReportDate } from "./rhid-attendance-table.js";

const RECORD_ID = /^(?:choice:registro_presenca_pendente:|pending_attendance_record:|(?:choice:sincronizar_atividade_fornecedor_presenca:)?supplier_sync_target:)(\d+)$/;
const DATE_IN_LABEL = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})\b/g;
const SLOTS = ["entry1", "exit1", "entry2", "exit2"];
const text = value => String(value ?? "").trim();
const normalizedName = value => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("pt-BR").replace(/\s+/g, " ");
const replyId = option => text(option?.reply || option?.id);

function calendarDate(value) {
  const raw = text(value);
  const iso = /^(\d{4}-\d{2}-\d{2})(?:$|[T ]\d{2}:\d{2})/.exec(raw);
  const br = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  const date = iso?.[1] || (br ? `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}` : "");
  return isValidRhidReportDate(date) ? date : "";
}

export function attendanceRhidPollEligible(poll) {
  if (!poll || (poll.type && poll.type !== "poll")) return false;
  if (["attendance_multi_select", "attendance_supplier_sync"].includes(poll.presentation)) return true;
  if (Array.isArray(poll.options) && poll.options.some(option =>
    /^(?:choice:sincronizar_atividade_fornecedor_presenca:)?supplier_sync_target:\d+$/.test(replyId(option)))) return true;
  return poll.presentation === "accordion" && Array.isArray(poll.options)
    && poll.options.some(option => /^pending_attendance_record:\d+$/.test(replyId(option)));
}

export function attendanceRhidOptionContext(option, poll) {
  if (!option || typeof option !== "object") return null;
  const id = replyId(option);
  const label = text(option.label || option.title || option.text);
  const control = normalizedName(label).replace(/^[^A-Z0-9]+/u, "");
  if (/^(?:SELECIONAR TODOS|SELECT ALL|PROSSEGUIR|CONTINUAR|SUBMETER|SUBMIT|ENDSTAGE|FINALIZAR(?: ETAPA)?|(?:AVALIAR|VER|ESCOLHER) OUTR[AO]S? (?:DATAS?|DIAS?))$/.test(control)) return null;
  const presenceId = RECORD_ID.exec(id)?.[1] || (attendanceRhidPollEligible(poll) && /^\d+$/.test(id) ? id : "");
  if (!presenceId) return null;

  const source = { ...option.sourceValues, ...option.source_values };
  const dates = [option.date, option.data, option.presenceDate, option.presence_date,
    source.DATA, source.date, source.data, source.presenceDate, source.presence_date];
  const explicitDateIndex = dates.findIndex(value => value !== undefined);
  // The legacy portal keeps per-record DATA in the existing detail table but
  // deliberately strips source_values. Never use another record's/day's table.
  const detail = option.detail_table || option.detailTable;
  const detailRows = Array.isArray(detail) ? detail : detail?.rows;
  const detailDateCell = (Array.isArray(detailRows) ? detailRows : []).flatMap(row => Array.isArray(row) ? row : [row])
    .find(cell => normalizedName(cell?.label || cell?.name) === "DATA");
  const dateInLabel = label.match(DATE_IN_LABEL)?.[0];
  // Empty/invalid per-record dates are authoritative. Unrelated historical
  // confirmations cannot prove which day a restored choice belongs to.
  const date = calendarDate(explicitDateIndex >= 0 ? dates[explicitDateIndex]
    : detailDateCell ? detailDateCell.value : dateInLabel);
  const withoutDates = label.replace(DATE_IN_LABEL, "");
  const afterId = new RegExp(`(?:^|\\D)${presenceId}\\s*[-–—:]\\s*(.*)$`, "u").exec(withoutDates)?.[1];
  const name = text(source.FORNECEDOR || option.FORNECEDOR || option.name
    || (afterId ?? withoutDates).replace(/^[\s|,;()[\]–—-]+|[\s|,;()[\]–—-]+$/g, ""));
  const rhidId = text(option.ID_PESSOA_RHID ?? source.ID_PESSOA_RHID ?? option.rhidId ?? source.rhidId);
  return { presenceId, name, date, ...(rhidId ? { rhidId } : {}) };
}

export function attendanceValidationDate(poll) {
  if (!attendanceRhidPollEligible(poll) || poll.presentation === "attendance_supplier_sync"
    || (poll.options || []).some(option => /supplier_sync_target:\d+$/.test(replyId(option)))) return "";
  const records = (poll.options || []).map(option => attendanceRhidOptionContext(option, poll)).filter(Boolean);
  const dates = new Set(records.map(record => record.date));
  const date = records.length ? (dates.size === 1 ? [...dates][0] : "") : poll.presenceDateKey;
  return isValidRhidReportDate(date) ? date : "";
}

function badge(status, date, minutes) {
  const brDate = date ? date.split("-").reverse().join("/") : "";
  const day = brDate ? ` em ${brDate}` : "";
  const labels = { absent: "AUSENTE", inconsistent: "INCONSISTENTE", unregistered: "S/ CADASTRO", unavailable: "RHID INDISPONÍVEL" };
  const duration = minutes == null ? "" : `${String(Math.floor(minutes / 60)).padStart(2, "0")}h${String(minutes % 60).padStart(2, "0")}`;
  const descriptions = {
    present: `RHID${day}: presente, ${duration}.`,
    absent: `RHID${day}: sem batidas no dia.`,
    inconsistent: `RHID${day}: batidas ou jornada exigem conferência.`,
    unregistered: `Fornecedor sem cadastro no RHID${day}, conforme cadastro completo.`,
    unavailable: `Consulta RHID${day} indisponível; presença não confirmada.`,
  };
  return { status, label: status === "present" ? duration : labels[status], date, description: descriptions[status],
    ...(minutes == null ? {} : { minutes }) };
}

function groupPeople(rows, directory = false) {
  const groups = new Map();
  for (const [index, row] of rows.entries()) {
    const rhidId = text(directory ? row.id : row.ID_PESSOA_RHID);
    const key = rhidId ? `rhid:${rhidId}` : text(row.Id) ? `item:${text(row.Id)}` : `row:${index}`;
    if (!groups.has(key)) groups.set(key, { rhidId, names: new Set(), pendingPresenceIds: new Set(), rows: [] });
    const person = groups.get(key);
    person.names.add(normalizedName(directory ? row.name : row.NOME_COLABORADOR));
    person.rows.push(row);
    for (const id of Array.isArray(row.pendingPresenceIds) ? row.pendingPresenceIds : []) person.pendingPresenceIds.add(text(id));
  }
  return [...groups.values()];
}

function resolvePerson(context, people, directory) {
  const rhidId = text(context.rhidId);
  const linked = people.filter(person => person.pendingPresenceIds.has(text(context.presenceId)));
  if (linked.length > 1 || (rhidId && linked.some(person => person.rhidId !== rhidId))) return { ambiguous: true };
  if (rhidId) return { person: people.find(person => person.rhidId === rhidId),
    registered: directory?.some(person => person.rhidId === rhidId) };
  if (linked.length) return { person: linked[0], registered: true };

  const name = normalizedName(context.name);
  if (!name) return { ambiguous: true };
  const named = people.filter(person => person.names.has(name));
  const registered = directory?.filter(person => person.names.has(name));
  if (named.length > 1 || registered?.length > 1) return { ambiguous: true };
  if (registered?.length) {
    const id = registered[0].rhidId;
    if (named.some(person => person.rhidId && person.rhidId !== id)) return { ambiguous: true };
    return { person: people.find(person => person.rhidId === id) || named[0], registered: true };
  }
  return { person: named[0], registered: directory ? false : undefined };
}

// Validate all raw tokens before using the table parser, which deliberately
// tolerates malformed input and deduplicates punches for its report display.
function inspectPunches(value, inArray = false) {
  if (value == null) return { times: [], invalid: inArray };
  if (Array.isArray(value)) {
    const parts = value.map(item => inspectPunches(item, true));
    return { times: parts.flatMap(part => part.times), invalid: parts.some(part => part.invalid) };
  }
  if (typeof value === "object") {
    const key = ["dataHora", "DataHora", "timestamp", "hora", "value"].find(key => Object.hasOwn(value, key));
    return key ? inspectPunches(value[key], true) : { times: [], invalid: true };
  }
  if (typeof value !== "string") return { times: [], invalid: true };
  const raw = value.trim();
  if (!raw) return { times: [], invalid: inArray };
  if (/^[\[{]/.test(raw)) {
    try { return inspectPunches(JSON.parse(raw), inArray); } catch { return { times: [], invalid: true }; }
  }
  const times = [];
  let invalid = false;
  const remainder = raw.replace(/(?:(\d{4}-\d{2}-\d{2})[T ])?(\d{1,2}:\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?/gi,
    (match, date, time, seconds, zone) => {
      const valid = /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(time)
        && (seconds === undefined || /^[0-5]\d$/.test(seconds))
        && (!date || isValidRhidReportDate(date))
        && (!zone || (date && /^(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.test(zone)));
      if (valid) times.push(time.padStart(5, "0"));
      else invalid = true;
      return "";
    });
  return { times, invalid: invalid || !times.length || /[^\s;,|]/u.test(remainder) };
}

function personBadge(person, date) {
  const rows = person.rows;
  if (rows.some(row => calendarDate(row.DATA_REFERENCIA ?? row.date) !== date)) return badge("unavailable", date);
  const parsed = rows.map(row => inspectPunches(row.BATIDAS_RHID));
  const rawTimes = parsed.flatMap(part => part.times);
  if (parsed.some(part => part.invalid)) return badge("inconsistent", date);
  const duplicatePunches = new Set(rawTimes).size !== rawTimes.length;
  const tablePerson = buildRhidAttendanceTable(rows.map((row, index) => ({
    ...row, BATIDAS_RHID: parsed[index].times, STATUS_RHID: "",
  }))).people[0];
  if (!tablePerson) return badge(duplicatePunches ? "inconsistent" : "unavailable", date);

  // Use the report's effective slots (including approved adjustments), never
  // assign an afternoon-only punch to E1 just because it is first in the array.
  const punches = Object.fromEntries(SLOTS.map(slot => [slot, tablePerson.slots[slot].effective]));
  const dailyBadge = (status, minutes) => ({ ...badge(status, date, minutes), punches });
  if (duplicatePunches) return dailyBadge("inconsistent");

  let times = tablePerson.rawPunches;
  const adjustments = Object.fromEntries(SLOTS.filter(slot => tablePerson.slots[slot].adjustment)
    .map(slot => [slot, tablePerson.slots[slot].adjustment]));
  if (Object.keys(adjustments).length) {
    // ADMIN_AJUSTES addresses the first two periods. Further raw pairs remain
    // part of the total; slot/range warnings are not the badge's duration rule.
    const adjusted = buildRhidAttendanceTable([{ Id: "badge", NOME_COLABORADOR: tablePerson.name,
      BATIDAS_RHID: times.slice(0, 4), ADMIN_AJUSTES: adjustments }]).people[0];
    if (!adjusted || SLOTS.some(slot => adjusted.slots[slot].rhidCandidates.length > 1)
      || SLOTS.flatMap(slot => adjusted.slots[slot].rhidCandidates).length !== Math.min(times.length, 4)) return dailyBadge("inconsistent");
    const effectiveSlots = SLOTS.map(slot => adjusted.slots[slot].effective);
    if ([0, 2].some(index => Boolean(effectiveSlots[index]) !== Boolean(effectiveSlots[index + 1]))) return dailyBadge("inconsistent");
    times = [...effectiveSlots.filter(Boolean), ...times.slice(4)];
  }
  if (!times.length) return dailyBadge("absent");
  if (times.length % 2 || times.some((time, index) => index > 0 && time <= times[index - 1])) return dailyBadge("inconsistent");
  let minutes = 0;
  for (let index = 0; index < times.length; index += 2) {
    const asMinutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    minutes += asMinutes(times[index + 1]) - asMinutes(times[index]);
  }
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return dailyBadge(weekday >= 1 && weekday <= 4 && minutes < 510 ? "inconsistent" : "present", minutes);
}

export function buildAttendanceRhidBadge(context, report) {
  const date = calendarDate(context?.date);
  if (!date || !report || calendarDate(report.date) !== date || !Array.isArray(report.rows)
    || report.rows.some(row => !row || typeof row !== "object" || Array.isArray(row)
      || calendarDate(row.DATA_REFERENCIA ?? row.date) !== date || !Object.hasOwn(row, "BATIDAS_RHID"))) return badge("unavailable", date);

  const registration = report.registration;
  const authoritative = registration?.complete === true && Array.isArray(registration.people)
    && registration.people.every(person => person && typeof person === "object" && !Array.isArray(person)
      && ["string", "number"].includes(typeof person.id) && text(person.id)
      && typeof person.name === "string" && normalizedName(person.name));
  const directory = authoritative ? groupPeople(registration.people, true) : undefined;
  const match = resolvePerson(context, groupPeople(report.rows), directory);
  if (match.ambiguous) return badge("unavailable", date);
  if (match.person) return personBadge(match.person, date);
  if (match.registered === true && authoritative) return badge("absent", date);
  return badge(authoritative && match.registered === false ? "unregistered" : "unavailable", date);
}
