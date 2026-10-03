import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { normalizeSpendingLaunch, normalizeSpendingProduct } from "./spending-reports-model.js";

const SITE = "personal";
const MAX_PAGES = 100;
const PREFER = "HonorNonIndexedQueriesWarningMayFailRandomly";

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError");
}

export function createSpendingReportsData({
  tokenProvider, repository: suppliedRepository, fetchImpl = globalThis.fetch, siteConfig = SHAREPOINT_SITES,
} = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("Os relatórios requerem a sessão Microsoft ativa.");
  const repository = suppliedRepository || createSharePointRepository(createGraphClient(tokenProvider, { fetch: fetchImpl }), siteConfig);

  async function resolve(name, signal) {
    abortIfNeeded(signal);
    const list = await repository.resolveList(SITE, [name], signal ? { signal } : {});
    abortIfNeeded(signal);
    if (list?.status !== "resolved" || !list.id) throw new Error(`A lista ${name} não está disponível nesta conta.`);
    return list.id;
  }

  async function allItems(list, signal) {
    const query = new URLSearchParams({ $expand: "fields", $top: "100" }).toString();
    const items = [];
    let cursor = "";
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
      abortIfNeeded(signal);
      const page = await repository.getItemsPage(SITE, list, query, {
        ...(signal ? { signal } : {}), pageNumber, maxPages: MAX_PAGES,
        headers: { Prefer: PREFER }, ...(cursor ? { cursor } : {}),
      });
      abortIfNeeded(signal);
      if (!Array.isArray(page?.items)) throw new Error("O SharePoint retornou uma página de itens inválida.");
      if (typeof page.hasMore !== "boolean") throw new Error("O SharePoint não informou se há mais páginas do relatório.");
      items.push(...page.items);
      if (!page.hasMore) return items;
      if (!page.nextLink) throw new Error("A paginação do relatório não informou a próxima página.");
      cursor = page.nextLink;
    }
    throw new Error("A lista excedeu o limite seguro de paginação; os totais não foram exibidos parcialmente.");
  }

  async function loadSnapshot({ reportNumber, signal } = {}) {
    if (reportNumber !== 9 && reportNumber !== 10) throw new RangeError("Relatório de gastos desconhecido.");
    abortIfNeeded(signal);
    const launchList = await resolve("LANCAMENTOS", signal);
    const productList = reportNumber === 9 ? await resolve("CADASTROPRODUTO", signal) : null;
    const [launchColumns, launchItems, productColumns, productItems] = await Promise.all([
      repository.getColumns(SITE, launchList, signal ? { signal } : {}),
      allItems(launchList, signal),
      productList ? repository.getColumns(SITE, productList, signal ? { signal } : {}) : [],
      productList ? allItems(productList, signal) : [],
    ]);
    abortIfNeeded(signal);
    if (!Array.isArray(launchColumns) || !Array.isArray(productColumns)) throw new Error("O SharePoint retornou colunas inválidas.");
    return Object.freeze({
      launches: Object.freeze(launchItems.map(item => normalizeSpendingLaunch(item, launchColumns))),
      productTypes: Object.freeze(productItems.map(item => normalizeSpendingProduct(item, productColumns))),
    });
  }

  return Object.freeze({ loadSnapshot });
}
