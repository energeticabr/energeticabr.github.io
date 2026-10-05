import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { normalizeStageProgressDate } from "./stage-progress-model.js";

const SITE = "personal";
const WINDOW_PAGES = 100;
// Reject runaway traversal entirely; never report truncated counts as complete.
const MAX_TOTAL_PAGES = 10_000;
const LISTS = { activities: ["DEMONSTRATIVOETAPA"], launches: ["LANCAMENTOOBRA"] };
const SCHEMA = {
  activities: [["FILIAL"], ["ETAPA"], ["ATIVIDADEEXECUTADA", "ATIVIDADE EXECUTADA"], ["IMOVEL", "IMÓVEL"],
    ["FORNECEDOR"], ["DATAEXECUTADO"], ["DATAPREVISTO"], ["STATUS"]],
  launches: [["FILIAL"], ["ETAPA"], ["INÍCIO", "INICIO"], ["FIM"], ["STATUS"], ["PERCENTUALEFETUADO", "PERCENTUAL EFETUADO"]],
};
const scalar = value => {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(scalar).filter(Boolean).join(", ");
  if (typeof value === "object") return scalar(value.LookupValue ?? value.Value ?? value.value ?? value.Title ?? value.LookupId);
  return String(value).trim();
};
const columnKey = value => scalar(value).replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError");
}

// Stop waiting even when a supplied repository or token provider ignores abort.
function abortable(operation, signal) {
  abortIfNeeded(signal);
  return new Promise((resolve, reject) => {
    const finish = (callback, value) => { signal.removeEventListener("abort", abort); callback(value); };
    const abort = () => finish(reject, signal.reason || new DOMException("Consulta cancelada.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { abortIfNeeded(signal); return operation(); })
      .then(value => { abortIfNeeded(signal); finish(resolve, value); }, error => finish(reject, error))
      .catch(error => finish(reject, error));
  });
}

function validateSchema(columns, kind) {
  if (!Array.isArray(columns)) throw new TypeError("Esquema de colunas SharePoint inválido.");
  // Renamed Title also renames auxiliary LinkTitle labels; Graph may omit their
  // computed facet. Resolve item data only, independent of metadata order.
  const dataColumns = columns.filter(column => column?.computed !== true
    && !/^LinkTitle(?:NoMenu|2)?$/i.test(String(column?.name ?? "")));
  const resolved = SCHEMA[kind].map(aliases => {
    const wanted = new Set(aliases.map(columnKey));
    const matches = dataColumns.filter(column => wanted.has(columnKey(column?.name)) || wanted.has(columnKey(column?.displayName)));
    if (matches.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(matches[0]?.name || "")) {
      throw new TypeError(`Coluna ${aliases[0]} ausente, ambígua ou insegura na lista ${LISTS[kind][0]}.`);
    }
    return matches[0];
  });
  if (new Set(resolved.map(column => column.name)).size !== resolved.length) {
    throw new TypeError(`Colunas ambíguas na lista ${LISTS[kind][0]}.`);
  }
  return resolved;
}

function normalizeItem(item, columns, kind) {
  const get = index => scalar(item.fields[columns[index].name]);
  if (kind === "activities") return Object.freeze({
    id: String(item.id), branch: get(0), stage: get(1), activity: get(2), property: get(3), supplier: get(4),
    executionDate: normalizeStageProgressDate(get(5)), plannedDate: normalizeStageProgressDate(get(6)), status: get(7),
  });
  const raw = get(5);
  const parsed = /^\+?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(raw) ? Number(raw.replace(",", ".")) : NaN;
  return Object.freeze({ id: String(item.id), branch: get(0), stage: get(1),
    startDate: normalizeStageProgressDate(get(2)), endDate: normalizeStageProgressDate(get(3)), status: get(4),
    percent: Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed * 100 : null });
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
      if (!["string", "number"].includes(typeof item?.id) || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))
        || !item?.fields || typeof item.fields !== "object" || Array.isArray(item.fields)) {
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

/** Read-only: both lists must finish before {complete:true,activities,launches}. */
export function createStageProgressData({ tokenProvider, repository: suppliedRepository } = {}) {
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
      const [activities, launches] = await Promise.all([loadList(repository, "activities", signal), loadList(repository, "launches", signal)]);
      abortIfNeeded(signal);
      return Object.freeze({ complete: true, activities, launches });
    } catch (error) {
      controller.abort(error);
      throw error;
    } finally {
      externalSignal?.removeEventListener("abort", abort);
    }
  }
  return Object.freeze({ loadSnapshot });
}
