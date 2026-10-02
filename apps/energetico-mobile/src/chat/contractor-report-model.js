function key(value) {
  return String(value ?? "").replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function scalar(value) {
  if (value == null) return "";
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
  const wanted = new Set(aliases.map(key));
  const column = (columns || []).find(entry => wanted.has(key(entry?.displayName)) || wanted.has(key(entry?.name)));
  if (column && fields[column.name] != null) return scalar(fields[column.name]);
  const direct = Object.entries(fields).find(([name, value]) => wanted.has(key(name)) && value != null);
  return direct ? scalar(direct[1]) : "";
}

function money(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = scalar(value).replace(/[^\d.,-]/g, "");
  if (!raw || raw === "-") return null;
  const lastComma = raw.lastIndexOf(","), lastDot = raw.lastIndexOf(".");
  let normalized = raw;
  if (lastComma > lastDot) normalized = raw.replaceAll(".", "").replace(",", ".");
  else if (lastDot > lastComma && lastComma >= 0) normalized = raw.replaceAll(",", "");
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
  const get = (...aliases) => valueFor(item, columns, aliases);
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
    globalEstimatedValue: money(get("VALORGLOBALESTIMADO", "VALOR GLOBAL ESTIMADO")),
    totalValue: money(get("VALORTOTAL", "VALOR TOTAL")),
    totalMeasurements: money(get("VALORTOTALMEDICOES", "TOTAL MEDIÇÕES")),
    status: get("STATUS"),
  });
}

function equals(left, right) {
  return key(left) === key(right);
}

export function contractorReport(rows, filters = {}) {
  const selected = (rows || []).filter(row => ["id", "branch", "supplier", "stage", "activity", "status"]
    .every(name => !filters[name] || equals(row[name], filters[name])));
  selected.sort((left, right) => String(right.startDate).localeCompare(String(left.startDate))
    || Number(right.id) - Number(left.id));
  const metrics = {
    active: selected.filter(row => equals(row.status, "ATIVO")).length,
    inactive: selected.filter(row => equals(row.status, "INATIVO")).length,
    contracts: new Set(selected.map(row => row.contractDocumentId).filter(Boolean)).size,
    activeGlobalValue: selected.reduce((sum, row) => sum + (equals(row.status, "ATIVO") ? row.globalEstimatedValue || 0 : 0), 0),
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
  const get = (...aliases) => valueFor(item, columns, aliases);
  const unit = money(get("VALOR UNITÁRIO", "VALORUNITARIO", "field_9"));
  const quantity = money(get("QUANTIDADE", "field_8"));
  const freight = money(get("FRETE", "field_10"));
  const paymentStatus = get("CONCLUÍDO", "CONCLUIDO", "field_19");
  return Object.freeze({
    id: scalar(item?.id || get("ID")), date: get("DATA", "field_2"), supplier: get("FORNECEDOR", "field_5"),
    contract: get("CONTRATO"), total: unit == null ? null : unit * (quantity || 0) + (freight || 0),
    paymentStatus: paymentStatus || "PENDENTE",
    paymentTone: ["PAGO", "APROVADO"].includes(key(paymentStatus)) ? "success" : !paymentStatus || key(paymentStatus) === "PENDENTE" ? "pending" : "neutral",
  });
}

export function normalizeMeasurementRow(item, columns = []) {
  const get = (...aliases) => valueFor(item, columns, aliases);
  const status = get("STATUS") || "PENDENTE";
  return Object.freeze({
    id: scalar(item?.id || get("ID")), supplier: get("FORNECEDOR"), contract: get("NUMEROCONTRATO", "NÚMERO CONTRATO"),
    status, statusTone: key(status) === "ATIVO" ? "success" : key(status) === "INATIVO" ? "danger" : key(status) === "PENDENTE" ? "pending" : "neutral",
  });
}
