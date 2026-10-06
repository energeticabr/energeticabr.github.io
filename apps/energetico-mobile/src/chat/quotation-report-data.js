import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { normalizeQuotationReportSnapshot } from "./quotation-report-model.js";

const SITE = "personal";
const WINDOW_PAGES = 100;
const MAX_TOTAL_PAGES = 10_000;
// PowerFx columns, confirmed against the live Lists headers; builtin IDs come from item.id.
const SOURCES = {
  quotes: { list: "NOVACOTACAO", schema: { branch: "FILIAL", stage: "ETAPA", description: "DESCRICAO", status: "STATUS" } },
  budgets: { list: "ORCAMENTOS", schema: { quotationId: "IDCOTACAO", branch: "FILIAL", stage: "ETAPA", supplier: "FORNECEDOR",
    finalizedDate: "DATAFINALIZADO", total: "VALORTOTAL", status: "STATUS", observation: "OBS" } },
};
const columnKey = value => String(value ?? "").replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function validateSchema(columns, source) {
  if (!Array.isArray(columns)) throw new TypeError(`Esquema SharePoint inválido em ${source.list}.`);
  const eligible = columns.filter(column => !column?.computed && !/^LinkTitle(?:NoMenu|2)?$/i.test(String(column?.name ?? "")));
  const resolved = {};
  for (const [field, alias] of Object.entries(source.schema)) {
    const matches = eligible.filter(column => columnKey(column?.name) === alias || columnKey(column?.displayName) === alias);
    if (matches.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(matches[0]?.name || "")) {
      throw new TypeError(`Coluna ${alias} ausente, ambígua ou insegura em ${source.list}.`);
    }
    resolved[field] = matches[0];
  }
  if (new Set(Object.values(resolved).map(column => column.name)).size !== Object.keys(resolved).length) {
    throw new TypeError(`Colunas ambíguas em ${source.list}.`);
  }
  return resolved;
}

function scalar(value, reference = false) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length <= 1) return scalar(value[0], reference);
  if (typeof value === "object" && !Array.isArray(value)) {
    const aliases = reference ? ["LookupId", "lookupId", "Value", "value"] : ["LookupValue", "Value", "value", "Title", "LookupId"];
    for (const name of aliases) if (Object.hasOwn(value, name)) return scalar(value[name], reference);
  }
  throw new TypeError("Campo SharePoint inválido no relatório de cotações.");
}

function normalizeItem(item, columns, kind) {
  if (!item || typeof item !== "object" || Array.isArray(item) || !item.fields || typeof item.fields !== "object" || Array.isArray(item.fields)) {
    throw new TypeError("Registro ou campos SharePoint inválidos no relatório de cotações.");
  }
  const row = { id: item.id };
  for (const [field, column] of Object.entries(columns)) {
    const reference = field === "quotationId";
    const name = reference && column.lookup && Object.hasOwn(item.fields, `${column.name}LookupId`) ? `${column.name}LookupId` : column.name;
    row[field] = scalar(item.fields[name], reference);
  }
  return normalizeQuotationReportSnapshot({ quotes: kind === "quotes" ? [row] : [], budgets: kind === "budgets" ? [row] : [] })[kind][0];
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError");
}

// Settle cancellation even when an injected transport or token provider ignores its signal.
function abortable(operation, signal) {
  abortIfNeeded(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true; signal.removeEventListener("abort", abort); callback(value);
    };
    const abort = () => finish(reject, signal.reason || new DOMException("Consulta cancelada.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { abortIfNeeded(signal); return operation(); })
      .then(value => { abortIfNeeded(signal); finish(resolve, value); }, error => finish(reject, error))
      .catch(error => finish(reject, error));
  });
}

async function loadRows(repository, kind, signal) {
  const source = SOURCES[kind];
  const list = await abortable(() => repository.resolveList(SITE, [source.list], { signal }), signal);
  if (list?.status !== "resolved" || !list.id) throw new Error(`A lista ${source.list} não está disponível nesta conta.`);
  const columns = validateSchema(await abortable(() => repository.getColumns(SITE, list.id, { signal }), signal), source);
  const query = new URLSearchParams({ $expand: "fields", $top: "100" }).toString();
  const rows = []; const ids = new Set(); const cursors = new Set(); let cursor = "";
  for (let pageIndex = 0; pageIndex < MAX_TOTAL_PAGES; pageIndex++) {
    const page = await abortable(() => repository.getItemsPage(SITE, list.id, query, {
      signal, pageNumber: pageIndex % WINDOW_PAGES + 1, maxPages: WINDOW_PAGES,
      headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" }, ...(cursor ? { cursor } : {}),
    }), signal);
    if (!Array.isArray(page?.items) || page.items.length > 100 || typeof page.hasMore !== "boolean"
      || page.error || page.incomplete || page.complete === false || page.partial || page.aborted || page.truncated
      || page.batchCount !== undefined && page.batchCount !== page.items.length
      || page.nextLink != null && typeof page.nextLink !== "string") throw new TypeError(`Página SharePoint inválida ou incompleta em ${source.list}.`);
    const next = page.nextLink?.trim() || "";
    if (page.hasMore !== Boolean(next) || page.hasMore && !page.items.length) throw new TypeError("Página com conclusão de paginação inconsistente.");
    for (const item of page.items) {
      const row = normalizeItem(item, columns, kind);
      if (ids.has(row.id)) throw new TypeError(`ID duplicado na paginação de ${source.list}.`);
      ids.add(row.id); rows.push(row);
    }
    if (!page.hasMore) return Object.freeze(rows);
    if (cursors.has(next)) throw new TypeError(`Cursor repetido: ciclo de paginação de ${source.list}.`);
    cursors.add(next); cursor = next;
  }
  throw new RangeError("Limite seguro de paginação excedido; nenhum resultado parcial foi disponibilizado.");
}

/** Authenticated GET-only load: a snapshot is returned only after BOTH lists finish successfully. */
export function createQuotationReportData({ tokenProvider, repository: suppliedRepository } = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("O relatório exige uma sessão Microsoft ativa.");
  if (suppliedRepository && ["resolveList", "getColumns", "getItemsPage"].some(name => typeof suppliedRepository[name] !== "function")) {
    throw new TypeError("Repositório SharePoint inválido para o relatório de cotações.");
  }
  async function loadSnapshot({ signal: externalSignal } = {}) {
    abortIfNeeded(externalSignal);
    const controller = new AbortController(); const { signal } = controller;
    const abort = () => controller.abort(externalSignal.reason);
    externalSignal?.addEventListener("abort", abort, { once: true });
    try {
      const repository = suppliedRepository || createSharePointRepository(createGraphClient(
        scopes => abortable(() => tokenProvider(scopes, { signal }), signal),
      ), SHAREPOINT_SITES);
      const quotes = await loadRows(repository, "quotes", signal);
      const budgets = await loadRows(repository, "budgets", signal);
      abortIfNeeded(signal);
      return Object.freeze({ quotes, budgets });
    } catch (error) {
      controller.abort(error); throw error;
    } finally {
      externalSignal?.removeEventListener("abort", abort);
    }
  }
  return Object.freeze({ loadSnapshot });
}
