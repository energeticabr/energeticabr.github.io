import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { createSharePointAttachmentTransport } from '../../../../portal/data/attachments.js';
import { PROVISION_FISCAL_DRAFT_STATUS } from '../../../../portal/forms/provision-parent-due.js';
import { provisionDescriptionLinkColumn, publishedProvisionRows } from './provision-description-detail-data.js';
import { normalizeManagementProvision, normalizeSpendingLaunch, normalizeSpendingProduct, normalizeSpendingProvision, normalizeSpendingRecurrence } from "./spending-reports-model.js";
import { normalizeProvisionReportRow, normalizeProvisionReportRecurrence, normalizeProvisionReportDescription } from './provision-report-model.js';
import { normalizeOrderValidationOrder, normalizeOrderValidationLaunch, assertOrderValidationSource } from './order-validation-report-model.js';

const SITE = "personal";
const MAX_PAGES = 100;
const PREFER = "HonorNonIndexedQueriesWarningMayFailRandomly";
const PAYMENT_LEDGER_LISTS = Object.freeze({ order: 'NOTASPENDENTES', launch: 'LANCAMENTOS' });
const PROVISION_LISTS = {
  description: ['DESCRITIVOPROVISAO'],
  provision: ['PROVISÃO PGTOS', 'PROVISAO PGTOS', 'PROVISAO PAGAMENTOS'],
};
const isConfirmedProvision = item => item.fields?.STATUS !== PROVISION_FISCAL_DRAFT_STATUS;

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError");
}

