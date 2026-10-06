import { normalizeCommercialMilestonesDate, normalizeCommercialMilestonesStart } from "./commercial-milestones-model.js";
import { normalizeCommercialReceiptsAmount } from "./commercial-receipts-model.js";

const ID_FIELDS = ["insurance", "proposal", "bankContract", "deed", "brokerDocument", "fiscalDocument", "fiscalPayment", "brokerPayment"];
const METADATA_FIELDS = ["saleStatus", "fiscal", "fiscalObservation", "brokerage", "broker", "brokerDescription", "fiscalValue", "brokerValue"];
const FILTER_FIELDS = ["branch", "contractId", "buyer", "property", "saleStatus"];
const DETAIL_FIELDS = ["saleStatus", "visualStatus", "fiscal", "fiscalPayment", "fiscalDocument", "fiscalValue", "fiscalObservation",
  "brokerage", "broker", "brokerDocument", "brokerValue", "brokerDescription", "deed", "bankContract"];
const FIELDS = {
  properties: ["branch", "property", "saleStatus", "visualStatus", "fiscal", ...ID_FIELDS, "fiscalObservation", "brokerage", "broker", "brokerDescription", "fiscalValue", "brokerValue"],
  contracts: ["branch", "property", "buyer", "status", "total", "saleDate", "broker"],
  documents: ["createdDate"], expenses: ["paidDate"],
  receipts: ["contractId", "createdDate", "dueDate", "paidDate", "description", "amount", "status"],
};
const DATE_FIELDS = new Set(["createdDate", "dueDate", "paidDate"]);
const MONEY_FIELDS = new Set(["fiscalValue", "brokerValue", "total", "amount"]);
const key = value => String(value ?? "").trim().toLocaleUpperCase("pt-BR");
const same = (a, b) => key(a) === key(b);
const selected = (value, filter) => !filter || same(value, filter);
const identity = row => JSON.stringify([key(row.branch), key(row.property)]);
const compare = (a, b) => a.localeCompare(b, "pt-BR");
const blank = value => value == null || value === "";
const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0);

function text(value) {
  if (value == null) return "";
  if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) {
    throw new TypeError("Campo inválido no relatório de pendências documentais.");
  }
  return String(value).trim();
}

function identifier(value) {
  if (!["string", "number"].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new TypeError("ID inválido no snapshot de pendências documentais.");
  }
  return String(value);
}

/** Validate the calendar and preserve the source day, including offset timestamps. */
export function normalizeCommercialDocumentsDate(value) {
  return normalizeCommercialMilestonesDate(value);
}

/** Retain additive timestamp chronology; date-only rows keep the documented shape. */
export function normalizeCommercialDocumentsSaleDate(value) {
  const { startDate, startOrder } = normalizeCommercialMilestonesStart(value);
  return { saleDate: startDate, ...(startOrder === undefined ? {} : { saleOrder: startOrder }) };
}

export function normalizeCommercialDocumentsAmount(value) {
  return normalizeCommercialReceiptsAmount(value);
}

// PowerFx uses IfError(Value(text; "pt-BR"); text) for these two property
// fields only. Preserve a nonnumeric annotation; never turn it into zero.
export function normalizeCommercialDocumentsPropertyAmount(value) {
  const raw = text(value);
  if (!raw) return null;
  try { return normalizeCommercialDocumentsAmount(value); }
  catch { return raw; }
}

function normalizeRows(source, kind) {
  const ids = new Set();
  return source.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row) || ["id", ...FIELDS[kind]].some(field => !Object.hasOwn(row, field))) {
      throw new TypeError(`Registro ou campo incompleto no snapshot documental (${kind}).`);
    }
    const normalized = { id: identifier(row.id) };
    if (ids.has(normalized.id)) throw new TypeError("ID duplicado no snapshot documental.");
    ids.add(normalized.id);
    for (const field of FIELDS[kind]) {
      if (field === "saleDate") Object.assign(normalized, normalizeCommercialDocumentsSaleDate(row[field]));
      else normalized[field] = DATE_FIELDS.has(field) ? normalizeCommercialDocumentsDate(row[field])
        : MONEY_FIELDS.has(field) ? (kind === "properties" ? normalizeCommercialDocumentsPropertyAmount(row[field]) : normalizeCommercialDocumentsAmount(row[field])) : text(row[field]);
    }
    if (kind === "contracts" && Object.hasOwn(row, "saleOrder")) {
      if (!normalized.saleDate || !Number.isSafeInteger(row.saleOrder) || Math.abs(row.saleOrder) > 8.64e15
        || normalized.saleOrder !== undefined && normalized.saleOrder !== row.saleOrder) {
        throw new TypeError("Ordem de data inválida no snapshot documental.");
      }
      normalized.saleOrder = row.saleOrder;
    }
    return normalized;
  });
}

