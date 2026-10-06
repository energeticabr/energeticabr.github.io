import Decimal from "decimal.js";

const text = value => String(value ?? "").trim();
const key = value => text(value).toLocaleUpperCase("pt-BR");
const same = (a, b) => key(a) === key(b);
const selected = (value, filter) => !text(filter) || same(value, filter);
const propertyKey = row => JSON.stringify([key(row.branch), key(row.property)]);
const clientKey = (row, name) => JSON.stringify([key(row.branch), key(row.property), key(name)]);
const validProperty = row => row.branch && row.property && key(row.property) !== "TODOS" && !key(row.property).startsWith("ESCRITÓRIO");
const rescinded = value => ["RESCISÃO", "RESCISAO"].includes(key(value));
const sum = (rows, field = "amount") => {
  const value = rows.reduce((total, row) => total.plus(row[field] ?? 0), new Decimal(0)).toNumber();
  if (!Number.isFinite(value)) throw new RangeError("Total monetário inválido; nenhum total parcial foi disponibilizado.");
  return value;
};
const identifier = (value, blank = false) => {
  if (blank && (value == null || value === "")) return "";
  if (!["string", "number"].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new TypeError("ID ou referência de contrato inválido no relatório comercial.");
  }
  return String(value);
};

/** Blank remains unknown. Calendar validation must not turn bad paid dates into pending receipts. */
export function normalizeCommercialReceiptsDate(value) {
  if (value == null) return "";
  if (typeof value !== "string") throw new TypeError("Data inválida no relatório comercial.");
  const raw = value.trim();
  if (!raw) return "";
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  const iso = /^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/.test(raw);
  const day = br ? `${br[3]}-${br[2]}-${br[1]}` : iso ? raw.slice(0, 10) : "";
  const parsed = new Date(`${day}T12:00:00Z`);
  if (!day || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day
    || iso && raw.length > 10 && !Number.isFinite(Date.parse(raw))) throw new RangeError("Data inválida no relatório comercial.");
  return day;
}

/** SharePoint numeric values and pt-BR text currencies; never discard arbitrary characters. */
export function normalizeCommercialReceiptsAmount(value) {
  if (value == null || typeof value === "string" && !value.trim()) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Valor monetário inválido no relatório comercial.");
    return value;
  }
  if (typeof value !== "string") throw new TypeError("Valor monetário inválido no relatório comercial.");
  const raw = value.trim().replace(/^R\$\s*/, "").replace(/[\s\u00a0]/g, "");
  let normalized;
  if (/^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(raw)) normalized = raw.replaceAll(".", "").replace(",", ".");
  else if (/^[+-]?\d+\.\d+$/.test(raw)) normalized = raw;
  else throw new TypeError("Valor monetário inválido no relatório comercial.");
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) throw new TypeError("Valor monetário inválido no relatório comercial.");
  return amount;
}

const ROW_FIELDS = {
  properties: ["branch", "property", "visualStatus", "saleStatus", "brokerage", "invoice", "fiscal"],
  contracts: ["branch", "property", "buyer", "status", "broker"],
  clients: ["branch", "property", "name", "definitive"],
  receipts: ["branch", "property", "buyer", "directBroker", "description", "paymentMethod", "account", "status"],
};
function normalizeRows(rows, kind) {
  const ids = new Set();
  return rows.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row) || ROW_FIELDS[kind].some(name => typeof row[name] !== "string")) {
      throw new TypeError(`Registro ou campo inválido no snapshot comercial (${kind}).`);
    }
    const id = identifier(row.id);
    if (ids.has(id)) throw new TypeError("ID duplicado no snapshot comercial.");
    ids.add(id);
    const normalized = { ...row, id };
    for (const name of ROW_FIELDS[kind]) normalized[name] = row[name].trim();
    if (kind === "contracts") {
      normalized.total = normalizeCommercialReceiptsAmount(row.total);
      normalized.saleDate = normalizeCommercialReceiptsDate(row.saleDate);
    }
    if (kind === "receipts") {
      normalized.contractId = identifier(row.contractId, true);
      normalized.amount = normalizeCommercialReceiptsAmount(row.amount);
      normalized.paidDate = normalizeCommercialReceiptsDate(row.paidDate);
      normalized.dueDate = normalizeCommercialReceiptsDate(row.dueDate);
    }
    return Object.freeze(normalized);
  });
}

function normalizeFilters(filters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) throw new TypeError("Filtros inválidos no relatório comercial.");
  return Object.fromEntries(["branch", "contractId", "buyer", "property", "contractStatus"].map(name => {
    const value = filters[name];
    if (name === "contractId") return [name, identifier(value == null ? "" : typeof value === "string" ? value.trim() : value, true)];
    if (value != null && typeof value !== "string") throw new TypeError("Filtros inválidos no relatório comercial.");
    return [name, text(value)];
  }));
}

