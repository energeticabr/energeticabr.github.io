import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderGanttCostDetail } from '../src/ui/stage-gantt-cost-view.js';
import { normalizeSpendingLaunch, normalizeSpendingProduct } from '../src/chat/spending-reports-model.js';

test('custo mostra concreto e produtos de todos os tipos ao abrir, sem duplicar valores ao recolher e expandir', t => {
  const dom = new JSDOM('<main></main>');
  t.after(() => dom.window.close());
  const container = dom.window.document.querySelector('main');
  const selection = { branch: '004 - EDIFÍCIO XAVANTE', stage: 'ALVENARIA E ESTRUTURAS' };
  const concrete = normalizeSpendingLaunch({ id: '3770', fields: {
    Title: selection.branch, field_6: selection.stage, field_7: 'CONCRETO USINADO FCK 30',
    field_2: '2026-11-09T03:00:00Z', field_4: '2026-11-09T12:00:00Z',
    field_8: 36.6666, field_9: 560.001200002182, field_10: 0,
  } });
  const product = normalizeSpendingProduct({ fields: { PRODUTO: concrete.product, TIPODESPESA: 'MATERIAL' } });
  renderGanttCostDetail({ container, selection, snapshot: {
    launches: [concrete, { ...concrete, id: '2', product: 'Serviço', total: 100 }],
    provisions: [{ ...selection, id: '3', product: 'Máquina', dueDate: '2026-11-20', total: 50 }],
    productTypes: [product, { product: 'Serviço', expenseType: 'MÃO DE OBRA' },
      { product: 'Máquina', expenseType: 'EQUIPAMENTOS / MÁQUINAS' }],
  } });
  const products = () => [...container.querySelectorAll('.gantt-cost-product')];
  assert.deepEqual(products().map(row => row.querySelector('th').textContent),
    ['CONCRETO USINADO FCK 30', 'Serviço', 'Máquina']);
  assert.match(products()[0].textContent, /20\.533,34/);
  const totals = () => [...container.querySelectorAll('[data-cost-total]')].map(node => node.textContent);
  const before = totals();
  assert.match(before[0], /20\.633,34/);
  assert.match(before[1], /50,00/);
  assert.match(before[2], /20\.683,34/);
  for (const toggle of container.querySelectorAll('.gantt-cost-toggle')) {
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  }
  assert.equal(products().length, 3);
  assert.deepEqual(totals(), before);
  const month = container.querySelector('[name="month"]');
  month.value = '';
  month.dispatchEvent(new dom.window.Event('change'));
  assert.equal(products().length, 3);
  assert.deepEqual(totals(), before);
});
