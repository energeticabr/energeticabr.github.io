import { normalizeCadastroValue } from "../core/utils.js";

const SYSTEM_COLUMNS = new Set([
  "ID", "CONTENTTYPE", "CONTENTTYPEID", "CREATED", "MODIFIED", "AUTHOR", "EDITOR",
  "_UIVERSIONSTRING", "ATTACHMENTS", "COMPLIANCEASSETID", "EDIT", "LINKTITLE", "LINKTITLENOMENU",
  "SELECTTITLE", "SELECTTITLE2", "FILELEAFREF", "FILEREF", "FSOBJTYPE", "GUID", "UNIQUEID",
]);

function columnType(column = {}) {
  if (column.calculated) return "readonly";
  if (column.choice) return "select";
  if (column.boolean) return "checkbox";
  if (column.currency || column.number?.displayAs === "currency") return "currency";
  if (column.number) return "number";
  if (column.dateTime?.format === "dateOnly") return "date";
  if (column.dateTime) return "datetime-local";
  if (column.lookup) return "lookup";
  if (column.personOrGroup) return "person";
  if (column.text?.allowMultipleLines || column.multilineText) return "textarea";
  return "text";
}

function isSystemColumn(column) {
  const name = String(column?.name || "").trim().toUpperCase();
  return name.startsWith("_") || SYSTEM_COLUMNS.has(name);
}

function parseDecimal(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const source = String(value ?? "").trim();
  if (!source) return undefined;
  const normalized = source.includes(",")
    ? source.replace(/\./g, "").replace(",", ".")
    : source;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeDateTime(value) {
  const source = String(value ?? "").trim();
  if (!source) return undefined;
  return source.length === 16 && source.includes("T") ? `${source}:00` : source;
}

function normalizeLookupId(value) {
  if (value === null || value === undefined || String(value).trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function mapSharePointColumns(columns = [], entity = {}) {
  return Object.freeze((columns || [])
    .filter(column => column?.name && !isSystemColumn(column))
    .map(column => {
      const control = columnType(column);
      return Object.freeze({
        name: column.name,
        label: column.displayName || column.name,
        control,
        required: column.required === true,
        hidden: column.hidden === true,
        readOnly: column.readOnly === true || control === "readonly",
        editable: column.hidden !== true && column.readOnly !== true && control !== "readonly",
        choices: Object.freeze([...(column.choice?.choices || [])]),
        isMessage: (entity.messageFields || []).includes(column.name),
        uppercase: (entity.uppercaseFields || []).includes(column.name),
      });
    }));
}

export function normalizeFormValues(values = {}, mappedColumns = [], entity = {}) {
  const descriptors = new Map((mappedColumns || []).map(column => [column.name, column]));
  const fields = {};
  for (const [name, rawValue] of Object.entries(values || {})) {
    const column = descriptors.get(name);
    if (!column || !column.editable) continue;
    let value = rawValue;
    if (column.control === "number" || column.control === "currency") value = parseDecimal(rawValue);
    if (column.control === "checkbox") value = rawValue === true || rawValue === "true" || rawValue === "on";
    if (column.control === "date" || column.control === "datetime-local") value = normalizeDateTime(rawValue);
    if (column.control === "lookup" || column.control === "person") {
      const lookupId = normalizeLookupId(rawValue);
      if (lookupId !== undefined) fields[`${name}LookupId`] = lookupId;
      continue;
    }
    if (typeof value === "string") {
      value = value.trim();
      if (column.uppercase && !(entity.messageFields || []).includes(name)) value = normalizeCadastroValue(value);
    }
    if (value !== undefined && value !== "") fields[name] = value;
  }
  return fields;
}

function searchableValues(item, fields) {
  const record = item?.fields || {};
  return fields.map(field => record[field]).filter(value => value !== undefined && value !== null).join(" ");
}

export function sortAndFilterItems(items = [], entity = {}, options = {}) {
  const search = String(options.search || "").trim().toLocaleLowerCase("pt-BR");
  const status = String(options.status || "").trim();
  const statusFields = entity.statusFields || [];
  const searchFields = entity.searchFields || ["Title"];
  const sort = options.sort || { field: "Title", direction: "asc" };
  const filtered = (items || []).filter(item => {
    const fields = item?.fields || {};
    const matchesSearch = !search || searchableValues(item, searchFields).toLocaleLowerCase("pt-BR").includes(search);
    const matchesStatus = !status || statusFields.some(field => String(fields[field] || "") === status);
    return matchesSearch && matchesStatus;
  }).slice().sort((left, right) => {
    const leftValue = String(left?.fields?.[sort.field] ?? "").localeCompare(String(right?.fields?.[sort.field] ?? ""), "pt-BR", { numeric: true });
    return sort.direction === "desc" ? -leftValue : leftValue;
  });
  const pageSize = Math.max(1, Number(options.pageSize) || 20);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, Number(options.page) || 1), pages);
  return Object.freeze({
    items: Object.freeze(filtered.slice((page - 1) * pageSize, page * pageSize)),
    total: filtered.length,
    page,
    pages,
    pageSize,
  });
}

export function displayFieldValue(value) {
  if (value === null || value === undefined || value === "") return "Não informado";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "object") return value.displayName || value.name || value.email || value.value || "Não informado";
  return String(value);
}
