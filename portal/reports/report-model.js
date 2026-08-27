const SYSTEM_COLUMNS = new Set([
  "ID", "CONTENTTYPE", "CONTENTTYPEID", "CREATED", "MODIFIED", "AUTHOR", "EDITOR", "ATTACHMENTS",
  "COMPLIANCEASSETID", "EDIT", "LINKTITLE", "LINKTITLENOMENU", "SELECTTITLE",
  "FILELEAFREF", "FILEREF", "FSOBJTYPE", "GUID", "UNIQUEID",
]);

const PENDING_STATUS = /^(PENDENTE|AGUARDANDO|ABERTO|EM ANDAMENTO)(?:$|\s|-)/;
const FINAL_STATUS = /^(FINALIZADO|CONCLUIDO|ENCERRADO|APROVADO)(?:$|\s|-)/;

function normalized(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleUpperCase("pt-BR");
}

function fieldName(column) {
  return String(column?.name || "").trim();
}

function isVisibleColumn(column) {
  const name = normalized(fieldName(column));
  return Boolean(name) && column?.hidden !== true && !SYSTEM_COLUMNS.has(name);
}

function reportColumn(column) {
  return Object.freeze({
    name: fieldName(column),
    label: String(column?.label || column?.displayName || fieldName(column)),
    hidden: column?.hidden === true,
  });
}

function findNamedColumn(columns, names) {
  const expected = new Set(names.map(normalized));
  return columns.find(column => expected.has(normalized(fieldName(column))))?.name || "";
}

function findMatchingColumn(columns, pattern) {
  return columns.find(column => pattern.test(normalized(fieldName(column))) || pattern.test(normalized(column?.displayName)))?.name || "";
}

function isDateColumn(column) {
  return Boolean(column?.dateTime);
}

function primitiveDisplay(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (Array.isArray(value)) return value.map(primitiveDisplay).filter(Boolean).join(", ");
  if (typeof value !== "object") return String(value);
  for (const key of ["lookupValue", "LookupValue", "displayName", "DisplayName", "name", "Name", "email", "Email", "value", "Value"]) {
    const candidate = primitiveDisplay(value[key]);
    if (candidate) return candidate;
  }
  return "";
}

function itemField(item, name) {
  const direct = item?.fields?.[name];
  if (direct !== undefined && direct !== null && String(direct).trim() !== "") return primitiveDisplay(direct);
  for (const suffix of ["LookupValue", "DisplayName", "Email"]) {
    const derived = primitiveDisplay(item?.fields?.[`${name}${suffix}`]);
    if (derived) return derived;
  }
  return "";
}

function dateValue(item, dateField) {
  return itemField(item, dateField);
}

function timestamp(value, endOfDay = false) {
  const source = String(value || "").trim();
  if (!source) return undefined;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(source);
  const parsed = new Date(dateOnly ? `${source}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}` : source);
  const result = parsed.getTime();
  return Number.isNaN(result) ? undefined : result;
}

function calendarDate(value) {
  return String(value || "").match(/^\d{4}-\d{2}-\d{2}/)?.[0] || "";
}

function uniqueSorted(values) {
  return Object.freeze([...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, "pt-BR", { numeric: true })));
}

function statusKind(value) {
  const status = normalized(value);
  if (PENDING_STATUS.test(status)) return "pending";
  if (FINAL_STATUS.test(status)) return "finalized";
  return "other";
}

export function detectReportDimensions(columns = [], entity = {}) {
  const available = (columns || []).filter(isVisibleColumn);
  const configuredStatus = findNamedColumn(available, entity.statusFields || []);
  return Object.freeze({
    dateFields: Object.freeze(available.filter(isDateColumn).map(column => Object.freeze({
      name: fieldName(column),
      label: String(column?.displayName || column?.label || fieldName(column)),
      dateOnly: column?.dateTime?.format === "dateOnly" || column?.control === "date",
    }))),
    branchField: findMatchingColumn(available, /(^|_)(FILIAL|UNIDADE)($|_)/),
    statusField: configuredStatus || findMatchingColumn(available, /(^|_)(STATUS|SITUACAO|CONCLUIDO)($|_)/),
  });
}

