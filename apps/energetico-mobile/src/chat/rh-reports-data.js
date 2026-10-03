import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { normalizeRhSupplier, normalizeRhPresence, normalizeRhLaunch } from "./rh-reports-model.js";

const SITE = "personal";
const MAX_PAGES = 100;
const PREFER = "HonorNonIndexedQueriesWarningMayFailRandomly";
const LISTS = Object.freeze({
  suppliers: ["FORNECEDORES"], presences: ["DESCRITIVOPRESENCA", "DESCRITIVO PRESENCA"], launches: ["LANCAMENTOS"],
});
const NORMALIZE = { suppliers: normalizeRhSupplier, presences: normalizeRhPresence, launches: normalizeRhLaunch };

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError");
}

export function createRhReportsData({
  tokenProvider, repository: suppliedRepository, fetchImpl = globalThis.fetch, siteConfig = SHAREPOINT_SITES,
} = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("Os relatórios de RH requerem a sessão Microsoft ativa.");
  const repository = suppliedRepository || createSharePointRepository(createGraphClient(tokenProvider, { fetch: fetchImpl }), siteConfig);

  async function loadList(kind, signal) {
    abortIfNeeded(signal);
    const resolved = await repository.resolveList(SITE, LISTS[kind], signal ? { signal } : {});
    abortIfNeeded(signal);
    if (resolved?.status !== "resolved" || !resolved.id) throw new Error(`A lista ${LISTS[kind][0]} não está disponível nesta conta.`);
    const columns = await repository.getColumns(SITE, resolved.id, signal ? { signal } : {});
    abortIfNeeded(signal);
    const query = new URLSearchParams({ $expand: "fields", $top: "100" }).toString();
    const items = []; let cursor = "";
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
      abortIfNeeded(signal);
      const page = await repository.getItemsPage(SITE, resolved.id, query, {
        ...(signal ? { signal } : {}), pageNumber, maxPages: MAX_PAGES,
        headers: { Prefer: PREFER }, ...(cursor ? { cursor } : {}),
      });
      abortIfNeeded(signal);
      if (!Array.isArray(page?.items)) throw new Error("O SharePoint retornou uma página de itens inválida.");
      items.push(...page.items);
      if (!page.hasMore) return Object.freeze(items.map(item => NORMALIZE[kind](item, columns)));
      if (!page.nextLink) throw new Error("A paginação do relatório não informou a próxima página.");
      cursor = page.nextLink;
    }
    throw new Error("A lista excedeu o limite seguro de paginação; os totais não foram exibidos parcialmente.");
  }

  async function loadSnapshot(reportNumber, { signal } = {}) {
    if (![3, 4, 5].includes(Number(reportNumber))) throw new RangeError("Número de relatório inválido: selecione 3, 4 ou 5.");
    abortIfNeeded(signal);
    const required = Number(reportNumber) === 4 ? ["presences"]
      : Number(reportNumber) === 3 ? ["suppliers", "presences"] : ["suppliers", "presences", "launches"];
    const lists = await Promise.all(required.map(kind => loadList(kind, signal)));
    abortIfNeeded(signal);
    const result = Object.fromEntries(required.map((kind, index) => [kind, lists[index]]));
    return Object.freeze({ suppliers: result.suppliers || Object.freeze([]),
      presences: result.presences || Object.freeze([]), launches: result.launches || Object.freeze([]) });
  }

  return Object.freeze({ loadSnapshot, loadReport: loadSnapshot });
}
