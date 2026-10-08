import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { galleryCases, galleryOptions, registrationKinds } from './helpers/gallery-create-cases.mjs';
import { REGISTRATION_GALLERY_MODELS } from '../src/chat/registration-gallery-data.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function setup(t, entry, overrides = {}) {
  const dom = new JSDOM('<button id="origin">Open gallery</button>', { url: 'https://example.test' });
  dom.window.document.querySelector('#origin').focus();
  const gallery = entry.factory(galleryOptions(entry, dom.window.document, overrides));
  t.after(() => { gallery.destroy(); dom.window.close(); });
  return { dom, gallery, root: () => dom.window.document.querySelector(entry.root) };
}
function shortcut(ctx) {
  const button = ctx.root().querySelector('[data-gallery-create], [data-action="create-task"]');
  assert.ok(button, 'visible creation shortcut exists');
  return button;
}
function forceClick(ctx, button) {
  button.dispatchEvent(new ctx.dom.window.MouseEvent('click', { bubbles: true }));
}

test('FOLHAPGTO reuses its native + beside Filters without a callback and prevents duplicate composer opens', async t => {
  const entry = galleryCases.find(entry => entry.name === 'FOLHAPGTO');
  const read = deferred(); let optionsReads = 0;
  const ctx = setup(t, entry, {
    request: () => read.promise,
    loadPaymentOptions: async () => { optionsReads++; return { launches: [], sheets: [], paymentTypes: [] }; },
    savePayment: () => assert.fail('creation tests never save records'),
  });
  const opening = ctx.gallery.open();
  const add = ctx.root().querySelector('[data-action="add-payroll-payment"]');
  assert.ok(add);
  assert.equal(add.closest('header'), null, 'existing button moved out of header');
  assert.equal(add.previousElementSibling.dataset.action, 'toggle-payroll-filters');
  assert.equal(ctx.root().querySelectorAll('.hr-gallery-add-payment').length, 1);
  assert.equal(add.getAttribute('aria-label'), 'Acrescentar pagamento');
  assert.equal(add.disabled, true);
  forceClick(ctx, add); assert.equal(optionsReads, 0);
  read.resolve({ gallery: 'FOLHAPGTO', page: 1, rows: [], hasMore: false }); await opening;
  add.click(); add.click(); forceClick(ctx, add); await settle();
  assert.equal(optionsReads, 1);
  assert.equal(ctx.root().hidden, false, 'native composer remains hosted by the gallery');
  assert.equal(ctx.root().querySelectorAll('[data-payroll-payment-screen]').length, 1);
  ctx.root().querySelector('[data-payment-cancel]').click(); await settle();
  assert.equal(add.disabled, false);
  ctx.gallery.close(); forceClick(ctx, add); assert.equal(optionsReads, 1);
  ctx.gallery.destroy(); forceClick(ctx, add); assert.equal(optionsReads, 1);
});

test('FOLHAPGTO native selector invokes onCreate before using any composer fallback', async t => {
  const entry = galleryCases.find(entry => entry.name === 'FOLHAPGTO'); let creates = 0;
  const ctx = setup(t, entry, {
    onCreate: () => { assert.equal(ctx.root().hidden, true); creates++; },
    loadPaymentOptions: () => assert.fail('onCreate takes precedence'),
    savePayment: () => assert.fail('creation tests never save records'),
  });
  await ctx.gallery.open();
  const add = ctx.root().querySelector('[data-action="add-payroll-payment"]');
  assert.ok(add); add.click(); add.click(); await settle();
  assert.equal(creates, 1);
  assert.equal(ctx.root().querySelector('[data-payroll-payment-screen]'), null);
});

test('creation coverage includes every registration kind', () => {
  assert.deepEqual(registrationKinds.sort(), Object.keys(REGISTRATION_GALLERY_MODELS).sort());
});

