import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { normalizeSpendingLaunch, normalizeSpendingProduct, normalizeSpendingProvision, normalizeSpendingRecurrence } from "./spending-reports-model.js";

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
    const aliases = Array.isArray(name) ? name : [name];
    const list = await repository.resolveList(SITE, aliases, signal ? { signal } : {});
    abortIfNeeded(signal);
    if (list?.status !== "resolved" || !list.id) throw new Error(`A lista ${aliases[0]} não está disponível nesta conta.`);
    return list.id;
  }

  async function allItems(list, signal, filter = '') {
    const query = new URLSearchParams({ $expand: "fields", $top: "100", ...(filter ? { $filter: filter } : {}) }).toString();
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
    throw new Error("A lista excedeu o limite seguro de paginação; reduza o período. Os totais não foram exibidos parcialmente.");
  }

  async function loadSnapshot({ reportNumber, signal } = {}) {
    if (reportNumber !== 9 && reportNumber !== 10) throw new RangeError("Relatório de gastos desconhecido.");
    abortIfNeeded(signal);
    if (reportNumber === 10) {
      const [recurrenceList, provisionList] = await Promise.all([
        resolve(["DESPESASRECORRENTES", "DESPESAS RECORRENTES"], signal),
        resolve(["PROVISÃO PGTOS", "PROVISAO PGTOS", "PROVISAO PAGAMENTOS"], signal),
      ]);
      const [recurrenceColumns, recurrenceItems, provisionColumns, provisionItems] = await Promise.all([
        repository.getColumns(SITE, recurrenceList, signal ? { signal } : {}), allItems(recurrenceList, signal),
        repository.getColumns(SITE, provisionList, signal ? { signal } : {}), allItems(provisionList, signal),
      ]);
      abortIfNeeded(signal);
      if (!Array.isArray(recurrenceColumns) || !Array.isArray(provisionColumns)) throw new Error("O SharePoint retornou colunas inválidas.");
      return Object.freeze({
        recurrences: Object.freeze(recurrenceItems.map(item => normalizeSpendingRecurrence(item, recurrenceColumns))),
        provisions: Object.freeze(provisionItems.map(item => normalizeSpendingProvision(item, provisionColumns))),
      });
    }
    const launchList = await resolve("LANCAMENTOS", signal);
    const productList = await resolve("CADASTROPRODUTO", signal);
    const [launchColumns, launchItems, productColumns, productItems] = await Promise.all([
      repository.getColumns(SITE, launchList, signal ? { signal } : {}),
      allItems(launchList, signal),
      repository.getColumns(SITE, productList, signal ? { signal } : {}),
      allItems(productList, signal),
    ]);
    abortIfNeeded(signal);
    if (!Array.isArray(launchColumns) || !Array.isArray(productColumns)) throw new Error("O SharePoint retornou colunas inválidas.");
    return Object.freeze({
      launches: Object.freeze(launchItems.map(item => normalizeSpendingLaunch(item, launchColumns))),
      productTypes: Object.freeze(productItems.map(item => normalizeSpendingProduct(item, productColumns))),
    });
  }

  async function loadPaymentsSnapshot({ signal, filters = {} } = {}) {
    const list = await resolve('LANCAMENTOS', signal);
    const columns = await repository.getColumns(SITE, list, signal ? { signal } : {});
    abortIfNeeded(signal);
    if (!Array.isArray(columns)) throw new Error('O SharePoint retornou colunas inválidas.');
    const key = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const paymentDate = columns.find(column => key(column.name) === 'DATAPGTOEFETUADO' || key(column.displayName) === 'DATAPGTOEFETUADO')?.name;
    const conditions = [];
    if (filters.startDate || filters.endDate) {
      if (!paymentDate || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(paymentDate)) throw new Error('A coluna de data de pagamento não está disponível para filtrar o relatório.');
      for (const name of ['startDate', 'endDate']) if (filters[name] && !/^\d{4}-\d{2}-\d{2}$/.test(filters[name])) throw new Error('Período de pagamento inválido.');
      if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) throw new Error('A data inicial não pode ser posterior à final.');
      if (filters.startDate) conditions.push(`fields/${paymentDate} ge '${filters.startDate}T00:00:00Z'`);
      if (filters.endDate) conditions.push(`fields/${paymentDate} le '${filters.endDate}T23:59:59.999Z'`);
    }
    const items = await allItems(list, signal, conditions.join(' and '));
    abortIfNeeded(signal);
    return Object.freeze({ launches: Object.freeze(items.map(item => {
      const row = normalizeSpendingLaunch(item, columns);
      return Object.freeze({ ...row, disbursement: row.disbursement === 'true' ? 'SIM'
        : row.disbursement === 'false' ? 'NÃO' : row.disbursement });
    })) });
  }

  return Object.freeze({ loadSnapshot, loadPaymentsSnapshot });
}
