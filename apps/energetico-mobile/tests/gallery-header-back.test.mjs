import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { galleryCases, galleryOptions } from './helpers/gallery-create-cases.mjs';
import { dismissGalleryOverlay } from '../src/ui/gallery-record-actions.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const editorContext = id => ({
  entity: { id: 'header-back-test', title: 'Registro' },
  columns: [{ name: 'Title', label: 'Título', control: 'text', editable: true }],
  item: { id, fields: { Title: 'Original' } }, contract: { hasForm: true, readOnly: false },
});

async function setup(t, name, overrides = {}) {
  const entry = galleryCases.find(item => item.name === name);
  const dom = new JSDOM('<button id="origin">Origem</button><main>Menu anterior</main>', { url: 'https://example.test' });
  const document = dom.window.document;
  const previousFormData = globalThis.FormData;
  globalThis.FormData = dom.window.FormData;
  const counters = { close: 0, home: 0, writes: 0 };
  const loadEditor = overrides.loadEditor || (async id => editorContext(id));
  const saveEditor = overrides.saveEditor || (async () => { counters.writes++; return {}; });
  const fields = { ID: 42, Title: 'Original', STATUS: 'ATIVO', FORNECEDOR: 'TESTE', PRODUTO: 'TESTE',
    MESREFERENCIA: '10/2026', EQUIPAMENTO: 'TESTE', QTD: 1, 'VALOR TOTAL': 10 };
  const rows = [{ id: '42', ...fields, fields, hasAttachments: false }];
  const snapshot = { rows, count: 1, page: 1, pages: 1, fields: [], totals: {}, filterOptions: {} };
  const data = { loadSnapshot: async () => snapshot, loadEditor, saveEditor, ...overrides.data };
  const gallery = entry.factory(galleryOptions(entry, document, {
    snapshot, data, loadEditor, saveEditor,
    request: async () => ({ ...snapshot, gallery: entry.options?.gallery }),
    onClose: () => counters.close++, onHome: () => counters.home++,
    ...overrides, data,
  }));
  t.after(() => { gallery.destroy(); dom.window.close(); globalThis.FormData = previousFormData; });
  await gallery.open();
  const root = document.querySelector(entry.root);
  const back = () => root.querySelector('.screen-navigation').firstElementChild.click();
  return { dom, document, root, back, gallery, counters };
}

for (const name of ['orders', 'tasks', 'payments', 'recurring', 'group', 'assetProduct', 'IDFOLHA', 'FOLHAPGTO']) {
  test(`${name}: header Back dismisses the editor before the gallery without saving`, async t => {
    const ctx = await setup(t, name);
    const pencil = ctx.root.querySelector('[data-gallery-action="edit"]');
    assert.ok(pencil, 'actual record editor is reachable');
    pencil.click(); await settle(); await settle();
    const input = ctx.root.querySelector('[name="Title"]');
    assert.ok(input, 'the editor has loaded'); input.value = 'Unsaved draft';
    ctx.back();
    assert.equal(ctx.root.hidden, false);
    assert.equal(ctx.root.querySelector('[data-gallery-record-dialog]'), null);
    assert.equal(ctx.document.activeElement, pencil);
    assert.deepEqual(ctx.counters, { close: 0, home: 0, writes: 0 });
    ctx.back();
    assert.equal(ctx.root.hidden, true, 'only the next Back exits the gallery');
    assert.equal(ctx.counters.home, 0);
  });
}

test('header Back during editor acquisition aborts only that read and ignores its late result', async t => {
  const pending = deferred(); let signal;
  const ctx = await setup(t, 'orders', { loadEditor: (_id, options) => { signal = options.signal; return pending.promise; } });
  ctx.root.querySelector('[data-gallery-action="edit"]').click();
  assert.equal(signal.aborted, false);
  ctx.back();
  assert.equal(signal.aborted, true);
  assert.equal(ctx.root.hidden, false);
  pending.resolve(editorContext('42')); await settle();
  assert.equal(ctx.root.querySelector('[data-gallery-record-dialog]'), null);
  assert.deepEqual(ctx.counters, { close: 0, home: 0, writes: 0 });
});

