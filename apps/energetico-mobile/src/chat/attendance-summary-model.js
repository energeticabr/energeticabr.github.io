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

function sum(rows) {
  if (rows.some(row => !Number.isFinite(row.dailyValue))) return null;
  const value = rows.reduce((total, row) => total.plus(row.dailyValue), new Decimal(0)).toNumber();
  return Number.isFinite(value) ? value : null;
}

function financial(rows) {
  return {
    pendingApproval: sum(rows.filter(row => key(row.presence) === "PENDENTE" && key(row.status) !== "PAGO")),
    approvedPayment: sum(rows.filter(row => key(row.presence) === "PRESENTE" && key(row.status) !== "PAGO")),
    paid: sum(rows.filter(row => key(row.status) === "PAGO")), total: sum(rows),
  };
}

function tone(rows) {
  if (rows.every(row => key(row.status) === "PAGO")) return "paid";
  return rows.every(row => key(row.presence) === "PENDENTE" && key(row.status) !== "PAGO") ? "pending" : "mixed";
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
    .sort(([a], [b]) => sortText(a, b)).map(([name, records]) => ({ name, count: records.length,
      paymentBadges: presence === "PRESENTE" ? [...new Set(records.map(row => key(row.status) === "PAGO"
        ? text(row.paymentId) ? `IDPGTO: ${text(row.paymentId)}` : "PAGO" : "PENDENTE PGTO"))] : [],
    }));
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

/** Read-only PowerFx summary. Null financial sums mean an unknown source amount.
 * Filters: startDate/endDate (ISO or dd/mm/yyyy; empty/null opens that bound),
 * branch, supplierStatus (registry; ATIVO by default; status is an RH alias),
 * supplier and presence.
 * Tones are paid/pending/mixed; paymentBadges are distinct display strings.
 */
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
      || ["branch", "supplier", "profession", "presence", "status", "paymentId"].some(name => typeof row[name] !== "string")) {
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
  const professions = groupBy(rows.filter(row => key(row.presence) !== "AUSENTE"), row => text(row.profession) || "SEM PROFISSÃO")
    .map(([name, records]) => ({ name, emoji: emoji(name), tone: tone(records), recordCount: records.length,
      professionalCount: new Set(records.map(row => text(row.supplier))).size,
      providers: groupBy(records, row => text(row.supplier) || "SEM NOME").sort(([a], [b]) => sortText(a, b))
        .map(([provider, providerRows]) => ({ name: provider, tone: tone(providerRows), recordCount: providerRows.length,
          present: providerRows.filter(row => key(row.presence) === "PRESENTE").length,
          pending: providerRows.filter(row => key(row.presence) === "PENDENTE").length, financial: financial(providerRows) })),
      financial: financial(records),
    })).sort((a, b) => b.recordCount - a.recordCount || sortText(a.name, b.name));
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
              count: new Set(professionRows.map(row => text(row.supplier))).size })), total: sum(presentRows) };
      }),
    };
  });
  return { rows, summary: { pending: rows.filter(row => key(row.presence) === "PENDENTE").length,
    present: present.length, absent: rows.filter(row => key(row.presence) === "AUSENTE").length, total: sum(present) }, professions, days };
}
