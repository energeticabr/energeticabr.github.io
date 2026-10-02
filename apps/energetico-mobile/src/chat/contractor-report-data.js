import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { normalizeContractorRow, normalizeLaunchRow, normalizeMeasurementRow } from "./contractor-report-model.js";

const SITE = "personal";
const MAX_PAGES = 100;
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

function queryFor(filter = "") {
  const params = new URLSearchParams({ $expand: "fields", $top: "100" });
  if (filter) params.set("$filter", filter);
  return params.toString();
}

function columnNamed(columns, aliases) {
  const wanted = new Set(aliases.map(key));
  const matches = (columns || []).filter(column => wanted.has(key(column?.name)) || wanted.has(key(column?.displayName)));
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
    const list = await repository.resolveList(SITE, ALIASES[kind], signal ? { signal } : {});
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
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
      abortIfNeeded(signal);
      const page = await repository.getItemsPage(SITE, list, query, {
        ...(signal ? { signal } : {}), pageNumber, maxPages: MAX_PAGES,
        headers: { Prefer: PREFER }, ...(cursor ? { cursor } : {}),
      });
      abortIfNeeded(signal);
      if (!Array.isArray(page?.items)) throw new Error("O SharePoint retornou uma página de itens inválida.");
      items.push(...page.items);
      if (!page.hasMore) return items;
      if (!page.nextLink) throw new Error("A paginação do relatório não informou a próxima página.");
      cursor = page.nextLink;
    }
    throw new Error("A lista excedeu o limite seguro de paginação; os totais não foram exibidos parcialmente.");
  }

  async function loadOverview({ signal } = {}) {
    const list = await resolve("contractors", signal);
    const columns = await repository.getColumns(SITE, list, signal ? { signal } : {});
    const items = await allItems(list, queryFor(), signal);
    const rows = items.map(item => normalizeContractorRow(item, columns)).filter(row => /^\d+$/.test(row.id));
    const documentStatuses = Object.create(null);
    const warnings = [];
    const ids = [...new Set(rows.flatMap(row => [row.contractDocumentId, row.estimateDocumentId]).filter(id => /^[1-9]\d*$/.test(id)))];
    if (ids.length) {
      try {
        const documentList = await resolve("documents", signal, false);
        if (!documentList) throw new Error("Lista de documentos indisponível.");
        const documentColumns = await repository.getColumns(SITE, documentList, signal ? { signal } : {});
        const statusColumn = columnNamed(documentColumns, ["STATUS"]);
        let next = 0;
        const workers = Array.from({ length: Math.min(6, ids.length) }, async () => {
          while (next < ids.length) {
            abortIfNeeded(signal);
            const id = ids[next++];
            try {
              const item = await repository.getItem(SITE, documentList, id, "$expand=fields", signal ? { signal } : {});
              abortIfNeeded(signal);
              documentStatuses[id] = readStatus(item, statusColumn);
            } catch (error) {
              abortIfNeeded(signal);
              if (Number(error?.status) !== 404) warnings.push("Alguns status de documentos não puderam ser consultados.");
            }
          }
        });
        await Promise.all(workers);
      } catch (error) {
        abortIfNeeded(signal);
        warnings.push("Os status de documentos não puderam ser consultados.");
      }
    }
    return Object.freeze({ rows: Object.freeze(rows), documentStatuses: Object.freeze(documentStatuses), warnings: Object.freeze([...new Set(warnings)]) });
  }

  async function linkedItems(kind, id, signal) {
    const list = await resolve(kind, signal);
    const columns = await repository.getColumns(SITE, list, signal ? { signal } : {});
    const column = columnNamed(columns, kind === "launches" ? ["CONTRATO"] : ["NUMEROCONTRATO", "NÚMERO CONTRATO"]);
    const numeric = Boolean(column.number || column.currency || column.integer);
    const filter = `fields/${column.name} eq ${numeric ? id : `'${id}'`}`;
    let items;
    try {
      items = await allItems(list, queryFor(filter), signal);
    } catch (error) {
      abortIfNeeded(signal);
      if (!isBadFilter(error)) throw error;
      items = await allItems(list, queryFor(), signal);
    }
    return items.filter(item => fieldValue(item, column) === id)
      .map(item => kind === "launches" ? normalizeLaunchRow(item, columns) : normalizeMeasurementRow(item, columns))
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
