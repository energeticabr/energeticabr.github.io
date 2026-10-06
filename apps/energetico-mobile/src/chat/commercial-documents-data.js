import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { normalizeCommercialDocumentsDate, normalizeCommercialDocumentsCreatedDate, normalizeCommercialDocumentsSaleDate, normalizeCommercialDocumentsAmount, normalizeCommercialDocumentsPropertyAmount } from "./commercial-documents-model.js";

const SITE = "personal";
const WINDOW_PAGES = 100;
const MAX_TOTAL_PAGES = 10_000;
const LISTS = {
  properties: ["IMOVEL CADASTRADO", "IMÓVEL CADASTRADO"], contracts: ["LANCAMENTOCOMPRAS", "LANCAMENTO COMPRAS"],
  documents: ["DOCUMENTOS_1", "DOCUMENTOS1", "DOCUMENTOS 1", "DOCUMENTOS"], expenses: ["LANCAMENTOS", "LANÇAMENTOS"],
  receipts: ["LANÇAMENTORECEITA", "LANCAMENTORECEITA", "LANCAMENTO RECEITA"],
};
const SCHEMA = {
  properties: { branch: ["FILIAL"], property: ["IMOVEL"], saleStatus: ["STATUS"], visualStatus: ["STATUSVISUAL"], fiscal: ["FISCAL"],
    insurance: ["SEGURO"], proposal: ["IDPROPOSTA"], bankContract: ["IDCONTRATOCAIXA"], deed: ["IDESCRITURA"],
    brokerDocument: ["IDDOCUMENTOCORRETAGEM"], fiscalDocument: ["IDDOCFISCAL"], fiscalPayment: ["IDPGTOFISCAL"], brokerPayment: ["IDPGTOCORRETAGEM"],
    fiscalObservation: ["OBS FISCAL"], brokerage: ["CORRETAGEM"], broker: ["CORRETOR"], brokerDescription: ["DESCRITIVO CORRETAGEM"],
    fiscalValue: ["VLORFISCAL"], brokerValue: ["VLORCORRETAGEM"] },
  contracts: { branch: ["FILIAL"], property: ["IMOVEL"], buyer: ["NOME"], status: ["STATUS"], total: ["TOTAL"], saleDate: ["DATA VENDA", "DATAVENDA"], broker: ["CORRETOR"] },
  documents: { createdDate: ["Created", "Criado"] }, expenses: { paidDate: ["DATA PGTO EFETUADO", "DATAPGTOEFETUADO"] },
  receipts: { contractId: ["IDCONTRATO"], createdDate: ["Created", "Criado"], dueDate: ["DATAPGTOPREVISTO"], paidDate: ["DATAPGTOEFETUADO"],
    description: ["DESCRIÇÃO"], product: ["PRODUTO"], amount: ["VALORTOTAL"], status: ["STATUS"] },
};
const columnKey = value => String(value ?? "").replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function scalar(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length <= 1) return scalar(value[0]);
  if (typeof value === "object" && !Array.isArray(value)) {
    for (const name of ["LookupValue", "Value", "value", "Title", "LookupId"]) if (Object.hasOwn(value, name)) return scalar(value[name]);
  }
  throw new TypeError("Campo SharePoint inválido no relatório de pendências documentais.");
}

function identifier(value) {
  if (!["string", "number"].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new TypeError("ID inválido no registro SharePoint.");
  }
  return String(value);
}

function validateSchema(columns, kind) {
  if (!Array.isArray(columns)) throw new TypeError("Esquema SharePoint inválido.");
  // Builtin Created may be hidden/read-only. Computed and LinkTitle aliases are never data fields.
  const eligible = columns.filter(column => !column?.computed && !/^LinkTitle(?:NoMenu|2)?$/i.test(String(column?.name ?? "")));
  const resolved = {};
  for (const [field, aliases] of Object.entries(SCHEMA[kind])) {
    const wanted = new Set(aliases.map(columnKey));
    const matches = eligible.filter(column => wanted.has(columnKey(column?.name)) || wanted.has(columnKey(column?.displayName)));
    if (!matches.length && kind === "receipts" && ["description", "product"].includes(field)) continue;
    if (matches.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(matches[0]?.name || "")) {
      throw new TypeError(`Coluna ${aliases[0]} ausente, ambígua ou insegura na lista ${LISTS[kind][0]}.`);
    }
    resolved[field] = matches[0].name;
  }
  if (kind === "receipts" && !resolved.description && !resolved.product) throw new TypeError("Coluna DESCRIÇÃO ou PRODUTO ausente na lista LANÇAMENTORECEITA.");
  if (new Set(Object.values(resolved)).size !== Object.keys(resolved).length) throw new TypeError(`Colunas ambíguas na lista ${LISTS[kind][0]}.`);
  return resolved;
}