function payment(row, today) {
  const isBroker = same(row.directBroker, "SIM");
  const dueStatus = !row.dueDate ? "SEM DATA" : row.dueDate < today ? "ATRASADO" : "A VENCER";
  const dueToday = !row.paidDate && row.dueDate === today;
  return Object.freeze({ ...row, dueStatus, dueToday,
    paymentState: row.paidDate ? isBroker ? "PAGO CORRETOR" : "PAGO" : dueStatus,
    tone: row.paidDate ? isBroker ? "broker" : "paid" : !row.dueDate ? "unknown" : row.dueDate < today ? "overdue" : dueToday ? "today" : "pending" });
}

function totalsFor(rows) {
  const paidRows = rows.filter(row => row.paidDate);
  return Object.freeze({ paid: sum(paidRows.filter(row => !same(row.directBroker, "SIM"))),
    brokerPaid: sum(paidRows.filter(row => same(row.directBroker, "SIM"))),
    pending: sum(rows.filter(row => !row.paidDate)), total: sum(rows) });
}

function summaryTotals(rows) {
  const paid = sum(rows, "paid"); const formerContracts = sum(rows, "formerContracts");
  const brokerPaid = sum(rows, "brokerPaid"); const pending = sum(rows, "pending");
  const total = sum(rows, "total");
  const paidTotal = new Decimal(paid).plus(formerContracts).plus(brokerPaid).toNumber();
  return { paid, formerContracts, brokerPaid, pending, total, paidPercentage: total ? paidTotal / total * 100 : 0 };
}

/** Implements the HOME PowerFx report. The three receipt scopes intentionally differ.
 * Unknown money stays null on source rows and contributes zero to Sum/Coalesce, as in PowerFx.
 * No foreign-key reconciliation: PowerFx permits unlinked receipts in indicators/pending.
 */
