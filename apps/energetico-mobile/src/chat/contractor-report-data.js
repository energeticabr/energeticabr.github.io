import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { normalizeContractorRow, normalizeLaunchRow, normalizeMeasurementRow } from "./contractor-report-model.js";

const SITE = "personal";
const MAX_PAGES = 100;
const MAX_TOTAL_PAGES = 10_000;
const PREFER = "HonorNonIndexedQueriesWarningMayFailRandomly";
const ALIASES = Object.freeze({
  contractors: ["EMPREITEIRO", "EMPREITEIROS"],
  documents: ["DOCUMENTOS_1"],
  launches: ["LANCAMENTOS"],
  measurements: ["DESCRICAOMEDICOES", "DESCRIÇÃO MEDIÇÕES"],
});

function key(value) {
  return String(value ?? "").replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError");
}

// A repository/token provider may ignore signal. Reject promptly and consume
// any eventual result or rejection without publishing a cancelled snapshot.
function abortable(operation, signal) {
  abortIfNeeded(signal);
  if (!signal) return operation();
  return new Promise((resolve, reject) => {
    const finish = (callback, value) => { signal.removeEventListener("abort", abort); callback(value); };
    const abort = () => finish(reject, signal.reason || new DOMException("Consulta cancelada.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { abortIfNeeded(signal); return operation(); })
      .then(value => { abortIfNeeded(signal); finish(resolve, value); })
      .catch(error => finish(reject, error));
  });
}

function rethrowAbort(error, signal) {
  abortIfNeeded(signal);
  if (error?.name === "AbortError") throw error;
}

function queryFor(filter = "") {
  const params = new URLSearchParams({ $expand: "fields", $top: "100" });
  if (filter) params.set("$filter", filter);
  return params.toString();
}

function columnNamed(columns, aliases) {
  if (!Array.isArray(columns)) throw new TypeError("Esquema de colunas SharePoint inválido.");
  const wanted = new Set(aliases.map(key));
  const matches = columns.filter(column => column?.computed !== true && !/^LinkTitle(?:NoMenu|\d+)?$/i.test(column?.name || ""))
    .filter(column => wanted.has(key(column?.name)) || wanted.has(key(column?.displayName)));
  if (matches.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(matches[0]?.name || "")) {
    throw new Error(`Não foi possível identificar com segurança a coluna ${aliases[0]} no SharePoint.`);
  }
  return matches[0];
}

function fieldValue(item, column) {
  const value = item?.fields?.[column?.name];
  if (value == null) return "";
  if (typeof value === "object") return String(value.LookupValue ?? value.Value ?? value.LookupId ?? "").trim();
  return String(value).trim();
}

function readStatus(item, column) { return fieldValue(item, column); }

function isBadFilter(error) {
  return Number(error?.status ?? error?.statusCode ?? error?.response?.status) === 400;
}

export function createContractorReportData({
  tokenProvider, repository: suppliedRepository, fetchImpl = globalThis.fetch, siteConfig = SHAREPOINT_SITES,
} = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("O relatório requer a sessão Microsoft ativa.");
  const repository = suppliedRepository || createSharePointRepository(createGraphClient(tokenProvider, { fetch: fetchImpl }), siteConfig);

  async function resolve(kind, signal, required = true) {
    abortIfNeeded(signal);
    const list = await abortable(() => repository.resolveList(SITE, ALIASES[kind], signal ? { signal } : {}), signal);
    abortIfNeeded(signal);
    if (list?.status !== "resolved" || !list.id) {
      if (!required) return null;
      throw new Error(`A lista ${ALIASES[kind][0]} não está disponível nesta conta.`);
    }
    return list.id;
  }

  async function allItems(list, query, signal) {
    let cursor = "";
    const items = [];
    const seenIds = new Map(), seenCursors = new Set();
    for (let pageIndex = 0; pageIndex < MAX_TOTAL_PAGES; pageIndex++) {
      abortIfNeeded(signal);
      const page = await abortable(() => repository.getItemsPage(SITE, list, query, {
        ...(signal ? { signal } : {}), pageNumber: pageIndex % MAX_PAGES + 1, maxPages: MAX_PAGES,
        headers: { Prefer: PREFER }, ...(cursor ? { cursor } : {}),
      }), signal);
      abortIfNeeded(signal);
      if (!Array.isArray(page?.items) || page.items.length > 100 || typeof page.hasMore !== "boolean"
        || page.error || page.partial || page.aborted || page.truncated
        || page.batchCount !== undefined && page.batchCount !== page.items.length
        || page.nextLink != null && typeof page.nextLink !== "string") {
        throw new Error("O SharePoint retornou uma página de itens inválida ou incompleta.");
      }
      const next = page.nextLink?.trim() || "";
      if (page.hasMore !== Boolean(next)) throw new Error("A paginação do relatório informou uma página inconsistente.");
      for (const item of page.items) {
        const id = String(item?.id ?? "").trim();
        if (!/^[1-9]\d*$/.test(id) || !item?.fields || typeof item.fields !== "object" || Array.isArray(item.fields)) {
          throw new Error("O SharePoint retornou um registro de item inválido.");
        }
        const fields = JSON.stringify(Object.fromEntries(Object.entries(item.fields).sort(([a], [b]) => a.localeCompare(b))));
        if (seenIds.has(id)) {
          if (seenIds.get(id) !== fields) throw new Error("O SharePoint retornou versões conflitantes de um item duplicado.");
          continue;
        }
        seenIds.set(id, fields);
        items.push(item);
      }
      if (!page.hasMore) return items;
      if (seenCursors.has(next)) throw new Error("A paginação do relatório repetiu um cursor.");
      seenCursors.add(next);
      cursor = next;
    }
    throw new Error("A lista excedeu o limite seguro de paginação; os totais não foram exibidos parcialmente.");
  }

  async function loadOverview({ signal } = {}) {
    const list = await resolve("contractors", signal);
    const columns = await abortable(() => repository.getColumns(SITE, list, signal ? { signal } : {}), signal);
    abortIfNeeded(signal);
    const items = await allItems(list, queryFor(), signal);
    const rows = items.map(item => normalizeContractorRow(item, columns)).filter(row => /^\d+$/.test(row.id));
    const documentStatuses = Object.create(null);
    const warnings = [];
    const ids = [...new Set(rows.flatMap(row => [row.contractDocumentId, row.estimateDocumentId]).filter(id => /^[1-9]\d*$/.test(id)))];
    if (ids.length) {
      try {
        const documentList = await resolve("documents", signal, false);
        if (!documentList) throw new Error("Lista de documentos indisponível.");
        const documentColumns = await abortable(() => repository.getColumns(SITE, documentList, signal ? { signal } : {}), signal);
        abortIfNeeded(signal);
        const statusColumn = columnNamed(documentColumns, ["STATUS"]);
        let next = 0;
        const workers = Array.from({ length: Math.min(6, ids.length) }, async () => {
          while (next < ids.length) {
            abortIfNeeded(signal);
            const id = ids[next++];
            try {
              const item = await abortable(() => repository.getItem(SITE, documentList, id, "$expand=fields", signal ? { signal } : {}), signal);
              abortIfNeeded(signal);
              documentStatuses[id] = readStatus(item, statusColumn);
            } catch (error) {
              rethrowAbort(error, signal);
              if (Number(error?.status ?? error?.statusCode ?? error?.response?.status) !== 404) warnings.push("Alguns status de documentos não puderam ser consultados.");
            }
          }
        });
        await Promise.all(workers);
      } catch (error) {
        rethrowAbort(error, signal);
        warnings.push("Os status de documentos não puderam ser consultados.");
      }
    }
    abortIfNeeded(signal);
    return Object.freeze({ rows: Object.freeze(rows), documentStatuses: Object.freeze(documentStatuses), warnings: Object.freeze([...new Set(warnings)]) });
  }

  async function linkedItems(kind, id, signal) {
    const list = await resolve(kind, signal);
    const columns = await abortable(() => repository.getColumns(SITE, list, signal ? { signal } : {}), signal);
    abortIfNeeded(signal);
    const column = columnNamed(columns, kind === "launches" ? ["CONTRATO"] : ["NUMEROCONTRATO", "NÚMERO CONTRATO"]);
    const numeric = Boolean(column.number || column.currency || column.integer);
    if (numeric === Boolean(column.text) || column.lookup || column.choice || column.boolean || column.dateTime || column.personOrGroup) {
      throw new TypeError(`O tipo da coluna ${column.name} não permite filtrar o contrato com segurança.`);
    }
    const filter = `fields/${column.name} eq ${numeric ? id : `'${id}'`}`;
    let items;
    try {
      items = await allItems(list, queryFor(filter), signal);
    } catch (error) {
      rethrowAbort(error, signal);
      if (!isBadFilter(error)) throw error;
      items = await allItems(list, queryFor(), signal);
    }
    return items.filter(item => {
      const value = fieldValue(item, column);
      return numeric ? /^\d+(?:\.0+)?$/.test(value) && Number(value) === Number(id) : value === id;
    })
      .map(item => {
        const row = kind === "launches" ? normalizeLaunchRow(item, columns) : normalizeMeasurementRow(item, columns);
        return numeric ? Object.freeze({ ...row, contract: id }) : row;
      })
      .sort((a, b) => Number(b.id) - Number(a.id));
  }

  async function loadDetails(id, { signal } = {}) {
    const safeId = String(id ?? "").trim();
    if (!/^[1-9]\d{0,14}$/.test(safeId)) throw new RangeError("O ID do empreiteiro é inválido.");
    abortIfNeeded(signal);
    const [launches, measurements] = await Promise.all([
      linkedItems("launches", safeId, signal), linkedItems("measurements", safeId, signal),
    ]);
    abortIfNeeded(signal);
    return Object.freeze({ launches: Object.freeze(launches), measurements: Object.freeze(measurements) });
  }

  return Object.freeze({ loadOverview, loadDetails });
}
