import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createTaskCompletionDialog } from '../src/ui/task-completion-dialog.js';
import { createDdaPaymentConfirmation } from '../src/ui/dda-payment-confirmation.js';
import { createDdaProvisionPicker } from '../src/ui/dda-provision-picker.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { await tick(); await tick(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function origin(t) {
  const dom = new JSDOM('<body><main id="gallery"><section id="results"><input value="FILTRO ORIGINAL"><button id="trigger">Editar</button></section></main></body>');
  t.after(() => dom.window.close());
  const doc = dom.window.document, host = doc.querySelector('#gallery'), results = doc.querySelector('#results'), trigger = doc.querySelector('#trigger');
  host.scrollTop = 172; results.scrollTop = 93;
  const focused = [], focus = trigger.focus.bind(trigger);
  trigger.focus = options => { focused.push(options); focus(options); };
  trigger.focus(); focused.length = 0;
  return { dom, doc, host, results, trigger, focused };
}
function backButton(ctx) {
  const back = ctx.host.querySelector('[data-gallery-editor-back]');
  assert.ok(back, 'top-left cancel-to-origin button exists');
  assert.equal(back.textContent, '←');
  assert.equal(back.type, 'button');
  assert.equal(back.getAttribute('aria-label'), 'Voltar à galeria sem salvar');
  assert.ok(back.classList.contains('gallery-editor-back'));
  assert.equal(back.parentElement.className, 'gallery-editor-header');
  assert.equal(back.parentElement.firstElementChild, back);
  return back;
}
function originPreserved(ctx) {
  assert.equal(ctx.doc.querySelector('#results'), ctx.results);
  assert.equal(ctx.results.querySelector('input').value, 'FILTRO ORIGINAL');
  assert.equal(ctx.host.scrollTop, 172);
  assert.equal(ctx.results.scrollTop, 93);
  assert.equal(ctx.doc.activeElement, ctx.trigger);
  assert.deepEqual(ctx.focused.at(-1), { preventScroll: true });
}
function forceClick(ctx, button) {
  button.dispatchEvent(new ctx.dom.window.MouseEvent('click', { bubbles: true }));
}
function taskContext() {
  return { contract: { hasForm: true, readOnly: false }, item: { id: '7', eTag: '"1"', fields: { field_8: '', field_12: 'EM ATENDIMENTO' } },
    columns: [{ name: 'field_8', label: 'DATA CONCLUSÃO', control: 'date', editable: true },
      { name: 'field_12', label: 'CONCLUÍDO', control: 'text', editable: true }] };
}
const dda = { itemId: 31, key: 'fake-dda-31', supplier: 'FORNECEDOR FICTÍCIO', amount: 'R$ 10,00', due: '30/10/2026' };
const provisionRow = { id: '31', supplier: 'FORNECEDOR FICTÍCIO', amount: '10' };
const provisionOptions = [{ id: '20', supplier: 'FORNECEDOR FICTÍCIO', label: 'Descritivo fictício #20', amount: '10', due: '2026-11-02' }];

test('task back discards a changed date without saving and preserves the origin gallery', async t => {
  const ctx = origin(t), context = taskContext(); let saves = 0, changed = 0;
  const dialog = createTaskCompletionDialog({ document: ctx.doc, host: ctx.host,
    data: { loadEditor: async () => context, saveEditor: async () => { saves++; } },
    today: () => '2026-10-30', onChanged: () => { changed++; }, onBlocked() {} });
  t.after(() => dialog.destroy());
  await dialog.open({ id: '7' }, ctx.trigger);
  ctx.host.querySelector('input[name="completionDate"]').value = '2026-11-04';
  backButton(ctx).click();
  assert.equal(ctx.host.querySelector('.tg-completion-dialog'), null);
  assert.equal(saves, 0); assert.equal(changed, 0);
  assert.equal(context.item.fields.field_8, '');
  originPreserved(ctx);
});

