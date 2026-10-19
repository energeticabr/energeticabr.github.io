import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createTasksGallery } from '../src/ui/tasks-gallery-view.js';

async function setup(t, rows = [
  { id: '100', fields: { TAREFA: 'Obra A', STATUS: 'EM ATENDIMENTO', field_7: '2026-10-01', Criado: '2026-09-01T12:00:00Z' } },
  { id: '300', fields: { TAREFA: 'Obra B', STATUS: 'EM ATENDIMENTO', field_7: '2026-10-03', Criado: '2026-09-02T12:00:00Z' } },
  { id: '200', fields: { TAREFA: 'Obra C', STATUS: 'EM ATENDIMENTO', field_7: '2026-10-02', Criado: '2026-09-03T12:00:00Z' } },
  { id: '400', fields: { TAREFA: 'Obra concluída', field_8: '2026-09-30' } },
  { id: '500', fields: { TAREFA: 'Outro assunto' } },
]) {
  const dom = new JSDOM('<button id="outside">Anterior</button>', { url: 'https://example.test' });
  const doc = dom.window.document;
  let loads = 0;
  const gallery = createTasksGallery({ document: doc, data: {
    loadSnapshot: async () => { loads++; return { rows }; },
  } });
  doc.querySelector('#outside').focus();
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  const root = doc.querySelector('.tg-overlay');
  const trigger = root.querySelector('.tg-sort-toggle');
  const open = () => { assert.ok(trigger, 'icon-only sort shortcut must exist'); trigger.focus(); trigger.click(); return root.querySelector('.tg-sort-dialog'); };
  return { dom, doc, root, gallery, trigger, open, loads: () => loads,
    ids: () => [...root.querySelectorAll('.tg-card')].map(card => card.dataset.itemId) };
}

test('sort icon sits between search and filters and opens the existing three ordering choices', async t => {
  const ctx = await setup(t);
  assert.ok(ctx.trigger, 'toolbar needs a sort icon');
  assert.equal(ctx.trigger.previousElementSibling, ctx.root.querySelector('[data-gallery-quick-search]'));
  assert.equal(ctx.trigger.nextElementSibling, ctx.root.querySelector('.tg-filter-toggle'));
  assert.equal(ctx.trigger.getAttribute('aria-label'), 'Ordenar tarefas');
  assert.equal(ctx.trigger.getAttribute('aria-haspopup'), 'dialog');
  assert.doesNotMatch(ctx.trigger.textContent, /ordenar/i);
  const dialog = ctx.open();
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.deepEqual([...dialog.querySelectorAll('[data-sort-value]')].map(button => [button.dataset.sortValue, button.textContent]), [
    ['fatal-asc', 'Data fatal (mais próxima)'], ['id-desc', 'ID (maior primeiro)'], ['created-desc', 'Criação (mais recente)'],
  ]);
  assert.equal(dialog.querySelector('[aria-pressed="true"]').dataset.sortValue, 'fatal-asc');
  assert.equal(ctx.trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(ctx.root.querySelector('.tg-filters').open, false);
});

test('popup sorts the searched and filtered snapshot without another request and stays in sync with old filters', async t => {
  const ctx = await setup(t);
  const input = ctx.root.querySelector('[name="search"]'), status = ctx.root.querySelector('[name="status"]');
  input.value = 'Obra';
  input.dispatchEvent(new ctx.dom.window.Event('change', { bubbles: true }));
  status.value = 'EM ATENDIMENTO';
  status.dispatchEvent(new ctx.dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(ctx.ids(), ['100', '200', '300']);
  for (const [value, ids] of [
    ['id-desc', ['300', '200', '100']], ['created-desc', ['200', '300', '100']], ['fatal-asc', ['100', '200', '300']],
  ]) {
    const dialog = ctx.open();
    dialog.querySelector(`[data-sort-value="${value}"]`).click();
    assert.equal(ctx.root.querySelector('.tg-sort-dialog'), null);
    assert.deepEqual(ctx.ids(), ids);
    assert.equal(input.value, 'Obra');
    assert.equal(status.value, 'EM ATENDIMENTO');
    assert.equal(ctx.root.querySelector('[name="sort"]').value, value);
    assert.equal(ctx.doc.activeElement, ctx.trigger);
    assert.equal(ctx.trigger.getAttribute('aria-expanded'), 'false');
  }
  const native = ctx.root.querySelector('[name="sort"]');
  native.value = 'created-desc'; native.dispatchEvent(new ctx.dom.window.Event('change', { bubbles: true }));
  assert.equal(ctx.open().querySelector('[aria-pressed="true"]').dataset.sortValue, 'created-desc');
  assert.equal(ctx.loads(), 1, 'sorting must not refetch the gallery');
});

test('sorting covers all pages, resets page one and survives reload', async t => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: String(i + 1),
    fields: { TAREFA: 'Tarefa ' + (i + 1), Criado: '2026-09-' + String(25 - i).padStart(2, '0') + 'T12:00:00Z' } }));
  const ctx = await setup(t, rows);
  ctx.root.querySelector('.og-pagination button:last-child').click();
  assert.match(ctx.root.querySelector('.og-page-label').textContent, /2 de 3/);
  ctx.open().querySelector('[data-sort-value="created-desc"]').click();
  assert.deepEqual(ctx.ids(), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  assert.match(ctx.root.querySelector('.og-page-label').textContent, /1 de 3/);
  await ctx.gallery.reload();
  assert.deepEqual(ctx.ids(), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  assert.equal(ctx.open().querySelector('[aria-pressed="true"]').dataset.sortValue, 'created-desc');
});

