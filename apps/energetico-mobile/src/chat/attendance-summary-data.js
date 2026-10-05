import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { normalizeRhSupplier, normalizeRhPresence } from "./rh-reports-model.js";

const SITE = "personal";
const WINDOW_PAGES = 100;
// An overall runaway guard rejects the entire load; it never publishes truncated totals.
const MAX_TOTAL_PAGES = 10_000;
const LISTS = { suppliers: ["FORNECEDORES"], presences: ["DESCRITIVOPRESENCA", "DESCRITIVO PRESENCA"] };
const SCHEMA = { suppliers: [["CADASTRO"], ["STATUS"]], presences: [["DATA"], ["FILIAL"], ["FORNECEDOR"],
  ["PROFISSAO", "PROFISSÃO"], ["PRESENCA", "PRESENÇA"], ["STATUS"],
  ["VLORDIARIO", "VALOR DIÁRIO", "VALOR DIARIO"], ["IDPGTO", "ID PGTO"]] };
const columnKey = value => String(value ?? "").replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError");
}

// Repositories/token providers may ignore the signal. Stop awaiting them on cancellation,
// while still consuming their eventual rejection and removing all our listeners.
function abortable(operation, signal) {
  abortIfNeeded(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new DOMException("Consulta cancelada.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { abortIfNeeded(signal); return operation(); })
      .then(value => { abortIfNeeded(signal); resolve(value); }, reject)
      .catch(reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function validateSchema(columns, kind) {
  if (!Array.isArray(columns)) throw new TypeError("Esquema de colunas SharePoint inválido.");
  // A renamed Title also renames the computed LinkTitle display labels. These
  // presentation-only fields are not item data; Graph may omit their type facet.
  const dataColumns = columns.filter(column => column?.computed !== true
    && !/^LinkTitle(?:NoMenu|2)?$/i.test(String(column?.name ?? "")));
  const resolved = SCHEMA[kind].map(aliases => {
    const wanted = new Set(aliases.map(columnKey));
    const matches = dataColumns.filter(column => wanted.has(columnKey(column?.name)) || wanted.has(columnKey(column?.displayName)));
    if (matches.length !== 1 || !matches[0].name) throw new TypeError(`Coluna ${aliases[0]} ausente ou ambígua na lista ${LISTS[kind][0]}.`);
    return matches[0];
  });
  return resolved;
}

function moneyIsValid(value) {
  if (typeof value === "number") return Number.isFinite(value);
  if (value && typeof value === "object" && !Array.isArray(value)) return moneyIsValid(value.Value ?? value.value ?? value.LookupValue);
  if (typeof value !== "string") return false;
  const raw = value.trim().replace(/^R\$\s*/, "");
  return /^-?(?:\d+(?:[.,]\d+)?|\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/.test(raw);
}

function normalizeItem(item, columns, kind) {
  const row = kind === "suppliers" ? normalizeRhSupplier(item, columns) : normalizeRhPresence(item, columns);
  if (kind === "suppliers") return row;
  const parsed = new Date(`${row.date}T12:00:00Z`);
  if (!row.date || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== row.date
    || !row.presence) throw new TypeError("Registro de presença com data ou presença inválida.");
  const moneyColumn = columns[6];
  const rawMoney = item.fields[moneyColumn.name];
  return Object.freeze({ ...row, dailyValue: moneyIsValid(rawMoney) ? row.dailyValue : null });
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
      || page.error || page.partial || page.aborted || page.truncated
      || page.batchCount !== undefined && page.batchCount !== page.items.length
      || page.nextLink != null && typeof page.nextLink !== "string") {
      throw new TypeError("O SharePoint retornou uma página inválida ou incompleta.");
    }
    const next = page.nextLink?.trim() || "";
    if (page.hasMore !== Boolean(next) || page.hasMore && page.items.length === 0) {
      throw new TypeError("A paginação retornou uma página com conclusão inconsistente.");
    }
    for (const item of page.items) {
      const id = String(item?.id ?? "");
      if (!/^[1-9]\d*$/.test(id) || !item?.fields || typeof item.fields !== "object" || Array.isArray(item.fields)) {
        throw new TypeError("Página com ID ou campos de registro inválidos.");
      }
      if (ids.has(id)) throw new TypeError("ID duplicado na paginação SharePoint.");
      ids.add(id); rows.push(normalizeItem(item, columns, kind));
    }
    if (!page.hasMore) return Object.freeze(rows);
    if (cursors.has(next)) throw new TypeError("Cursor repetido: ciclo de paginação SharePoint.");
    cursors.add(next); cursor = next;
  }
  throw new RangeError("Limite seguro de paginação excedido; nenhum total parcial foi disponibilizado.");
}

/** Fully traverses both read-only lists before returning {complete:true,suppliers,presences}. */
export function createAttendanceSummaryData({ tokenProvider, repository: suppliedRepository } = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("O relatório exige uma sessão Microsoft ativa.");
  if (suppliedRepository && ["resolveList", "getColumns", "getItemsPage"].some(name => typeof suppliedRepository[name] !== "function")) {
    throw new TypeError("Repositório SharePoint inválido para o relatório.");
  }
  async function loadSnapshot({ signal: externalSignal } = {}) {
    abortIfNeeded(externalSignal);
    const controller = new AbortController();
    const { signal } = controller;
    const abort = () => controller.abort(externalSignal.reason);
    externalSignal?.addEventListener("abort", abort, { once: true });
    try {
      const repository = suppliedRepository || createSharePointRepository(createGraphClient(
        scopes => abortable(() => tokenProvider(scopes, { signal }), signal),
      ), SHAREPOINT_SITES);
      const [suppliers, presences] = await Promise.all([loadList(repository, "suppliers", signal), loadList(repository, "presences", signal)]);
      abortIfNeeded(signal);
      return Object.freeze({ complete: true, suppliers, presences });
    } catch (error) {
      controller.abort(error);
      throw error;
    } finally {
      externalSignal?.removeEventListener("abort", abort);
    }
  }
  return Object.freeze({ loadSnapshot });
}
