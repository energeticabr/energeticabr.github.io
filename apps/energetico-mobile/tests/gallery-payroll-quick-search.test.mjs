import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPayrollRows } from '../src/chat/payroll-gallery-filters.js';
import { createHrPayrollGalleryData } from '../src/chat/orders-gallery-data.js';

const payment = Object.freeze({
  id: '20', FORNECEDOR: ['JOSÉ', 'Construções'], TIPOPGTO: 'SALÁRIO',
  VALORUNITARIO: 1234.5, QTD: 2.5, DATA: '2026-10-08T00:00:00Z', IDFOLHA: 42, IDLANCAMENTO: 7801,
});

for (const search of ['1.234,50', 'R$ 1.234,50', '1234.5', '2,5', '2.5']) {
  test(`payment quick search includes numeric values as ${search}`, () => {
    assert.deepEqual(filterPayrollRows('FOLHAPGTO', [payment], { search }).map(row => row.id), ['20']);
  });
}

test('payment quick search combines supplier, type, amount, quantity, date and linked IDs across fields', () => {
  const search = ' JOSE   construcoes salario 1.234,50 2,5 08/10/2026 42 7801 ';
  assert.deepEqual(filterPayrollRows('FOLHAPGTO', [payment], { search }), [payment]);
  assert.deepEqual(filterPayrollRows('FOLHAPGTO', [payment], { search: `${search} ausente` }), []);
});

test('sheet quick search includes status with supplier, month and ID without searching metadata', () => {
  const rows = [
    { id: '42', FORNECEDOR: 'JOSÉ', MESREFERENCIA: '10/2026', STATUS: ['INATIVO', 'Revisão'], eTag: 'metadata-only' },
    { id: '43', FORNECEDOR: 'JOSÉ', MESREFERENCIA: '10/2026', STATUS: 'ATIVO' },
  ];
  assert.deepEqual(filterPayrollRows('IDFOLHA', rows, { search: 'jose inativo revisao 10/2026 42' }).map(row => row.id), ['42']);
  assert.deepEqual(filterPayrollRows('IDFOLHA', rows, { search: 'metadata-only' }), []);
});

test('quick search remains an intersection with exact, numeric and date filters', () => {
  const row = { ...payment, FORNECEDOR: 'JOSÉ' };
  const filters = { search: 'salario 1.234,50 08/10/2026', FORNECEDOR: 'JOSÉ', TIPOPGTO: 'SALÁRIO',
    id: '20', IDFOLHA: '42', IDLANCAMENTO: '7801', VALORUNITARIOmin: '1.234,50', VALORUNITARIOmax: '1234.50',
    QTDmin: '2,5', QTDmax: '2.5', DATAfrom: '2026-10-08', DATAto: '08/10/2026' };
  assert.deepEqual(filterPayrollRows('FOLHAPGTO', [row], filters), [row]);
  for (const excluded of [{ FORNECEDOR: 'OUTRO' }, { QTDmin: '3', QTDmax: '' }, { DATAfrom: '2026-10-09', DATAto: '' }]) {
    assert.deepEqual(filterPayrollRows('FOLHAPGTO', [row], { ...filters, ...excluded }), []);
  }
});

function fixture({ brokenSource, amounts = new Map([['102', 1234.5], ['120', 1234.5], ['200', 9]]) } = {}) {
  const sourceReads = [], pageReads = [];
  const item = (id, supplier, link, amount) => ({ id, fields: {
    FORNECEDOR: supplier, TIPOPGTO: 'SALÁRIO', VALORUNITARIO: amount, QTD: 99,
    DATA: '2026-10-08T00:00:00Z', IDFOLHA: 42, IDLANCAMENTO: link,
  } });
  const pages = [[item('2', 'JOSÉ', 102, 1)], [item('100', 'OUTRO', 200, 1234.5), item('20', 'JOSÉ', 120, 1)]];
  const data = createHrPayrollGalleryData({ repository: {
    resolveList: async (_site, names) => ({ status: 'resolved', id: names[0] }),
    getItemsPage: async (_site, _list, query, options) => {
      pageReads.push({ query, ...options });
      return options.cursor ? { items: pages[1], hasMore: false }
        : { items: pages[0], hasMore: true, nextLink: 'second-page' };
    },
    getColumns: async () => [{ name: 'VALORUNITARIO' }, { name: 'QUANTIDADE' }],
    getItem: async (_site, _list, id) => {
      sourceReads.push(id);
      if (id === brokenSource) throw new Error('Source unavailable');
      return { id, fields: { VALORUNITARIO: amounts.get(id), QUANTIDADE: id === '200' ? 4 : 2.5 } };
    },
  } });
  return { data, sourceReads, pageReads, amounts };
}

