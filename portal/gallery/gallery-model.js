import { displayColumnValue } from "../data/column-mapper.js";

function searchableText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("pt-BR");
}

export function normalizeGallerySearchTerms(value, limit = 8) {
  const maximum = Math.max(1, Math.min(12, Number(limit) || 8));
  const terms = searchableText(value).trim().split(/\s+/).filter(Boolean);
  return Object.freeze([...new Set(terms)].slice(0, maximum));
}

export function matchesGallerySearchTerms(fields = {}, searchFields = [], terms = []) {
  const normalizedTerms = (terms || []).map(searchableText).filter(Boolean);
  if (!normalizedTerms.length) return true;
  const haystack = [...new Set(searchFields || [])]
    .map(name => displayColumnValue(fields, { name }))
    .filter(value => value !== "Não informado")
    .map(searchableText)
    .join(" ");
  return normalizedTerms.every(term => haystack.includes(term));
}

function shortDatePtBR(value, dateOnly = false) {
  if (value === null || value === undefined || value === "") return "Não informado";
  if (dateOnly) {
    const calendarDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if (calendarDate) return `${calendarDate[3]}/${calendarDate[2]}/${calendarDate[1]}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

export function formatGalleryValue(fields = {}, column = {}) {
  const value = fields?.[column.name] ?? fields?.[`${column.name}LookupValue`];
  if (["date", "datetime-local"].includes(column.control)) return shortDatePtBR(value, column.control === "date");
  return displayColumnValue(fields, column);
}

export function buildGalleryFilters(items = [], columns = [], filterFields = [], optionValues = {}) {
  const byName = new Map((columns || []).map(column => [column.name, column]));
  return Object.freeze([...new Set(filterFields || [])].map(name => {
    const column = byName.get(name);
    if (!column || column.hidden) return undefined;
    const options = [...new Set([
      ...(column.choices || []),
      ...(optionValues?.[name] || []),
      ...(items || []).map(item => formatGalleryValue(item.fields || {}, column)),
    ].map(value => String(value || "").trim()).filter(value => value && value !== "Não informado"))]
      .sort((left, right) => left.localeCompare(right, "pt-BR", { numeric: true }));
    return Object.freeze({ name, label: column.label || name, options: Object.freeze(options) });
  }).filter(Boolean));
}
