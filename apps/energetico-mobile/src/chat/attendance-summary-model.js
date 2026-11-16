import Decimal from "decimal.js";

const text = value => String(value ?? "").trim();
const key = value => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ");
const sortText = (a, b) => a.localeCompare(b, "pt-BR");
const matches = (value, filter) => !text(filter) || key(filter) === "TODOS" || key(value) === key(filter);
const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function dateFilter(value) {
  if (value == null || value === "") return "";
  const raw = text(value);
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : raw;
  const parsed = new Date(`${iso}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    throw new RangeError("Data inválida no período do relatório.");
  }
  return iso;
}

function groupBy(rows, accessor) {
  const groups = new Map();
  for (const row of rows) {
    const name = accessor(row);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  return [...groups];
}

export function attendanceStageLabel({ id, stage, activity, property, supplier }) {
  return [...new Set([`#${id}`, stage, activity, property, supplier].filter(Boolean))].join(" · ");
}

export function attendanceActivityOptions(activities, stage) {
  return [...new Set(activities.filter(row => !stage || key(row.stage) === key(stage))
    .map(row => row.activity))].sort(sortText);
}

function assignmentKey({ stage, activity }) {
  return key(stage) && key(activity) ? JSON.stringify([key(stage), key(activity)]) : "";
}

function currentProfessions(suppliers, stages, filters, status) {
  const labels = new Map(stages.map(stage => [text(stage.id), attendanceStageLabel(stage)]));
  const assignments = [...new Set(suppliers.map(assignmentKey).filter(Boolean))].sort();
  const hues = new Map(assignments.map((assignment, index) => [assignment, index * 137.508 % 360]));
  const selected = suppliers.filter(supplier => text(supplier.name) && matches(supplier.status, status)
    && matches(supplier.branch, filters.branch) && matches(supplier.name, filters.supplier));
  return groupBy(selected, supplier => key(supplier.profession))
    .map(([, records]) => {
      const name = text(records[0].profession) || "SEM PROFISSÃO";
      const providers = records.map(supplier => ({
        ...supplier,
        stageLabel: labels.get(text(supplier.stage)) || text(supplier.stage),
        assignmentHue: hues.get(assignmentKey(supplier)) ?? null,
      })).sort((a, b) => sortText(a.name, b.name));
      return { name, emoji: emoji(name), providers };
    }).sort((a, b) => b.providers.length - a.providers.length || sortText(a.name, b.name));
}

function emoji(name) {
  const profession = key(name);
  for (const [part, symbol] of [["EMPREITEIRO", "🏗️"], ["SERVENTE", "🪣"], ["PEDREIRO", "🧱"],
    ["ELETRICISTA", "⚡"], ["PINTOR", "🎨"]]) {
    if (profession.includes(part)) return symbol;
  }
  return "";
}

function categories(rows, presence) {
  return groupBy(rows.filter(row => key(row.presence) === presence), row => text(row.supplier) || "SEM NOME")
    .sort(([a], [b]) => sortText(a, b)).map(([name, records]) => ({ name, count: records.length }));
}

function supplierStatuses(suppliers) {
  const statuses = new Map();
  for (const supplier of suppliers) {
    if (!supplier || typeof supplier.name !== "string" || typeof supplier.status !== "string") {
      throw new TypeError("Cadastro de fornecedor inválido no snapshot.");
    }
    const name = key(supplier.name);
    if (!name) continue;
    const status = ["ATIVO", "INATIVO"].includes(key(supplier.status)) ? key(supplier.status) : "DESCONHECIDO";
    statuses.set(name, statuses.has(name) && statuses.get(name) !== status ? "DESCONHECIDO" : status);
  }
  return statuses;
}

/** Current supplier assignments and daily attendance. Date and presence filters apply to the daily records. */
export function buildAttendanceSummary(snapshot, filters = {}) {
  if (snapshot?.complete !== true || snapshot.error || snapshot.aborted || snapshot.partial || snapshot.truncated
    || !Array.isArray(snapshot.suppliers) || !Array.isArray(snapshot.presences)) {
    throw new TypeError("O relatório exige um snapshot completo, sem erros ou cancelamento.");
  }
  const now = new Date(); const initial = new Date(now); initial.setDate(initial.getDate() - 14);
  const startDate = dateFilter(filters.startDate === undefined ? localDate(initial) : filters.startDate);
  const endDate = dateFilter(filters.endDate === undefined ? localDate(now) : filters.endDate);
  if (startDate && endDate && startDate > endDate) throw new RangeError("Período inválido: data inicial posterior à final.");
  const statuses = supplierStatuses(snapshot.suppliers);
  const status = filters.supplierStatus !== undefined ? filters.supplierStatus
    : filters.status === undefined ? "ATIVO" : filters.status;
  const ids = new Set();
  for (const row of snapshot.presences) {
    if (!row || !/^[1-9]\d*$/.test(String(row.id)) || typeof row.date !== "string" || !row.date
      || ["branch", "supplier", "profession", "presence"].some(name => typeof row[name] !== "string")) {
      throw new TypeError("Registro de presença inválido no snapshot.");
    }
    dateFilter(row.date);
    if (ids.has(String(row.id))) throw new TypeError("ID duplicado no snapshot de presenças.");
    ids.add(String(row.id));
  }
  const rows = snapshot.presences.filter(row => ["PRESENTE", "PENDENTE", "AUSENTE"].includes(key(row.presence))
    && (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate)
    && matches(row.branch, filters.branch) && matches(row.supplier, filters.supplier)
    && matches(row.presence, filters.presence)
    && matches(statuses.get(key(row.supplier)) || "DESCONHECIDO", status))
    .sort((a, b) => new Decimal(b.id).comparedTo(a.id));
  const present = rows.filter(row => key(row.presence) === "PRESENTE");
  const attendanceNames = new Set(snapshot.presences.map(row => key(row.supplier)));
  const registeredProfessionals = snapshot.suppliers.filter(row => text(row.profession) || attendanceNames.has(key(row.name)));
  const professions = currentProfessions(registeredProfessionals, snapshot.stages || [], filters, status);
  const days = groupBy(rows, row => row.date).sort(([a], [b]) => sortText(b, a)).map(([date, records]) => {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    return { date, weekday: ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][weekday],
      weekend: weekday === 0 || weekday === 6,
      branches: groupBy(records, row => text(row.branch)).sort(([a], [b]) => sortText(a, b)).map(([branch, branchRows]) => {
        const presentRows = branchRows.filter(row => key(row.presence) === "PRESENTE");
        return { branch, pending: categories(branchRows, "PENDENTE"), present: categories(branchRows, "PRESENTE"),
          absent: categories(branchRows, "AUSENTE"),
          professions: groupBy(presentRows, row => text(row.profession) || "SEM PROFISSÃO")
            .sort(([a], [b]) => sortText(a, b)).map(([name, professionRows]) => ({ name, emoji: emoji(name),
              count: new Set(professionRows.map(row => text(row.supplier))).size })) };
      }),
    };
  });
  return { rows, summary: { pending: rows.filter(row => key(row.presence) === "PENDENTE").length,
    present: present.length, absent: rows.filter(row => key(row.presence) === "AUSENTE").length }, professions, days };
}
