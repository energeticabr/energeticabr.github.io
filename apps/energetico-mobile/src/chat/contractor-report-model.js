import Decimal from "decimal.js";

const UNRESOLVED = Symbol("unresolved SharePoint column");

function key(value) {
  return String(value ?? "").replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function scalar(value) {
  if (value == null || value === UNRESOLVED) return "";
  if (Array.isArray(value)) return value.map(scalar).filter(Boolean).join(", ");
  if (typeof value === "object") {
    for (const name of ["LookupValue", "Value", "value", "Title", "title", "LookupId"]) {
      if (value[name] != null) return scalar(value[name]);
    }
    return "";
  }
  return String(value).trim();
}

function valueFor(item, columns, aliases) {
  const fields = item?.fields || {};
  if (!Array.isArray(columns)) throw new TypeError("Esquema de colunas SharePoint inválido.");
  const available = columns.filter(entry => entry?.computed !== true && !/^LinkTitle(?:NoMenu|\d+)?$/i.test(entry?.name || ""));
  const semantic = aliases.filter(alias => !/^field_\d+$/i.test(alias));
  const legacy = aliases.filter(alias => /^field_\d+$/i.test(alias));
  const wanted = new Set(semantic.map(key));
  const matches = available.filter(entry => wanted.has(key(entry?.displayName)) || wanted.has(key(entry?.name)));
  if (matches.length > 1) throw new TypeError(`Coluna ${aliases[0]} ambígua no SharePoint.`);
  // A schema-mapped blank is authoritative; a stale alias must not fill it.
  if (matches.length) return fields[matches[0].name];
  const direct = Object.entries(fields).filter(([name]) => wanted.has(key(name))
    && (!columns.length || available.some(entry => entry.name === name && wanted.has(key(entry.displayName || name)))));
  if (direct.length > 1) throw new TypeError(`Coluna ${aliases[0]} ambígua no registro.`);
  if (direct.length) return direct[0][1];
  const fallback = legacy.filter(name => !columns.length ? Object.hasOwn(fields, name)
    : available.some(entry => entry.name === name && key(entry.displayName || name) === key(name)));
  return fallback.length ? fields[fallback[0]] : UNRESOLVED;
}

function knownBlankMoney(value) {
  if (value == null || typeof value === "string" && !value.trim()) return true;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const name of ["LookupValue", "Value", "value"]) {
      if (Object.hasOwn(value, name)) return knownBlankMoney(value[name]);
    }
  }
  return false;
}

