import { normalizeCommercialMilestonesDate } from "./commercial-milestones-model.js";

const QUOTE_TEXT = ["branch", "stage", "description", "status"];
const BUDGET_TEXT = ["branch", "stage", "supplier", "status", "observation"];
const key = value => value.toLocaleUpperCase("pt-BR");
const compare = (left, right) => left.localeCompare(right, "pt-BR");

function identifier(value, allowBlank = false) {
  const raw = typeof value === "string" ? value.trim() : value;
  if (allowBlank && (raw == null || raw === "")) return "";
  if (!["string", "number"].includes(typeof raw) || !/^\d+(?:\.0+)?$/.test(String(raw))
    || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) {
    throw new TypeError("ID ou referência de cotação inválido no relatório de cotações.");
  }
  return Number(raw);
}

function text(value) {
  if (value == null) return "";
  if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) {
    throw new TypeError("Campo inválido no relatório de cotações.");
  }
  return String(value).trim();
}

function amount(value) {
  if (value == null || typeof value === "string" && !value.trim()) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") throw new TypeError("Valor monetário inválido no relatório de cotações.");
  const raw = value.trim().replace(/^R\$\s*/, "");
  let normalized;
  if (/^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(raw)) normalized = raw.replaceAll(".", "").replace(",", ".");
  else if (/^[+-]?\d+\.\d+$/.test(raw)) normalized = raw;
  else throw new TypeError("Valor monetário inválido no relatório de cotações.");
  const result = Number(normalized);
  if (!Number.isFinite(result)) throw new TypeError("Valor monetário inválido no relatório de cotações.");
  return result;
}

function rows(source, kind) {
  const textFields = kind === "quotes" ? QUOTE_TEXT : BUDGET_TEXT;
  const required = ["id", ...textFields, ...(kind === "budgets" ? ["quotationId", "finalizedDate", "total"] : [])];
  const ids = new Set();
  return Object.freeze(source.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row) || required.some(field => !Object.hasOwn(row, field))) {
      throw new TypeError(`Registro ou campo incompleto no relatório de cotações (${kind}).`);
    }
    const normalized = { id: identifier(row.id) };
    if (ids.has(normalized.id)) throw new TypeError("ID duplicado no relatório de cotações.");
    ids.add(normalized.id);
    for (const field of textFields) normalized[field] = text(row[field]);
    if (kind === "budgets") {
      normalized.quotationId = identifier(row.quotationId, true);
      // Retain the source calendar day; display formatting belongs to the view.
      normalized.finalizedDate = normalizeCommercialMilestonesDate(row.finalizedDate) || null;
      normalized.total = amount(row.total);
    }
    return Object.freeze(normalized);
  }));
}

/** Atomic data boundary: both lists must be present; malformed or partial data cannot become zero indicators. */
export function normalizeQuotationReportSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || !Array.isArray(snapshot.quotes) || !Array.isArray(snapshot.budgets) || snapshot.complete === false
    || snapshot.error || snapshot.partial || snapshot.incomplete || snapshot.truncated || snapshot.aborted) {
    throw new TypeError("Snapshot de cotações inválido ou incompleto.");
  }
  return Object.freeze({ quotes: rows(snapshot.quotes, "quotes"), budgets: rows(snapshot.budgets, "budgets") });
}

/** PowerFx NOVACOTACAO/ORCAMENTOS projection. Every budget contributes to the pending indicator, including orphans. */
export function buildQuotationOverview(snapshot) {
  const { quotes, budgets } = normalizeQuotationReportSnapshot(snapshot);
  const linked = new Map();
  let pending = 0;
  for (const budget of budgets) {
    if (["PENDENTE SOLICITAÇÃO", "PENDENTE SOLICITACAO"].includes(key(budget.status))) pending++;
    if (!linked.has(budget.quotationId)) linked.set(budget.quotationId, []);
    linked.get(budget.quotationId).push(budget);
  }
  const metrics = Object.freeze({ active: quotes.filter(row => ["ATIVA", "ATIVO"].includes(key(row.status))).length,
    inactive: quotes.filter(row => ["INATIVA", "INATIVO"].includes(key(row.status))).length, total: quotes.length, pending });
  const detail = [...quotes].sort((a, b) => b.id - a.id).map(quote => {
    const quoteBudgets = linked.get(quote.id) || [];
    const suppliers = new Set(); const groups = new Map();
    for (const budget of quoteBudgets) {
      if (budget.supplier) suppliers.add(key(budget.supplier));
      const identity = JSON.stringify([budget.quotationId, key(budget.branch), key(budget.stage)]);
      if (!groups.has(identity)) groups.set(identity, { quotationId: budget.quotationId, branch: budget.branch, stage: budget.stage, budgets: [] });
      groups.get(identity).budgets.push(budget);
    }
    const sortedGroups = [...groups.values()].sort((a, b) => b.quotationId - a.quotationId
      || compare(a.branch, b.branch) || compare(a.stage, b.stage)).map(group => Object.freeze({ ...group,
      budgets: Object.freeze(group.budgets.sort((a, b) => b.id - a.id)) }));
    return Object.freeze({ ...quote, supplierCount: suppliers.size, budgetCount: quoteBudgets.length, groups: Object.freeze(sortedGroups) });
  });
  return Object.freeze({ metrics, quotes: Object.freeze(detail) });
}
