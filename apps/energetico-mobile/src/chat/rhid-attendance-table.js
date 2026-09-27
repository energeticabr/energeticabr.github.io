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
    const name = String(row.NOME_COLABORADOR ?? "").trim();
    const id = String(row.ID_PESSOA_RHID ?? row.Id ?? "").trim();
    const normalizedName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("pt-BR").replace(/\s+/g, " ").trim();
    if (/^PIS NAO LOCALIZADO\b/.test(normalizedName)) continue;
    const key = name
      ? `name:${name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")}`
      : `id:${id}`;
    if (!name && !id) continue;
    const times = punchTimes(row.BATIDAS_RHID);
    if (!times.length) continue;
    if (!people.has(key)) people.set(key, { name: name || `ID ${id}`, times: new Set() });
    const person = people.get(key);
    for (const time of times) person.times.add(time);
  }

  const persons = [...people.values()]
    .map(person => ({ ...person, punches: [...person.times].sort() }))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base" }));
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
