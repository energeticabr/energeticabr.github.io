import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as model from '../src/chat/supplier-payroll-report-model.js';
import { createSupplierPayrollReportView } from '../src/ui/supplier-payroll-report-view.js';
import { captureFilteredReport } from '../src/ui/report-print.js';

const byType = rows => {
  assert.equal(typeof model.summarizePayrollPaymentsByType, 'function');
  return model.summarizePayrollPaymentsByType(rows);
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const text = node => node.textContent.replaceAll('\u00a0', ' ');

test('rubrics sum exact payment cents and combine case whitespace and unicode variants without changing rows', () => {
  const rows = [
    { type: ' SALÁRIO ', totalCents: 52600 },
    { type: 'sala\u0301rio', totalCents: 67225 },
    { type: 'Ajuda  de Custo', totalCents: 20456 },
    { type: 'ajuda de custo', totalCents: 100 },
    { type: 'Prêmio', unitValue: '1,005', quantity: 1 },
    { type: 'Prêmio', totalCents: -1 },
  ];
  const before = structuredClone(rows);
  assert.deepEqual(byType(rows), [
    { type: 'AJUDA DE CUSTO', totalCents: 20556, uncalculated: 0 },
    { type: 'PRÊMIO', totalCents: 100, uncalculated: 0 },
    { type: 'SALÁRIO', totalCents: 119825, uncalculated: 0 },
  ]);
  assert.deepEqual(rows, before);
});

test('unknown amounts invalidate only their rubric instead of presenting a partial total', () => {
  assert.deepEqual(byType([
    { type: 'SALÁRIO', totalCents: 10000 },
    { type: 'SALÁRIO', totalCents: null },
    { type: 'PRÊMIO', totalCents: 900 },
    { type: 'VALE', totalCents: Number.MAX_SAFE_INTEGER },
    { type: 'VALE', totalCents: 1 },
  ]), [
    { type: 'PRÊMIO', totalCents: 900, uncalculated: 0 },
    { type: 'SALÁRIO', totalCents: null, uncalculated: 1 },
    { type: 'VALE', totalCents: null, uncalculated: 0 },
  ]);
});

test('missing rubric is explicit and unknown financial rows are not silently discarded', () => {
  assert.deepEqual(byType([{ totalCents: 123 }, { type: ' ', totalCents: 100 }, null]), [
    { type: 'RUBRICA NÃO INFORMADA', totalCents: null, uncalculated: 1 },
  ]);
  assert.deepEqual(byType([]), []);
  assert.throws(() => byType(null), TypeError);
});

const fixtureRows = [
  { id: '10', payrollId: '8', type: 'SALÁRIO', totalCents: 52600 },
  { id: '12', payrollId: '8', type: 'SALÁRIO', totalCents: 67225 },
  { id: '13', payrollId: '8', type: 'AJUDA DE CUSTO', totalCents: 20456 },
  { id: '14', payrollId: '7', type: 'PRÊMIO', totalCents: 1000 },
];
function setup(t, read) {
  const dom = new JSDOM('<main id="app"></main>');
  dom.window.matchMedia = () => ({ matches: false });
  const calls = [];
  const view = createSupplierPayrollReportView({ document: dom.window.document,
    now: () => new Date('2026-10-08T12:00:00Z'), data: {
      loadSnapshot: async () => ({ complete: true, sheets: [
        { id: '8', supplier: 'José Geraldo', month: '2026-09', profession: 'Pedreiro' },
        { id: '7', supplier: 'José Geraldo', month: '2026-10', profession: 'Pedreiro' },
      ] }),
      loadPaymentsForPayrollIds: async (ids, options) => {
        calls.push(ids);
        return read ? read(ids, options) : fixtureRows.filter(row => ids.includes(row.payrollId));
      },
    } });
  t.after(() => { view.destroy(); dom.window.close(); });
  return { dom, view, root: view.element, calls };
}
function changeMonth(root, dom, month) {
  const control = root.querySelector('[name=month]');
  control.value = month;
  control.dispatchEvent(new dom.window.Event('change'));
}

test('collapsed supplier header puts rubric totals between total paid and payment count using selected sheets', async t => {
  const { dom, view, root, calls } = setup(t);
  await view.open(); await tick();
  changeMonth(root, dom, '2026-09'); await tick();
  const card = root.querySelector('details');
  const rubrics = card.querySelector('[aria-label="Total pago por rubrica"]');
  assert.ok(rubrics, 'supplier header must expose the rubric breakdown');
  assert.equal(card.open, false);
  assert.equal(rubrics.previousElementSibling.classList.contains('spr-total-paid'), true);
  assert.equal(rubrics.nextElementSibling.classList.contains('spr-payment-count'), true);
  assert.deepEqual([...rubrics.querySelectorAll('[role=listitem]')].map(text), [
    'AJUDA DE CUSTO: R$ 204,56', 'SALÁRIO: R$ 1.198,25',
  ]);
  assert.equal(text(card.querySelector('.spr-total-paid .spr-metric-value')), 'R$ 1.402,81');
  assert.equal(text(card.querySelector('.spr-payment-count .spr-metric-value')), '3');
  card.open = true; card.dispatchEvent(new dom.window.Event('toggle')); await tick();
  assert.deepEqual(calls, [['7'], ['8']], 'summary and expansion must reuse the same reads');
  const printed = JSON.stringify(captureFilteredReport(root));
  assert.match(printed, /SALÁRIO/); assert.match(printed, /1.198,25/);
  changeMonth(root, dom, '2026-10'); await tick();
  assert.deepEqual([...root.querySelectorAll('[role=listitem]')].map(text), ['PRÊMIO: R$ 10,00']);
  assert.deepEqual(calls, [['7'], ['8']], 'cached month keeps the correct breakdown');
});

test('rubric state distinguishes loading failed unknown and empty instead of stale or invented values', async t => {
  let reject, resolve;
  const { view, root, dom } = setup(t, () => new Promise((done, fail) => { resolve = done; reject = fail; }));
  await view.open(); await tick();
  let rubrics = root.querySelector('[aria-label="Total pago por rubrica"]');
  assert.ok(rubrics); assert.match(text(rubrics), /Carregando/);
  reject(Error('offline')); await tick();
  assert.match(text(rubrics), /Não disponível/);
  root.querySelector('.spr-retry').click(); await tick();
  assert.match(text(rubrics), /Carregando/);
  resolve([{ type: 'PRÊMIO', totalCents: null }]); await tick();
  assert.deepEqual([...rubrics.querySelectorAll('[role=listitem]')].map(text), ['PRÊMIO: Não calculado']);
  changeMonth(root, dom, '2026-09'); await tick();
  rubrics = root.querySelector('[aria-label="Total pago por rubrica"]');
  assert.match(text(rubrics), /Carregando/); assert.doesNotMatch(text(rubrics), /PRÊMIO/);
  resolve([]); await tick(); assert.equal(text(rubrics), 'Sem pagamentos');
});

test('rubric labels are rendered as text and cannot inject markup', async t => {
  const { view, root } = setup(t, async () => [{ type: '<img src=x onerror=alert(1)>', totalCents: 100 }]);
  await view.open(); await tick();
  const rubrics = root.querySelector('[aria-label="Total pago por rubrica"]');
  assert.ok(rubrics); assert.equal(rubrics.querySelector('img'), null);
  assert.match(text(rubrics), /<IMG SRC=X ONERROR=ALERT\(1\)>: R\$ 1,00/);
});
