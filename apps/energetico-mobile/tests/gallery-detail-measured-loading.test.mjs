import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createLaunchGallery } from '../src/ui/launch-gallery-view.js';
import { createOrdersGallery } from '../src/ui/orders-gallery-view.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const launch = (id = '901', fields = {}) => ({ id, hasAttachments: false, attachmentCount: 0,
  fields: { ID: id, FORNECEDOR: 'Fornecedor QA', DATA: '2026-10-01', QUANTIDADE: 1, 'VALOR UNITÁRIO': 10, PRODUTO: 'Cimento', ...fields } });
const snapshot = rows => ({ rows, pages: 1, page: 1, count: rows.length });
const badge = root => root.querySelector('.app-loading [role=progressbar]');
const percent = node => Number(node.getAttribute('aria-valuenow'));
function launchSetup(t, options = {}) {
  const dom = new JSDOM('<main></main>');
  const view = createLaunchGallery({ document: dom.window.document, ...options });
  t.after(() => { view.destroy(); dom.window.close(); });
  return { view, root: dom.window.document.querySelector('.lg-overlay') };
}

test('launch editor receives in-flight acquisition progress and completes after accepted form rendering', async t => {
  const pending = deferred(); let options;
  const { view, root } = launchSetup(t, { request: (operation, _payload, input) => {
    if (operation === 'snapshot') return snapshot([launch()]);
    options = input; return pending.promise;
  } });
  t.after(() => pending.resolve({ item: launch(), editFields: [] }));
  await view.open(); root.querySelector('[data-gallery-action=edit]').click();
  const loader = badge(root.querySelector('.lg-detail-modal:not(.lg-cluster-modal)'));
  assert.equal(percent(loader), 33);
  options.onProgress({ percent: 50 }); assert.equal(percent(loader), 50);
  options.onProgress({ percent: 100 }); assert.equal(percent(loader), 66);
  pending.resolve({ item: launch(), attachments: [], editFields: [{ name: 'QUANTIDADE', label: 'Quantidade', type: 'number' }] });
  await settle();
  assert.equal(percent(loader), 100);
  assert.ok(root.querySelector('.lg-detail-modal input[name=QUANTIDADE]'));
});

test('supplier cluster measures real declared pages while keeping its completed list mask independent', async t => {
  const pages = [deferred(), deferred(), deferred()], options = [];
  const { view, root } = launchSetup(t, { request: (operation, payload, input) => {
    assert.equal(operation, 'snapshot');
    if (!payload.filters?.supplier) return snapshot([launch()]);
    options[payload.page - 1] = input; return pages[payload.page - 1].promise;
  } });
  t.after(() => pages.forEach(page => page.resolve({ rows: [], pages: 3 })));
  await view.open(); const mask = badge(root.querySelector('.gallery-loading-screen'));
  root.querySelector('[data-cluster-kind=supplier]').click();
  const loader = badge(root.querySelector('.lg-cluster-modal'));
  assert.equal(percent(loader), 33);
  assert.equal(typeof options[0].onProgress, 'function');
  options[0].onProgress({ percent: 50 });
  assert.ok(percent(loader) > 33 && percent(loader) < 66);
  pages[0].resolve({ rows: [launch('901')], pages: 3 }); await settle();
  const first = percent(loader);
  options[1].onProgress({ percent: 50 });
  assert.ok(percent(loader) > first && percent(loader) < 66);
  pages[1].resolve({ rows: [launch('902')], pages: 3 }); await settle();
  assert.ok(percent(loader) < 66, 'third declared page remains outstanding');
  assert.equal(percent(mask), 100, 'the completed gallery request never owns cluster progress');
  pages[2].resolve({ rows: [launch('903')], pages: 3 }); await settle();
  assert.equal(percent(loader), 100);
  assert.match(root.querySelector('.lg-cluster-modal').textContent, /903/);
});

test('order cluster aggregates its two sources and sparse-record hydration before declaring success', async t => {
  const order = deferred(), links = deferred(), hydrate = deferred(); let orderOptions, linkOptions, detailOptions;
  const { view, root } = launchSetup(t, {
    request: (operation, _payload, options) => {
      if (operation === 'snapshot') return snapshot([launch('901', { AGRUPAR: '42' })]);
      detailOptions = options; return hydrate.promise;
    },
    loadOrderSnapshot: options => { orderOptions = options; return order.promise; },
    loadLaunchGroup: (_id, options) => { linkOptions = options; return links.promise; },
  });
  t.after(() => { order.resolve({ rows: [] }); links.resolve([]); hydrate.resolve({ item: launch() }); });
  await view.open(); root.querySelector('[data-cluster-kind=order]').click();
  const loader = badge(root.querySelector('.lg-cluster-modal'));
  assert.equal(percent(loader), 33);
  orderOptions.onProgress({ percent: 50 }); assert.equal(percent(loader), 38);
  linkOptions.onProgress({ percent: 50 }); assert.equal(percent(loader), 44);
  order.resolve({ rows: [{ id: '42', fields: { VALORTOTAL: 10 } }] });
  links.resolve([{ id: '901', fields: { AGRUPAR: '42' } }]); await settle();
  assert.ok(percent(loader) < 66, 'sparse record details still need to arrive');
  detailOptions.onProgress({ percent: 50 }); assert.ok(percent(loader) > 55 && percent(loader) < 66);
  hydrate.resolve({ item: launch('901', { AGRUPAR: '42' }) }); await settle();
  assert.equal(percent(loader), 100);
  assert.ok(root.querySelector('.lg-cluster-table'));
});

test('linked-order detail progress cannot affect its list or complete after closing', async t => {
  const dom = new JSDOM('<main></main>'), pending = deferred(); let options;
  const view = createOrdersGallery({ document: dom.window.document, data: {
    loadSnapshot: async () => ({ rows: [launch()] }),
    loadEditor: async id => ({ entity: { id: 'orders' }, item: { id, fields: { Title: 'QA' } },
      columns: [{ name: 'Title', control: 'text', editable: true }], contract: { hasForm: true } }),
    loadLinkedReport: (_id, input) => { options = input; return pending.promise; },
  } });
  t.after(() => { pending.resolve({ orderId: '901' }); view.destroy(); dom.window.close(); });
  await view.open(); const root = dom.window.document.querySelector('.og-overlay');
  const mask = badge(root.querySelector('.gallery-loading-screen'));
  root.querySelector('[data-gallery-action=edit]').click();
  root.querySelector('[data-order-linked-report]').click();
  const detail = root.querySelector('.og-detail'), loader = badge(detail);
  assert.equal(percent(loader), 33);
  options.onProgress({ percent: 50 }); assert.equal(percent(loader), 50);
  assert.equal(percent(mask), 100);
  detail.querySelector('button').click();
  assert.equal(options.signal.aborted, true);
  options.onProgress({ percent: 100 }); pending.resolve({ orderId: '901' }); await settle();
  assert.equal(percent(loader), 50);
  assert.equal(detail.hidden, true);
});
