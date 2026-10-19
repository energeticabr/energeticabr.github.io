import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createOrdersGalleryData } from '../src/chat/orders-gallery-data.js';
import { createOrdersGallery } from '../src/ui/orders-gallery-view.js';

const failure = (code = 'request_timeout', status = 0) => Object.assign(
  new Error('A requisicao Microsoft Graph excedeu o tempo limite.'),
  { name: 'GraphRequestError', code, status, retryAfter: undefined });

test('orders recover a temporary discovery and page failure without rereading completed pages', async () => {
  let discoveries = 0, secondPage = 0;
  const pages = [];
  const data = createOrdersGalleryData({ repository: {
    async resolveList() { if (++discoveries === 1) throw failure(); return { status: 'resolved', id: 'orders' }; },
    async getItemsPage(_site, list, query, options) {
      assert.equal(list, 'orders'); assert.equal(query, '$expand=fields&$top=100');
      pages.push([options.pageNumber, options.cursor ?? '']);
      if (options.pageNumber === 1) return { items: [{ id: '1', fields: { VALORTOTAL: 10 } }], hasMore: true, nextLink: 'page-2' };
      if (++secondPage === 1) throw failure();
      return { items: [{ id: '2', fields: { VALORTOTAL: 20 } }], hasMore: false };
    },
  } });
  const result = await data.loadSnapshot();
  assert.equal(discoveries, 2);
  assert.deepEqual(pages, [[1, ''], [2, 'page-2'], [2, 'page-2']]);
  assert.deepEqual(result.rows.map(row => [row.id, row.fields.VALORTOTAL]), [['2', 20], ['1', 10]]);
});

for (const [code, status] of [['network_error', 0], ['http_408', 408], ['http_502', 502], ['http_503', 503], ['http_504', 504]]) {
  test(`orders retry one transient snapshot read: ${code}`, async () => {
    let reads = 0;
    const data = createOrdersGalleryData({ repository: {
      async resolveList() { return { status: 'resolved', id: 'orders' }; },
      async getItemsPage() { if (++reads === 1) throw failure(code, status); return { items: [{ id: '7', fields: {} }], hasMore: false }; },
    } });
    assert.deepEqual((await data.loadSnapshot()).rows.map(row => row.id), ['7']);
    assert.equal(reads, 2);
  });
}

test('persistent snapshot failures stop after one retry and never return partial rows', async () => {
  const pages = [], error = failure();
  const data = createOrdersGalleryData({ repository: {
    async resolveList() { return { status: 'resolved', id: 'orders' }; },
    async getItemsPage(_site, _list, _query, options) {
      pages.push(options.pageNumber);
      if (options.pageNumber === 1) return { items: [{ id: '1', fields: {} }], hasMore: true, nextLink: 'page-2' };
      throw error;
    },
  } });
  await assert.rejects(data.loadSnapshot(), value => value === error);
  assert.deepEqual(pages, [1, 2, 2]);
});

for (const [code, status] of [['unauthorized', 401], ['accessDenied', 403], ['badRequest', 400], ['notFound', 404], ['throttled', 429], ['request_aborted', 0], ['invalid_payload', 0]]) {
  test(`orders do not retry authorization, permanent, throttle or cancellation failures: ${code}`, async () => {
    let reads = 0;
    const error = failure(code, status);
    const data = createOrdersGalleryData({ repository: {
      async resolveList() { return { status: 'resolved', id: 'orders' }; },
      async getItemsPage() { reads++; throw error; },
    } });
    await assert.rejects(data.loadSnapshot(), value => value === error);
    assert.equal(reads, 1);
  });
}

