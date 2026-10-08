import Decimal from "decimal.js";

const Money = Decimal.clone({ precision: 40 });
const text = value => String(value ?? "").trim();
// Preserve accents/punctuation in supplier identities: normalizing them away can join different people.
const key = value => text(value).normalize("NFC").toLocaleUpperCase("pt-BR");
const matches = (value, filter) => !text(filter) || key(value) === key(filter);
const sortText = (a, b) => text(a).localeCompare(text(b), "pt-BR") || text(a).localeCompare(text(b));
const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

function dateOnly(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") throw new RangeError("Data inválida no relatório.");
  const raw = text(value); const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : raw;
  const parsed = new Date(`${iso}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    throw new RangeError("Data inválida no período ou registro do relatório.");
  }
  return iso;
}

function validateRows(rows, kind) {
  const ids = new Set();
  for (const row of rows) {
    if (!row || !/^[1-9]\d*$/.test(String(row.id))) throw new TypeError(`Registro inválido no snapshot de ${kind}.`);
    if (ids.has(String(row.id))) throw new TypeError(`ID duplicado no snapshot de ${kind}.`);
    ids.add(String(row.id));
    const fields = kind === "suppliers" ? ["name", "branch", "property", "profession", "status", "paymentMethod"]
      : ["date", "branch", "property", "supplier", "stage", "presence"];
    if (fields.some(field => typeof row[field] !== "string")) throw new TypeError(`Registro com campos inválidos no snapshot de ${kind}.`);
    if (kind === "suppliers") {
      if (!(typeof row.contractor === "boolean" || typeof row.contractor === "string" && ["", "SIM", "NAO", "NÃO"].includes(key(row.contractor)))) {
        throw new TypeError("Registro com EMPREITEIRO inválido no snapshot.");
      }
      if ((row.contractor === true || key(row.contractor) === "SIM") && !text(row.name)) throw new TypeError("Fornecedor com identidade inválida no snapshot.");
      for (const field of ["stage", "activity", "measurement"]) {
        if (row[field] !== undefined && typeof row[field] !== "string") throw new TypeError("Descrição de fornecedor inválida no snapshot.");
      }
      if (row.dailyValueBlank !== undefined && typeof row.dailyValueBlank !== "boolean") throw new TypeError("Indicador de valor diário inválido no snapshot.");
    } else if (!text(row.supplier) || !dateOnly(row.date)) throw new TypeError("Presença com fornecedor ou data inválida no snapshot.");
  }
}

function registryNames(suppliers) {
  const names = new Set();
  for (const supplier of suppliers) {
    const name = key(supplier.name); if (!name) continue;
    if (names.has(name)) throw new TypeError(`Fornecedor com identidade ambígua no cadastro: ${supplier.name}.`);
    names.add(name);
  }
  return names;
}

function numeric(value) {
  const number = value.toNumber();
  return Number.isFinite(number) && Math.abs(number) <= Number.MAX_SAFE_INTEGER && new Money(number).eq(value) ? number : null;
}

function dailySummary(rows) {
  const daily = rows.filter(row => key(row.paymentMethod) === "DIÁRIA");
  let total = new Money(0); let unknown = false;
  for (const row of daily) {
    // The source explicitly Sum(Coalesce(VLR DIARIO, 0)); only a verified blank qualifies.
    if (row.dailyValue == null && row.dailyValueBlank === true) continue;
    if (typeof row.dailyValue !== "number" || !Number.isFinite(row.dailyValue) || Math.abs(row.dailyValue) > Number.MAX_SAFE_INTEGER) unknown = true;
    else total = total.plus(row.dailyValue);
  }
  return { count: rows.length, dailyCount: daily.length,
    measurementCount: rows.filter(row => key(row.paymentMethod) === "MEDIÇÃO").length,
    globalCount: rows.filter(row => key(row.paymentMethod) === "VALOR GLOBAL").length,
    dailyTotal: unknown ? null : numeric(total) };
}

function frequency(records) {
  const present = records.filter(row => key(row.presence) === "PRESENTE").length;
  return { present, total: records.length, percent: records.length
    ? new Money(present).div(records.length).times(100).toDecimalPlaces(1, Money.ROUND_HALF_UP).toNumber() : 0 };
}

function group(rows, field) {
  const result = new Map();
  for (const row of rows) {
    const value = row[field];
    if (!result.has(value)) result.set(value, []);
    result.get(value).push(row);
  }
  return [...result].sort(([a], [b]) => sortText(a, b));
}

export function defaultSupplierWorkforceFilters(today = localToday()) {
  const day = dateOnly(today);
  if (!day) throw new RangeError("Data atual inválida no relatório.");
  return { startDate: "", endDate: day, branch: "", property: "", supplier: "", supplierStatus: "ATIVO", stage: "" };
}

/** Literal PowerFx filtering/grouping and frequency rules, with complete history instead of FirstN(2000).
 * Property and stage select only the presence base; registry membership needs that base only when dates exist.
 * Null daily totals indicate invalid/unknown values, except verified source blanks explicitly coalesced to zero.
 */
export function buildSupplierWorkforceReport(snapshot, filters = {}, today = localToday()) {
  if (snapshot?.complete !== true || snapshot.error || snapshot.partial || snapshot.aborted || snapshot.truncated
    || !Array.isArray(snapshot.suppliers) || !Array.isArray(snapshot.presences)) {
    throw new TypeError("O relatório exige um snapshot completo, sem erros ou cancelamento.");
  }
  const day = dateOnly(today); const defaults = defaultSupplierWorkforceFilters(day);
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) throw new TypeError("Filtros inválidos no relatório.");
  const effective = Object.fromEntries(Object.keys(defaults).map(field => [field, filters[field] === undefined ? defaults[field] : filters[field]]));
  effective.startDate = dateOnly(effective.startDate); effective.endDate = dateOnly(effective.endDate);
  for (const field of ["branch", "property", "supplier", "supplierStatus", "stage"]) {
    if (effective[field] == null) effective[field] = "";
    if (typeof effective[field] !== "string") throw new TypeError("Filtro de identidade inválido no relatório.");
    effective[field] = text(effective[field]);
  }
  if (effective.startDate && effective.endDate && effective.startDate > effective.endDate) {
    throw new RangeError("Período inválido: data inicial posterior à final.");
  }
  validateRows(snapshot.suppliers, "suppliers"); validateRows(snapshot.presences, "presences");
  const names = registryNames(snapshot.suppliers);
  const warnings = new Set(Array.isArray(snapshot.warnings) ? snapshot.warnings : []);
  const hasDateFilter = Boolean(effective.startDate || effective.endDate);
  if (!hasDateFilter && (effective.property || effective.stage)) {
    warnings.add("Sem filtro de data, imóvel e etapa filtram apenas a base das frequências; fornecedores sem presença correspondente continuam no cadastro agrupado.");
  }
  const history = new Map();
  for (const raw of snapshot.presences) {
    const row = { ...raw, date: dateOnly(raw.date) };
    const name = key(row.supplier);
    if (!names.has(name)) warnings.add(`Fornecedor ${row.supplier}: presença sem cadastro correspondente; confira a identidade.`);
    if (effective.startDate && row.date < effective.startDate || effective.endDate && row.date > effective.endDate
      || !matches(row.branch, effective.branch) || !matches(row.property, effective.property)
      || !matches(row.supplier, effective.supplier) || !matches(row.stage, effective.stage)) continue;
    if (!history.has(name)) history.set(name, []);
    history.get(name).push(row);
  }
  const recent = new Date(`${day}T12:00:00Z`); recent.setUTCDate(recent.getUTCDate() - 30);
  const cutoff = recent.toISOString().slice(0, 10); const suppliers = [];
  for (const supplier of snapshot.suppliers) {
    const records = history.get(key(supplier.name)) || [];
    if (!(supplier.contractor === true || key(supplier.contractor) === "SIM") || !matches(supplier.status, effective.supplierStatus)
      || !matches(supplier.branch, effective.branch) || !matches(supplier.name, effective.supplier) || hasDateFilter && !records.length) continue;
    const dates = records.map(row => row.date).sort();
    const presentDates = records.filter(row => key(row.presence) === "PRESENTE").map(row => row.date).sort();
    const firstDate = dates[0] || ""; const lastPresentDate = presentDates.at(-1) || "";
    const lastDay = key(supplier.status) === "INATIVO" ? lastPresentDate : day;
    const activeDays = firstDate && lastDay ? (Date.parse(`${lastDay}T12:00:00Z`) - Date.parse(`${firstDate}T12:00:00Z`)) / 86_400_000 : null;
    if (key(supplier.paymentMethod) === "DIÁRIA") {
      if (supplier.dailyValue == null && supplier.dailyValueBlank === true) {
        warnings.add(`${supplier.name}: valor diário em branco (PREENCHER); o resumo aplica zero conforme Coalesce da origem.`);
      } else if (typeof supplier.dailyValue !== "number" || !Number.isFinite(supplier.dailyValue) || Math.abs(supplier.dailyValue) > Number.MAX_SAFE_INTEGER) {
        warnings.add(`${supplier.name}: valor diário inválido ou desconhecido; total de diária indisponível.`);
      }
    }
    suppliers.push({ ...supplier, firstDate, lastPresentDate, activeDays,
      frequency30: frequency(records.filter(row => row.date >= cutoff)), frequencyHistory: frequency(records) });
  }
  const byPayment = (a, b) => sortText(a.paymentMethod, b.paymentMethod) || new Money(a.id).comparedTo(b.id) || sortText(a.name, b.name);
  const branches = group(suppliers, "branch").map(([branch, branchRows]) => ({ branch,
    properties: group(branchRows, "property").map(([property, propertyRows]) => ({ property, summary: dailySummary(propertyRows),
      professions: group(propertyRows, "profession").map(([profession, professionRows]) => ({ profession,
        summary: dailySummary(professionRows), suppliers: professionRows.slice().sort(byPayment) })) })) }));
  return { branches, filters: effective, warnings: [...warnings] };
}
