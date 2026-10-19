import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createLaunchGallery } from '../src/ui/launch-gallery-view.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
function snapshot(id = 17, overrides = {}) {
  return { rows: [{ id, hasAttachments: false, fields: { FORNECEDOR: `Fornecedor ${id}` } }],
    count: 1, page: 1, pages: 3, pageSize: 20, totals: { paid: id },
    filterOptions: { supplier: ['Mauro'] }, ...overrides };
}
function setup(t) {
  const dom = new JSDOM('<body></body>');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  dom.window.setTimeout = globalThis.setTimeout;
  dom.window.clearTimeout = globalThis.clearTimeout;
  const pending = [];
  const gallery = createLaunchGallery({ document: dom.window.document, request: (operation, payload) => {
    assert.equal(operation, 'snapshot');
    return new Promise((resolve, reject) => pending.push({ payload, resolve, reject }));
  } });
  const root = dom.window.document.querySelector('.lg-overlay');
  const search = root.querySelector('[data-gallery-quick-search]');
  t.after(() => { gallery.destroy(); dom.window.close(); });
  const type = value => {
    search.value = value;
    search.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }));
  };
  const tick = async (ms = 180) => { t.mock.timers.tick(ms); await settle(); };
  const rows = () => [...root.querySelectorAll('.lg-cards > [data-item-id]')].map(node => node.dataset.itemId);
  async function open() {
    const opening = gallery.open(); pending.at(-1).resolve(snapshot()); await opening;
  }
  return { dom, gallery, root, search, pending, type, tick, rows, open };
}
function assertInteractive(ctx) {
  assert.equal(ctx.root.querySelector('.gallery-loading-screen').hidden, true);
  for (let node = ctx.search; node && node !== ctx.root; node = node.parentElement) {
    assert.notEqual(node.inert, true, 'search ancestors remain interactive');
    assert.notEqual(node.getAttribute('aria-hidden'), 'true');
  }
  assert.equal(ctx.search.disabled, false);
  assert.equal(ctx.dom.window.document.activeElement, ctx.search);
}

test('launch search preserves cards, focus and caret during network filtering of the complete dataset', async t => {
  const ctx = setup(t); await ctx.open();
  ctx.root.querySelector('[name="supplier"]').value = 'Mauro';
  ctx.search.focus(); ctx.type('Mauro central'); ctx.search.setSelectionRange(3, 7);
  const card = ctx.root.querySelector('.lg-record');
  const status = ctx.root.querySelector('.lg-list-status').textContent;
  await ctx.tick();
  assert.equal(ctx.pending.length, 2);
  assert.equal(ctx.pending[1].payload.filters.search, 'Mauro central');
  assert.equal(ctx.pending[1].payload.filters.supplier, 'Mauro');
  assert.equal(ctx.pending[1].payload.page, 1);
  assert.equal(ctx.pending[1].payload.pageSize, 20);
  assertInteractive(ctx);
  assert.equal(ctx.root.querySelector('.lg-list-status').textContent, status,
    'typing does not replace the result count with a loading/searching message');
  assert.equal(ctx.root.querySelector('.lg-record'), card);
  assert.equal(ctx.search.selectionStart, 3); assert.equal(ctx.search.selectionEnd, 7);
  ctx.pending[1].resolve(snapshot(901)); await settle();
  assert.deepEqual(ctx.rows(), ['901'], 'server can return a match absent from the current page');
  assertInteractive(ctx);
  assert.equal(ctx.search.selectionStart, 3); assert.equal(ctx.search.selectionEnd, 7);
});

test('focus, click and unchanged input do not reload launch data', async t => {
  const ctx = setup(t); await ctx.open();
  ctx.search.focus(); ctx.search.click(); ctx.type('');
  ctx.search.dispatchEvent(new ctx.dom.window.Event('search'));
  ctx.search.dispatchEvent(new ctx.dom.window.Event('change', { bubbles: true }));
  await ctx.tick(500);
  assert.equal(ctx.pending.length, 1);
  assertInteractive(ctx); assert.deepEqual(ctx.rows(), ['17']);
});

