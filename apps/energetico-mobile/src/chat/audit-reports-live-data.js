import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import {
  normalizeAuditQuote, normalizeAuditBudget, normalizeAuditAsset, normalizeAuditDocument,
} from "./audit-reports-live-model.js";

const SITE = "personal";
const MAX_PAGES = 100;
const LISTS = Object.freeze({
  quotes: ["NOVACOTACAO", "NOVA COTACAO", "NOVA COTAÇÃO"],
  budgets: ["ORCAMENTOS", "ORÇAMENTOS"],
  assets: ["IMOBILIZADOS"],
  documents: ["DOCUMENTOS_1", "DOCUMENTOS 1", "DOCUMENTOS"],
});

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError");
}

export function createAuditReportsData({
  tokenProvider, repository: suppliedRepository, fetchImpl = globalThis.fetch, siteConfig = SHAREPOINT_SITES,
} = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("O relatório requer a sessão Microsoft ativa.");
  const repository = suppliedRepository || createSharePointRepository(createGraphClient(tokenProvider, { fetch: fetchImpl }), siteConfig);

  async function list(kind, signal) {
    abortIfNeeded(signal);
    const resolved = await repository.resolveList(SITE, LISTS[kind], signal ? { signal } : {});
    abortIfNeeded(signal);
    if (resolved?.status !== "resolved" || !resolved.id) throw new Error(`A lista ${LISTS[kind][0]} não está disponível nesta conta.`);
    return resolved.id;
  }

  async function allItems(listId, signal) {
    const items = [];
    let cursor = "";
    const query = new URLSearchParams({ $expand: "fields", $top: "100" }).toString();
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
      abortIfNeeded(signal);
      const page = await repository.getItemsPage(SITE, listId, query, {
        ...(signal ? { signal } : {}), pageNumber, maxPages: MAX_PAGES,
        headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" },
        ...(cursor ? { cursor } : {}),
      });
      abortIfNeeded(signal);
      if (!Array.isArray(page?.items)) throw new Error("O SharePoint retornou uma página inválida.");
      items.push(...page.items);
      if (!page.hasMore) return items;
      if (!page.nextLink) throw new Error("A paginação do relatório não informou a próxima página.");
      cursor = page.nextLink;
    }
    throw new Error("A lista excedeu o limite seguro de paginação; os totais não foram exibidos parcialmente.");
  }

  async function loadKind(kind, normalize, signal) {
    const listId = await list(kind, signal);
    const [columns, items] = await Promise.all([
      repository.getColumns(SITE, listId, signal ? { signal } : {}), allItems(listId, signal),
    ]);
    abortIfNeeded(signal);
    return items.map(item => normalize(item, columns));
  }

  async function loadReport(number, { signal } = {}) {
    abortIfNeeded(signal);
    if (number === 11) {
      const [quotes, budgets] = await Promise.all([
        loadKind("quotes", normalizeAuditQuote, signal), loadKind("budgets", normalizeAuditBudget, signal),
      ]);
      return Object.freeze({ quotes: Object.freeze(quotes), budgets: Object.freeze(budgets) });
    }
    if (number === 12) return Object.freeze({ rows: Object.freeze(await loadKind("assets", normalizeAuditAsset, signal)) });
    if (number === 13) return Object.freeze({ rows: Object.freeze(await loadKind("documents", normalizeAuditDocument, signal)) });
    throw new RangeError("Relatório de auditoria desconhecido.");
  }

  return Object.freeze({ loadReport });
}
