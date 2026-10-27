import Decimal from 'decimal.js';
import { createAcquisitionProgress } from './acquisition-progress.js';

const ORDER_FIELDS = Object.freeze(['DATAPGTOEFETUADO', 'FILIAL', 'FORNECEDOR', 'FORMAPGTO', 'VALORTOTAL', 'OBS', 'NOTA FISCAL', 'OBS FISCAL', 'STATUS']);
const ACTIVE_FIELDS = Object.freeze(['AGRUPAR', 'DATA', 'FILIAL', 'FORNECEDOR', 'CONTA', 'PRODUTO', 'DESCRIÇÃO', 'QUANTIDADE', 'VALOR UNITÁRIO', 'FRETE', 'APROVACAO']);
const ARCHIVE_FIELDS = Object.freeze(['AGRUPAR', 'DATA', 'FORNECEDOR', 'CONTA', 'PRODUTO', 'DESCRIÇÃO', 'QUANTIDADE', 'VALOR UNITÁRIO', 'FRETE', 'ID 2', 'DATAEXCLUSAO']);
const SCHEMAS = Object.freeze({ NOTASPENDENTES: ORDER_FIELDS, LANCAMENTOS: ACTIVE_FIELDS, ARQUIVOLANCAMENTOS: ARCHIVE_FIELDS });
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

function key(value) {
  return String(value ?? '').replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function linkedReportText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(linkedReportText).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    for (const name of ['LookupValue', 'Value', 'value', 'DisplayName', 'displayName', 'Title', 'title', 'Email', 'email']) {
      if (value[name] != null) return linkedReportText(value[name]);
    }
    return '';
  }
  return String(value);
}

function abort(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('A consulta foi cancelada.', 'AbortError');
}

function decimal(value, label, id) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Decimal(value);
  const raw = linkedReportText(value).trim().replace(/^R\$\s*/, '').replace(/\s/g, '');
  if (!raw) return new Decimal(0);
  const number = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  if (!/^-?\d+(?:\.\d+)?$/.test(number)) throw new Error(`O campo ${label} do registro #${id} não contém um número válido.`);
  const result = new Decimal(number);
  if (!result.isFinite()) throw new Error(`O campo ${label} do registro #${id} não contém um número válido.`);
  return result;
}

export { decimal as linkedReportDecimal };

function total(row) {
  const fields = row.fields;
  return decimal(fields.QUANTIDADE, 'QUANTIDADE', row.id).times(decimal(fields['VALOR UNITÁRIO'], 'VALOR UNITÁRIO', row.id))
    .plus(decimal(fields.FRETE, 'FRETE', row.id));
}

function groups(rows, deleted) {
  const bySupplier = new Map();
  for (const row of rows) {
    const supplier = (linkedReportText(row.fields.FORNECEDOR) || '-').trim();
    if (!bySupplier.has(supplier)) bySupplier.set(supplier, []);
    bySupplier.get(supplier).push(row);
  }
  return Object.freeze([...bySupplier].sort(([left], [right]) => left.toLowerCase().localeCompare(right.toLowerCase(), 'pt-BR'))
    .map(([supplier, members]) => {
      members.sort((left, right) => Number(deleted ? left.fields['ID 2'] : left.id) - Number(deleted ? right.fields['ID 2'] : right.id));
      const accumulated = deleted ? null : members.reduce((sum, row) => sum.plus(total(row)), new Decimal(0)).toNumber();
      return Object.freeze({ supplier, rows: Object.freeze(members), accumulated });
    }));
}

