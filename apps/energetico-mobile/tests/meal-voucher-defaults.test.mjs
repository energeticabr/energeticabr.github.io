import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createMealVoucherView } from '../src/ui/meal-voucher-view.js';

test('alimentação inicia os cargos do fluxo semanal em 5 × 45 e os demais em zero', async t => {
  const dom = new JSDOM('<body></body>', { url:'https://example.invalid' }), doc = dom.window.document;
  const roles = ['SERVENTE DE PEDREIRO I','SERVENTE DE PEDREIRO II','SERVENTE DE PEDREIRO III',
    'PEDREIRO I','PEDREIRO II','PEDREIRO III','MESTRE DE OBRAS','SUPERVISOR DE OBRAS',
    ' perdeiro iii ', '','ENGENHEIRO','ARMADOR DE FERRAGENS','ENGENHEIRO','','PEDREIRO-I','PEDREIROI','PEDRÉIRO I'];
  const suppliers = roles.map((cargo, i) => ({ id:String(i + 1), label:`Fornecedor ${i}`, branch:'OBRA A', profession:'PEDREIRO', cargo }));
  suppliers[12].id = '240'; suppliers[13].id = '241';
  const view = createMealVoucherView({ documentRef:doc, data:{
    loadOptions:async () => ({ suppliers, accounts:[], stages:[] }), loadOrders:async () => [],
  } });
  t.after(() => { view.destroy(); dom.window.close(); });
  await view.open();
  assert.deepEqual([...doc.querySelectorAll('[data-meal-quantity]')].map(input => input.value),
    ['5','5','5','5','5','5','5','5','5','0','0','0','5','0','0','0','0']);
  assert.deepEqual([...doc.querySelectorAll('[data-meal-value]')].map(input => input.value),
    ['45','45','45','45','45','45','45','45','45','0','0','0','45','0','0','0','0']);
  assert.equal(doc.querySelector('[data-meal-bulk-quantity]').value, '5');
  assert.equal(doc.querySelector('[data-meal-bulk-value]').value, '45');
  assert.match(doc.querySelector('[data-meal-total]').textContent, /2\.250,00/);
  assert.equal(doc.querySelectorAll('.meal-voucher-selected-row').length, 10);
});