function money(value, blank = null) {
  if (value == null) return blank;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && !Array.isArray(value)) {
    for (const name of ["LookupValue", "Value", "value"]) {
      if (Object.hasOwn(value, name)) return money(value[name], blank);
    }
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return blank;
  const raw = text.replace(/^R\$\s*/, "");
  if (text.startsWith("R$")) {
    if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(raw)) return null;
    const result = Number(raw.replaceAll(".", "").replace(",", "."));
    return Number.isFinite(result) ? result : null;
  }
  if (!/^-?(?:\d+(?:[.,]\d+)?|\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/.test(raw)) return null;
  const lastComma = raw.lastIndexOf(","), lastDot = raw.lastIndexOf(".");
  let normalized = raw;
  if ((raw.match(/,/g) || []).length > 1 && lastDot < 0) normalized = raw.replaceAll(",", "");
  else if (lastComma > lastDot) normalized = raw.replaceAll(".", "").replace(",", ".");
  else if (lastDot > lastComma && lastComma >= 0) normalized = raw.replaceAll(",", "");
  else if ((raw.match(/\./g) || []).length > 1) normalized = raw.replaceAll(".", "");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

export function formatReportMoney(value) {
  return value == null || !Number.isFinite(value)
    ? "PENDENTE"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export function formatReportDate(value) {
  const raw = scalar(value);
  if (!raw) return "PENDENTE";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return br ? `${br[1]}/${br[2]}/${br[3]}` : "PENDENTE";
}

export function normalizeContractorRow(item, columns = []) {
  const read = (...aliases) => valueFor(item, columns, aliases);
  const get = (...aliases) => scalar(read(...aliases));
  const globalValue = read("VALORGLOBALESTIMADO", "VALOR GLOBAL ESTIMADO");
  return Object.freeze({
    id: scalar(item?.id || get("ID")),
    startDate: get("DATA INÍCIO", "DATAINICIO", "DATAIN_x00cd_CIO"),
    endDate: get("DATA FIM", "DATAFIM"),
    branch: get("FILIAL"),
    supplier: get("FORNECEDOR"),
    stage: get("ETAPA OBRA", "ETAPAOBRA"),
    activity: get("ATIVIDADEEXECUTADA", "ATIVIDADE EXECUTADA"),
    measurementType: get("TIPO DE MEDIÇÃO", "TIPOMEDICAO"),
    contractDocumentId: get("IDCONTRATO", "ID CONTRATO"),
    estimateDocumentId: get("IDESTIMATIVA", "ID ESTIMATIVA"),
    globalEstimatedValue: money(globalValue),
    globalEstimatedValueKnownBlank: knownBlankMoney(globalValue),
    totalValue: money(read("VALORTOTAL", "VALOR TOTAL")),
    totalMeasurements: money(read("VALORTOTALMEDICOES", "TOTAL MEDIÇÕES")),
    status: get("STATUS"),
  });
}

function equals(left, right) {
  return String(left ?? "").trim().toLocaleLowerCase("pt-BR")
    === String(right ?? "").trim().toLocaleLowerCase("pt-BR");
}

function startDateOrder(value) {
  const raw = scalar(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const date = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : br ? `${br[3]}-${br[2]}-${br[1]}` : "";
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) return -Infinity;
  const timestamp = iso && raw.includes("T") ? Date.parse(raw) : time;
  return Number.isFinite(timestamp) ? timestamp : -Infinity;
}

function finiteTotal(decimal) {
  const value = decimal.toNumber();
  return Number.isFinite(value) ? value : null;
}

export function contractorReport(rows, filters = {}) {
  const selected = (rows || []).filter(row => ["id", "branch", "supplier", "stage", "activity", "status"]
    .every(name => !filters[name] || equals(row[name], filters[name])));
  selected.sort((left, right) => (startDateOrder(right.startDate) - startDateOrder(left.startDate))
    || Number(right.id) - Number(left.id));
  const active = selected.filter(row => equals(row.status, "ATIVO"));
  const metrics = {
    active: selected.filter(row => equals(row.status, "ATIVO")).length,
    inactive: selected.filter(row => equals(row.status, "INATIVO")).length,
    contracts: new Set(selected.map(row => row.contractDocumentId).filter(Boolean)).size,
    activeGlobalValue: active.some(row => !Number.isFinite(row.globalEstimatedValue)
      && !(row.globalEstimatedValue === null && row.globalEstimatedValueKnownBlank === true)) ? null
      : finiteTotal(active.reduce((sum, row) => sum.plus(row.globalEstimatedValue ?? 0), new Decimal(0))),
  };
  return Object.freeze({ rows: Object.freeze(selected), metrics: Object.freeze(metrics) });
}

export function documentCell(id, status) {
  const documentId = scalar(id);
  if (!documentId) return { text: "PENDENTE", tone: "pending" };
  const normalized = key(status);
  if (normalized === "PENDENTE") return { text: `${documentId} (PENDENTE)`, tone: "danger" };
  if (normalized === "SUBMETIDO") return { text: documentId, tone: "success" };
  return { text: documentId, tone: "neutral" };
}

export function normalizeLaunchRow(item, columns = []) {
  const read = (...aliases) => valueFor(item, columns, aliases);
  const get = (...aliases) => scalar(read(...aliases));
  const unit = money(read("VALOR UNITÁRIO", "VALORUNITARIO", "field_9"));
  const quantity = money(read("QUANTIDADE", "field_8"), 0);
  const freight = money(read("FRETE", "field_10"), 0);
  const paymentStatus = get("CONCLUÍDO", "CONCLUIDO", "field_19");
  return Object.freeze({
    id: scalar(item?.id || get("ID")), date: get("DATA", "field_2"), supplier: get("FORNECEDOR", "field_5"),
    contract: get("CONTRATO"), total: unit == null || quantity == null || freight == null ? null
      : finiteTotal(new Decimal(unit).times(quantity).plus(freight)),
    paymentStatus: paymentStatus || "PENDENTE",
    paymentTone: ["PAGO", "APROVADO"].includes(key(paymentStatus)) ? "success" : !paymentStatus || key(paymentStatus) === "PENDENTE" ? "pending" : "neutral",
  });
}

export function normalizeMeasurementRow(item, columns = []) {
  const get = (...aliases) => scalar(valueFor(item, columns, aliases));
  const status = get("STATUS") || "PENDENTE";
  return Object.freeze({
    id: scalar(item?.id || get("ID")), supplier: get("FORNECEDOR"), contract: get("NUMEROCONTRATO", "NÚMERO CONTRATO"),
    status, statusTone: key(status) === "ATIVO" ? "success" : key(status) === "INATIVO" ? "danger" : key(status) === "PENDENTE" ? "pending" : "neutral",
  });
}