// Mirrors the supplied PowerApps formula: only active rows affect divergences
// and totals; archived rows retain their original ID and deletion audit.
export function buildOrdersLinkedReport({ orderId, order, active, deleted }) {
  if (!order || String(order.id) !== orderId || !Array.isArray(active) || !Array.isArray(deleted)) {
    throw new Error('A resposta do relatório não corresponde ao pedido solicitado.');
  }
  const linked = rows => rows.filter(row => linkedReportText(row?.fields?.AGRUPAR) === orderId);
  const valued = row => Object.freeze({ ...row,
    quantity: decimal(row.fields.QUANTIDADE, 'QUANTIDADE', row.id).toNumber(),
    unitPrice: decimal(row.fields['VALOR UNITÁRIO'], 'VALOR UNITÁRIO', row.id).toNumber(),
    freight: decimal(row.fields.FRETE, 'FRETE', row.id).toNumber(), amount: total(row).toNumber(),
  });
  active = linked(active).map(valued);
  deleted = linked(deleted).map(valued);
  const activeTotal = active.reduce((sum, row) => sum.plus(total(row)), new Decimal(0));
  const orderTotal = decimal(order.fields.VALORTOTAL, 'VALORTOTAL', orderId);
  const divergentIds = (lineField, headerField) => Object.freeze(active.filter(row =>
    linkedReportText(row.fields[lineField]).toLocaleLowerCase('pt-BR') !== linkedReportText(order.fields[headerField]).toLocaleLowerCase('pt-BR')).map(row => row.id));
  const summary = Object.freeze({ activeCount: active.length, deletedCount: deleted.length,
    activeTotal: activeTotal.toNumber(), orderTotal: orderTotal.toNumber(),
    difference: orderTotal.minus(activeTotal).toNumber(),
    totalDiffers: !orderTotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).equals(activeTotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)),
  });
  return Object.freeze({ orderId, order, active: Object.freeze(active), deleted: Object.freeze(deleted), summary,
    divergences: Object.freeze({ branch: divergentIds('FILIAL', 'FILIAL'), supplier: divergentIds('FORNECEDOR', 'FORNECEDOR'), paymentForm: divergentIds('CONTA', 'FORMAPGTO') }),
    activeGroups: groups(active, false), deletedGroups: groups(deleted, true),
  });
}

