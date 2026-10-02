import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import {
  normalizePaymentLaunchRow, normalizePresencePaymentRow, normalizeSupplierStatusRow,
} from "./presence-payment-report-model.js";

const SITE = "personal";
const MAX_PAGES = 100;
const PREFER = "HonorNonIndexedQueriesWarningMayFailRandomly";
const LISTS = Object.freeze({
  presences: ["DESCRITIVOPRESENCA", "DESCRITIVO PRESENCA"],
  suppliers: ["FORNECEDORES"],
  launches: ["LANCAMENTOS"],
});

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError");
}

function isNotFound(error) {
  return Number(error?.status ?? error?.statusCode ?? error?.response?.status) === 404;
}

export function createPresencePaymentReportData({
  tokenProvider, repository: suppliedRepository, fetchImpl = globalThis.fetch, siteConfig = SHAREPOINT_SITES,
} = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("O relatório requer a sessão Microsoft ativa.");
  const repository = suppliedRepository || createSharePointRepository(createGraphClient(tokenProvider, { fetch: fetchImpl }), siteConfig);

  async function resolve(kind, signal) {
    abortIfNeeded(signal);
    const list = await repository.resolveList(SITE, LISTS[kind], signal ? { signal } : {});
    abortIfNeeded(signal);
    if (list?.status !== "resolved" || !list.id) throw new Error(`A lista ${LISTS[kind][0]} não está disponível nesta conta.`);
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
      items.push(...page.items);
      if (!page.hasMore) return items;
      if (!page.nextLink) throw new Error("A paginação do relatório não informou a próxima página.");
      cursor = page.nextLink;
    }
    throw new Error("A lista excedeu o limite seguro de paginação; os totais não foram exibidos parcialmente.");
  }

  async function loadSnapshot({ signal } = {}) {
    abortIfNeeded(signal);
    const [presenceList, supplierList, launchList] = await Promise.all([
      resolve("presences", signal), resolve("suppliers", signal), resolve("launches", signal),
    ]);
    abortIfNeeded(signal);
    const [presenceColumns, supplierColumns, launchColumns, presenceItems, supplierItems] = await Promise.all([
      repository.getColumns(SITE, presenceList, signal ? { signal } : {}),
      repository.getColumns(SITE, supplierList, signal ? { signal } : {}),
      repository.getColumns(SITE, launchList, signal ? { signal } : {}),
      allItems(presenceList, signal), allItems(supplierList, signal),
    ]);
    abortIfNeeded(signal);
    const presences = presenceItems.map(item => normalizePresencePaymentRow(item, presenceColumns)).filter(row => row.paymentId);
    const supplierStatusByName = Object.create(null);
    const seenSuppliers = new Set();
    for (const item of supplierItems) {
      const row = normalizeSupplierStatusRow(item, supplierColumns);
      const match = row.name.trim().toLocaleLowerCase("pt-BR");
      if (match && !seenSuppliers.has(match)) {
        supplierStatusByName[row.name] = row.status;
        seenSuppliers.add(match);
      }
    }

    const launchesById = Object.create(null);
    const ids = [...new Set(presences.map(row => row.paymentId).filter(id => /^[1-9]\d{0,14}$/.test(id)))];
    let next = 0;
    const workers = Array.from({ length: Math.min(6, ids.length) }, async () => {
      while (next < ids.length) {
        abortIfNeeded(signal);
        const id = ids[next++];
        try {
          const item = await repository.getItem(SITE, launchList, id, "$expand=fields", signal ? { signal } : {});
          abortIfNeeded(signal);
          launchesById[id] = normalizePaymentLaunchRow(item, launchColumns);
        } catch (error) {
          abortIfNeeded(signal);
          if (!isNotFound(error)) throw error;
        }
      }
    });
    await Promise.all(workers);
    abortIfNeeded(signal);
    const invalidIds = new Set(presences.map(row => row.paymentId).filter(id => !/^[1-9]\d{0,14}$/.test(id)));
    const warnings = invalidIds.size ? [`${invalidIds.size} IDPGTO não numérico ou fora do intervalo não pôde ser associado a um lançamento.`] : [];
    return Object.freeze({
      presences: Object.freeze(presences), launchesById: Object.freeze(launchesById),
      supplierStatusByName: Object.freeze(supplierStatusByName), warnings: Object.freeze(warnings),
    });
  }

  return Object.freeze({ loadSnapshot });
}
