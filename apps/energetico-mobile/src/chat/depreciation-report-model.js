import Decimal from "decimal.js";

const Money = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP });
const TEXT_FIELDS = ["branch", "patrimony", "group", "asset"];
const NUMBER_FIELDS = ["estimatedUnit", "residualUnit", "quantity", "rate"];
const REQUIRED_FIELDS = ["id", "depreciationDate", ...TEXT_FIELDS, ...NUMBER_FIELDS];
const collator = new Intl.Collator("pt-BR");
// Retain exact source decimals across repeated normalization without adding fields to the public contract.
const sourceDecimals = new WeakMap();

function identifier(value) {
  const raw = typeof value === "string" ? value.trim() : value;
  if (!["string", "number"].includes(typeof raw) || !/^\d+(?:\.0+)?$/.test(String(raw))
    || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) {
    throw new TypeError("ID inválido no relatório de depreciação.");
  }
  return Number(raw);
}

function text(value) {
  if (value == null) return "";
  if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) {
    throw new TypeError("Campo inválido no relatório de depreciação.");
  }
  return String(value).trim();
}

function number(value, field) {
  if (value == null || typeof value === "string" && !value.trim()) return new Money(0);
  if (typeof value === "number" && Number.isFinite(value)) return new Money(value);
  if (typeof value !== "string") throw new TypeError(`Valor numérico inválido em ${field}.`);
  // Residual TEXT uses IfError(Value(...; "pt-BR"); 0), including scientific and percent formats.
  if (field === "residualUnit") {
    const currency = /^R\$/.test(value.trim());
    const percent = /%$/.test(value.trim());
    const raw = value.trim().replace(/^R\$\s*/, "").replace(/%$/, "").trim();
    if (currency && percent || !/^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) return new Money(0);
    const result = new Money(raw.replaceAll(".", "").replace(",", ".")).div(percent ? 100 : 1);
    return result.isFinite() && Number.isFinite(result.toNumber()) ? result : new Money(0);
  }
  const raw = value.trim().replace(/^R\$\s*/, "");
  let canonical;
  if (/^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(raw)) canonical = raw.replaceAll(".", "").replace(",", ".");
  else if (/^[+-]?\d+\.\d+$/.test(raw)) canonical = raw;
  else throw new TypeError(`Valor numérico inválido em ${field}.`);
  const result = new Money(canonical);
  if (!result.isFinite() || !Number.isFinite(result.toNumber())) throw new TypeError(`Valor numérico inválido em ${field}.`);
  return result;
}

function date(value) {
  if (value == null || typeof value === "string" && !value.trim()) return null;
  if (typeof value !== "string") throw new TypeError("Data inválida no relatório de depreciação.");
  const raw = value.trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  const iso = /^(\d{4}-\d{2}-\d{2})(?:T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d+)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/.exec(raw);
  const day = br ? `${br[3]}-${br[2]}-${br[1]}` : iso?.[1] || "";
  const calendar = Date.parse(`${day}T00:00:00Z`);
  if (!day || !Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== day) {
    throw new RangeError("Data de calendário inválida no relatório de depreciação.");
  }
  // SharePoint date columns represent a calendar day, including when serialized with a UTC offset.
  return day;
}

/** An incomplete or malformed base must never turn into a valid report with zero indicators. */
export function normalizeDepreciationReportSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !Array.isArray(snapshot.assets)
    || snapshot.complete === false || snapshot.partial || snapshot.incomplete || snapshot.error || snapshot.truncated || snapshot.aborted
    || snapshot.hasMore || snapshot.nextLink) {
    throw new TypeError("Snapshot de depreciação inválido ou incompleto.");
  }
  const ids = new Set();
  const assets = Array.from(snapshot.assets, row => {
    if (!row || typeof row !== "object" || Array.isArray(row) || REQUIRED_FIELDS.some(field => !Object.hasOwn(row, field))) {
      throw new TypeError("Registro ou campo incompleto no relatório de depreciação.");
    }
    const normalized = { id: identifier(row.id), branch: text(row.branch) || "SEM FILIAL", depreciationDate: date(row.depreciationDate),
      patrimony: text(row.patrimony), group: text(row.group), asset: text(row.asset) };
    if (ids.has(normalized.id)) throw new TypeError("ID duplicado no relatório de depreciação.");
    ids.add(normalized.id);
    const decimals = sourceDecimals.get(row) || Object.fromEntries(NUMBER_FIELDS.map(field => [field, number(row[field], field)]));
    for (const field of NUMBER_FIELDS) normalized[field] = decimals[field].toNumber();
    sourceDecimals.set(normalized, decimals);
    return Object.freeze(normalized);
  });
  // Gallery2_27's base sort is unit residual descending; stable ties preserve source order.
  assets.sort((a, b) => sourceDecimals.get(b).residualUnit.comparedTo(sourceDecimals.get(a).residualUnit));
  return Object.freeze({ assets: Object.freeze(assets) });
}

