import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createLaunchGallery } from '../src/ui/launch-gallery-view.js';
import { createOrdersGallery } from '../src/ui/orders-gallery-view.js';
import { createTasksGallery } from '../src/ui/tasks-gallery-view.js';
import { createPaymentProgrammingGallery } from '../src/ui/payment-programming-gallery-view.js';
import { createRecurringExpensesGallery } from '../src/ui/recurring-expenses-gallery-view.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';
import { createContractorReportsView } from '../src/ui/contractor-reports-view.js';
import { createHrPayrollGallery } from '../src/ui/hr-payroll-gallery-view.js';
import { createHrPayrollReport } from '../src/ui/hr-payroll-report-view.js';
import { createSupplierPayrollView } from '../src/ui/supplier-payroll-view.js';

const data = { loadSnapshot: async () => ({ rows: [] }), loadOverview: async () => ({ rows: [] }), loadDetails: async () => ({}) };
const cases = [
  ['lançamentos', opts => createLaunchGallery({ ...opts, request: async () => ({ rows: [], totals: {}, filterOptions: {} }) })],
  ['pedidos', opts => createOrdersGallery({ ...opts, data })],
  ['tarefas', opts => createTasksGallery({ ...opts, data })],
  ['pagamentos previstos', opts => createPaymentProgrammingGallery({ ...opts, data })],
  ['despesas recorrentes', opts => createRecurringExpensesGallery({ ...opts, data })],
  ['relatórios 1 a 17', opts => createContractorReportsView({ ...opts, data })],
  ...['group', 'family', 'subfamily', 'product', 'documents'].map(kind =>
    [kind, opts => createRegistrationGallery({ ...opts, kind, data })]),
  ...['IDFOLHA', 'FOLHAPGTO'].map(gallery => [gallery, opts => createHrPayrollGallery({ ...opts, gallery, request: async () => ({ rows: [] }) })]),
  ['relatório da folha', opts => createHrPayrollReport({ ...opts, request: async () => [] }), { id: '1' }],
  ['efetuar folha', opts => createSupplierPayrollView({ ...opts, documentRef: opts.document, data: {} })],
];

for (const [name, create, input] of cases) {
  test(`${name}: retorno e início agrupados antes do título; casinha retorna ao menu`, async t => {
    const dom = new JSDOM('<main></main>');
    let home = 0;
    const view = create({ document: dom.window.document, onHome: () => { home++; } });
    t.after(() => { view.destroy(); dom.window.close(); });
    await view.open(input);
    const doc = dom.window.document;
    const nav = doc.querySelector('.screen-navigation');
    assert.ok(nav, 'navegação única à esquerda do título');
    assert.equal(nav.parentElement.firstElementChild, nav);
    assert.ok(nav.nextElementSibling.classList.contains('screen-navigation-title'));
    assert.deepEqual([...nav.children].map(b => b.dataset.navigationIcon), ['↩️', '🏠']);
    assert.ok([...nav.children].every(b => b.getAttribute('aria-label') && b.title && b.type === 'button'));
    nav.lastElementChild.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(home, 1);
    assert.ok(nav.closest('[hidden]') || !nav.isConnected, 'casinha fecha a tela antes do menu');
  });
}

test('casinha do relatório IDFOLHA fecha relatório e galeria mesmo quando onClose destrói a página', async t => {
  const dom = new JSDOM('<main></main>');
  let homes = 0, closes = 0;
  let resolveReport, reportSignal;
  const view = createHrPayrollGallery({
    document: dom.window.document, gallery: 'IDFOLHA',
    request: async () => ({ gallery: 'IDFOLHA', page: 1, rows: [{ id: '12', FORNECEDOR: 'EDGAR' }] }),
    requestReport: async (_id, { signal }) => {
      reportSignal = signal;
      return new Promise(resolve => { resolveReport = resolve; });
    },
    onHome: () => { homes++; },
    onClose: () => { closes++; view.destroy(); },
  });
  t.after(() => { view.destroy(); dom.window.close(); });
  await view.open();
  dom.window.document.querySelector('[data-action="open-payroll-report"]').click();
  await new Promise(resolve => setImmediate(resolve));
  dom.window.document.querySelector('.hr-payroll-report-overlay .screen-navigation').lastElementChild.click();
  assert.equal(homes, 1);
  assert.equal(closes, 1);
  assert.equal(reportSignal.aborted, true);
  resolveReport([]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dom.window.document.querySelector('.hr-gallery-overlay'), null);
});