function uniqueProvisionRows(rows) {
  const seen = new Set();
  return rows.filter(item => {
    const id = String(item.id ?? '').trim();
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function createSpendingReportsData({
  tokenProvider, repository: suppliedRepository,
  fetchImpl = globalThis.fetch, siteConfig = SHAREPOINT_SITES,
} = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("Os relatórios requerem a sessão Microsoft ativa.");
  const repository = suppliedRepository || createSharePointRepository(createGraphClient(tokenProvider, { fetch: fetchImpl }), siteConfig, {
    attachmentTransport: createSharePointAttachmentTransport({
      tokenProvider, allowedSites: Object.values(siteConfig), fetch: fetchImpl,
    }),
  });

  async function resolve(name, signal) {
    abortIfNeeded(signal);
    const aliases = Array.isArray(name) ? name : [name];
    const list = await repository.resolveList(SITE, aliases, signal ? { signal } : {});
    abortIfNeeded(signal);
    if (list?.status !== "resolved" || !list.id) throw new Error(`A lista ${aliases[0]} não está disponível nesta conta.`);
    return list.id;
  }

  async function allItems(list, signal, filter = '', completeTraversal = false) {
    const query = new URLSearchParams({ $expand: "fields", $top: "100", ...(filter ? { $filter: filter } : {}) }).toString();
    const items = [];
    let cursor = ""; const seenCursors = new Set();
    // Match the established commercial-report cursor-window pattern without changing the repository guard.
    const maximum = completeTraversal ? 1000 : MAX_PAGES;
    for (let pageIndex = 1; pageIndex <= maximum; pageIndex++) {
      abortIfNeeded(signal);
      const page = await repository.getItemsPage(SITE, list, query, {
        ...(signal ? { signal } : {}), pageNumber: (pageIndex - 1) % MAX_PAGES + 1, maxPages: MAX_PAGES,
        headers: { Prefer: PREFER }, ...(cursor ? { cursor } : {}),
      });
      abortIfNeeded(signal);
      if (!Array.isArray(page?.items)) throw new Error("O SharePoint retornou uma página de itens inválida.");
      if (typeof page.hasMore !== "boolean") throw new Error("O SharePoint não informou se há mais páginas do relatório.");
      items.push(...page.items);
      if (!page.hasMore) return items;
      if (!page.nextLink) throw new Error("A paginação do relatório não informou a próxima página.");
      if (completeTraversal && seenCursors.has(page.nextLink)) throw new Error('A paginação retornou cursor repetido; nenhum total parcial foi exibido.');
      seenCursors.add(page.nextLink);
      cursor = page.nextLink;
    }
    throw new Error("A lista excedeu o limite seguro de paginação. Os totais não foram exibidos parcialmente.");
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
      const linkName = provisionDescriptionLinkColumn(provisionColumns, { required:false }) || 'DESCRITIVOPROVISAO';
      const published = await publishedProvisionRows(provisionItems, { repository, siteKey:SITE, signal, linkName });
      return Object.freeze({
        recurrences: Object.freeze(recurrenceItems.map(item => normalizeSpendingRecurrence(item, recurrenceColumns))),
        provisions: Object.freeze(published.map(item => normalizeSpendingProvision(item, provisionColumns))),
      });
    }
    const [launchList, productList, provisionList] = await Promise.all([
      resolve("LANCAMENTOS", signal), resolve("CADASTROPRODUTO", signal), resolve(PROVISION_LISTS.provision, signal),
    ]);
    const [launchColumns, launchItems, productColumns, productItems, provisionColumns, provisionItems] = await Promise.all([
      repository.getColumns(SITE, launchList, signal ? { signal } : {}),
      allItems(launchList, signal),
      repository.getColumns(SITE, productList, signal ? { signal } : {}),
      allItems(productList, signal),
      repository.getColumns(SITE, provisionList, signal ? { signal } : {}),
      allItems(provisionList, signal, '', true),
    ]);
    abortIfNeeded(signal);
    if (![launchColumns, productColumns, provisionColumns].every(Array.isArray)) throw new Error("O SharePoint retornou colunas inválidas.");
    const linkName = provisionDescriptionLinkColumn(provisionColumns, { required:false }) || 'DESCRITIVOPROVISAO';
    const published = await publishedProvisionRows(provisionItems, { repository, siteKey:SITE, signal, linkName });
    abortIfNeeded(signal);
    const productTypes = productItems.map(item => normalizeSpendingProduct(item, productColumns));
    const disbursementByProduct = new Map();
    for (const product of productTypes) {
      const name = product.product.toLocaleLowerCase('pt-BR');
      if (name && !disbursementByProduct.has(name)) disbursementByProduct.set(name, product.disbursement);
    }
    const provisions = uniqueProvisionRows(published).map(item => {
      const row = normalizeManagementProvision(item, provisionColumns);
      const disbursement = row.disbursement || disbursementByProduct.get(row.product.toLocaleLowerCase('pt-BR')) || '';
      return Object.freeze({ ...row, disbursement });
    });
    return Object.freeze({
      launches: Object.freeze(launchItems.map(item => normalizeSpendingLaunch(item, launchColumns))),
      productTypes: Object.freeze(productTypes),
      provisions: Object.freeze(provisions),
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
      const attachmentFlag = String(item.fields?.Attachments ?? item.hasAttachments ?? '').trim().toLowerCase();
      const hasAttachments = ['true', '1'].includes(attachmentFlag) ? true
        : ['false', '0'].includes(attachmentFlag) ? false : undefined;
      return Object.freeze({ ...row, disbursement: row.disbursement === 'true' ? 'SIM'
        : row.disbursement === 'false' ? 'NÃO' : row.disbursement, hasAttachments });
    })) });
  }

  async function listPaymentLedgerPdfs(kind, id, { signal, interactive = false } = {}) {
    if (!Object.hasOwn(PAYMENT_LEDGER_LISTS, kind) || !/^[1-9]\d*$/.test(id)) {
      throw new TypeError('Origem de anexo inválida.');
    }
    const list = await resolve(PAYMENT_LEDGER_LISTS[kind], signal);
    let files;
    try {
      files = await repository.listAttachments(SITE, list, id, { signal, requireCollection: true, namesOnly: true, interactive });
    } catch (error) {
      abortIfNeeded(signal);
      if (error?.status === 404) return []; // Historical launches can reference a deleted item.
      throw error;
    }
    abortIfNeeded(signal);
    return files.filter(({ name }) => /\.pdf$/i.test(name)).map(({ name }) => ({
      fileName: name,
      mimeType: 'application/pdf',
      async source({ signal: downloadSignal = signal, onProgress } = {}) {
        abortIfNeeded(signal);
        const bytes = await repository.downloadAttachment(SITE, list, id, name, { signal: downloadSignal, onProgress });
        abortIfNeeded(downloadSignal);
        return new Blob([bytes], { type: 'application/pdf' });
      },
    }));
  }

  async function loadProvisionReportSnapshot({ signal } = {}) {
    const [recurrenceList, provisionList, descriptionList] = await Promise.all([
      resolve(['DESPESASRECORRENTES', 'DESPESAS RECORRENTES'], signal),
      resolve(PROVISION_LISTS.provision, signal),
      resolve(PROVISION_LISTS.description, signal),
    ]);
    const [recurrenceColumns, recurrenceItems, provisionColumns, provisionItems, descriptionColumns, descriptionItems] = await Promise.all([
      repository.getColumns(SITE, recurrenceList, signal ? { signal } : {}), allItems(recurrenceList, signal),
      repository.getColumns(SITE, provisionList, signal ? { signal } : {}), allItems(provisionList, signal),
      repository.getColumns(SITE, descriptionList, signal ? { signal } : {}), allItems(descriptionList, signal),
    ]);
    abortIfNeeded(signal);
    if (![recurrenceColumns, provisionColumns, descriptionColumns].every(Array.isArray)) throw new Error('O SharePoint retornou colunas inválidas.');
    const linkName = provisionDescriptionLinkColumn(provisionColumns, { required:false }) || 'DESCRITIVOPROVISAO';
    const published = await publishedProvisionRows(provisionItems, { parents:descriptionItems, signal, linkName });
    return Object.freeze({
      recurrences: Object.freeze(recurrenceItems.map(item => normalizeProvisionReportRecurrence(item, recurrenceColumns))),
      provisions: Object.freeze(uniqueProvisionRows(published).map(item => normalizeProvisionReportRow(item, provisionColumns))),
      descriptions: Object.freeze(descriptionItems.filter(isConfirmedProvision).map(item => normalizeProvisionReportDescription(item, descriptionColumns))),
    });
  }

  function resolveAttachmentList(kind, signal) {
    if (!Object.hasOwn(PROVISION_LISTS, kind)) throw new RangeError('Origem de anexo inválida.');
    return resolve(PROVISION_LISTS[kind], signal);
  }

  async function listProvisionReportAttachments(kind, id, { signal, interactive = true } = {}) {
    const list = await resolveAttachmentList(kind, signal);
    const files = await repository.listAttachments(SITE, list, id, { signal, requireCollection: true, namesOnly: true, interactive });
    return files.map(({ name, type }) => ({ fileName: name, mimeType: type }));
  }

  async function downloadProvisionReportAttachment(kind, id, fileName, { signal, onProgress } = {}) {
    const list = await resolveAttachmentList(kind, signal);
    const bytes = await repository.downloadAttachment(SITE, list, id, fileName, { signal, onProgress });
    return new Blob([bytes], { type: /\.pdf$/i.test(fileName) ? 'application/pdf' : '' });
  }

  async function loadOrderValidationSnapshot({ signal } = {}) {
    const [orderList, launchList] = await Promise.all([
      resolve('NOTASPENDENTES', signal), resolve('LANCAMENTOS', signal),
    ]);
    const [orderColumns, orderItems, launchColumns, launchItems] = await Promise.all([
      repository.getColumns(SITE, orderList, signal ? { signal } : {}), allItems(orderList, signal, '', true),
      repository.getColumns(SITE, launchList, signal ? { signal } : {}), allItems(launchList, signal, '', true),
    ]);
    abortIfNeeded(signal);
    if (!Array.isArray(orderColumns) || !Array.isArray(launchColumns)) throw new Error('O SharePoint retornou colunas inválidas.');
    assertOrderValidationSource(orderItems, orderColumns, 'orders');
    assertOrderValidationSource(launchItems, launchColumns, 'launches');
    return Object.freeze({
      orders: Object.freeze(orderItems.map(item => normalizeOrderValidationOrder(item, orderColumns))),
      launches: Object.freeze(launchItems.map(item => normalizeOrderValidationLaunch(item, launchColumns))),
    });
  }

  return Object.freeze({ loadSnapshot, loadPaymentsSnapshot, listPaymentLedgerPdfs, loadProvisionReportSnapshot, loadOrderValidationSnapshot,
    listProvisionReportAttachments, downloadProvisionReportAttachment });
}