test('financial text searches current launch values across pages before counting and descending display pagination', async () => {
  const f = fixture();
  const first = await f.data.loadFilteredPage('FOLHAPGTO', { pageSize: 1, filters: { search: '1.234,50' } });
  assert.equal(first.count, 2);
  assert.equal(first.totalCount, 3);
  assert.deepEqual(first.rows.map(row => row.id), ['20']);
  assert.equal(first.rows[0].VALORUNITARIO, 1234.5);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextCursor, '2');
  const second = await f.data.loadFilteredPage('FOLHAPGTO', { page: 2, pageSize: 1, filters: { search: '1.234,50' } });
  assert.deepEqual(second.rows.map(row => row.id), ['2']);
  assert.equal(second.hasMore, false);
  assert.equal(f.sourceReads.length, 3, 'financial text requires current values, reused across display pages');
  assert.equal(f.pageReads.length, 2);
});

test('quantity text search uses current quantity instead of its stale copied value', async () => {
  const { data } = fixture();
  const result = await data.loadFilteredPage('FOLHAPGTO', { filters: { search: '2,5' } });
  assert.deepEqual(result.rows.map(row => row.id), ['20', '2']);
  assert.equal(result.count, 2);
  assert.equal(result.rows[0].QTD, 2.5);
});

test('financial crossfield terms prefilter nonfinancial words and specific filters before reading linked sources', async () => {
  const f = fixture({ brokenSource: '200' });
  const result = await f.data.loadFilteredPage('FOLHAPGTO', { filters: {
    search: 'jose salario R$ 1.234,50 2,5 08/10/2026 42', FORNECEDOR: 'JOSÉ', id: '20',
    IDFOLHA: '42', IDLANCAMENTO: '120', VALORUNITARIOmin: '1234,50', VALORUNITARIOmax: '1234.5',
    QTDmin: '2,5', QTDmax: '2.5', DATAfrom: '2026-10-08', DATAto: '2026-10-08',
  } });
  assert.deepEqual(result.rows.map(row => row.id), ['20']);
  assert.deepEqual(f.sourceReads, ['120']);
});

for (const search of ['jose salario', 'jose 08/10/2026', 'jose 2026-10-08']) {
  test(`nonfinancial text search ${search} hydrates only the visible page`, async () => {
    const f = fixture({ brokenSource: '200' });
    const result = await f.data.loadFilteredPage('FOLHAPGTO', { pageSize: 1, filters: { search } });
    assert.equal(result.count, 2);
    assert.deepEqual(result.rows.map(row => row.id), ['20']);
    assert.deepEqual(f.sourceReads, ['120']);
  });
}

test('financial text combined with a range still rejects values outside the range', async () => {
  const f = fixture();
  const result = await f.data.loadFilteredPage('FOLHAPGTO', { filters: { search: 'jose 1.234,50', QTDmin: '3' } });
  assert.equal(result.count, 0);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(f.sourceReads.sort(), ['102', '120']);
});

test('refresh invalidates current source values used by financial text search', async () => {
  const f = fixture();
  const options = { filters: { search: '1.234,50' } };
  assert.equal((await f.data.loadFilteredPage('FOLHAPGTO', options)).count, 2);
  f.amounts.set('120', 10);
  const refreshed = await f.data.loadFilteredPage('FOLHAPGTO', { ...options, refresh: true });
  assert.deepEqual(refreshed.rows.map(row => row.id), ['2']);
  assert.equal(refreshed.count, 1);
  assert.equal(f.sourceReads.length, 6);
});

test('sheet filtered data requests and normalizes available status without changing specific filters', async () => {
  const queries = [];
  const data = createHrPayrollGalleryData({ repository: {
    resolveList: async () => ({ status: 'resolved', id: 'IDFOLHA' }),
    getItemsPage: async (_site, _list, query) => {
      queries.push(query);
      const includesStatus = !query.includes('fields($select=') || /\bSTATUS\b/.test(query);
      return { hasMore: false, items: [
        { id: '42', fields: { FORNECEDOR: 'JOSÉ', MESREFERENCIA: '10/2026', ...(includesStatus ? { STATUS: { Value: 'INATIVO' } } : {}) } },
        { id: '43', fields: { FORNECEDOR: 'JOSÉ', MESREFERENCIA: '09/2026', ...(includesStatus ? { STATUS: 'ATIVO' } : {}) } },
      ] };
    },
  } });
  const result = await data.loadFilteredPage('IDFOLHA', { filters: { search: 'jose inativo 10/2026', FORNECEDOR: 'JOSÉ', MESREFERENCIA: '10/2026' } });
  assert.deepEqual(result.rows.map(row => row.id), ['42']);
  assert.equal(result.rows[0].STATUS, 'INATIVO');
  assert.equal(result.count, 1);
  assert.deepEqual(result.filterOptions.MESREFERENCIA, ['09/2026', '10/2026']);
  assert.equal(queries.length, 1);
});
