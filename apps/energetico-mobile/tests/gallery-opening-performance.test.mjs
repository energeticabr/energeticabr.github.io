import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { galleryCases, galleryOptions } from './helpers/gallery-create-cases.mjs';
import { loadingRow } from './helpers/gallery-loading-cases.mjs';
import { getRegistrationGalleryFilterSource } from '../src/chat/registration-gallery-filter-data.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const cases = galleryCases.filter(entry => entry.name === 'tasks'
  || ['asset', 'workDiary', 'contracts', 'recurringTasks', 'provisionDescription'].includes(entry.name));

for (const entry of cases) {
  test(`${entry.name}: complete records are usable without waiting for auxiliary catalogs`, async t => {
    const dom = new JSDOM('<main></main>'), catalog = deferred(), snapshot = deferred();
    let catalogReads = 0, opened = false;
    const gallery = entry.factory(galleryOptions(entry, dom.window.document, { data: {
      loadSnapshot: () => snapshot.promise,
      getFilterSource: field => getRegistrationGalleryFilterSource(entry.name, field),
      loadFilterOptions: () => { catalogReads++; return catalog.promise; },
    } }));
    t.after(() => { gallery.destroy(); dom.window.close(); });
    const opening = gallery.open().then(() => { opened = true; });
    await settle();
    assert.ok(catalogReads > 0, 'catalog requests start alongside the records, not after them');
    const root = dom.window.document.querySelector(entry.root);
    assert.equal(root.dataset.galleryLoading, 'true', 'partial record lists remain blocked');
    const row = loadingRow(entry);
    if (entry.name === 'provisionDescription') row.fields.STATUS = 'PAGAMENTO PREVISTO';
    snapshot.resolve({ rows: [row] });
    await settle(); await settle();
    assert.equal(root.dataset.galleryLoading, 'false', 'slow catalog must not keep the record loader visible');
    assert.equal(root.getAttribute('aria-busy'), 'false');
    assert.ok(root.querySelector('[data-item-id="901"], [data-row-id="901"], .rg-row'), 'complete records are rendered');
    assert.equal(opened, true, 'navigation is released even if a catalog is still pending');
    const control = entry.name === 'tasks' ? root.querySelector('[name="supplier"]')
      : root.querySelector('[data-filter-field="FILIAL"]');
    assert.equal(control.disabled, true);
    assert.equal(control.getAttribute('aria-busy'), 'true', 'only the unfinished filter is loading');
    catalog.resolve([{ value: 'QA', label: 'QA' }]);
    await opening; await settle(); await settle();
    assert.notEqual(control.getAttribute('aria-busy'), 'true');
    assert.equal(control.disabled, false);
  });
}

for (const entry of cases) {
  test(`${entry.name}: late catalogs from a closed gallery cannot replace the new filter choices`, async t => {
    const dom = new JSDOM('<main></main>'), old = deferred();
    let fresh = false;
    const gallery = entry.factory(galleryOptions(entry, dom.window.document, { data: {
      loadSnapshot: async () => ({ rows: [] }),
      getFilterSource: field => getRegistrationGalleryFilterSource(entry.name, field),
      loadFilterOptions: () => fresh ? Promise.resolve([{ value: 'CURRENT', label: 'CURRENT' }]) : old.promise,
    } }));
    t.after(() => { gallery.destroy(); dom.window.close(); });
    const opening = gallery.open(); await settle();
    gallery.close(); fresh = true;
    const reopening = gallery.open(); await settle(); await settle();
    old.resolve([{ value: 'STALE', label: 'STALE' }]);
    await Promise.all([opening, reopening]); await settle();
    const root = dom.window.document.querySelector(entry.root);
    const control = root.querySelector(entry.name === 'tasks' ? '[name="supplier"]' : '[data-filter-field="FILIAL"]');
    assert.ok([...control.options].some(option => option.value === 'CURRENT'));
    assert.ok(![...control.options].some(option => option.value === 'STALE'));
    assert.equal(control.disabled, false);
    assert.equal(root.dataset.galleryLoading, 'false');
  });
}

test('refresh keeps the selected supplier active while its auxiliary catalog is pending or fails', async t => {
  const dom = new JSDOM('<main></main>'), pending = deferred();
  let refreshing = false, reads = 0;
  const entry = cases.find(entry => entry.name === 'tasks');
  const gallery = entry.factory(galleryOptions(entry, dom.window.document, { data: {
    loadSnapshot: async () => { reads++; return { rows: [
      { id: '901', fields: { TAREFA: 'Selected', REFERENTE: 'QA', STATUS: 'EM ATENDIMENTO' } },
      { id: '902', fields: { TAREFA: 'Other', REFERENTE: 'OTHER', STATUS: 'EM ATENDIMENTO' } },
    ] }; },
    loadFilterOptions: () => refreshing ? pending.promise : Promise.resolve([{ value: 'QA', label: 'QA' }]),
  } }));
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open(); await settle();
  const root = dom.window.document.querySelector(entry.root), control = root.querySelector('[name="supplier"]');
  control.value = 'QA'; control.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  refreshing = true;
  const refresh = gallery.reload(); await settle();
  assert.equal(control.value, 'QA');
  assert.deepEqual([...root.querySelectorAll('.tg-card')].map(card => card.dataset.itemId), ['901']);
  assert.equal(root.dataset.galleryLoading, 'false');
  pending.reject(new Error('Catalog unavailable')); await refresh; await settle();
  assert.equal(control.value, 'QA');
  assert.equal(reads, 2);
  assert.equal(control.disabled, true);
  assert.match(root.querySelector('.tg-supplier-notice').textContent, /Catalog unavailable/);
});
