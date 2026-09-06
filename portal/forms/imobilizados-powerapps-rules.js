const ASSET_NUMBER_FIELDS = [
  "NÚMEROIMOBILIZADO",
  "NUMEROIMOBILIZADO",
  "N_x00da_MEROIMOBILIZADO",
  "numeroImobilizado",
];

const ASSET_NAME_FIELDS = ["IMOBILIZADO", "imobilizado"];
const ASSET_GROUP_FIELDS = ["GRUPOIMOBILIZADO", "GRUPO IMOBILIZADO", "grupoImobilizado"];
const ASSET_FUNCTION_FIELDS = ["FUNCAO", "FUNÇÃO", "FUN_x00c7__x00c3_O", "funcao"];
const PRODUCT_FIELDS = ["PRODUTO", "field_1", "produto"];

function canonicalText(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("pt-BR");
}

function readField(record, aliases) {
  if (!record || typeof record !== "object") return undefined;

  for (const alias of aliases) {
    if (Object.hasOwn(record, alias)) return record[alias];
  }

  const canonicalAliases = new Set(aliases.map(canonicalText));
  const matchingKeys = Object.keys(record).filter(key => canonicalAliases.has(canonicalText(key)));
  return matchingKeys.length === 1 ? record[matchingKeys[0]] : undefined;
}

function valueOrNull(value) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "")
    ? null
    : value;
}

function numericValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(",", ".");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function dateParts(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
    };
  }

  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(year, month - 1, day);
  if (
    candidate.getFullYear() !== year
    || candidate.getMonth() + 1 !== month
    || candidate.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function twoDigits(value) {
  return String(value).padStart(2, "0");
}

function selectedAssetRecord(selectedImobilizado, cadastroImobilizado) {
  const selectedRecord = selectedImobilizado && typeof selectedImobilizado === "object"
    ? selectedImobilizado
    : null;
  const selectedName = selectedRecord
    ? readField(selectedRecord, ASSET_NAME_FIELDS)
    : selectedImobilizado;
  const expectedName = canonicalText(selectedName);
  const catalogRecord = expectedName
    ? cadastroImobilizado.find(record => canonicalText(readField(record, ASSET_NAME_FIELDS)) === expectedName)
    : null;

  if (!selectedRecord) return catalogRecord || null;
  if (!catalogRecord) return selectedRecord;
  return { ...catalogRecord, ...selectedRecord };
}

export function getF18NextAssetNumber(records = []) {
  const numbers = (Array.isArray(records) ? records : [])
    .map(record => numericValue(readField(record, ASSET_NUMBER_FIELDS)))
    .filter(value => value !== null);
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

export function getF18NextMonthDepreciationDate(registrationDate) {
  const parts = dateParts(registrationDate);
  if (!parts) return null;

  const nextYear = parts.month === 12 ? parts.year + 1 : parts.year;
  const nextMonth = parts.month === 12 ? 1 : parts.month + 1;
  return `${nextYear}-${twoDigits(nextMonth)}-01`;
}

export function deriveF18ImobilizadoDefaults({
  selectedImobilizado,
  cadastroImobilizado = [],
  estimatedValue,
} = {}) {
  const catalog = Array.isArray(cadastroImobilizado) ? cadastroImobilizado : [];
  const selected = selectedAssetRecord(selectedImobilizado, catalog);

  return {
    grupoImobilizado: valueOrNull(readField(selected, ASSET_GROUP_FIELDS)),
    funcao: valueOrNull(readField(selected, ASSET_FUNCTION_FIELDS)),
    valorResidual: valueOrNull(estimatedValue),
  };
}

export function buildF18PowerAppsDefaults({
  existingAssets = [],
  registrationDate,
  selectedImobilizado,
  cadastroImobilizado = [],
  estimatedValue,
} = {}) {
  return {
    numeroImobilizado: getF18NextAssetNumber(existingAssets),
    dataDepreciacao: getF18NextMonthDepreciationDate(registrationDate),
    ...deriveF18ImobilizadoDefaults({
      selectedImobilizado,
      cadastroImobilizado,
      estimatedValue,
    }),
  };
}

export function buildF20SecondaryCadastroProdutoPayload({
  product,
  existingProducts = [],
} = {}) {
  const productName = valueOrNull(product);
  if (productName === null) return null;

  const expectedName = canonicalText(productName);
  const productExists = (Array.isArray(existingProducts) ? existingProducts : []).some(record => {
    const existingName = typeof record === "string" ? record : readField(record, PRODUCT_FIELDS);
    return canonicalText(existingName) === expectedName;
  });
  if (productExists) return null;

  return {
    PRODUTO: productName,
    SUBFAMÍLIA: "DEPRECIAÇÃO E AMORTIZAÇÃO",
  };
}
