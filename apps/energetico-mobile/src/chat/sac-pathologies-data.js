import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { normalizeSacPathologiesSnapshot } from "./sac-pathologies-model.js";

const SITE = "personal";
const LIST_ALIASES = ["SACPATOLOGIAS", "SAC PATOLOGIAS"];
const WINDOW_PAGES = 100;
const MAX_TOTAL_PAGES = 10_000;
// ID is the builtin item.id, never a user column labelled ID.
const SCHEMA = { branch: "FILIAL", property: "IMOVEL", client: "CLIENTE", type: "TIPOPATOLOGIA", status: "STATUS",
  description: "DESCRICAO", startDate: "DATAAPONTADO", endDate: "DATASOLUCAO", cost: "CUSTO" };
const columnKey = value => String(value ?? "").replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function validateSchema(columns) {
  if (!Array.isArray(columns)) throw new TypeError("Esquema SharePoint inválido.");
  const eligible = columns.filter(column => !column?.computed && !/^LinkTitle(?:NoMenu|2)?$/i.test(String(column?.name ?? "")));
  const resolved = {};
  for (const [field, alias] of Object.entries(SCHEMA)) {
    const matches = eligible.filter(column => columnKey(column?.name) === alias || columnKey(column?.displayName) === alias);
    if (matches.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(matches[0]?.name || "")) {
      throw new TypeError(`Coluna ${alias} ausente, ambígua ou insegura na lista SACPATOLOGIAS.`);
    }
    resolved[field] = matches[0].name;
  }
  if (new Set(Object.values(resolved)).size !== Object.keys(resolved).length) throw new TypeError("Colunas ambíguas na lista SACPATOLOGIAS.");
  return resolved;
}

function scalar(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length <= 1) return scalar(value[0]);
  if (typeof value === "object" && !Array.isArray(value)) {
    for (const name of ["LookupValue", "Value", "value", "Title", "LookupId"]) if (Object.hasOwn(value, name)) return scalar(value[name]);
  }
  throw new TypeError("Campo SharePoint inválido no relatório de patologias.");
}

function normalizeItem(item, columns) {
  if (!item || typeof item !== "object" || Array.isArray(item) || !item.fields || typeof item.fields !== "object" || Array.isArray(item.fields)) {
    throw new TypeError("Registro ou campos SharePoint inválidos.");
  }
  const row = { id: item.id };
  for (const [field, column] of Object.entries(columns)) row[field] = scalar(item.fields[column]);
  return normalizeSacPathologiesSnapshot({ complete: true, rows: [row] }).rows[0];
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError");
}

// Cancellation must settle even when a supplied transport ignores its signal.
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

async function loadRows(repository, signal) {
  let list;
  // Resolve the actual PowerFx name first, independently of list enumeration order.
  for (const alias of LIST_ALIASES) {
    list = await abortable(() => repository.resolveList(SITE, [alias], { signal }), signal);
    if (list?.status !== "missing") break;
  }
  if (list?.status !== "resolved" || !list.id) throw new Error("A lista SACPATOLOGIAS não está disponível nesta conta.");
  const columns = validateSchema(await abortable(() => repository.getColumns(SITE, list.id, { signal }), signal));
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

/** Authenticated GET-only load; expose a trustworthy snapshot only after pagination ends. */
export function createSacPathologiesData({ tokenProvider, repository: suppliedRepository } = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("O relatório exige uma sessão Microsoft ativa.");
  if (suppliedRepository && ["resolveList", "getColumns", "getItemsPage"].some(name => typeof suppliedRepository[name] !== "function")) {
    throw new TypeError("Repositório SharePoint inválido para o relatório de patologias.");
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
      const rows = await loadRows(repository, signal);
      abortIfNeeded(signal);
      return Object.freeze({ complete: true, rows });
    } catch (error) {
      controller.abort(error); throw error;
    } finally {
      externalSignal?.removeEventListener("abort", abort);
    }
  }
  return Object.freeze({ loadSnapshot });
}
