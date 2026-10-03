const key = value => String(value ?? "").replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const text = value => {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  if (typeof value === "object") return text(value.LookupValue ?? value.Value ?? value.value ?? value.Title ?? value.LookupId);
  return String(value).trim();
};
const byIdDesc = (a, b) => Number(b.id) - Number(a.id);
const normalized = value => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

function rawAuditField(item, columns = [], ...aliases) {
  const wanted = new Set(aliases.map(key));
  const column = (columns || []).find(entry => wanted.has(key(entry?.displayName)) || wanted.has(key(entry?.name)));
  if (column && item?.fields?.[column.name] != null) return item.fields[column.name];
  const direct = Object.entries(item?.fields || {}).find(([name, value]) => wanted.has(key(name)) && value != null);
  return direct?.[1];
}

export function auditField(item, columns = [], ...aliases) {
  return text(rawAuditField(item, columns, ...aliases));
}

export function auditNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = text(value).replace(/[^\d.,-]/g, "");
  if (!raw || raw === "-") return null;
  const comma = raw.lastIndexOf(","), dot = raw.lastIndexOf(".");
  const decimal = comma > dot ? raw.replaceAll(".", "").replace(",", ".")
    : comma >= 0 && dot > comma ? raw.replaceAll(",", "")
      : /^-?\d{1,3}(?:\.\d{3})+$/.test(raw) ? raw.replaceAll(".", "") : raw;
  const result = Number(decimal);
  return Number.isFinite(result) ? result : null;
}

function numericField(item, columns, ...aliases) {
  return auditNumber(rawAuditField(item, columns, ...aliases));
}