test('closing while a snapshot read fails prevents another attempt', async () => {
  const controller = new AbortController(); let reads = 0;
  const data = createOrdersGalleryData({ repository: {
    async resolveList() { return { status: 'resolved', id: 'orders' }; },
    async getItemsPage() { reads++; controller.abort(); throw failure(); },
  } });
  await assert.rejects(data.loadSnapshot({ signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(reads, 1);
});

test('an already-closed gallery performs no discovery or page request', async () => {
  const controller = new AbortController(); controller.abort(); let reads = 0;
  const data = createOrdersGalleryData({ repository: {
    async resolveList() { reads++; return { status: 'resolved', id: 'orders' }; },
    async getItemsPage() { reads++; return { items: [], hasMore: false }; },
  } });
  await assert.rejects(data.loadSnapshot({ signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(reads, 0);
});

test('a cancellation during the final page never publishes a partial snapshot', async () => {
  const controller = new AbortController();
  const data = createOrdersGalleryData({ repository: {
    async resolveList() { return { status: 'resolved', id: 'orders' }; },
    async getItemsPage() { controller.abort(); return { items: [{ id: '9', fields: {} }], hasMore: false }; },
  } });
  await assert.rejects(data.loadSnapshot({ signal: controller.signal }), error => error.name === 'AbortError');
});

test('a session change between attempts cannot send another read', async () => {
  let valid = true, reads = 0;
  const data = createOrdersGalleryData({ assertSession() { if (!valid) throw new Error('Sessão encerrada'); }, repository: {
    async resolveList() { return { status: 'resolved', id: 'orders' }; },
    async getItemsPage() { reads++; valid = false; throw failure(); },
  } });
  await assert.rejects(data.loadSnapshot(), /Sessão encerrada/);
  assert.equal(reads, 1);
});

test('a service Retry-After directive is not bypassed by an immediate snapshot retry', async () => {
  let reads = 0; const error = Object.assign(failure('http_503', 503), { retryAfter: 60 });
  const data = createOrdersGalleryData({ repository: {
    async resolveList() { return { status: 'resolved', id: 'orders' }; },
    async getItemsPage() { reads++; throw error; },
  } });
  await assert.rejects(data.loadSnapshot(), value => value === error);
  assert.equal(reads, 1);
});

test('snapshot recovery never retries an order write', async () => {
  let writes = 0; const error = failure();
  const data = createOrdersGalleryData({ repository: {
    async resolveList() { return { status: 'resolved', id: 'orders' }; },
    async getItemsPage() { return { items: [], hasMore: false }; },
    async getItem() { return { id: '9', eTag: '"version-1"', fields: {} }; },
    async updateItem(_site, _list, id, fields, options) {
      assert.equal(id, '9'); assert.deepEqual(fields, { OBS: 'TESTE' }); assert.equal(options.eTag, '"version-1"');
      writes++; throw error;
    },
  } });
  await assert.rejects(data.updateItem('9', { OBS: 'TESTE' }), value => value === error);
  assert.equal(writes, 1);
});

test('other list snapshots retain their existing failure policy', async () => {
  let reads = 0; const error = failure();
  const data = createOrdersGalleryData({ listName: 'LANCAMENTOS', listAliases: ['LANCAMENTOS'], repository: {
    async resolveList() { return { status: 'resolved', id: 'launches' }; },
    async getItemsPage() { reads++; throw error; },
  } });
  await assert.rejects(data.loadSnapshot(), value => value === error);
  assert.equal(reads, 1);
});

test('orders failure stays in a wrapping alert, hides sorting and recovers through manual retry', async t => {
  const dom = new JSDOM('<main></main>');
  let attempts = 0;
  const gallery = createOrdersGallery({ document: dom.window.document, data: {
    async loadSnapshot() { if (++attempts === 1) throw failure(); return { rows: [{ id: '9', fields: { FORNECEDOR: 'TESTE' }, hasAttachments: false }] }; },
    async listAttachments() { return []; },
  } });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  const root = dom.window.document.querySelector('.og-overlay');
  const alert = root.querySelector('.og-notice[role="alert"]');
  assert.ok(alert && !alert.hidden);
  assert.match(alert.textContent, /Não foi possível carregar pedidos.*Microsoft Graph/);
  assert.equal(root.querySelector('.og-sort-field').hidden, true);
  assert.equal(root.querySelector('.og-list-status').textContent, '');
  const retry = [...root.querySelectorAll('button')].find(button => button.textContent === 'Tentar novamente');
  retry.click();
  for (let attempt = 0; attempt < 10 && !root.querySelector('.og-order-card'); attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 2);
  assert.equal(root.querySelector('.og-notice').hidden, true);
  assert.equal(root.querySelector('.og-sort-field').hidden, false);
  assert.equal(root.querySelector('.og-order-card').dataset.itemId, '9');
});