function normalizeItem(item, columns, kind) {
  const fields = item?.fields;
  if (!item || typeof item !== "object" || Array.isArray(item) || !fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new TypeError("Registro ou campos SharePoint inválidos.");
  }
  const row = { id: identifier(item.id) };
  for (const [field, column] of Object.entries(columns)) {
    const raw = scalar(fields[column]);
    if (field === "saleDate") Object.assign(row, normalizeCommercialDocumentsSaleDate(raw));
    else row[field] = field === "createdDate" ? normalizeCommercialDocumentsCreatedDate(raw)
      : ["dueDate", "paidDate"].includes(field) ? normalizeCommercialDocumentsDate(raw)
      : ["fiscalValue", "brokerValue"].includes(field) ? normalizeCommercialDocumentsPropertyAmount(raw)
        : ["total", "amount"].includes(field) ? normalizeCommercialDocumentsAmount(raw) : String(raw).trim();
  }
  if (kind === "receipts") { row.description = row.description || row.product || ""; delete row.product; }
  return Object.freeze(row);
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError");
}

// Bound every stage even when an injected transport ignores the signal; always remove listeners.
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

async function loadList(repository, kind, signal) {
  // resolveList matches list enumeration order, not alias order. Resolve the PowerFx name first.
  let resolved;
  if (kind === "documents") {
    for (const alias of LISTS.documents) {
      resolved = await abortable(() => repository.resolveList(SITE, [alias], { signal }), signal);
      if (resolved?.status !== "missing") break;
    }
  } else resolved = await abortable(() => repository.resolveList(SITE, LISTS[kind], { signal }), signal);
  if (resolved?.status !== "resolved" || !resolved.id) throw new Error(`A lista ${LISTS[kind][0]} não está disponível nesta conta.`);
  const columns = validateSchema(await abortable(() => repository.getColumns(SITE, resolved.id, { signal }), signal), kind);
  const query = new URLSearchParams({ $expand: "fields", $top: "100" }).toString();
  const rows = []; const ids = new Set(); const cursors = new Set(); let cursor = "";
  for (let pageIndex = 0; pageIndex < MAX_TOTAL_PAGES; pageIndex++) {
    const page = await abortable(() => repository.getItemsPage(SITE, resolved.id, query, {
      signal, pageNumber: pageIndex % WINDOW_PAGES + 1, maxPages: WINDOW_PAGES,
      headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" }, ...(cursor ? { cursor } : {}),
    }), signal);
    if (!Array.isArray(page?.items) || page.items.length > 100 || typeof page.hasMore !== "boolean"
      || page.error || page.incomplete || page.complete === false || page.partial || page.aborted || page.truncated
      || page.batchCount !== undefined && page.batchCount !== page.items.length
      || page.nextLink != null && typeof page.nextLink !== "string") throw new TypeError("Página SharePoint inválida ou incompleta.");
    const next = page.nextLink?.trim() || "";
    if (page.hasMore !== Boolean(next) || page.hasMore && !page.items.length) throw new TypeError("Página com conclusão de paginação inconsistente.");
    for (const item of page.items) {
      const row = normalizeItem(item, columns, kind);
      if (ids.has(row.id)) throw new TypeError("ID duplicado na paginação SharePoint.");
      ids.add(row.id); rows.push(row);
    }
    if (!page.hasMore) return Object.freeze(rows);
    if (cursors.has(next)) throw new TypeError("Cursor repetido: ciclo de paginação SharePoint.");
    cursors.add(next); cursor = next;
  }
  throw new RangeError("Limite seguro de paginação excedido; nenhum resultado parcial foi disponibilizado.");
}

/** Authenticated GET-only load. No snapshot is exposed before all five sources complete. */
export function createCommercialDocumentsData({ tokenProvider, repository: suppliedRepository } = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("O relatório exige uma sessão Microsoft ativa.");
  if (suppliedRepository && ["resolveList", "getColumns", "getItemsPage"].some(name => typeof suppliedRepository[name] !== "function")) {
    throw new TypeError("Repositório SharePoint inválido para o relatório documental.");
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
      const entries = await Promise.all(Object.keys(LISTS).map(async kind => [kind, await loadList(repository, kind, signal)]));
      abortIfNeeded(signal);
      return Object.freeze({ complete: true, ...Object.fromEntries(entries) });
    } catch (error) {
      controller.abort(error); throw error;
    } finally {
      externalSignal?.removeEventListener("abort", abort);
    }
  }
  return Object.freeze({ loadSnapshot });
}