export function auditDateKey(value) {
  const raw = text(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : "";
}

export function formatAuditMoney(value) {
  return value == null || !Number.isFinite(value) ? "PENDENTE" :
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
export function formatAuditDate(value) {
  const match = auditDateKey(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "PENDENTE";
}

function getFor(item, columns) { return (...aliases) => auditField(item, columns, ...aliases); }
function idFor(item, get) { return text(item?.id || get("ID")); }

export function normalizeAuditQuote(item, columns = []) {
  const get = getFor(item, columns);
  return { id: idFor(item, get), branch: get("FILIAL"), stage: get("ETAPA"), description: get("DESCRICAO", "DESCRIÇÃO"), status: get("STATUS") };
}
export function normalizeAuditBudget(item, columns = []) {
  const get = getFor(item, columns);
  return {
    id: idFor(item, get), quotationId: get("IDCOTACAO", "ID COTAÇÃO"), branch: get("FILIAL"), stage: get("ETAPA"),
    supplier: get("FORNECEDOR"), completedDate: auditDateKey(get("DATAFINALIZADO", "DATA FINALIZADO")),
    total: numericField(item, columns, "VALORTOTAL", "VALOR TOTAL"), status: get("STATUS"), observation: get("OBS"),
  };
}
export function normalizeAuditAsset(item, columns = []) {
  const get = getFor(item, columns);
  return {
    id: idFor(item, get), assetNumber: get("NÚMEROIMOBILIZADO", "NUMEROIMOBILIZADO"),
    depreciationDate: auditDateKey(get("DATA DEPRECIAÇÃO", "DATADEPRECIACAO", "DATADEPRECIA_x00c7__x00c3_O")),
    group: get("GRUPO IMOBILIZADO", "GRUPOIMOBILIZADO"), asset: get("IMOBILIZADO"),
    percent: numericField(item, columns, "% DEPRECIACAO", "OData__x0025_DEPRECIACAO"),
    estimated: numericField(item, columns, "VALOR ESTIMADO", "VALORESTIMADO"), quantity: numericField(item, columns, "QTD"),
    residual: numericField(item, columns, "VALOR RESIDUAL", "VALORRESIDUAL"), branch: get("FILIAL"),
  };
}
export function normalizeAuditDocument(item, columns = []) {
  const get = getFor(item, columns);
  return {
    id: idFor(item, get), submittedDate: auditDateKey(get("DATASUBMETIDO", "DATA SUBMETIDO")),
    issuedDate: auditDateKey(get("DATA")), validityDate: auditDateKey(get("DATAVALIDADE", "DATA VALIDADE")),
    branch: get("FILIAL"), homologation: get("TIPOHOMOLOGACAO", "TIPO HOMOLOGACAO"),
    documentType: get("TIPODOCUMENTO", "TIPO DOCUMENTO"), person: get("PESSOARELACIONADA", "PESSOA RELACIONADA"),
    stage: get("ETAPA"), property: get("IMOVEL", "IMÓVEL"), status: get("STATUS"),
  };
}

export function buildQuotationReport({ quotes = [], budgets = [] } = {}) {
  const sorted = [...quotes].sort(byIdDesc), ids = new Set(sorted.map(row => row.id));
  const output = sorted.map(quote => {
    const attached = budgets.filter(row => row.quotationId === quote.id).sort(byIdDesc);
    const groups = new Map();
    for (const row of attached) {
      const branch = row.branch || "SEM FILIAL", stage = row.stage || "SEM ETAPA";
      const groupKey = `${branch}\u0000${stage}`;
      if (!groups.has(groupKey)) groups.set(groupKey, { branch, stage, budgets: [] });
      groups.get(groupKey).budgets.push(row);
    }
    return { ...quote, budgetCount: attached.length,
      supplierCount: new Set(attached.map(row => row.supplier).filter(Boolean)).size,
      groups: [...groups.values()].sort((a, b) => a.branch.localeCompare(b.branch, "pt-BR") || a.stage.localeCompare(b.stage, "pt-BR")) };
  });
  return { metrics: {
    active: sorted.filter(row => ["ATIVA", "ATIVO"].includes(normalized(row.status))).length,
    inactive: sorted.filter(row => ["INATIVA", "INATIVO"].includes(normalized(row.status))).length,
    total: sorted.length, pendingRequests: budgets.filter(row => normalized(row.status) === "PENDENTE SOLICITACAO").length,
  }, quotes: output, unlinkedBudgets: budgets.filter(row => !ids.has(row.quotationId)).sort(byIdDesc) };
}

function day(value) {
  const iso = auditDateKey(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== iso ? null : date;
}
function addDays(value, count) {
  const date = day(value);
  if (!date) throw new RangeError("Data de referência inválida.");
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
function sum(rows, expression) {
  let total = 0, complete = true;
  for (const row of rows) {
    const value = expression(row);
    if (value == null || !Number.isFinite(value)) complete = false;
    else total += value;
  }
  return { value: complete ? total : null, partial: total };
}
function depreciationMetrics(rows) {
  const total = sum(rows, row => row.estimated == null || row.quantity == null ? null : row.estimated * row.quantity);
  const current = sum(rows, row => row.residual == null || row.quantity == null ? null : row.residual * row.quantity);
  const depreciated = sum(rows, row => row.estimated == null || row.residual == null || row.quantity == null ? null : (row.estimated - row.residual) * row.quantity);
  const toDepreciate = sum(rows, row => row.percent == null || row.residual == null || row.quantity == null ? null : row.percent * row.residual * row.quantity / 100);
  return { records: rows.length, active: rows.filter(row => row.residual != null && row.residual > 0).length,
    total: total.value, partialTotal: total.partial, current: current.value, partialCurrent: current.partial,
    depreciated: depreciated.value, partialDepreciated: depreciated.partial,
    toDepreciate: toDepreciate.value, partialToDepreciate: toDepreciate.partial };
}
export function buildDepreciationReport({ rows = [] } = {}, today) {
  const deadline = addDays(today, 30);
  const selected = rows.filter(row => day(row.depreciationDate) && row.depreciationDate <= deadline);
  const groups = new Map();
  for (const row of selected) {
    const branch = row.branch || "SEM FILIAL";
    if (!groups.has(branch)) groups.set(branch, []);
    groups.get(branch).push(row);
  }
  return { today, deadline, metrics: { ...depreciationMetrics(selected), branches: groups.size },
    groups: [...groups].sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
      .map(([branch, groupRows]) => ({ branch, rows: groupRows.sort((a, b) => a.depreciationDate.localeCompare(b.depreciationDate) || byIdDesc(a, b)), metrics: depreciationMetrics(groupRows) })) };
}

const DOCUMENT_FILTERS = ["documentType", "branch", "person", "status", "homologation", "stage", "property"];
export function buildDocumentReport({ rows = [] } = {}, filters = {}, today) {
  if (!day(today)) throw new RangeError("Data de referência inválida.");
  const end = addDays(today, 15);
  const selected = rows.filter(row => DOCUMENT_FILTERS.every(name => !filters[name] || normalized(row[name]) === normalized(filters[name])));
  const order = filters.order || "validityDate";
  const sorted = [...selected].sort((a, b) => {
    if (order === "id") return (filters.direction === "asc" ? -1 : 1) * byIdDesc(a, b);
    if (order === "validityDate") return (!a.validityDate) - (!b.validityDate) || String(a.validityDate).localeCompare(String(b.validityDate)) || byIdDesc(a, b);
    return (filters.direction === "desc" ? -1 : 1) * String(a[order] ?? "").localeCompare(String(b[order] ?? ""), "pt-BR") || byIdDesc(a, b);
  });
  return { metrics: {
    submitted: selected.filter(row => normalized(row.status) === "SUBMETIDO").length,
    pending: selected.filter(row => normalized(row.status) === "PENDENTE").length,
    total: selected.length,
    expired: selected.filter(row => day(row.validityDate) && row.validityDate < today).length,
    expiring15: selected.filter(row => day(row.validityDate) && row.validityDate >= today && row.validityDate <= end).length,
  }, rows: sorted.map(row => ({ ...row, daysToExpiry: day(row.validityDate) ? Math.round((day(row.validityDate) - day(today)) / 86400000) : null })) };
}