export function buildReportView(items = [], columns = [], dimensions = {}, filters = {}) {
  const reportColumns = Object.freeze((columns || []).filter(isVisibleColumn).map(reportColumn));
  const allItems = [...(items || [])];
  const branch = String(filters.branch || "").trim();
  const status = String(filters.status || "").trim();
  const activeDateField = (dimensions.dateFields || []).find(field => field.name === filters.dateField) || null;
  const dateOnly = activeDateField?.dateOnly === true;
  const startDate = calendarDate(filters.startDate);
  const endDate = calendarDate(filters.endDate);
  const start = timestamp(filters.startDate);
  const end = timestamp(filters.endDate, true);
  const filteredItems = allItems.filter(item => {
    if (activeDateField && dateOnly) {
      const itemDate = calendarDate(dateValue(item, activeDateField.name));
      if (startDate && (!itemDate || itemDate < startDate)) return false;
      if (endDate && (!itemDate || itemDate > endDate)) return false;
    }
    const itemDate = activeDateField ? timestamp(dateValue(item, activeDateField.name)) : undefined;
    if (activeDateField && !dateOnly && start !== undefined && (itemDate === undefined || itemDate < start)) return false;
    if (activeDateField && !dateOnly && end !== undefined && (itemDate === undefined || itemDate > end)) return false;
    if (branch && itemField(item, dimensions.branchField) !== branch) return false;
    if (status && itemField(item, dimensions.statusField) !== status) return false;
    return true;
  });
  const statuses = filteredItems.map(item => itemField(item, dimensions.statusField));
  return Object.freeze({
    columns: reportColumns,
    items: Object.freeze(filteredItems),
    activeDateField,
    metrics: Object.freeze({
      loaded: allItems.length,
      filtered: filteredItems.length,
      pending: statuses.filter(value => statusKind(value) === "pending").length,
      finalized: statuses.filter(value => statusKind(value) === "finalized").length,
    }),
    options: Object.freeze({
      branches: uniqueSorted(allItems.map(item => itemField(item, dimensions.branchField))),
      statuses: uniqueSorted(allItems.map(item => itemField(item, dimensions.statusField))),
    }),
  });
}

export function reportCellValue(item, column) {
  const value = itemField(item, column?.name);
  return value || "Não informado";
}

function safeSpreadsheetValue(value) {
  const source = String(value ?? "");
  let offset = 0;
  for (const character of source) {
    const codePoint = character.codePointAt(0);
    if (!/[\p{White_Space}\p{Cc}\p{Cf}]/u.test(character)
      && codePoint > 31
      && codePoint !== 127) break;
    offset += character.length;
  }
  return /^[=+\-@]/.test(source.slice(offset)) ? `'${source}` : source;
}

function csvCell(value) {
  const source = safeSpreadsheetValue(value).replaceAll('"', '""');
  return /[;"\r\n]/.test(source) ? `"${source}"` : source;
}

function partialCsvNotice(metadata = {}) {
  if (metadata.complete !== false) return [];
  const loaded = new Intl.NumberFormat("pt-BR").format(Number(metadata.loadedCount) || 0);
  const limit = metadata.partialReason === "max-pages"
    ? `o limite operacional de ${Number(metadata.maxPages) || 0} páginas foi atingido`
    : `o limite operacional de ${new Intl.NumberFormat("pt-BR").format(Number(metadata.maxItems) || 0)} registros foi atingido`;
  return [`AVISO;${csvCell(`RELATÓRIO PARCIAL: ${loaded} registros carregados; ${limit}.`)}`, ""];
}

export function reportViewToCsv(view = {}, metadata = {}) {
  const columns = view.columns || [];
  const lines = [
    ...partialCsvNotice(metadata),
    columns.map(column => csvCell(column.label)).join(";"),
    ...(view.items || []).map(item => columns.map(column => csvCell(reportCellValue(item, column))).join(";")),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}
