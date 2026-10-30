import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSupplierPayrollReportView } from '../src/ui/supplier-payroll-report-view.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const text = node => node.textContent.replaceAll('\u00a0', ' ');
const snapshot = () => ({ complete: true, sheets: [{ id: '9', supplier: 'FUNCIONÁRIO FICTÍCIO', profession: 'CARGO DE TESTE', month: '2026-10' }] });
const payment = (type = 'Salário', totalCents = 52700) => ({ id: '1', payrollId: '9', type, totalCents, date: '2026-10-05' });
async function setup(t, { source = snapshot(), rows = [payment()], loadSnapshot, loadPaymentsForPayrollIds } = {}) {
  const dom = new JSDOM('<main id="app"></main>'); dom.window.matchMedia = () => ({ matches: false });
  const view = createSupplierPayrollReportView({ document: dom.window.document, now: () => new Date('2026-10-08T12:00:00Z'),
    data: { loadSnapshot: loadSnapshot || (async () => source), loadPaymentsForPayrollIds: loadPaymentsForPayrollIds || (async () => rows) } });
  t.after(() => { view.destroy(); dom.window.close(); }); await view.open(); await tick();
  return { view, root: view.element, dom };
}

for (const type of ['Salário', ' SALARIO ', 'salário']) test(`salary header keeps paid and shows unknown expected for exact normalized ${type}`, async t => {
  const h = await setup(t, { rows: [payment(type)] });
  const rubric = h.root.querySelector('summary .spr-rubric-row');
  assert.equal(text(rubric.querySelector('.spr-rubric-value')), 'R$ 527,00 / Não informado');
  assert.equal(rubric.style.getPropertyValue('--spr-type-color'), '#16794d');
  assert.equal(text(h.root.querySelector('.spr-total-paid .spr-metric-value')), 'R$ 527,00');
});
test('13 salary, extra salary and other rubrics keep their original single paid amount', async t => {
  const h = await setup(t, { rows: ['13 Salário', 'Salário extra', 'Ajuda de Custo'].map((type, index) => ({ ...payment(type), id: String(index + 1) })) });
  for (const row of h.root.querySelectorAll('summary .spr-rubric-row')) assert.equal(text(row.querySelector('.spr-rubric-value')), 'R$ 527,00');
  assert.equal(h.root.querySelector('summary .spr-salary-expected'), null);
});
test('unknown paid amount remains unknown alongside unknown expected, never replaced by zero', async t => {
  const h = await setup(t, { rows: [payment('Salário', null)] });
  assert.equal(text(h.root.querySelector('summary .spr-rubric-value')), 'Não calculado / Não informado');
});
test('print keeps the expected amount in the summary only and restores accordion state', async t => {
  const h = await setup(t), card = h.root.querySelector('details');
  assert.equal(card.open, false); const restore = await h.view.preparePrint();
  assert.match(text(card.querySelector('summary .spr-rubric-value')), /527,00 \/ Não informado/);
  assert.equal(card.querySelectorAll('.spr-detail .spr-salary-expected').length, 0);
  assert.equal(text(card.querySelector('.spr-type-amount')), 'R$ 527,00');
  restore(); assert.equal(card.open, false);
});
test('refresh failure removes previous salary text and closing cancels a pending replacement snapshot', async t => {
  let reads = 0, resolve, signal;
  const h = await setup(t, { loadSnapshot: async options => {
    if (++reads === 1) return snapshot();
    if (reads === 2) throw new Error('Falha fictícia');
    signal = options.signal; return new Promise(done => { resolve = done; });
  } });
  assert.match(text(h.root.querySelector('summary .spr-rubric-value')), /Não informado/);
  h.root.querySelector('.pl-refresh').click(); await tick();
  assert.equal(h.root.querySelector('summary'), null);
  h.root.querySelector('.pl-refresh').click(); await tick(); h.view.close();
  assert.equal(signal.aborted, true); resolve(snapshot()); await tick();
  assert.equal(h.root.hidden, true); assert.equal(h.root.querySelector('summary'), null);
});
test('known monthly salary is displayed once for multiple payroll sheets and follows month/All filters', async t => {
  const source = { complete: true, sheets: [
    { ...snapshot().sheets[0], id: '9' }, { ...snapshot().sheets[0], id: '10' }, { ...snapshot().sheets[0], id: '8', month: '2026-09' },
  ], salaryExpectations: { '9': 320050, '10': 320050, '8': 300000 } };
  const payments = [payment(), { ...payment('Salário', 10000), id: '2', payrollId: '10' }, { ...payment('Salário', 5000), id: '3', payrollId: '8' }];
  const h = await setup(t, { source, loadPaymentsForPayrollIds: async ids => payments.filter(row => ids.includes(row.payrollId)) });
  const value = () => text(h.root.querySelector('summary .spr-rubric-value'));
  assert.equal(value(), 'R$ 627,00 / R$ 3.200,50');
  assert.equal(text(h.root.querySelector('.spr-total-paid .spr-metric-value')), 'R$ 627,00');
  const month = h.root.querySelector('[name="month"]');
  month.value = '2026-09'; month.dispatchEvent(new h.dom.window.Event('change')); await tick();
  assert.equal(value(), 'R$ 50,00 / R$ 3.000,00');
  month.value = ''; month.dispatchEvent(new h.dom.window.Event('change')); await tick();
  assert.equal(value(), 'R$ 677,00 / R$ 6.200,50');
});
test('confirmed expected zero is displayed; absent/invalid salary projection remains not informed', async t => {
  for (const expected of [0, null, undefined, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '320050']) {
    const h = await setup(t, { source: { ...snapshot(), salaryExpectations: { '9': expected } } });
    assert.equal(text(h.root.querySelector('summary .spr-rubric-value')), `R$ 527,00 / ${expected === 0 ? 'R$ 0,00' : 'Não informado'}`);
  }
});
test('refresh replaces known expected salary; print preserves paid/expected only in summary', async t => {
  let expected = 320050;
  const h = await setup(t, { loadSnapshot: async () => ({ ...snapshot(), salaryExpectations: { '9': expected } }) });
  assert.equal(text(h.root.querySelector('summary .spr-salary-expected')), 'R$ 3.200,50');
  expected = 350000; h.root.querySelector('.pl-refresh').click(); await tick(); await tick();
  assert.equal(text(h.root.querySelector('summary .spr-salary-expected')), 'R$ 3.500,00');
  const restore = await h.view.preparePrint();
  assert.equal(text(h.root.querySelector('summary .spr-rubric-value')), 'R$ 527,00 / R$ 3.500,00');
  assert.equal(text(h.root.querySelector('.spr-type-amount')), 'R$ 527,00'); restore();
});
