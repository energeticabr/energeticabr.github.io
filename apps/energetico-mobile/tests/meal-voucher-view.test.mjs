import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createMealVoucherView } from '../src/ui/meal-voucher-view.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('vale alimentação: lista fornecedores, soma valores e só posta depois da confirmação', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.invalid' });
  const doc = dom.window.document;
  const supplier = { id: '1', label: 'Ana', branch: 'OBRA A', profession: 'PEDREIRO' };
  let posts = 0;
  const panel = createMealVoucherView({ documentRef: doc, data: {
    loadOptions: async () => ({ suppliers: [supplier], accounts: [{ id: '8', label: 'CAIXA' }], stages: [{ id: '7', label: 'FUNDAÇÃO', branch: 'OBRA A' }] }),
    loadOrders: async () => [],
    loadSheetAssignments: async () => ({ '1': { id: '11' } }),
    post: async draft => { posts++; return { orderId: '5', lines: [{ id: '9', supplier: 'Ana', sheetId: '11', payrollId: '31' }], total: Number(draft.lines[0].unitValue) }; },
  } });
  await panel.open(); await tick();
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /Ana/);
  const value = doc.querySelector('[data-meal-value="1"]'); value.value = '10'; value.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.match(doc.querySelector('[data-meal-total]').textContent, /10,00/);
  doc.querySelector('[data-meal-next]').click(); await tick();
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /pedido novo/i);
  doc.querySelector('[data-meal-order-new]').click(); await tick();
  const date = doc.querySelector('[name="meal-date"]'); date.value = '2026-10-15'; date.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const due = doc.querySelector('[name="meal-due-date"]'); due.value = '2026-10-30'; due.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const month = doc.querySelector('[name="meal-reference-month"]'); month.value = '2026-10'; month.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  doc.querySelector('[name="meal-account"]').value = '8'; doc.querySelector('[name="meal-account"]').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  doc.querySelector('[name="meal-stage"]').value = '7'; doc.querySelector('[name="meal-stage"]').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  doc.querySelector('[data-meal-next]').click(); await tick();
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /OBS/i);
  doc.querySelector('[data-meal-next]').click(); await tick();
  assert.equal(posts, 0);
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /PEDREIRO/);
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /2026-10/);
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /IDFOLHA 11/);
  doc.querySelector('[data-meal-confirm]').click(); await tick();
  assert.equal(posts, 1);
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /Pedido 5/);
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /Vínculo 31/);
  panel.destroy(); dom.window.close();
});