function normalizeFilters(filters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) throw new TypeError("Filtros inválidos no relatório documental.");
  return Object.fromEntries(FILTER_FIELDS.map(field => {
    if (filters[field] != null && typeof filters[field] !== "string"
      && !(field === "contractId" && typeof filters[field] === "number" && Number.isFinite(filters[field]))) {
      throw new TypeError("Filtro inválido no relatório documental.");
    }
    return [field, text(filters[field])];
  }));
}

const validProperty = row => row.branch && row.property && key(row.property) !== "TODOS" && !key(row.property).startsWith("ESCRITÓRIO");
const saleOrder = row => row.saleOrder ?? (row.saleDate ? Date.parse(`${row.saleDate}T00:00:00Z`) : -Infinity);

function options(values) {
  const unique = new Map();
  for (const value of values) if (value && !unique.has(key(value))) unique.set(key(value), value);
  return [...unique.values()].sort(compare);
}

// Only a scalar numeric value may reference an item. Never split IDPROPOSTA lists.
function lookupId(value) {
  let number;
  try { number = normalizeCommercialDocumentsAmount(value); }
  catch { return ""; }
  return Number.isSafeInteger(number) && number > 0 ? String(number) : "";
}

function idState(value, field, documents, expenses, detail = false) {
  if (!value) return { value, date: "", tone: "red", label: "PENDENTE", dateLabel: "", dateTone: "neutral", note: "" };
  const payment = ["fiscalPayment", "brokerPayment"].includes(field);
  const detailDocument = detail && !payment;
  if (same(value, "DISPENSADO") && !detailDocument) {
    return { value, date: "", tone: "amber", label: "DISPENSADO", dateLabel: "", dateTone: "neutral", note: "" };
  }
  const item = (payment ? expenses : documents).get(lookupId(value));
  const date = (payment ? item?.paidDate : item?.createdDate) || "";
  const unpaidFiscal = field === "fiscalPayment" && !date;
  return { value, date, tone: unpaidFiscal ? "amber" : detailDocument ? "neutral" : "green", label: value,
    dateLabel: date || (field === "fiscalPayment" ? "" : "SEM DATA"),
    dateTone: date ? "neutral" : field === "brokerPayment" ? "amber" : "neutral",
    note: unpaidFiscal ? "PAGAMENTO NÃO EFETUADO" : "" };
}

function statusState(value, kind, detail = false) {
  const normalized = key(value);
  if (!detail && normalized === "DISPENSADO") return { value, tone: "amber", label: "DISPENSADO" };
  const good = kind === "sale" ? "VENDIDO" : "ATIVO";
  const bad = kind === "sale" ? ["NÃO VENDIDO", "NAO VENDIDO"] : ["INATIVO"];
  return { value, tone: normalized === good ? "green" : "red",
    label: normalized === good ? good : bad.includes(normalized) ? bad[0] : "PENDENTE" };
}

function counts(rows) {
  return { ...Object.fromEntries(ID_FIELDS.map(field => [field, rows.filter(row => !row[field]).length])),
    declared: rows.filter(row => same(row.fiscal, "DECLARADO")).length,
    undeclared: rows.filter(row => !same(row.fiscal, "DECLARADO")).length,
    sold: rows.filter(row => same(row.saleStatus, "VENDIDO")).length,
    unsold: rows.filter(row => ["NÃO VENDIDO", "NAO VENDIDO"].includes(key(row.saleStatus))).length,
    active: rows.filter(row => same(row.visualStatus, "ATIVO")).length,
    inactive: rows.filter(row => same(row.visualStatus, "INATIVO")).length };
}