export function buildCommercialReceipts(snapshot, filters = {}, today) {
  const kinds = Object.keys(ROW_FIELDS);
  if (snapshot?.complete !== true || snapshot.error || snapshot.partial || snapshot.aborted || snapshot.truncated
    || kinds.some(kind => !Array.isArray(snapshot[kind]))) throw new TypeError("O relatório exige um snapshot completo, sem erros ou cancelamento.");
  const data = Object.fromEntries(kinds.map(kind => [kind, normalizeRows(snapshot[kind], kind)]));
  const f = normalizeFilters(filters);
  const day = normalizeCommercialReceiptsDate(today === undefined
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()) : today);
  if (!day) throw new RangeError("Data de hoje inválida no relatório comercial.");
  const propertiesByKey = new Map(); const clientsByKey = new Map();
  for (const row of data.properties) {
    if (!validProperty(row)) continue;
    const identity = propertyKey(row);
    if (propertiesByKey.has(identity)) throw new TypeError("Imóvel duplicado na mesma filial no snapshot comercial.");
    propertiesByKey.set(identity, row);
  }
  for (const row of data.clients) {
    const identity = clientKey(row, row.name);
    // Equivalent rows do not change PowerFx LookUp: retain the first match.
    if (clientsByKey.has(identity)) {
      if (!same(clientsByKey.get(identity).definitive, row.definitive)) {
        throw new TypeError("Situação DEFINITIVO conflitante para o mesmo cliente, imóvel e filial no snapshot comercial.");
      }
      continue;
    }
    clientsByKey.set(identity, row);
  }
  const contractsById = new Map(data.contracts.map(row => [row.id, row]));
  const matchesContract = row => selected(row.id, f.contractId) && selected(row.buyer, f.buyer) && selected(row.status, f.contractStatus);
  const matchesReceipt = (row, status = true) => selected(row.branch, f.branch) && selected(row.property, f.property)
    && selected(row.contractId, f.contractId) && selected(row.buyer, f.buyer)
    && (!status || selected(contractsById.get(row.contractId)?.status, f.contractStatus));
  const isFormer = row => rescinded(clientsByKey.get(clientKey(row, contractsById.get(row.contractId)?.buyer || row.buyer))?.definitive);
  const detail = Boolean(f.contractId || f.buyer || f.property);
  const properties = [...propertiesByKey.values()].filter(row => selected(row.branch, f.branch) && selected(row.property, f.property)
    && (!f.contractId && !f.buyer && !f.contractStatus || data.contracts.some(contract => propertyKey(contract) === propertyKey(row) && matchesContract(contract))));
  const indicatorReceipts = data.receipts.filter(row => validProperty(row) && matchesReceipt(row));
  const indicators = Object.freeze({ total: sum(indicatorReceipts), paid: sum(indicatorReceipts.filter(row => row.paidDate)),
    pending: sum(indicatorReceipts.filter(row => !row.paidDate)), active: properties.filter(row => same(row.visualStatus, "ATIVO")).length,
    inactive: properties.filter(row => same(row.visualStatus, "INATIVO")).length,
    ...(detail ? { visualStatus: key(properties[0]?.visualStatus) } : {}) });
  const receiptsByProperty = new Map();
  for (const row of data.receipts) {
    const identity = propertyKey(row);
    if (!receiptsByProperty.has(identity)) receiptsByProperty.set(identity, []);
    receiptsByProperty.get(identity).push(row);
  }
  const summary = properties.map(property => {
    const all = receiptsByProperty.get(propertyKey(property)) || [];
    const current = all.filter(row => matchesReceipt(row) && !isFormer(row));
    const formerContracts = sum(all.filter(row => row.paidDate && !same(row.directBroker, "SIM") && isFormer(row)));
    const totals = totalsFor(current);
    const total = new Decimal(totals.total).plus(formerContracts).toNumber();
    const paidTotal = new Decimal(totals.paid).plus(formerContracts).plus(totals.brokerPaid).toNumber();
    const buyer = f.contractId ? contractsById.get(f.contractId)?.buyer || "—" : f.buyer
      || data.clients.find(row => propertyKey(row) === propertyKey(property) && !rescinded(row.definitive))?.name
      || data.contracts.find(row => propertyKey(row) === propertyKey(property) && !rescinded(clientsByKey.get(clientKey(row, row.buyer))?.definitive))?.buyer
      || all.find(row => !rescinded(clientsByKey.get(clientKey(row, row.buyer))?.definitive))?.buyer || "—";
    return Object.freeze({ ...property, buyer, paid: totals.paid, formerContracts, brokerPaid: totals.brokerPaid,
      pending: totals.pending, total, paidPercentage: total ? paidTotal / total * 100 : 0,
      hasBrokerPayment: current.some(row => same(row.directBroker, "SIM")),
      brokerPending: current.some(row => same(row.directBroker, "SIM") && !row.paidDate) });
  });
  const groups = new Map();
  for (const row of summary) {
    const identity = key(row.branch);
    if (!groups.has(identity)) groups.set(identity, { name: row.branch, properties: [] });
    groups.get(identity).properties.push(row);
  }
  const branches = Object.freeze([...groups.values()].map(group => Object.freeze({ ...group,
    properties: Object.freeze(group.properties), ...summaryTotals(group.properties) })));
  const pendingPayments = Object.freeze(data.receipts.filter(row => !row.paidDate && matchesReceipt(row, false))
    .sort((a, b) => (a.dueDate || "2100-01-01").localeCompare(b.dueDate || "2100-01-01"))
    .map(row => payment(row, day)));
  const contracts = Object.freeze((detail ? data.contracts.filter(row => selected(row.branch, f.branch)
    && selected(row.property, f.property) && matchesContract(row)) : [])
    .sort((a, b) => b.saleDate.localeCompare(a.saleDate)).map(row => {
      const payments = Object.freeze(data.receipts.filter(receipt => receipt.contractId === row.id).map(receipt => payment(receipt, day)));
      const totals = totalsFor(payments);
      // Detail LookUp uses the complete property source, including office/TODOS.
      const visualStatus = data.properties.find(property => propertyKey(property) === propertyKey(row))?.visualStatus || "SEM STATUS";
      return Object.freeze({ ...row, visualStatus, payments, totals, paid: totals.paid, brokerPaid: totals.brokerPaid,
        pending: totals.pending, paymentsTotal: totals.total,
        indicators: Object.freeze({ total: row.total, paid: sum(payments.filter(row => row.paidDate)), pending: totals.pending, visualStatus }) });
    }));
  const options = values => Object.freeze([...new Map(values.filter(Boolean).map(value => [key(value), value])).values()]
    .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })));
  const filterOptions = Object.freeze({ branch: options([...data.properties, ...data.contracts, ...data.receipts].map(row => row.branch)),
    contractId: options(data.contracts.map(row => row.id)), buyer: options([...data.contracts.map(row => row.buyer), ...data.clients.map(row => row.name), ...data.receipts.map(row => row.buyer)]),
    property: options(data.properties.filter(validProperty).map(row => row.property)), contractStatus: options(data.contracts.map(row => row.status)) });
  return Object.freeze({ indicators, branches, pendingPayments, pendingTotal: sum(pendingPayments), contracts, detail, filterOptions });
}
