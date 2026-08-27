const TECHNICAL_FIELDS = Object.freeze(new Set([
  "ID",
  "CONTENTTYPE",
  "ATTACHMENTS",
  "CREATED",
  "MODIFIED",
  "AUTHOR",
  "EDITOR",
  "COMPLIANCEASSETID",
  "UIVERSIONSTRING",
  "GUID",
]));

const DEFAULT_CONTRACT = Object.freeze({
  formFields: Object.freeze(["*"]),
  galleryColumns: Object.freeze(["*"]),
  filterFields: Object.freeze([]),
  searchFields: Object.freeze([]),
  multiple: false,
  dateFormat: "shortDate",
});

const CONTRACTS = Object.freeze({
  lancamentos: Object.freeze({
    formFields: Object.freeze([
      "FILIAL", "TIPOTRANSACAO", "TIPO TRANSAÇÃO", "DATA", "DATAPGTOPREVISTO",
      "DATA PGTO PREVISTO", "DATAPGTOEFETUADO", "DATA PGTO EFETUADO", "FORNECEDOR", "ETAPA",
      "PRODUTO", "QUANTIDADE", "VALOR UNITÁRIO", "VALORUNITARIO", "FRETE", "CONTA", "DESCRICAO",
      "DESCRIÇÃO", "CONCLUIDO", "CONCLUÍDO", "DATA RMS", "DATARMS", "TIPO DESPESA", "TIPODESPESA",
      "AGRUPAR", "NOTA", "CONTRATO",
    ]),
    galleryColumns: Object.freeze(["FILIAL", "DATA", "FORNECEDOR", "PRODUTO", "DESCRICAO", "DESCRIÇÃO", "CONCLUIDO", "CONCLUÍDO"]),
    filterFields: Object.freeze(["FILIAL", "CONCLUIDO", "CONCLUÍDO"]),
    searchFields: Object.freeze(["FILIAL", "FORNECEDOR", "PRODUTO", "DESCRICAO", "DESCRIÇÃO"]),
    multiple: true,
    dateFormat: "shortDate",
  }),
  compras: Object.freeze({ ...DEFAULT_CONTRACT, multiple: true }),
  "linhas-de-contrato": Object.freeze({ ...DEFAULT_CONTRACT, multiple: true }),
  "linhas-de-medicao": Object.freeze({ ...DEFAULT_CONTRACT, multiple: true }),
});

function canonicalFieldName(value) {
  return String(value || "")
    .replace(/_x([0-9a-f]{4})_/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^_+|_+$/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLocaleUpperCase("pt-BR");
}

export function isTechnicalPowerAppsField(name) {
  return TECHNICAL_FIELDS.has(canonicalFieldName(name));
}

function freezeContract(contract = {}) {
  return Object.freeze({
    formFields: Object.freeze([...(contract.formFields || DEFAULT_CONTRACT.formFields)]),
    galleryColumns: Object.freeze([...(contract.galleryColumns || DEFAULT_CONTRACT.galleryColumns)]),
    filterFields: Object.freeze([...(contract.filterFields || [])]),
    searchFields: Object.freeze([...(contract.searchFields || [])]),
    multiple: contract.multiple === true,
    dateFormat: contract.dateFormat === "shortDate" ? "shortDate" : DEFAULT_CONTRACT.dateFormat,
  });
}

export function getPowerAppsUiContract(entityId) {
  return freezeContract(CONTRACTS[String(entityId || "")] || DEFAULT_CONTRACT);
}

function availableColumns(columns = []) {
  return (columns || []).filter(column => !column.hidden && !isTechnicalPowerAppsField(column.name));
}

function selectColumns(columns, declarations, predicate = () => true) {
  const candidates = availableColumns(columns).filter(predicate);
  if ((declarations || []).includes("*")) return candidates;
  const byCanonicalName = new Map(candidates.map(column => [canonicalFieldName(column.name), column]));
  const selected = [];
  const seen = new Set();
  for (const declaration of declarations || []) {
    const column = byCanonicalName.get(canonicalFieldName(declaration));
    if (column && !seen.has(column.name)) {
      selected.push(column);
      seen.add(column.name);
    }
  }
  return selected;
}

function selectFieldNames(columns, declarations) {
  const selected = selectColumns(columns, declarations);
  return selected.map(column => column.name);
}

export function resolvePowerAppsUiContract(entity = {}, columns = []) {
  const declared = getPowerAppsUiContract(entity.id);
  const fallbackSearch = declared.searchFields.length ? declared.searchFields : (entity.searchFields || ["Title"]);
  const fallbackFilters = declared.filterFields.length
    ? declared.filterFields
    : [...(entity.filterFields || []), ...(entity.statusFields || []), ...availableColumns(columns).filter(column => column.control === "select").map(column => column.name)];
  const galleryColumns = selectColumns(columns, declared.galleryColumns).slice(0, 8);
  const formColumns = selectColumns(columns, declared.formFields, column => column.editable === true);
  return Object.freeze({
    entityId: String(entity.id || ""),
    formColumns: Object.freeze(formColumns),
    galleryColumns: Object.freeze(galleryColumns),
    filterFields: Object.freeze(selectFieldNames(columns, fallbackFilters)),
    searchFields: Object.freeze(selectFieldNames(columns, fallbackSearch)),
    multiple: declared.multiple,
    dateFormat: declared.dateFormat,
  });
}

export default CONTRACTS;