test('typing debounces and suppresses an older response even before the newest query is sent', async t => {
  const ctx = setup(t); await ctx.open();
  ctx.type('a'); await ctx.tick(100); ctx.type('ab'); await ctx.tick(179);
  assert.equal(ctx.pending.length, 1);
  await ctx.tick(1); assert.equal(ctx.pending.length, 2);
  ctx.type('abc'); ctx.pending[1].resolve(snapshot(18)); await settle();
  assert.deepEqual(ctx.rows(), ['17'], 'a response for ab cannot replace cards while abc is being typed');
  await ctx.tick();
  assert.equal(ctx.pending[2].payload.filters.search, 'abc');
  ctx.type('abcd'); await ctx.tick();
  ctx.pending[3].resolve(snapshot(901)); await settle();
  ctx.pending[2].resolve(snapshot(19)); await settle();
  assert.deepEqual(ctx.rows(), ['901']);
  assert.match(ctx.root.querySelector('.lg-totals').textContent, /901/);
  assert.equal(ctx.root.getAttribute('aria-busy'), 'false');
});

test('search errors preserve usable cards and retry without taking the search focus', async t => {
  const ctx = setup(t); await ctx.open();
  ctx.search.focus(); ctx.type('new'); await ctx.tick();
  ctx.pending[1].reject(new Error('Offline')); await settle();
  assert.deepEqual(ctx.rows(), ['17']); assertInteractive(ctx);
  assert.match(ctx.root.querySelector('.lg-list-status').textContent, /Offline/);
  const retry = ctx.root.querySelector('.lg-list-status button');
  retry.click(); await settle();
  assert.equal(ctx.pending[2].payload.filters.search, 'new'); assertInteractive(ctx);
  ctx.pending[2].resolve(snapshot(901)); await settle();
  assert.deepEqual(ctx.rows(), ['901']); assert.equal(ctx.root.querySelector('.lg-list-status button'), null);
});

test('returning to a discarded query still reloads its results', async t => {
  const ctx = setup(t); await ctx.open();
  ctx.type('ab'); await ctx.tick(); ctx.type('abc');
  ctx.pending[1].resolve(snapshot(18)); await settle();
  ctx.type('ab'); await ctx.tick();
  assert.equal(ctx.pending.length, 3, 'discarded results must not count as an applied query');
  ctx.pending[2].resolve(snapshot(901)); await settle();
  assert.deepEqual(ctx.rows(), ['901']);
});

test('retry after a page failure keeps the requested page', async t => {
  const ctx = setup(t); await ctx.open();
  [...ctx.root.querySelectorAll('.lg-pagination button')].find(node => node.textContent === 'Próxima página').click();
  ctx.pending[1].reject(new Error('Offline')); await settle();
  ctx.root.querySelector('.lg-list-status button').click();
  assert.equal(ctx.pending[2].payload.page, 2);
  ctx.pending[2].resolve(snapshot(901, { page: 2 })); await settle();
  assert.match(ctx.root.querySelector('.lg-pagination').textContent, /Página 2 de 3/);
});

test('a superseded failure cannot replace newer launch results or leave a retry', async t => {
  const ctx = setup(t); await ctx.open();
  ctx.type('old'); await ctx.tick(); ctx.type('new'); await ctx.tick();
  ctx.pending[2].resolve(snapshot(901)); await settle();
  ctx.pending[1].reject(new Error('obsolete')); await settle();
  assert.deepEqual(ctx.rows(), ['901']);
  assert.doesNotMatch(ctx.root.querySelector('.lg-list-status').textContent, /obsolete/);
  assert.equal(ctx.root.getAttribute('aria-busy'), 'false');
});

test('initial opening and explicit refresh retain the blocking loader', async t => {
  const ctx = setup(t);
  const opening = ctx.gallery.open();
  assert.equal(ctx.root.querySelector('.gallery-loading-screen').hidden, false);
  ctx.pending[0].resolve(snapshot()); await opening;
  ctx.root.querySelector('[data-gallery-refresh]').click();
  assert.equal(ctx.pending[1].payload.refresh, true);
  assert.equal(ctx.root.querySelector('.gallery-loading-screen').hidden, false);
  ctx.pending[1].resolve(snapshot(901)); await settle();
  assert.equal(ctx.root.querySelector('.gallery-loading-screen').hidden, true);
});

for (const action of ['close', 'destroy']) test(`pending launch search ignores completion after ${action}`, async t => {
  const ctx = setup(t); await ctx.open();
  ctx.type('new'); await ctx.tick(); ctx.gallery[action]();
  const before = ctx.root.innerHTML;
  ctx.pending[1].resolve(snapshot(901)); await settle();
  assert.equal(ctx.root.innerHTML, before);
});
