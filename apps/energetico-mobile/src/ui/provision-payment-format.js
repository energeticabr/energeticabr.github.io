import { provisionTotal } from '../chat/pending-provision-dates.js';

const DATE_FIELD = /(data|date|criad|created|modific|modified|previst|agend|execu)/i;

export function key(value) {
  return String(value || "").replace(/_x([0-9a-f]{4})_/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("pt-BR").replace(/[^A-Z0-9]/g, "");
}

export function text(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  if (typeof value === "object") {
    for (const name of ["LookupValue", "Value", "value", "DisplayName", "displayName", "Title", "title", "Email", "email"]) {
      if (value[name] != null) return text(value[name]);
    }
    return value instanceof Date ? value.toISOString() : "";
  }
  return String(value);
}

export function field(fields, aliases) {
  const accepted = new Set(aliases.map(key));
  return Object.entries(fields || {}).find(([name, value]) => accepted.has(key(name)) && value != null)?.[1];
}

function dateParts(value) {
  const raw = text(value).trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/i);
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (iso || br) {
    const parts = iso ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
      : { year: Number(br[3]), month: Number(br[2]), day: Number(br[1]) };
    const calendar = new Date(0);
    calendar.setUTCFullYear(parts.year, parts.month - 1, parts.day);
    if (calendar.getUTCFullYear() !== parts.year || calendar.getUTCMonth() !== parts.month - 1
      || calendar.getUTCDate() !== parts.day) return null;
    if (br || raw.length === 10) return parts;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Sao_Paulo" }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
}

export function dateKey(value) {
  const parts = dateParts(value);
  return parts ? `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}` : "";
}

export function formatDate(name, value) {
  if (!DATE_FIELD.test(name) || value == null || value === "") return null;
  const parts = dateParts(value);
  return parts ? `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${parts.year}` : null;
}

function numericValue(value) {
  if (typeof value === "number") return value;
  const raw = text(value).trim().replace(/[^\d,.-]/g, "");
  if (!raw) return NaN;
  const parsed = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function paymentTotal(fields) {
  return provisionTotal(text(field(fields, ["VALOR TOTAL", "VALORTOTAL"])),
    text(field(fields, ["QTD", "QUANTIDADE"])), text(field(fields, ["FRETE"])));
}

export function displayValue(name, value) {
  const date = formatDate(name, value);
  if (date) return date;
  if (["VALORTOTAL", "VALORUNITARIO", "FRETE"].includes(key(name))) {
    const amount = numericValue(value);
    if (Number.isFinite(amount)) return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  if (key(name) === "PGTOAGENDADO" && typeof value === "boolean") return value ? "AGENDADO" : "PENDENTE";
  return text(value) || "—";
}
