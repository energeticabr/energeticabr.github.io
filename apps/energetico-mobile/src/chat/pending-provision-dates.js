import Decimal from "decimal.js";

const DAY_MS = 86_400_000;

// SharePoint timestamps represent instants; date-only fields represent calendar days.
export function provisionDateKey(value = new Date()) {
  const raw = String(value ?? "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (iso || br) {
    const [year, month, day] = iso ? iso.slice(1).map(Number) : [Number(br[3]), Number(br[2]), Number(br[1])];
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : "";
  }
  if (!(value instanceof Date) && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return "";
  const date = value instanceof Date ? value : new Date(raw);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export function provisionDayOffset(value, days) {
  const key = provisionDateKey(value);
  return key ? new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10) : "";
}

export function provisionDueState(value, today = new Date()) {
  const due = provisionDateKey(value), reference = provisionDateKey(today);
  if (!due || !reference) return { kind: "unknown", label: "VENCIMENTO NÃO INFORMADO", date: "—" };
  const days = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${reference}T00:00:00Z`)) / DAY_MS);
  return {
    kind: days <= 0 ? "urgent" : days <= 2 ? "upcoming" : "later",
    label: days < 0 ? `VENCIDO HÁ ${-days} ${days === -1 ? "DIA" : "DIAS"}`
      : days === 0 ? "VENCE HOJE" : days === 1 ? "VENCE AMANHÃ" : `VENCE EM ${days} DIAS`,
    date: `${due.slice(8, 10)}/${due.slice(5, 7)}/${due.slice(0, 4)}`,
  };
}

export function provisionNumericValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const raw = String(value ?? "").trim().replace(/^R\$\s*/, "").replace(/\s/g, "");
  if (!raw || !/^-?[\d.,]+$/.test(raw)) return NaN;
  const number = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
  return Number.isFinite(number) ? number : NaN;
}

export function provisionTotal(amount, quantity, freight) {
  const price = provisionNumericValue(amount);
  const count = quantity == null || String(quantity).trim() === "" ? 1 : provisionNumericValue(quantity);
  const shipping = freight == null || String(freight).trim() === "" ? 0 : provisionNumericValue(freight);
  if (![price, count, shipping].every(Number.isFinite)) return "";
  const total = new Decimal(price).times(count).plus(shipping)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
  return Number.isFinite(total) ? total : "";
}