for (const entry of galleryCases) {
  test(`${entry.name}: visible + follows Filters and closes before one callback; reopen works`, async t => {
    const events = [];
    const ctx = setup(t, entry, { onCreate: () => {
      assert.equal(ctx.root().hidden, true, 'close completes before callback');
      events.push('create');
    } });
    await ctx.gallery.open();
    const button = shortcut(ctx), filter = button.previousElementSibling;
    assert.equal(button.type, 'button');
    assert.equal(button.textContent, '+');
    assert.match(button.getAttribute('aria-label'), /(?:Adicionar|Acrescentar).+(?:tarefa|pedido|lançamento|pagamento|despesa|registro)/i);
    assert.equal(button.title, button.getAttribute('aria-label'));
    assert.equal(button.closest('details'), null, '+ cannot be buried in a closed disclosure');
    assert.equal(filter.tagName, 'BUTTON');
    assert.match(filter.textContent, /Filtros/);
    assert.equal(button.disabled, false);
    const disclosure = ctx.root().querySelector('details'), panel = disclosure || ctx.root().querySelector('.re-filter-panel, .hr-gallery-filter-panel');
    assert.equal(filter.getAttribute('aria-expanded'), 'false');
    filter.click();
    assert.equal(filter.getAttribute('aria-expanded'), 'true');
    assert.equal(disclosure ? disclosure.open : panel.hidden, disclosure ? true : false);
    assert.equal(button.previousElementSibling, filter);
    button.click(); button.click(); forceClick(ctx, button);
    assert.deepEqual(events, ['create']);
    await ctx.gallery.open();
    button.click();
    assert.deepEqual(events, ['create', 'create']);
  });

  test(`${entry.name}: missing callback stays disabled after loading and filtering`, async t => {
    const ctx = setup(t, entry);
    await ctx.gallery.open();
    const button = shortcut(ctx);
    assert.equal(button.disabled, true);
    button.previousElementSibling.click();
    await settle();
    assert.equal(button.disabled, true);
    forceClick(ctx, button);
    assert.equal(ctx.root().hidden, false);
  });

  test(`${entry.name}: loading, closed, and destroyed views ignore even dispatched clicks`, async t => {
    const read = deferred(); let creates = 0;
    const result = { rows: [], page: 1, pages: 1, hasMore: false, gallery: entry.options?.gallery };
    const ctx = setup(t, entry, { onCreate: () => { creates++; },
      data: { loadSnapshot: () => read.promise }, request: () => read.promise });
    const opening = ctx.gallery.open();
    const button = shortcut(ctx);
    assert.equal(button.disabled, true, 'loading disables the shortcut synchronously');
    button.click(); forceClick(ctx, button);
    assert.equal(creates, 0);
    read.resolve(result); await opening;
    assert.equal(button.disabled, false);
    ctx.gallery.close();
    assert.equal(button.disabled, true);
    forceClick(ctx, button);
    await ctx.gallery.open();
    ctx.gallery.destroy();
    assert.equal(button.disabled, true);
    forceClick(ctx, button);
    assert.equal(creates, 0);
  });

  if (REGISTRATION_GALLERY_MODELS[entry.options?.kind]?.readOnly) {
    test(`${entry.name}: read-only parent has no isolated edit/delete but + starts the linked creation flow`, async t => {
      let creates = 0;
      const ctx = setup(t, entry, {
        onCreate: () => { creates++; },
        snapshot: { rows: [{ id: '7', fields: { FORNECEDOR: 'Fornecedor', VALORTOTAL: '100' } }] },
      });
      await ctx.gallery.open();
      assert.equal(ctx.root().querySelector('[data-gallery-action]'), null);
      shortcut(ctx).click();
      await settle();
      assert.equal(creates, 1);
      assert.equal(ctx.root().hidden, true);
    });
    continue;
  }

  test(`${entry.name}: pending record deletion blocks creation and does not close the gallery`, async t => {
    const mutation = deferred(); let creates = 0;
    const status = { tasks: 'EM ATENDIMENTO', measurementLines: 'PENDENTE PGTO', stageDemonstratives: 'ATIVIDADE INICIADA', constructionStages: 'INICIADO' }[entry.name] || 'ATIVO';
    const row = { id: '7', hasAttachments: false, fields: { STATUS: status, TAREFA: 'Example',
      CONCLUÍDO: 'EM ATENDIMENTO', TIPO: 'ATIVIDADE COMUM', Modified: '2026-10-07T12:00:00Z' } };
    const result = { rows: [row], page: 1, pages: 1, gallery: entry.options?.gallery, hasMore: false };
    const ctx = setup(t, entry, { onCreate: () => { creates++; },
      deleteItem: () => mutation.promise,
      data: { loadSnapshot: async () => result, deleteItem: () => mutation.promise },
      request: async operation => operation === 'delete' ? mutation.promise : result });
    await ctx.gallery.open();
    const button = shortcut(ctx), remove = ctx.root().querySelector('[data-gallery-action="delete"]');
    assert.ok(remove, 'record deletion trigger rendered');
    remove.click(); await settle();
    const confirm = ctx.root().querySelector('[data-gallery-confirm="yes"]')
      || [...ctx.dom.window.document.querySelectorAll('.lg-review button')].find(node => /Confirmar/.test(node.textContent));
    assert.ok(confirm, 'confirmation uses the actual gallery UI');
    confirm.click(); await settle();
    assert.equal(button.disabled, true);
    forceClick(ctx, button);
    assert.equal(creates, 0);
    assert.equal(ctx.root().hidden, false);
    ctx.gallery.close(); await ctx.gallery.open();
    assert.equal(button.disabled, true, 'reopening cannot bypass an unfinished mutation');
    forceClick(ctx, button);
    assert.equal(creates, 0);
    mutation.resolve({}); await settle(); await settle();
    assert.equal(button.disabled, false, 'mutation completion restores creation');
    ctx.gallery.close();
  });
}
