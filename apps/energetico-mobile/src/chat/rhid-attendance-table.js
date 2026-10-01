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

export function summarizeRhidAttendance(tableOrRows) {
  const rows = Array.isArray(tableOrRows) ? tableOrRows : tableOrRows?.rows;
  const validRows = Array.isArray(rows) ? rows.filter(Array.isArray) : [];
  const withPunches = validRows.filter(row => !isRhidAttendanceRowWithoutPunches(row)).length;
  return {
    collaborators: validRows.length,
    withPunches,
    withoutPunches: validRows.length - withPunches,
  };
}

function punchTimes(value) {
  return punchText(value).flatMap(text => [...text.replace(/[+-](?:[01]?\d|2[0-3]):[0-5]\d\b/g, "")
    .matchAll(/(?:^|[^\d])((?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)(?!\d)/g)]
    .map(match => match[1].slice(0, 5).padStart(5, "0")));
}

const RHID_SLOTS = [
  ["entry1", "Entrada 1"], ["exit1", "Saída 1"],
  ["entry2", "Entrada 2"], ["exit2", "Saída 2"],
];

export function classifyRhidPunch(value) {
  const text = String(value ?? "").trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) return null;
  const minutes = Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
  if (minutes >= 5 * 60 && minutes <= 8 * 60) return "entry1";
  if (minutes >= 11 * 60 && minutes < 12 * 60 + 30) return "exit1";
  if (minutes >= 12 * 60 + 30 && minutes <= 13 * 60 + 30) return "entry2";
  if (minutes >= 15 * 60 + 30) return "exit2";
  return null;
}

function totalFromSlots(times) {
  let minutes = 0;
  let completed = 0;
  for (let index = 0; index < 4; index += 2) {
    if (!times[index] || !times[index + 1]) continue;
    const [entryHours, entryMinutes] = times[index].split(":").map(Number);
    const [exitHours, exitMinutes] = times[index + 1].split(":").map(Number);
    const interval = (exitHours * 60 + exitMinutes) - (entryHours * 60 + entryMinutes);
    if (interval < 0) return "— (parcial)";
    minutes += interval;
    completed += 1;
  }
  if (!completed) return "— (parcial)";
  const total = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return times.every(Boolean) ? total : `${total} (parcial)`;
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
    const name = String(row.NOME_COLABORADOR ?? "").trim();
    const rhidId = String(row.ID_PESSOA_RHID ?? "").trim();
    const id = rhidId || String(row.Id ?? "").trim();
    const normalizedName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("pt-BR").replace(/\s+/g, " ").trim();
    if (/^PIS NAO LOCALIZADO\b/.test(normalizedName) || /\bNAO APAGAR\b/.test(normalizedName)) continue;
    const key = rhidId ? `rhid:${rhidId}` : name ? `name:${normalizedName}` : `id:${id}`;
    if (!name && !id) continue;
    const times = punchTimes(row.BATIDAS_RHID);
    if (!people.has(key)) people.set(key, {
      personKey: rhidId ? `rhid:${rhidId}` : id ? `id:${id}` : "",
      name: name || `ID ${id}`, times: new Set(), inactive: false, adjustments: {},
    });
    const person = people.get(key);
    if (String(row.STATUS_RHID ?? "").trim().toUpperCase() === "INATIVO") person.inactive = true;
    for (const time of times) person.times.add(time);
    const adjustments = row.ADMIN_AJUSTES;
    if (adjustments && typeof adjustments === "object") {
      for (const [slot] of RHID_SLOTS) {
        const adjustment = adjustments[slot];
        if (adjustment && typeof adjustment === "object" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(adjustment.time || ""))) {
          const previous = person.adjustments[slot];
          if (!previous || String(previous.adjustedAt || "") <= String(adjustment.adjustedAt || "")) {
            person.adjustments[slot] = adjustment;
          }
        }
      }
    }
  }

  const persons = [...people.values()]
    .map(person => ({ ...person, punches: [...person.times].sort() }))
    .filter(person => person.punches.length || Object.keys(person.adjustments).length || !person.inactive)
    .sort((left, right) => Number(Boolean(right.punches.length || Object.keys(right.adjustments).length)) - Number(Boolean(left.punches.length || Object.keys(left.adjustments).length))
      || left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base" }));
  const headers = ["Nome", ...RHID_SLOTS.map(([, label]) => label), "Total de horas/dia"];
  const details = persons.map(person => {
    const candidates = Object.fromEntries(RHID_SLOTS.map(([slot]) => [slot, []]));
    const outside = [];
    for (const time of person.punches) {
      const slot = classifyRhidPunch(time);
      if (slot) candidates[slot].push(time);
      else outside.push(time);
    }
    const issues = [];
    const slots = {};
    for (const [slot, label] of RHID_SLOTS) {
      const rhidCandidates = candidates[slot];
      const rhid = rhidCandidates.length === 1 ? rhidCandidates[0] : null;
      if (rhidCandidates.length > 1) issues.push(`Batidas duplicadas em ${label}: ${rhidCandidates.join(", ")}`);
      const adjustment = person.adjustments[slot] || null;
      slots[slot] = {
        rhid, rhidCandidates, effective: adjustment?.time || rhid || null,
        source: adjustment ? rhidCandidates.length ? "corrected" : "added" : rhid ? "rhid" : "empty",
        adjustment,
      };
    }
    for (const time of outside) issues.push(`Batida fora das faixas: ${time}`);
    return { personKey: person.personKey, name: person.name, rawPunches: person.punches, slots, issues };
  });

  return {
    kind: "rhid_attendance",
    headers,
    people: details,
    rows: details.map(person => {
      const times = RHID_SLOTS.map(([slot]) => person.slots[slot].effective);
      return [person.name, ...times.map(time => time || "—"), totalFromSlots(times)];
    }),
  };
}
