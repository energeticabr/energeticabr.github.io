import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createHrPayrollGalleryData } from '../src/chat/orders-gallery-data.js';
import { createHrPayrollGallery } from '../src/ui/hr-payroll-gallery-view.js';

function fixture() {
  const reads = [], hydrated = [];
  let newest = false;
  const item = (id, supplier = 'A') => ({ id, fields: {
    FORNECEDOR: supplier, TIPOPGTO: 'SALÁRIO', MESREFERENCIA: '10/2026',
    IDLANCAMENTO: Number(id), DATA: '2026-10-08',
  } });
  const pages = [[item('2'), item('10', 'B')], [item('100'), item('20', 'B')]];
  const data = createHrPayrollGalleryData({ repository: {
    resolveList: async (_site, names) => ({ status: 'resolved', id: names[0] }),
    getItemsPage: async (_site, list, _query, options) => {
      reads.push({ list, cursor: options.cursor });
      return options.cursor
        ? { items: newest ? [...pages[1], item('101')] : pages[1], hasMore: false }
        : { items: pages[0], hasMore: true, nextLink: 'second-source-page' };
    },
    getColumns: async () => [{ name: 'VALORUNITARIO' }, { name: 'QUANTIDADE' }],
    getItem: async (_site, _list, id) => {
      hydrated.push(id);
      return { id, fields: { VALORUNITARIO: 25, QUANTIDADE: 2 } };
    },
  } });
  return { data, reads, hydrated, pages, addNewest: () => { newest = true; } };
}

test('FOLHAPGTO orders numeric IDs descending across source pages before display pagination', async () => {
  const f = fixture();
  const first = await f.data.loadFilteredPage('FOLHAPGTO', { pageSize: 2 });
  assert.deepEqual(first.rows.map(row => row.id), ['100', '20']);
  assert.equal(first.count, 4);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextCursor, '2');
  assert.deepEqual(f.hydrated, ['100', '20'], 'hydrate only the newest visible records');
  const second = await f.data.loadFilteredPage('FOLHAPGTO', { page: 2, pageSize: 2 });
  assert.deepEqual(second.rows.map(row => row.id), ['10', '2']);
  assert.equal(second.hasMore, false);
  assert.equal(f.reads.length, 2, 'page changes reuse the complete snapshot');
  assert.deepEqual(f.pages.map(page => page.map(item => item.id)), [['2', '10'], ['100', '20']]);
});

test('FOLHAPGTO preserves descending IDs for search, field and financial filters', async () => {
  const { data } = fixture();
  for (const filters of [{ search: 'salario' }, { FORNECEDOR: 'A' }, { QTDmin: '2', FORNECEDOR: 'A' }]) {
    const result = await data.loadFilteredPage('FOLHAPGTO', { filters });
    assert.deepEqual(result.rows.map(row => row.id), filters.FORNECEDOR ? ['100', '2'] : ['100', '20', '10', '2']);
  }
});

test('refresh puts a newly created highest payment ID first without keeping the old order', async () => {
  const f = fixture();
  await f.data.loadFilteredPage('FOLHAPGTO');
  f.addNewest();
  const result = await f.data.loadFilteredPage('FOLHAPGTO', { refresh: true });
  assert.deepEqual(result.rows.map(row => row.id), ['101', '100', '20', '10', '2']);
  assert.equal(result.count, 5);
  assert.equal(f.reads.length, 4);
});

test('payment default ordering does not change the IDFOLHA gallery', async () => {
  const { data } = fixture();
  const result = await data.loadFilteredPage('IDFOLHA');
  assert.deepEqual(result.rows.map(row => row.id), ['2', '10', '100', '20']);
});

test('real payroll gallery renders newest ID first on open and after refresh', async t => {
  const f = fixture(), dom = new JSDOM('<main></main>'), doc = dom.window.document;
  const panel = createHrPayrollGallery({ document: doc, gallery: 'FOLHAPGTO',
    request: (gallery, page, pageSize, _cursor, options) => f.data.loadFilteredPage(gallery, { page, pageSize, ...options }),
  });
  t.after(() => { panel.destroy(); dom.window.close(); });
  const ids = () => [...doc.querySelectorAll('.hr-gallery-id')].map(node => node.textContent);
  await panel.open();
  assert.deepEqual(ids(), ['ID 100', 'ID 20', 'ID 10', 'ID 2']);
  f.addNewest();
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('focus'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(ids(), ['ID 101', 'ID 100', 'ID 20', 'ID 10', 'ID 2']);
});
