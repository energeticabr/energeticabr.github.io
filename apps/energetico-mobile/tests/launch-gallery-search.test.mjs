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
  const tick = async (ms = 0) => { t.mock.timers.tick(ms); await settle(); };
  const rows = () => [...root.querySelectorAll('.lg-cards > [data-item-id]')].map(node => node.dataset.itemId);
  async function open() {
    const opening = gallery.open(); pending.at(-1).resolve(snapshot()); await opening;
  }
  return { dom, gallery, root, search, pending, type, tick, rows, open };
}
function assertInteractive(ctx) {
  assert.equal(ctx.root.querySelector('.gallery-loading-screen').hidden, true);
  assert.equal(ctx.root.querySelector('.gallery-loading-screen--scoped').hidden, true);
  for (let node = ctx.search; node && node !== ctx.root; node = node.parentElement) {
    assert.notEqual(node.inert, true, 'search ancestors remain interactive');
    assert.notEqual(node.getAttribute('aria-hidden'), 'true');
  }
  assert.equal(ctx.search.disabled, false);
  assert.equal(ctx.dom.window.document.activeElement, ctx.search);
}

function assertRecalculating(ctx) {
  const screen = ctx.root.querySelector('.gallery-loading-screen--scoped');
  assert.ok(screen, 'recalculation has a results-only loader');
  assert.equal(screen.hidden, false, 'old gallery stays covered until the current filter finishes');
  assert.match(screen.textContent, /Recalculando a galeria/);
  assert.ok(screen.querySelector('.app-loading__mascot'));
  assert.equal(ctx.root.getAttribute('aria-busy'), 'true');
  assert.notEqual(ctx.root.querySelector('.lg-content').inert, true);
  assert.equal(ctx.root.querySelector('.lg-cards').inert, true);
  assert.equal(ctx.root.querySelector(':scope > .gallery-loading-screen').hidden, true);
  assert.equal(ctx.search.closest('[inert], [aria-hidden="true"]'), null);
}

