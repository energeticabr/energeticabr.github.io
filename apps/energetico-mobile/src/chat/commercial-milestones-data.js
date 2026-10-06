import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { normalizeCommercialMilestonesDate, normalizeCommercialMilestonesStart } from "./commercial-milestones-model.js";

const SITE = "personal";
const WINDOW_PAGES = 100;
const MAX_TOTAL_PAGES = 10_000;
const LISTS = { properties: ["IMOVEL CADASTRADO"], milestones: ["APONTAMENTOSCOMERCIAIS"] };
const SCHEMA = {
  properties: { branch: "FILIAL", property: "IMOVEL", visualStatus: "STATUSVISUAL" },
  milestones: { branch: "FILIAL", property: "IMOVEL", contractId: "IDCONTRATO", buyer: "NOME", type: "TIPOMARCO",
    description: "DESCRICAO", startDate: "DATAINICIO", dueDate: "DATAFATAL", status: "STATUS" },
};
const columnKey = value => String(value ?? "").replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function scalar(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length <= 1) return scalar(value[0]);
  if (typeof value === "object" && !Array.isArray(value)) {
    for (const field of ["LookupValue", "Value", "value", "Title", "LookupId"]) if (Object.hasOwn(value, field)) return scalar(value[field]);
  }
  throw new TypeError("Campo SharePoint inválido no relatório de marcos comerciais.");
}

function identifier(value) {
  if (!["string", "number"].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new TypeError("ID inválido no registro SharePoint.");
  }
  return String(value);
}

function validateSchema(columns, kind) {
  if (!Array.isArray(columns)) throw new TypeError("Esquema SharePoint inválido.");
  const eligible = columns.filter(column => !column?.computed && !/^LinkTitle(?:NoMenu|2)?$/i.test(String(column?.name ?? "")));
  const resolved = {};
  for (const [field, source] of Object.entries(SCHEMA[kind])) {
    const matches = eligible.filter(column => columnKey(column?.name) === columnKey(source) || columnKey(column?.displayName) === columnKey(source));
    if (matches.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(matches[0]?.name || "")) {
      throw new TypeError(`Coluna ${source} ausente, ambígua ou insegura na lista ${LISTS[kind][0]}.`);
    }
    resolved[field] = matches[0].name;
  }
  if (new Set(Object.values(resolved)).size !== Object.keys(resolved).length) throw new TypeError(`Colunas ambíguas na lista ${LISTS[kind][0]}.`);
  return resolved;
}

function normalizeItem(item, columns) {
  const fields = item?.fields;
  if (!item || typeof item !== "object" || Array.isArray(item) || !fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new TypeError("Registro ou campos SharePoint inválidos.");
  }
  const row = { id: identifier(item.id) };
  for (const [field, column] of Object.entries(columns)) {
    const raw = scalar(fields[column]);
    if (field === "startDate") Object.assign(row, normalizeCommercialMilestonesStart(raw));
    else if (field === "dueDate") row[field] = normalizeCommercialMilestonesDate(raw);
    else row[field] = String(raw).trim();
  }
  return Object.freeze(row);
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError");
}

// Bound every stage, including transports that ignore the signal, and remove listeners on settlement.
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
  const resolved = await abortable(() => repository.resolveList(SITE, LISTS[kind], { signal }), signal);
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
      const row = normalizeItem(item, columns);
      if (ids.has(row.id)) throw new TypeError("ID duplicado na paginação SharePoint.");
      ids.add(row.id); rows.push(row);
    }
    if (!page.hasMore) return Object.freeze(rows);
    if (cursors.has(next)) throw new TypeError("Cursor repetido: ciclo de paginação SharePoint.");
    cursors.add(next); cursor = next;
  }
  throw new RangeError("Limite seguro de paginação excedido; nenhum resultado parcial foi disponibilizado.");
}

/** Authenticated GET-only, atomic snapshot from the two commercial milestone sources. */
export function createCommercialMilestonesData({ tokenProvider, repository: suppliedRepository } = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("O relatório exige uma sessão Microsoft ativa.");
  if (suppliedRepository && ["resolveList", "getColumns", "getItemsPage"].some(name => typeof suppliedRepository[name] !== "function")) {
    throw new TypeError("Repositório SharePoint inválido para o relatório de marcos comerciais.");
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
