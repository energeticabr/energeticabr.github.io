import { normalizeCadastroValue } from "../core/utils.js";

const SYSTEM_COLUMNS = new Set([
  "ID", "CONTENTTYPE", "CONTENTTYPEID", "CREATED", "MODIFIED", "AUTHOR", "EDITOR",
  "_UIVERSIONSTRING", "ATTACHMENTS", "COMPLIANCEASSETID", "EDIT", "LINKTITLE", "LINKTITLENOMENU",
  "SELECTTITLE", "SELECTTITLE2", "FILELEAFREF", "FILEREF", "FSOBJTYPE", "GUID", "UNIQUEID",
  "ITEMCHILDCOUNT", "FOLDERCHILDCOUNT", "APPAUTHOR", "APPEDITOR", "EDITMENUTABLESTART", "EDITMENUTABLEEND",
  "_MODERATIONSTATUS", "_MODERATIONCOMMENT", "_LEVEL", "_ISCURRENTVERSION", "_CHECKINCOMMENT", "_UIVERSION",
  "_HASCOPYDESTINATIONS", "_COPYSOURCE", "_SOURCEURL", "_DISPLAYNAME", "_COMPLIANCEFLAGS", "_COMPLIANCETAG",
  "_COMPLIANCETAGWRITTENTIME", "_COMPLIANCETAGUSERID", "_VIRUSSTATUS", "_SHORTCUTSITEID",
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

function relationshipDescriptor(column, control) {
  if (control !== "lookup" && control !== "person") return undefined;
  const multiple = control === "lookup"
    ? column?.lookup?.allowMultipleValues === true
    : column?.personOrGroup?.allowMultipleSelection === true;
  const listId = control === "lookup" ? String(column?.lookup?.listId || "").trim() : "";
  const displayField = String(column?.lookup?.columnName || "Title").trim();
  const principalType = String(column?.personOrGroup?.chooseFromType || "peopleOnly");
  const safeDisplayField = /^[A-Za-z_][A-Za-z0-9_]*$/.test(displayField);
  return Object.freeze({
    kind: control,
    listId,
    displayField,
    multiple,
    ...(control === "person" ? { principalType } : {}),
    resolvable: !multiple && safeDisplayField && (control === "person" ? principalType.toLowerCase() === "peopleonly" : Boolean(listId)),
  });
}

function isSystemColumn(column) {
  const name = String(column?.name || "").trim().toUpperCase();
  return SYSTEM_COLUMNS.has(name);
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

function isEmptyValue(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function emptyFieldValue(column) {
  return column.control === "lookup" || column.control === "person"
    ? { name: `${column.name}LookupId`, value: null }
    : { name: column.name, value: null };
}

export function mapSharePointColumns(columns = [], entity = {}) {
  return Object.freeze((columns || [])
    .filter(column => column?.name && !isSystemColumn(column))
    .map(column => {
      const control = columnType(column);
      const relation = relationshipDescriptor(column, control);
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
        ...(relation ? { relation } : {}),
      });
    }));
}

export function validateFormValues(values = {}, mappedColumns = [], entity = {}, options = {}) {
  const descriptors = new Map((mappedColumns || []).map(column => [column.name, column]));
  const fields = {};
  const errors = {};
  const mode = options.mode === "edit" ? "edit" : "create";
  for (const column of descriptors.values()) {
    if (!column.editable || column.hidden) continue;
    const name = column.name;
    if (!Object.hasOwn(values || {}, name)) continue;
    const rawValue = values?.[name];
    if (isEmptyValue(rawValue)) {
      if (column.required) errors[name] = `Informe ${column.label}.`;
      else if (mode === "edit") {
        const empty = emptyFieldValue(column);
        fields[empty.name] = empty.value;
      }
      continue;
    }
    let value = rawValue;
    if (column.control === "number" || column.control === "currency") value = parseDecimal(rawValue);
    if ((column.control === "number" || column.control === "currency") && value === undefined) {
      errors[name] = `Informe um valor válido para ${column.label}.`;
      continue;
    }
    if (column.control === "checkbox") value = rawValue === true || rawValue === "true" || rawValue === "on";
    if (column.control === "date" || column.control === "datetime-local") value = normalizeDateTime(rawValue);
    if (column.control === "lookup" || column.control === "person") {
      const lookupId = normalizeLookupId(rawValue);
      if (lookupId === undefined) errors[name] = `Selecione uma opção válida para ${column.label}.`;
      else fields[`${name}LookupId`] = lookupId;
      continue;
    }
    if (typeof value === "string") {
      value = value.trim();
      if (column.uppercase && !(entity.messageFields || []).includes(name)) value = normalizeCadastroValue(value);
    }
    if (value !== undefined) fields[name] = value;
  }
  return Object.freeze({ fields: Object.freeze(fields), errors: Object.freeze(errors) });
}

export function normalizeFormValues(values = {}, mappedColumns = [], entity = {}, options = {}) {
  return validateFormValues(values, mappedColumns, entity, options).fields;
}

function objectDisplayValue(value) {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) return value.map(objectDisplayValue).filter(Boolean).join(" ");
  for (const key of ["lookupValue", "LookupValue", "displayName", "DisplayName", "name", "Name", "email", "Email", "value", "Value"]) {
    if (value[key] !== undefined && value[key] !== null && String(value[key]).trim()) return String(value[key]);
  }
  return "";
}

function graphFieldDisplay(fields = {}, name = "") {
  const direct = fields[name];
  const derived = [fields[`${name}LookupValue`], fields[`${name}DisplayName`], fields[`${name}Email`]];
  const candidates = typeof direct === "object" ? [direct, ...derived] : [...derived, direct];
  for (const candidate of candidates) {
    const display = typeof candidate === "object" ? objectDisplayValue(candidate) : String(candidate ?? "").trim();
    if (display) return display;
  }
  const lookupId = fields[`${name}LookupId`];
  return lookupId === null || lookupId === undefined || lookupId === "" ? "" : `ID ${lookupId}`;
}

function searchableValues(item, fields) {
  const record = item?.fields || {};
  return fields.map(field => graphFieldDisplay(record, field)).filter(Boolean).join(" ");
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
    const leftValue = graphFieldDisplay(left?.fields, sort.field).localeCompare(graphFieldDisplay(right?.fields, sort.field), "pt-BR", { numeric: true });
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
  if (typeof value === "object") return objectDisplayValue(value) || "Não informado";
  return String(value);
}

export function displayColumnValue(fields = {}, column = {}) {
  const value = graphFieldDisplay(fields, column.name);
  return value || "Não informado";
}
