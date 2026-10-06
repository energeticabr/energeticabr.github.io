import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { normalizeTaskAssociationSnapshot } from "./task-association-report-model.js";

const SITE = "personal";
const LISTS = ["LANCAMENTOTAREFAS", "LANCAMENTO TAREFAS"];
const WINDOW_PAGES = 100;
const MAX_TOTAL_PAGES = 10_000;
const SCHEMA = {
  createdDate: ["DATAIDENTIFICACAO", "DATA IDENTIFICAÇÃO"], dueDate: ["DATAFATAL", "DATA FATAL"],
  description: ["TAREFA"], association: ["ASSOCIAÇÃO", "ASSOCIACAO"], status: ["CONCLUÍDO"],
  priority: ["PRIORITÁRIA"], difficulty: ["DIFICULDADE"], supplier: ["REFERENTE"],
};
// Fold accents only in schema aliases. Report equality keeps the source accents.
const columnKey = value => String(value ?? "").replace(/^OData_/i, "")
  .replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function validateSchema(columns) {
  if (!Array.isArray(columns)) throw new TypeError("Esquema SharePoint inválido em LANCAMENTOTAREFAS.");
  const eligible = columns.filter(column => !column?.computed && !/^LinkTitle(?:NoMenu|2)?$/i.test(String(column?.name ?? "")));
  const resolved = {};
  for (const [field, aliases] of Object.entries(SCHEMA)) {
    const keys = new Set(aliases.map(columnKey));
    const matches = eligible.filter(column => keys.has(columnKey(column?.name)) || keys.has(columnKey(column?.displayName)));
    if (matches.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(matches[0]?.name || "")) {
      throw new TypeError(`Coluna ${aliases[0]} ausente, ambígua ou insegura em LANCAMENTOTAREFAS.`);
    }
    resolved[field] = matches[0].name;
  }
  if (new Set(Object.values(resolved)).size !== Object.keys(resolved).length) throw new TypeError("Colunas ambíguas em LANCAMENTOTAREFAS.");
  return resolved;
}

function scalar(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length <= 1) return scalar(value[0]);
  if (typeof value === "object" && !Array.isArray(value)) {
    let hasLabel = false;
    for (const alias of ["LookupValue", "Value", "value", "Title"]) {
      if (Object.hasOwn(value, alias)) {
        hasLabel = true;
        const label = scalar(value[alias]);
        if (String(label).trim()) return label;
      }
    }
    if (Object.hasOwn(value, "LookupId")) {
      if (String(scalar(value.LookupId)).trim()) throw new TypeError("Lookup não resolvido em LANCAMENTOTAREFAS.");
      return "";
    }
    if (hasLabel) return "";
  }
  throw new TypeError("Campo SharePoint inválido no relatório de tarefas por associação.");
}

function normalizeItem(item, columns) {
  if (!item || typeof item !== "object" || Array.isArray(item) || !item.fields || typeof item.fields !== "object" || Array.isArray(item.fields)) {
    throw new TypeError("Registro ou campos SharePoint inválidos no relatório de tarefas por associação.");
  }
  const row = { id: item.id };
  for (const [field, column] of Object.entries(columns)) {
    const value = scalar(item.fields[column]);
    if (!String(value).trim() && String(scalar(item.fields[`${column}LookupId`])).trim()) {
      throw new TypeError(`Lookup não resolvido na coluna ${column} de LANCAMENTOTAREFAS.`);
    }
    row[field] = value;
  }
  return normalizeTaskAssociationSnapshot({ tasks: [row] }).tasks[0];
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError");
}

// Bound every await even when an injected provider or repository ignores cancellation.
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
  for (const alias of LISTS) {
    list = await abortable(() => repository.resolveList(SITE, [alias], { signal }), signal);
    if (list?.status !== "missing") break;
  }
  if (list?.status !== "resolved" || !list.id) throw new Error("A lista LANCAMENTOTAREFAS não está disponível nesta conta.");
  const columns = validateSchema(await abortable(() => repository.getColumns(SITE, list.id, { signal }), signal));
  const query = new URLSearchParams({ $expand: `fields($select=${Object.values(columns).join(",")})`, $top: "100" }).toString();
  const rows = []; const ids = new Set(); const cursors = new Set(); let cursor = "";
  for (let index = 0; index < MAX_TOTAL_PAGES; index++) {
    const page = await abortable(() => repository.getItemsPage(SITE, list.id, query, {
      signal, pageNumber: index % WINDOW_PAGES + 1, maxPages: WINDOW_PAGES,
      headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" }, ...(cursor ? { cursor } : {}),
    }), signal);
    if (!Array.isArray(page?.items) || page.items.length > 100 || typeof page.hasMore !== "boolean"
      || page.error || page.incomplete || page.complete === false || page.partial || page.aborted || page.truncated
      || page.batchCount !== undefined && page.batchCount !== page.items.length
      || page.nextLink != null && typeof page.nextLink !== "string") {
      throw new TypeError("Página SharePoint inválida ou incompleta em LANCAMENTOTAREFAS.");
    }
    const next = page.nextLink?.trim() || "";
    if (page.hasMore !== Boolean(next) || page.hasMore && !page.items.length) throw new TypeError("Página com conclusão de paginação inconsistente.");
    for (const item of page.items) {
      const row = normalizeItem(item, columns);
      if (ids.has(row.id)) throw new TypeError("ID duplicado na paginação de LANCAMENTOTAREFAS.");
      ids.add(row.id); rows.push(row);
    }
    if (!page.hasMore) return rows;
    if (cursors.has(next)) throw new TypeError("Cursor repetido: ciclo de paginação de LANCAMENTOTAREFAS.");
    cursors.add(next); cursor = next;
  }
  throw new RangeError("Limite seguro de paginação excedido; nenhum resultado parcial foi disponibilizado.");
}

/** Authenticated GET-only load returns a frozen snapshot after full schema and base validation. */
export function createTaskAssociationReportData({ tokenProvider, repository: suppliedRepository } = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("O relatório exige uma sessão Microsoft ativa.");
  if (suppliedRepository && ["resolveList", "getColumns", "getItemsPage"].some(name => typeof suppliedRepository[name] !== "function")) {
    throw new TypeError("Repositório SharePoint inválido para o relatório de tarefas por associação.");
  }
  async function loadSnapshot({ signal: externalSignal } = {}) {
    abortIfNeeded(externalSignal);
    const controller = new AbortController(); const { signal } = controller;
    const abort = () => controller.abort(externalSignal.reason);
    externalSignal?.addEventListener("abort", abort, { once: true });
    try {
      const repository = suppliedRepository || createSharePointRepository(createGraphClient(
        scopes => abortable(() => tokenProvider(scopes, { signal }), signal),
      ), { personal: SHAREPOINT_SITES.personal });
      const tasks = await loadRows(repository, signal);
      abortIfNeeded(signal);
      return normalizeTaskAssociationSnapshot({ tasks });
    } catch (error) {
      controller.abort(error); throw error;
    } finally {
      externalSignal?.removeEventListener("abort", abort);
    }
  }
  return Object.freeze({ loadSnapshot });
}