function amounts(row) {
  const { estimatedUnit, residualUnit, quantity, rate } = sourceDecimals.get(row);
  const total = estimatedUnit.times(quantity);
  const current = residualUnit.times(quantity);
  return { total, current, depreciated: total.minus(current), toDepreciate: rate.times(residualUnit).times(quantity).div(100), quantity };
}

function money(value) {
  const result = value.toDecimalPlaces(2).toNumber();
  if (!Number.isFinite(result)) throw new RangeError("Valor agregado inválido no relatório de depreciação.");
  return result === 0 ? 0 : result;
}

function totals(rows) {
  const sums = { total: new Money(0), current: new Money(0), depreciated: new Money(0), toDepreciate: new Money(0), quantity: new Money(0) };
  for (const row of rows) {
    const raw = amounts(row);
    for (const field of Object.keys(sums)) sums[field] = sums[field].plus(raw[field]);
  }
  const quantity = sums.quantity.toNumber();
  if (!Number.isFinite(quantity)) throw new RangeError("Quantidade agregada inválida no relatório de depreciação.");
  return { total: money(sums.total), toDepreciate: money(sums.toDepreciate), depreciated: money(sums.depreciated), current: money(sums.current), quantity };
}

/** PowerFx date window and raw product sums; rounding belongs only to the returned displays. */
export function buildDepreciationOverview(snapshot, todayISO) {
  if (typeof todayISO !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(todayISO)) {
    throw new TypeError("A data de hoje deve estar no formato ISO YYYY-MM-DD.");
  }
  const today = date(todayISO);
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 30);
  if (limit.getUTCFullYear() > 9999) throw new RangeError("Data limite de calendário inválida.");
  const limitDate = limit.toISOString().slice(0, 10);
  const { assets } = normalizeDepreciationReportSnapshot(snapshot);
  const qualifying = assets.filter(row => row.depreciationDate && row.depreciationDate <= limitDate);
  const groups = new Map();
  for (const row of qualifying) {
    if (!groups.has(row.branch)) groups.set(row.branch, []);
    groups.get(row.branch).push(row);
  }
  const branches = [...groups].sort(([left], [right]) => collator.compare(left, right)).map(([branch, rows]) => {
    rows.sort((a, b) => a.depreciationDate.localeCompare(b.depreciationDate)
      || sourceDecimals.get(b).residualUnit.comparedTo(sourceDecimals.get(a).residualUnit));
    const displayed = rows.map(row => {
      const raw = amounts(row);
      return Object.freeze({ ...row, total: money(raw.total), current: money(raw.current), depreciated: money(raw.depreciated),
        toDepreciate: money(raw.toDepreciate), dateTone: row.depreciationDate < today ? "overdue" : row.depreciationDate === today ? "today" : "future" });
    });
    return Object.freeze({ branch, records: rows.length, ...totals(rows), assets: Object.freeze(displayed) });
  });
  // Global sums use the original products, never the already-rounded row or branch displays.
  const { quantity: _quantity, ...globalTotals } = totals(qualifying);
  const metrics = Object.freeze({ records: qualifying.length, active: qualifying.filter(row => sourceDecimals.get(row).residualUnit.gt(0)).length,
    branches: branches.length, ...globalTotals });
  return Object.freeze({ today, limitDate, metrics, branches: Object.freeze(branches) });
}