test('task back is disabled and guarded during save, then available after failure', async t => {
  const ctx = origin(t), pending = deferred(), context = taskContext(); let saves = 0, changed = 0, signal;
  const dialog = createTaskCompletionDialog({ document: ctx.doc, host: ctx.host,
    data: { loadEditor: async (_id, options) => { signal ||= options?.signal; return context; },
      saveEditor: async () => { saves++; return pending.promise; } },
    today: () => '2026-10-30', onChanged: () => { changed++; }, onBlocked() {} });
  t.after(() => dialog.destroy());
  await dialog.open({ id: '7' }, ctx.trigger);
  const back = backButton(ctx);
  ctx.host.querySelector('[data-task-completion-form]').dispatchEvent(new ctx.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(saves, 1); assert.equal(back.disabled, true);
  forceClick(ctx, back);
  assert.ok(ctx.host.querySelector('.tg-completion-dialog')); assert.equal(signal.aborted, false);
  pending.reject(new Error('Falha fictícia')); await settle();
  assert.equal(back.disabled, false); assert.equal(changed, 0);
  back.click(); originPreserved(ctx); assert.equal(saves, 1);
});

test('DDA payment back cancels an unconfirmed payment without callbacks and preserves the origin', t => {
  const ctx = origin(t); let writes = 0, confirmed = 0, closed = 0;
  const dialog = createDdaPaymentConfirmation({ document: ctx.doc, host: ctx.host,
    confirmPayment: async () => { writes++; }, onConfirmed: () => { confirmed++; }, onClose: () => { closed++; } });
  t.after(() => dialog.destroy()); dialog.show(dda, ctx.trigger);
  backButton(ctx).click();
  assert.equal(dialog.isOpen, false); assert.equal(writes, 0); assert.equal(confirmed, 0); assert.equal(closed, 1);
  assert.equal(ctx.results.inert, false); originPreserved(ctx);
});

test('DDA payment back cannot force-close an in-flight confirmation and recovers after failure', async t => {
  const ctx = origin(t), pending = deferred(); let writes = 0, confirmed = 0, closed = 0, signal;
  const dialog = createDdaPaymentConfirmation({ document: ctx.doc, host: ctx.host,
    confirmPayment: options => { writes++; signal = options.signal; return pending.promise; },
    onConfirmed: () => { confirmed++; }, onClose: () => { closed++; } });
  t.after(() => dialog.destroy()); dialog.show(dda, ctx.trigger);
  const back = backButton(ctx); ctx.host.querySelector('[data-dda-payment-yes]').click();
  assert.equal(writes, 1); assert.equal(back.disabled, true);
  forceClick(ctx, back);
  assert.equal(dialog.isOpen, true); assert.equal(signal.aborted, false); assert.equal(closed, 0);
  pending.reject(new Error('Falha fictícia')); await settle();
  assert.equal(back.disabled, false); assert.equal(confirmed, 0);
  back.click(); assert.equal(dialog.isOpen, false); assert.equal(closed, 1); originPreserved(ctx);
});

test('DDA provision back discards a selected link and search without saving', async t => {
  const ctx = origin(t); let writes = 0, linked = 0, signal;
  const dialog = createDdaProvisionPicker({ document: ctx.doc, host: ctx.host,
    service: { loadOptions: async options => { signal = options.signal; return provisionOptions; }, save: async () => { writes++; } },
    onLinked: () => { linked++; } });
  t.after(() => dialog.destroy()); await dialog.show(provisionRow, ctx.trigger);
  const search = ctx.host.querySelector('.dda-provision-search'); search.value = 'fictício';
  search.dispatchEvent(new ctx.dom.window.Event('input', { bubbles: true }));
  ctx.host.querySelector('input[type="radio"]').click();
  assert.equal(ctx.host.querySelector('.dda-provision-save').disabled, false);
  backButton(ctx).click();
  assert.equal(dialog.isOpen, false); assert.equal(signal.aborted, true);
  assert.equal(writes, 0); assert.equal(linked, 0); assert.equal(ctx.results.inert, false); originPreserved(ctx);
});

test('DDA provision back is disabled and guarded while linking, then recovers after failure', async t => {
  const ctx = origin(t), pending = deferred(); let writes = 0, linked = 0, signal;
  const dialog = createDdaProvisionPicker({ document: ctx.doc, host: ctx.host,
    service: { loadOptions: async () => provisionOptions, save: options => { writes++; signal = options.signal; return pending.promise; } },
    onLinked: () => { linked++; } });
  t.after(() => dialog.destroy()); await dialog.show(provisionRow, ctx.trigger);
  const back = backButton(ctx); ctx.host.querySelector('input[type="radio"]').click();
  ctx.host.querySelector('.dda-provision-save').click();
  assert.equal(writes, 1); assert.equal(back.disabled, true);
  forceClick(ctx, back);
  assert.equal(dialog.isOpen, true); assert.equal(signal.aborted, false);
  pending.reject(new Error('Falha fictícia')); await settle();
  assert.equal(back.disabled, false); assert.equal(linked, 0);
  back.click(); assert.equal(dialog.isOpen, false); assert.equal(writes, 1); originPreserved(ctx);
});