test('popup traps focus, closes on escape/cancel/backdrop and restores background without changing order', async t => {
  const ctx = await setup(t);
  for (const way of ['escape', 'cancel', 'backdrop']) {
    const dialog = ctx.open();
    const choices = [...dialog.querySelectorAll('button')], first = choices[0], last = choices.at(-1);
    assert.equal(ctx.root.querySelector('.og-content').inert, true);
    assert.equal(ctx.root.querySelector('.og-header').inert, true);
    assert.equal(ctx.doc.activeElement, first);
    last.focus();
    last.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.equal(ctx.doc.activeElement, first);
    first.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    assert.equal(ctx.doc.activeElement, last);
    ctx.doc.querySelector('#outside').focus();
    assert.ok(dialog.contains(ctx.doc.activeElement), 'focus cannot escape to underlying app');
    if (way === 'escape') dialog.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    else if (way === 'cancel') dialog.querySelector('[data-task-sort-cancel]').click();
    else dialog.parentElement.click();
    assert.equal(ctx.root.querySelector('.tg-sort-dialog'), null);
    assert.equal(ctx.root.querySelector('.og-content').inert, false);
    assert.equal(ctx.root.querySelector('.og-header').inert, false);
    assert.equal(ctx.doc.activeElement, ctx.trigger);
    assert.equal(ctx.root.querySelector('[name="sort"]').value, 'fatal-asc');
  }
});

test('opening and cancelling sorting does not discard a pending search debounce', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ctx = await setup(t);
  const input = ctx.root.querySelector('[name="search"]');
  input.value = 'Obra C';
  input.dispatchEvent(new ctx.dom.window.Event('input', { bubbles: true }));
  ctx.open().querySelector('[data-task-sort-cancel]').click();
  t.mock.timers.tick(181);
  assert.deepEqual(ctx.ids(), ['200']);
});

test('closing/reloading/destroying gallery tears down sort popup and focus guard', async t => {
  const ctx = await setup(t);
  ctx.open(); await ctx.gallery.reload();
  assert.equal(ctx.root.querySelector('.tg-sort-dialog'), null);
  ctx.open(); ctx.gallery.close();
  assert.equal(ctx.doc.querySelector('.tg-sort-dialog'), null);
  assert.equal(ctx.doc.activeElement.id, 'outside');
  await ctx.gallery.open(); ctx.open(); ctx.gallery.destroy();
  assert.equal(ctx.doc.querySelector('.tg-sort-dialog'), null);
  ctx.doc.querySelector('#outside').focus();
  assert.equal(ctx.doc.activeElement.id, 'outside');
});

test('sort button stays disabled until the complete snapshot is available', async t => {
  const dom = new JSDOM('<main></main>'), doc = dom.window.document;
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const gallery = createTasksGallery({ document: doc, data: { loadSnapshot: () => pending } });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  const opening = gallery.open();
  const button = doc.querySelector('.tg-sort-toggle');
  assert.ok(button);
  assert.equal(button.disabled, true);
  button.click();
  assert.equal(doc.querySelector('.tg-sort-dialog'), null);
  finish({ rows: [] }); await opening;
  assert.equal(button.disabled, false);
  button.click();
  assert.ok(doc.querySelector('.tg-sort-dialog'));
});