/** Pure PowerFx projection. All five sources validate before exclusions or filters. */
export function buildCommercialDocuments(snapshot, filters = {}, today = new Date().toISOString().slice(0, 10)) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || snapshot.complete !== true
    || Object.keys(FIELDS).some(kind => !Array.isArray(snapshot[kind]))
    || snapshot.incomplete || snapshot.partial || snapshot.truncated || snapshot.aborted || snapshot.error) {
    throw new TypeError("Snapshot documental inválido ou incompleto.");
  }
  if (typeof today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(today) || normalizeCommercialDocumentsDate(today) !== today) {
    throw new TypeError("Data de hoje inválida no relatório documental.");
  }
  const normalized = Object.fromEntries(Object.keys(FIELDS).map(kind => [kind, normalizeRows(snapshot[kind], kind)]));
  const selection = normalizeFilters(filters);
  const properties = normalized.properties.filter(validProperty);
  const propertyKeys = new Set(properties.map(identity));
  const contractsByProperty = new Map();
  for (const contract of normalized.contracts) {
    const propertyKey = identity(contract);
    if (!contractsByProperty.has(propertyKey)) contractsByProperty.set(propertyKey, []);
    contractsByProperty.get(propertyKey).push(contract);
  }
  const eligibleContracts = normalized.contracts.filter(row => propertyKeys.has(identity(row)));
  const filterOptions = { branch: options(properties.map(row => row.branch)), contractId: options(eligibleContracts.map(row => row.id)),
    buyer: options(eligibleContracts.map(row => row.buyer)), property: options(properties.map(row => row.property)),
    saleStatus: options(properties.map(row => row.saleStatus)) };
  const documents = new Map(normalized.documents.map(row => [row.id, row]));
  const expenses = new Map(normalized.expenses.map(row => [row.id, row]));
  const paymentsByContract = new Map();
  for (const receipt of normalized.receipts) {
    if (!paymentsByContract.has(receipt.contractId)) paymentsByContract.set(receipt.contractId, []);
    paymentsByContract.get(receipt.contractId).push({ ...receipt,
      tone: receipt.paidDate ? "green" : receipt.dueDate && receipt.dueDate < today ? "red" : "neutral",
      statusState: { value: receipt.status, label: receipt.status || "PENDENTE",
        tone: !receipt.status ? "red" : receipt.paidDate ? "green" : "amber" } });
  }
  for (const payments of paymentsByContract.values()) payments.sort((a, b) => compare(a.dueDate, b.dueDate));
  const rows = properties.filter(row => {
    const group = contractsByProperty.get(identity(row)) || [];
    return selected(row.branch, selection.branch) && selected(row.property, selection.property) && selected(row.saleStatus, selection.saleStatus)
      // These two existence tests intentionally need not match the same contract.
      && (!selection.buyer || group.some(contract => same(contract.buyer, selection.buyer)))
      && (!selection.contractId || group.some(contract => same(contract.id, selection.contractId)));
  }).map(row => {
    const pendingFields = METADATA_FIELDS.filter(field => blank(row[field])).length;
    const pendingMeasures = ID_FIELDS.filter(field => !row[field]).length + Number(!same(row.fiscal, "DECLARADO"))
      + Number(!["VENDIDO", "DISPENSADO"].includes(key(row.saleStatus)))
      + Number(!["ATIVO", "DISPENSADO"].includes(key(row.visualStatus)));
    const contracts = (contractsByProperty.get(identity(row)) || []).filter(contract => selected(contract.id, selection.contractId)
      && selected(contract.buyer, selection.buyer)).map(contract => ({ ...contract, payments: paymentsByContract.get(contract.id) || [] }))
      .sort((a, b) => saleOrder(b) - saleOrder(a));
    return { ...row, pendingMeasures, pendingFields, totalPendencies: pendingMeasures + pendingFields,
      fiscalSituation: same(row.fiscal, "DECLARADO") ? "DECLARADO" : "NÃO DECLARADO",
      ids: Object.fromEntries(ID_FIELDS.map(field => [field, idState(row[field], field, documents, expenses)])),
      detailIds: Object.fromEntries(ID_FIELDS.map(field => [field, idState(row[field], field, documents, expenses, true)])),
      saleState: statusState(row.saleStatus, "sale"), visualState: statusState(row.visualStatus, "visual"),
      detailSaleState: statusState(row.saleStatus, "sale", true), detailVisualState: statusState(row.visualStatus, "visual", true), contracts };
  }).sort((a, b) => compare(a.branch, b.branch) || compare(a.property, b.property));
  const grouped = new Map();
  for (const row of rows) {
    const name = key(row.branch);
    if (!grouped.has(name)) grouped.set(name, { name: row.branch, rows: [] });
    grouped.get(name).rows.push(row);
  }
  const branches = [...grouped.values()].map(branch => ({ ...branch, count: branch.rows.length,
    pendingMeasures: sum(branch.rows, "pendingMeasures"), pendingFields: sum(branch.rows, "pendingFields"), counts: counts(branch.rows) }));
  const allCounts = counts(rows);
  const cards = { counts: Object.fromEntries(ID_FIELDS.filter(field => field !== "fiscalPayment").map(field => [field, allCounts[field]])),
    totalIDs: sum(rows, "pendingMeasures"), totalFields: sum(rows, "pendingFields"), total: sum(rows, "pendingMeasures"),
    totalPendencies: sum(rows, "totalPendencies") };
  return { detail: Boolean(selection.contractId || selection.buyer || selection.property), rows, branches, filterOptions, cards,
    counts: allCounts, detailFields: [...DETAIL_FIELDS], contracts: rows.flatMap(row => row.contracts).sort((a, b) => saleOrder(b) - saleOrder(a)) };
}