test('launch search covers preserved cards until filtered results and totals are rendered', async t => {
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
  assertRecalculating(ctx);
  assert.equal(ctx.dom.window.document.activeElement, ctx.search, 'recalculation never takes typing focus');
  assert.equal(ctx.root.querySelector('[data-gallery-quick-search]'), ctx.search, 'search DOM is not rebuilt');
  assert.equal(ctx.root.querySelector('.lg-list-status').textContent, status,
    'typing does not replace the result count with a loading/searching message');
  assert.equal(ctx.root.querySelector('.lg-record'), card);
  assert.equal(ctx.search.selectionStart, 3); assert.equal(ctx.search.selectionEnd, 7);
  ctx.pending[1].resolve(snapshot(901)); await settle();
  assert.deepEqual(ctx.rows(), ['901'], 'server can return a match absent from the current page');
  assert.match(ctx.root.querySelector('.lg-totals').textContent, /901/);
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

test('typing continuously searches and suppresses an older response before the newest input is applied', async t => {
  const ctx = setup(t); await ctx.open();
  ctx.type('a'); await ctx.tick();
  assert.equal(ctx.pending[1].payload.filters.search, 'a');
  ctx.type('ab'); await ctx.tick();
  assert.equal(ctx.pending[2].payload.filters.search, 'ab');
  ctx.type('abc'); ctx.pending[2].resolve(snapshot(18)); await settle();
  assert.deepEqual(ctx.rows(), ['17'], 'a response for ab cannot replace cards while abc is being typed');
  assertRecalculating(ctx);
  await ctx.tick();
  assert.equal(ctx.pending[3].payload.filters.search, 'abc');
  ctx.type('abcd'); await ctx.tick();
  ctx.pending[4].resolve(snapshot(901)); await settle();
  ctx.pending[3].resolve(snapshot(19)); ctx.pending[1].reject(new Error('obsolete')); await settle();
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
  assert.equal(ctx.pending[2].payload.filters.search, 'new'); assertRecalculating(ctx);
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

test('a superseded success cannot uncover the newest pending launch search', async t => {
  const ctx = setup(t); await ctx.open();
  ctx.type('old'); await ctx.tick(); ctx.type('new'); await ctx.tick();
  ctx.pending[1].resolve(snapshot(18)); await settle();
  assertRecalculating(ctx);
  ctx.pending[2].resolve(snapshot(901)); await settle();
  assert.deepEqual(ctx.rows(), ['901']);
  assert.doesNotMatch(ctx.root.querySelector('.lg-list-status').textContent, /obsolete/);
  assert.equal(ctx.root.getAttribute('aria-busy'), 'false');
});

test('a superseded failure cannot uncover the newest pending search or leave a retry', async t => {
  const ctx = setup(t); await ctx.open();
  ctx.type('old'); await ctx.tick(); ctx.type('new'); await ctx.tick();
  ctx.pending[1].reject(new Error('obsolete')); await settle();
  assertRecalculating(ctx);
  ctx.pending[2].resolve(snapshot(901)); await settle();
  assert.deepEqual(ctx.rows(), ['901']);
  assert.doesNotMatch(ctx.root.querySelector('.lg-list-status').textContent, /obsolete/);
  assert.equal(ctx.root.getAttribute('aria-busy'), 'false');
});

for (const [name, value, event] of [['id', '349', 'input'], ['supplier', 'Mauro', 'change'],
  ['pendingApproval', true, 'change'], ['dateStart', '2026-10-01', 'change'], ['sort', 'ID crescente', 'change']]) {
  test(`launch ${name} filter shows the mascot until the filtered gallery is ready`, async t => {
    const ctx = setup(t); await ctx.open();
    const control = ctx.root.querySelector(`[name="${name}"]`);
    if (control.type === 'checkbox') control.checked = value;
    else if (control.tagName === 'SELECT' && name === 'sort') control.selectedIndex = 1;
    else control.value = value;
    control.dispatchEvent(new ctx.dom.window.Event(event, { bubbles: true }));
    if (event === 'input') await ctx.tick();
    assert.equal(ctx.pending.length, 2);
    assertRecalculating(ctx);
    ctx.pending[1].resolve(snapshot(901, { rows: [], count: 0, totals: { paid: 0 } })); await settle();
    assert.equal(ctx.root.querySelector('.gallery-loading-screen').hidden, true);
    assert.match(ctx.root.querySelector('.lg-list-status').textContent, /Nenhum lançamento/);
    assert.equal(ctx.root.getAttribute('aria-busy'), 'false');
  });
}

test('invalid dates release a pending loader and cannot publish an older result', async t => {
  const ctx = setup(t); await ctx.open();
  ctx.type('new'); await ctx.tick();
  const start = ctx.root.querySelector('[name="dateStart"]'), end = ctx.root.querySelector('[name="dateEnd"]');
  start.value = '2026-10-20'; end.value = '2026-10-01';
  end.dispatchEvent(new ctx.dom.window.Event('change', { bubbles: true }));
  assert.equal(ctx.root.querySelector('.gallery-loading-screen').hidden, true);
  assert.equal(ctx.root.getAttribute('aria-busy'), 'false');
  assert.match(ctx.root.querySelector('.lg-notice').textContent, /A data final/);
  ctx.pending[1].resolve(snapshot(901)); await settle();
  assert.deepEqual(ctx.rows(), ['17']);
});

test('pagination after an invalid date range releases the loader when no filter is queued', async t => {
  const ctx = setup(t); await ctx.open();
  const start = ctx.root.querySelector('[name="dateStart"]'), end = ctx.root.querySelector('[name="dateEnd"]');
  start.value = '2026-10-20';
  start.dispatchEvent(new ctx.dom.window.Event('change', { bubbles: true }));
  ctx.pending[1].resolve(snapshot()); await settle();
  end.value = '2026-10-01';
  end.dispatchEvent(new ctx.dom.window.Event('change', { bubbles: true }));
  [...ctx.root.querySelectorAll('.lg-pagination button')].find(node => node.textContent === 'Próxima página').click();
  assert.equal(ctx.pending[2].payload.page, 2);
  ctx.pending[2].resolve(snapshot(901, { page: 2 })); await settle();
  assert.equal(ctx.root.querySelector('.gallery-loading-screen').hidden, true);
  assert.equal(ctx.root.getAttribute('aria-busy'), 'false');
  assert.deepEqual(ctx.rows(), ['901']);
});

test('finishing a search does not steal focus after navigation with Tab', async t => {
  const ctx = setup(t); await ctx.open();
  ctx.search.focus(); ctx.type('new'); await ctx.tick();
  const back = ctx.root.querySelector(':scope > header button');
  back.focus();
  back.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  ctx.pending[1].resolve(snapshot(901)); await settle();
  assert.equal(ctx.dom.window.document.activeElement, back);
  assert.equal(ctx.root.querySelector('.gallery-loading-screen').hidden, true);
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

for (const event of ['change', 'search']) test(`native text ${event} deduplicates input and applies clearing without a pause`, async t => {
  const ctx = setup(t); await ctx.open();
  ctx.search.focus(); ctx.type('Ma');
  ctx.search.dispatchEvent(new ctx.dom.window.Event(event, { bubbles: true }));
  await ctx.tick();
  assert.equal(ctx.pending.length, 2);
  assert.equal(ctx.pending[1].payload.filters.search, 'Ma');
  assertRecalculating(ctx);
  ctx.pending[1].resolve(snapshot(901)); await settle();
  ctx.search.value = '';
  ctx.search.dispatchEvent(new ctx.dom.window.Event(event, { bubbles: true }));
  ctx.search.dispatchEvent(new ctx.dom.window.InputEvent('input', { bubbles: true }));
  await ctx.tick();
  assert.equal(ctx.pending.length, 3);
  assert.equal(ctx.pending[2].payload.filters.search, '');
  ctx.pending[2].resolve(snapshot()); await settle();
  assertInteractive(ctx);
});

test('typing another query while the local loader is active preserves the new caret and controls', async t => {
  const ctx = setup(t); await ctx.open();
  const toolbar = ctx.search.parentElement;
  ctx.search.focus(); ctx.type('Ma'); await ctx.tick();
  ctx.type('Mauro'); ctx.search.setSelectionRange(1, 4); await ctx.tick();
  assert.equal(ctx.pending.length, 3);
  ctx.pending[1].resolve(snapshot(18)); await settle();
  assert.deepEqual(ctx.rows(), ['17']); assertRecalculating(ctx);
  const filters = ctx.root.querySelector('.gallery-filter-button'); filters.click();
  assert.equal(ctx.root.querySelector('.lg-filters').open, true);
  assert.equal(ctx.search.parentElement, toolbar);
  assert.equal(ctx.root.querySelector('.lg-filter-form').closest('[inert]'), null);
  ctx.pending[2].resolve(snapshot(901)); await settle();
  assertInteractive(ctx);
  assert.deepEqual([ctx.search.selectionStart, ctx.search.selectionEnd], [1, 4]);
});

for (const action of ['close', 'destroy']) test(`${action} cancels a search before the next event-loop turn`, async t => {
  const ctx = setup(t); await ctx.open();
  ctx.type('Mauro'); ctx.gallery[action](); await ctx.tick(5000);
  assert.equal(ctx.pending.length, 1);
});

test('local loading relocates focus from controls that are about to become inert or disabled', async t => {
  const ctx = setup(t); await ctx.open();
  for (const selector of ['.lg-record [data-gallery-action="edit"]', '[data-gallery-refresh]']) {
    ctx.type(selector); const control = ctx.root.querySelector(selector); control.focus(); await ctx.tick();
    assert.equal(ctx.dom.window.document.activeElement, ctx.search);
    ctx.pending.at(-1).resolve(snapshot()); await settle();
  }
});

test('pending global search preserves an active supplier filter edit through loading and option refresh', async t => {
  const ctx = setup(t); await ctx.open();
  ctx.type('central');
  ctx.root.querySelector('.gallery-filter-button').click();
  const picker = ctx.root.querySelector('[name="supplier"]').nextElementSibling;
  const combo = picker.querySelector('.sfs-search'); combo.click();
  combo.value = 'Mau'; combo.dispatchEvent(new ctx.dom.window.Event('input', { bubbles: true }));
  combo.setSelectionRange(1, 2); await ctx.tick();
  const preserved = () => {
    assert.equal(combo.value, 'Mau'); assert.equal(combo.getAttribute('aria-expanded'), 'true');
    assert.equal(picker.querySelector('.sfs-popup').hidden, false);
    assert.equal(ctx.dom.window.document.activeElement, combo);
    assert.deepEqual([combo.selectionStart, combo.selectionEnd], [1, 2]);
  };
  assert.equal(ctx.pending.length, 2); preserved();
  ctx.pending[1].resolve(snapshot(901, { filterOptions: { supplier: ['Mauro', 'Outro fornecedor'] } }));
  await settle(); preserved();
});

for (const action of ['close', 'destroy']) test(`pending launch search ignores completion after ${action}`, async t => {
  const ctx = setup(t); await ctx.open();
  ctx.type('new'); await ctx.tick(); ctx.gallery[action]();
  const before = ctx.root.innerHTML;
  ctx.pending[1].resolve(snapshot(901)); await settle();
  assert.equal(ctx.root.innerHTML, before);
});
