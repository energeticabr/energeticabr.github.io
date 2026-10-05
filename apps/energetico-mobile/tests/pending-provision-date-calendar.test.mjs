import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatView } from '../src/ui/chat-view.js';

function editor(t, overrides = {}) {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root);
  t.after(() => { view.destroy(); dom.window.close(); });
  view.render({ sessionStatus: 'authenticated', account: { name: 'Teste', username: 'teste@example.com' },
    messages: [], pendingFiles: [], draft: '',
    pendingProvisions: { due: true, rows: [{ id: '314', supplier: 'Fornecedor de teste', dueDate: '2026-10-06T01:00:00Z' }] },
    pendingProvisionDateEditPaymentId: '314', ...overrides });
  return { dom, root, view, field: root.querySelector('[data-role="pending-provision-due-date"]') };
}

test('vencimento oferece calendário nativo com o mesmo dia brasileiro da provisão', t => {
  const { field } = editor(t);
  assert.equal(field.type, 'date');
  assert.equal(field.value, '2026-10-05');
  assert.equal(field.getAttribute('inputmode'), null);
});

test('tocar no campo solicita calendário e salvar envia o dia escolhido para a provisão certa', t => {
  const { dom, root, view, field } = editor(t, { pendingProvisionDateEditValue: '05/10/2026' });
  const saved = [];
  view.on('save-pending-provision-due-date', command => saved.push(command));
  // jsdom has no native picker; substitute only that browser boundary.
  let opens = 0;
  field.showPicker = () => { opens++; };
  const tap = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
  field.dispatchEvent(tap);
  assert.equal(opens, 1);
  assert.equal(tap.defaultPrevented, false, 'preserva o seletor padrão no WebView');
  field.value = '2026-10-09';
  field.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }));
  field.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(field.value, '2026-10-09');
  assert.deepEqual(saved, [], 'escolher não grava sem Salvar');
  root.querySelector('[data-action="save-pending-provision-due-date"]').click();
  assert.deepEqual(saved.map(({ paymentId, value }) => ({ paymentId, value })), [
    { paymentId: '314', value: '09/10/2026' },
  ]);
});

test('calendário indisponível mantém a interação nativa e cancelar não envia vencimento', t => {
  const { dom, root, view, field } = editor(t);
  const saved = [], cancelled = [];
  view.on('save-pending-provision-due-date', command => saved.push(command));
  view.on('cancel-pending-provision-date-edit', command => cancelled.push(command));
  field.showPicker = () => { throw new dom.window.DOMException('Unsupported', 'NotSupportedError'); };
  const tap = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
  field.dispatchEvent(tap);
  assert.equal(tap.defaultPrevented, false);
  root.querySelector('[data-action="cancel-pending-provision-date-edit"]').click();
  assert.equal(cancelled.length, 1);
  assert.deepEqual(saved, []);
});

test('vencimento fica bloqueado durante gravação e campo vazio não reaproveita a data antiga', t => {
  const { root, view, field } = editor(t);
  const saved = [];
  view.on('save-pending-provision-due-date', command => saved.push(command));
  field.value = '';
  root.querySelector('[data-action="save-pending-provision-due-date"]').click();
  assert.equal(saved[0].value, '');
  const busy = editor(t, { pendingProvisionDateEditBusy: true });
  let opens = 0;
  busy.field.showPicker = () => { opens++; };
  busy.field.click();
  assert.equal(busy.field.disabled, true);
  assert.equal(busy.root.querySelector('[data-action="save-pending-provision-due-date"]').disabled, true);
  assert.equal(opens, 0);
});