for (const name of ['orders', 'tasks', 'payments', 'recurring', 'group', 'assetProduct', 'IDFOLHA', 'FOLHAPGTO']) {
  test(`${name}: header Back cannot dismiss or abort an in-flight editor save`, async t => {
    const pending = deferred(); let signal, saves = 0;
    t.after(() => pending.resolve({}));
    const ctx = await setup(t, name, { saveEditor: (_context, _fields, options) => { signal = options.signal; saves++; return pending.promise; } });
    ctx.root.querySelector('[data-gallery-action="edit"]').click(); await settle(); await settle();
    const form = ctx.root.querySelector('[data-gallery-record-dialog] form');
    ctx.root.querySelector('[name="Title"]').value = 'Changed';
    form.dispatchEvent(new ctx.dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    assert.equal(saves, 1);
    ctx.back();
    assert.equal(signal.aborted, false);
    assert.equal(ctx.root.hidden, false);
    assert.ok(ctx.root.querySelector('[data-gallery-record-dialog]'));
    assert.equal(ctx.counters.close, 0);
    pending.resolve({}); await settle(); await settle();
    assert.ok(ctx.root.querySelector('[data-gallery-edit-success]'));
    ctx.back();
    assert.equal(ctx.root.hidden, false);
    assert.equal(ctx.root.querySelector('[data-gallery-record-dialog]'), null);
    assert.equal(saves, 1);
  });
}

test('local overlay Escape cannot reenter outer navigation when its busy handler does not stop propagation', t => {
  const dom = new JSDOM('<section id="gallery"><div class="gallery-record-overlay" aria-busy="true"></div></section>');
  t.after(() => dom.window.close());
  const root = dom.window.document.querySelector('#gallery');
  const overlay = root.firstElementChild;
  let escapes = 0, outerNavigation = 0;
  overlay.addEventListener('keydown', () => { escapes++; });
  root.addEventListener('keydown', () => { outerNavigation++; root.hidden = true; });
  assert.equal(dismissGalleryOverlay(root), true);
  assert.equal(escapes, 1);
  assert.equal(outerNavigation, 0);
  assert.equal(root.hidden, false);
  assert.equal(overlay.isConnected, true);
});

test('header Back cancels a delete confirmation without deleting or leaving the gallery', async t => {
  const ctx = await setup(t, 'group');
  ctx.root.querySelector('[data-gallery-action="delete"]').click();
  assert.ok(ctx.root.querySelector('[data-gallery-confirm="yes"]'));
  ctx.back();
  assert.equal(ctx.root.hidden, false);
  assert.equal(ctx.root.querySelector('[data-gallery-record-dialog]'), null);
  assert.deepEqual(ctx.counters, { close: 0, home: 0, writes: 0 });
});

test('orders: header Back cancels the nested linked-report read before dismissing its parent editor', async t => {
  const pending = deferred(); let signal;
  const ctx = await setup(t, 'orders', { data: { loadLinkedReport: (_id, options) => { signal = options.signal; return pending.promise; } } });
  ctx.root.querySelector('[data-gallery-action="edit"]').click(); await settle(); await settle();
  const editor = ctx.root.querySelector('[data-gallery-record-dialog]');
  const trigger = ctx.root.querySelector('[data-order-linked-report]');
  trigger.click();
  const detail = ctx.root.querySelector('.og-detail');
  assert.equal(detail.hidden, false);
  ctx.back();
  assert.equal(detail.hidden, true);
  assert.equal(signal.aborted, true);
  assert.equal(editor.isConnected, true, 'Back preserves the report origin editor');
  assert.equal(ctx.document.activeElement, trigger);
  assert.equal(ctx.root.hidden, false);
  pending.resolve({ orderId: '42' }); await settle();
  assert.equal(detail.hidden, true, 'late report cannot reopen');
  ctx.back();
  assert.equal(editor.isConnected, false);
  assert.equal(ctx.root.hidden, false);
});

test('IDFOLHA: header Back closes only its report and aborts the pending query', async t => {
  const pending = deferred(); let signal;
  const ctx = await setup(t, 'IDFOLHA', { requestReport: (_id, options) => { signal = options.signal; return pending.promise; } });
  ctx.root.querySelector('[data-action="open-payroll-report"]').click();
  await settle();
  const report = ctx.document.querySelector('.hr-payroll-report-backdrop');
  assert.equal(report.hidden, false);
  ctx.back();
  assert.equal(report.hidden, true);
  assert.equal(signal.aborted, true);
  assert.equal(ctx.root.hidden, false);
  assert.equal(ctx.counters.close, 0);
  pending.resolve([]); await settle();
  assert.equal(report.hidden, true);
});

test('FOLHAPGTO: header Back cancels its payment composer without leaving the gallery', async t => {
  const pending = deferred(); let signal;
  const ctx = await setup(t, 'FOLHAPGTO', {
    loadPaymentOptions: options => { signal = options.signal; return pending.promise; },
    savePayment: async () => { throw new Error('Back must never save a payment'); },
  });
  ctx.root.querySelector('[data-gallery-create]').click();
  assert.ok(ctx.root.querySelector('[data-payroll-payment-screen]'));
  ctx.back();
  assert.equal(ctx.root.hidden, false);
  assert.equal(signal.aborted, true);
  assert.equal(ctx.root.querySelector('[data-payroll-payment-screen]'), null);
  assert.equal(ctx.counters.close, 0);
  pending.resolve({ launches: [], sheets: [], paymentTypes: [] }); await settle();
  assert.equal(ctx.root.querySelector('[data-payroll-payment-screen]'), null);
});

test('tasks: header Back cancels the completion dialog without saving or closing the gallery', async t => {
  const pending = deferred(); let signal;
  const ctx = await setup(t, 'tasks', { loadEditor: (_id, options) => { signal = options.signal; return pending.promise; } });
  ctx.root.querySelector('[data-action="complete"]').click();
  assert.ok(ctx.root.querySelector('.tg-completion-overlay'));
  ctx.back();
  assert.equal(signal.aborted, true);
  assert.equal(ctx.root.hidden, false);
  assert.equal(ctx.root.querySelector('.tg-completion-overlay'), null);
  pending.resolve(editorContext('42')); await settle();
  assert.deepEqual(ctx.counters, { close: 0, home: 0, writes: 0 });
});
