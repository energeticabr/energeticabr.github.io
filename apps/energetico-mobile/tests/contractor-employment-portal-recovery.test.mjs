import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { persistEntityRecord } from '../../../portal/forms/entity-submit.js';
import { createItemDetailPage } from '../../../portal/ui/item-detail.js';
import { ENTITIES } from '../../../portal/catalog/entities.js';
import { syntheticTransport } from './helpers/contractor-employment-transport.mjs';
const entity = ENTITIES.find(e => e.id === 'fornecedores');
const list = { id: 'source' };
const tick = () => new Promise(resolve => setImmediate(resolve));
test('actual portal mixed conflict review shows the individually read stored and pending names before renewal', async t => {
  const f = syntheticTransport(); f.failSource('unknown');
  await assert.rejects(persistEntityRecord(f.repository, entity, list, {
    mode: 'edit', item: structuredClone(f.source), fields: { STATUS: 'INATIVO', Title: 'REQUESTED TITLE', DATADESLIGAMENTO: '2026-02-20' },
  }), error => error.code === 'CONTRACTOR_EMPLOYMENT_PARTIAL');
  f.failSource(''); f.source.fields.STATUS = 'INATIVO'; f.source.eTag = '"9"';
  const dom = new JSDOM('<main></main>'), root = dom.window.document.querySelector('main');
  const page = createItemDetailPage(root, { entity, itemId: '17', repository: f.repository, can: () => true });
  t.after(() => { page.cleanup(); dom.window.close(); });
  await page.ready;
  const readsBeforeReview = f.calls.length;
  root.querySelector('[data-contractor-review]').click(); await tick();
  assert.match(root.querySelector('[data-contractor-conflict]').textContent, /SYNTHETIC SOURCE NAME/);
  assert.match(root.querySelector('[data-contractor-conflict]').textContent, /REQUESTED TITLE/);
  const sourceReads = f.calls.slice(readsBeforeReview).filter(call => call.path.includes('/source/items/17'));
  assert.ok(sourceReads.length > 0);
  assert.ok(sourceReads.every(call => call.query.get('$expand') === 'fields($select=STATUS,EMPREITEIRO,Title)'));
  const writesBeforeRenewal = f.writes.length;
  root.querySelector('[data-contractor-renew]').click(); await tick();
  assert.equal(f.writes.length, writesBeforeRenewal);
  root.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick(); await tick();
  assert.equal(f.source.fields.Title, 'REQUESTED TITLE');
  assert.equal(f.target.fields.STATUS, 'INATIVO'); assert.equal(f.storage.entries.size, 0);
});
test('actual portal source 412 recovery does not use the generic full-source conflict reload', async t => {
  const f = syntheticTransport(), dom = new JSDOM('<main></main>'), root = dom.window.document.querySelector('main');
  const page = createItemDetailPage(root, { entity, itemId: '17', repository: f.repository, can: () => true });
  t.after(() => { page.cleanup(); dom.window.close(); });
  await page.ready;
  const fullSourceReads = () => f.calls.filter(c => c.path.includes('/source/items/17') && c.options.method === 'GET' && c.query.get('$expand') === 'fields').length;
  const initialReads = fullSourceReads();
  root.querySelector('[data-item-edit]').click();
  const statusInput = root.querySelector('[aria-controls="field-STATUS-listbox"]');
  statusInput.focus(); statusInput.value = 'INATIVO';
  statusInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  [...root.querySelectorAll('#field-STATUS-listbox [role="option"]')].find(option => option.textContent === 'INATIVO').click();
  f.failSource('412');
  root.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
  const prompt = dom.window.document.querySelector('dialog form');
  assert.ok(prompt, root.textContent);
  prompt.querySelector('input').value = '2026-02-20';
  prompt.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick(); await tick();
  assert.ok(root.querySelector('[data-contractor-review]'));
  assert.equal(fullSourceReads(), initialReads);
});
test('recreated actual portal exposes source/target 412 review and renews the original discharge intent', async t => {
  const f = syntheticTransport(); f.failTarget('412');
  await assert.rejects(persistEntityRecord(f.repository, entity, list, {
    mode: 'edit', item: structuredClone(f.source), fields: { STATUS: 'INATIVO', DATADESLIGAMENTO: '2026-02-20' },
  }), error => error.code === 'CONTRACTOR_EMPLOYMENT_PARTIAL');
  f.source.fields.Title = 'CONCURRENT SOURCE NAME';
  f.source.eTag = '"9"';
  const dom = new JSDOM('<main></main>'), root = dom.window.document.querySelector('main');
  const page = createItemDetailPage(root, { entity, itemId: '17', repository: f.repository, can: () => true });
  t.after(() => { page.cleanup(); dom.window.close(); });
  await page.ready;
  const review = root.querySelector('[data-contractor-review]');
  assert.ok(review, 'actual item detail must expose the durable pending lifecycle');
  review.click(); await tick(); await tick();
  assert.match(root.querySelector('[data-contractor-conflict]').textContent, /INATIVO/);
  assert.match(root.querySelector('[data-contractor-conflict]').textContent, /2026-02-20/);
  const before = f.writes.length;
  root.querySelector('[data-contractor-renew]').click(); await tick();
  assert.equal(f.writes.length, before, 'review and renewal cannot mutate SharePoint');
  const form = root.querySelector('form');
  assert.ok(form);
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick(); await tick();
  assert.equal(f.target.fields.STATUS, 'INATIVO', root.textContent);
  assert.equal(f.target.fields.DATADESLIGAMENTO, '2026-02-20');
  assert.equal(f.target.fields.FILIAL, 'Concurrent branch');
  assert.equal(f.source.fields.Title, 'CONCURRENT SOURCE NAME');
  assert.deepEqual(f.writes.map(w => w.list), ['source', 'target', 'target']);
});
test('supplier retry after a recreated repository reuses the durable date and never repeats confirmed source STATUS', async () => {
  const f = syntheticTransport(); f.failTarget('unknown');
  await assert.rejects(persistEntityRecord(f.repository, entity, list, { mode: 'edit', item: structuredClone(f.source),
    fields: { STATUS: 'INATIVO', DATADESLIGAMENTO: '2026-02-20' } }), error => error.code === 'CONTRACTOR_EMPLOYMENT_PARTIAL');
  f.failTarget('');
  const recreated = { ...f.repository };
  await persistEntityRecord(recreated, entity, list, { mode: 'edit', item: structuredClone(f.source), fields: { STATUS: 'INATIVO' } });
  assert.deepEqual(f.writes.map(w => w.list), ['source', 'target', 'target']);
  assert.equal(f.target.fields.DATADESLIGAMENTO, '2026-02-20');
});