export function createOrdersLinkedReportData({ repository, siteKey = 'personal' } = {}) {
  const contracts = new Map();

  async function contract(name, signal, progress) {
    abort(signal);
    if (contracts.has(name)) {
      progress.step(`${name}:list`, { cached: true });
      progress.step(`${name}:schema`, { cached: true });
      return contracts.get(name);
    }
    if (typeof repository?.getColumns !== 'function') throw new Error('Os metadados SharePoint do relatório de pedidos não estão disponíveis.');
    const list = await repository.resolveList(siteKey, [name], signal ? { signal } : {});
    abort(signal);
    if (list?.status !== 'resolved' || !list.id) throw new Error(`A lista ${name} não está disponível nesta conta SharePoint.`);
    progress.step(`${name}:list`);
    const columns = await repository.getColumns(siteKey, list.id, signal ? { signal } : {});
    abort(signal);
    if (!Array.isArray(columns)) throw new Error(`Os metadados da lista ${name} não retornaram uma resposta válida.`);
    const mapping = new Map();
    for (const label of SCHEMAS[name]) {
      const wanted = key(label);
      const matches = columns.filter(column => key(column.displayName || column.label || column.name) === wanted || key(column.name) === wanted);
      const names = [...new Set(matches.map(column => column.name))];
      if (names.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(names[0])) {
        throw new Error(`A coluna ${label} da lista ${name} não pôde ser comprovada ou está ambígua.`);
      }
      mapping.set(label, names[0]);
    }
    const result = { id: list.id, mapping };
    contracts.set(name, result);
    progress.step(`${name}:schema`);
    return result;
  }

  function normalize(item, mapping) {
    const id = String(item?.id ?? item?.fields?.ID ?? '').trim();
    if (!/^\d{1,15}$/.test(id) || !item?.fields || typeof item.fields !== 'object' || Array.isArray(item.fields)) {
      throw new Error('O SharePoint devolveu uma resposta de registro inválida para o relatório.');
    }
    const fields = Object.fromEntries([...mapping].map(([label, name]) => [label, item.fields[name] ?? item.fields[label] ?? null]));
    const person = item.createdBy?.user ?? item.createdBy;
    const author = linkedReportText(person) || linkedReportText(item.fields.Author ?? item.fields['Criado por']);
    fields['Criado por'] = /^\d+$/.test(author) ? 'Usuário não identificado' : author;
    fields.ID = id;
    return Object.freeze({ id, fields: Object.freeze(fields) });
  }

  async function readGroup(name, orderId, signal, progress) {
    const { id, mapping } = await contract(name, signal, progress);
    const query = `$select=id,createdBy&$expand=fields($select=${[...mapping.values()].join(',')})&$filter=fields/${mapping.get('AGRUPAR')} eq '${orderId}'&$top=${PAGE_SIZE}`;
    const rows = new Map();
    const visited = new Set();
    let cursor;
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
      abort(signal);
      const page = await repository.getItemsPage(siteKey, id, query, { pageNumber, maxPages: MAX_PAGES,
        headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' }, ...(cursor ? { cursor } : {}), ...(signal ? { signal } : {}) });
      abort(signal);
      if (!Array.isArray(page?.items)) throw new Error(`A lista ${name} retornou uma resposta de paginação inválida.`);
      for (const item of page.items) {
        const row = normalize(item, mapping);
        if (linkedReportText(row.fields.AGRUPAR) === orderId) rows.set(row.id, row);
      }
      progress.report(`${name}:items`, { pages: pageNumber, records: rows.size, listName: name });
      if (page.hasMore !== true) {
        progress.step(`${name}:items`, { pages: pageNumber, records: rows.size, listName: name });
        return [...rows.values()];
      }
      if (typeof page.nextLink !== 'string' || !page.nextLink || visited.has(page.nextLink)) {
        throw new Error(`A paginação da lista ${name} está incompleta ou repetiu o cursor; o relatório não foi truncado.`);
      }
      visited.add(page.nextLink);
      cursor = page.nextLink;
    }
    throw new Error(`A lista ${name} ultrapassou o limite seguro de páginas; o relatório não foi truncado.`);
  }

  async function loadLinkedReport(rawId, { signal, onProgress } = {}) {
    const orderId = String(rawId ?? '').trim();
    if (!/^\d{1,15}$/.test(orderId)) throw new RangeError('O ID do pedido não é válido.');
    abort(signal);
    if (typeof repository?.getItem !== 'function') throw new Error('A consulta pontual do pedido não está disponível.');
    const progress = createAcquisitionProgress({ signal, onProgress }, [
      'NOTASPENDENTES:list', 'NOTASPENDENTES:schema', 'order',
      'LANCAMENTOS:list', 'LANCAMENTOS:schema', 'LANCAMENTOS:items',
      'ARQUIVOLANCAMENTOS:list', 'ARQUIVOLANCAMENTOS:schema', 'ARQUIVOLANCAMENTOS:items', 'report',
    ]);
    const { id, mapping } = await contract('NOTASPENDENTES', signal, progress);
    let item;
    try {
      item = await repository.getItem(siteKey, id, orderId, `$expand=fields($select=${[...mapping.values()].join(',')})`, signal ? { signal } : {});
    } catch (error) {
      if (Number(error?.status) === 404) throw new Error(`O pedido #${orderId} não foi encontrado no SharePoint.`);
      throw error;
    }
    abort(signal);
    if (!item) throw new Error(`O pedido #${orderId} não foi encontrado no SharePoint.`);
    const order = normalize(item, mapping);
    if (order.id !== orderId) throw new Error('O SharePoint devolveu outro pedido para a consulta solicitada.');
    progress.step('order');
    const [active, deleted] = await Promise.all([readGroup('LANCAMENTOS', orderId, signal, progress), readGroup('ARQUIVOLANCAMENTOS', orderId, signal, progress)]);
    abort(signal);
    const result = buildOrdersLinkedReport({ orderId, order, active, deleted });
    progress.step('report');
    return result;
  }
  return Object.freeze({ loadLinkedReport, invalidate: () => contracts.clear() });
}
