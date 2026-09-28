function punchText(value) {
  if (Array.isArray(value)) return value.flatMap(punchText);
  if (value && typeof value === "object") {
    return punchText(value.dataHora ?? value.DataHora ?? value.timestamp ?? value.hora ?? value.value ?? "");
  }
  if (value == null) return [];
  const raw = String(value).trim();
  if (raw.startsWith("[")) {
    try { return punchText(JSON.parse(raw)); } catch { /* Read the string as ordinary text. */ }
  }
  return [raw];
}

export function isValidRhidReportDate(value) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

export function shiftRhidReportDate(value, days) {
  if (!isValidRhidReportDate(value) || !Number.isInteger(days) || Math.abs(days) !== 1) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function saoPauloClockParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const fields = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(fields.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
}

export function isRhidAttendanceDayFinalized(reportDate, now = new Date()) {
  if (!isValidRhidReportDate(reportDate)) return false;
  const local = saoPauloClockParts(now);
  if (!local) return false;
  const today = `${local.year}-${local.month}-${local.day}`;
  if (reportDate < today) return true;
  if (reportDate > today) return false;
  return Number(local.hour) * 60 + Number(local.minute) >= 17 * 60 + 15;
}

export function isRhidAttendanceRowDiscrepant(row, reportDate, now = new Date()) {
  if (!Array.isArray(row) || row.length < 6 || !isRhidAttendanceDayFinalized(reportDate, now)) return false;
  const day = new Date(`${reportDate}T00:00:00.000Z`);
  const weekday = day.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;

  const requiredMinutes = weekday === 5 ? 7 * 60 + 45 : 8 * 60 + 45;
  const slots = row.slice(1, -1).map(value => String(value ?? "").trim());
  const isTime = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const isBlank = value => !value || value === "—" || value === "-";
  if (slots.length < 4 || slots.slice(0, 4).some(value => !isTime(value))) return true;

  const extraSlots = slots.slice(4);
  let foundGap = false;
  const extraPunches = [];
  for (const value of extraSlots) {
    if (isTime(value)) {
      if (foundGap) return true;
      extraPunches.push(value);
    } else if (isBlank(value)) {
      foundGap = true;
    } else {
      return true;
    }
  }
  if (extraPunches.length % 2) return true;

  const punches = [...slots.slice(0, 4), ...extraPunches];
  let workedMinutes = 0;
  for (let index = 0; index < punches.length; index += 2) {
    const [entryHour, entryMinute] = punches[index].split(":").map(Number);
    const [exitHour, exitMinute] = punches[index + 1].split(":").map(Number);
    const interval = (exitHour * 60 + exitMinute) - (entryHour * 60 + entryMinute);
    if (interval < 0) return true;
    workedMinutes += interval;
  }
  return workedMinutes < requiredMinutes;
}

export function isRhidAttendanceRowWithoutPunches(row) {
  return Array.isArray(row) && row.length >= 4 && row.slice(1, -1)
    .every(value => !/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(String(value ?? "").trim()));
}

function punchTimes(value) {
  return punchText(value).flatMap(text => [...text.replace(/[+-](?:[01]?\d|2[0-3]):[0-5]\d\b/g, "")
    .matchAll(/(?:^|[^\d])((?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)(?!\d)/g)]
    .map(match => match[1].slice(0, 5).padStart(5, "0")));
}

function totalFromPunches(times) {
  let minutes = 0;
  for (let index = 0; index + 1 < times.length; index += 2) {
    const [entryHours, entryMinutes] = times[index].split(":").map(Number);
    const [exitHours, exitMinutes] = times[index + 1].split(":").map(Number);
    minutes += (exitHours * 60 + exitMinutes) - (entryHours * 60 + entryMinutes);
  }
  if (times.length < 2) return "— (parcial)";
  const total = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return times.length % 2 ? `${total} (parcial)` : total;
}

function timestampInSaoPaulo(value) {
  const text = String(value || "").trim();
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) return null;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function rhidUpdateLabel(report = {}) {
  const deviceTime = timestampInSaoPaulo(report.clockUpdatedAt);
  const collectionTimes = (Array.isArray(report.rows) ? report.rows : [])
    .map(row => timestampInSaoPaulo(row?.COLETADO_EM)).filter(Boolean);
  const stamp = deviceTime || (collectionTimes.length
    ? new Date(Math.max(...collectionTimes.map(value => value.getTime()))) : null);
  if (!stamp) return "HORÁRIO DA COLETA DO RHID INDISPONÍVEL";
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(stamp);
  return deviceTime
    ? `DADOS ATUALIZADOS NO RELÓGIO DE PONTO ÀS ${time}`
    : `ÚLTIMA COLETA DO RHID ÀS ${time}`;
}

export function buildRhidAttendanceTable(rows = []) {
  const people = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (String(row.STATUS_RHID ?? "").trim().toLocaleUpperCase("pt-BR") === "INATIVO") continue;
    const name = String(row.NOME_COLABORADOR ?? "").trim();
    const id = String(row.ID_PESSOA_RHID ?? row.Id ?? "").trim();
    const normalizedName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("pt-BR").replace(/\s+/g, " ").trim();
    if (/^PIS NAO LOCALIZADO\b/.test(normalizedName) || /\bNAO APAGAR\b/.test(normalizedName)) continue;
    const key = name
      ? `name:${name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")}`
      : `id:${id}`;
    if (!name && !id) continue;
    const times = punchTimes(row.BATIDAS_RHID);
    if (!people.has(key)) people.set(key, { name: name || `ID ${id}`, times: new Set() });
    const person = people.get(key);
    for (const time of times) person.times.add(time);
  }

  const persons = [...people.values()]
    .map(person => ({ ...person, punches: [...person.times].sort() }))
    .sort((left, right) => Number(Boolean(right.punches.length)) - Number(Boolean(left.punches.length))
      || left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base" }));
  const pairs = Math.max(2, Math.ceil(Math.max(0, ...persons.map(person => person.punches.length)) / 2));
  const headers = ["Nome"];
  for (let index = 1; index <= pairs; index += 1) headers.push(`Entrada ${index}`, `Saída ${index}`);
  headers.push("Total de horas/dia");

  return {
    kind: "rhid_attendance",
    headers,
    rows: persons.map(person => [
      person.name,
      ...Array.from({ length: pairs * 2 }, (_, index) => person.punches[index] || "—"),
      totalFromPunches(person.punches),
    ]),
  };
}
