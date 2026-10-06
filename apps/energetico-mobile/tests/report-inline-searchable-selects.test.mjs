import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommercialProgressReportsView } from '../src/ui/commercial-progress-reports-view.js';
import { createCommercialDocsRentReportsView } from '../src/ui/commercial-docs-rent-reports-view.js';
import { createOperationsReportsView } from '../src/ui/operations-reports-view.js';
import { createSpendingReportsView } from '../src/ui/spending-reports-view.js';
import { createPresencePaymentReportView } from '../src/ui/presence-payment-report-view.js';
import { createAuditReportsView } from '../src/ui/audit-reports-live-view.js';

const branches = ['Alfa', 'Beta'];
const properties = branches.map((branch, index) => ({ id: String(index + 1), branch, property: `Casa ${index + 1}`, visualStatus: 'ATIVO', saleStatus: 'VENDIDO', status: 'À VENDA', fiscal: 'DECLARADO', documents: [], stateChecks: [], otherFields: [], contracts: [], idPending: 0, fieldsPending: 0, totalPending: 0 }));
const specs = [
  { name: 'commercial progress', create: createCommercialProgressReportsView, number: 14, method: 'loadSnapshot', filters: '.cpr-filters', count: root => root.querySelectorAll('.cpr-property').length,
    snapshot: { properties, contracts: branches.map((branch, index) => ({ id: String(index + 10), branch, property: `Casa ${index + 1}`, buyer: 'Ana', status: 'VENDIDO', total: 100 })), clients: [], receipts: [], milestones: [] } },
  { name: 'commercial documents', create: createCommercialDocsRentReportsView, number: 16, method: 'loadReport', filters: '.cdr-filters', count: root => root.querySelectorAll('.cdr-branch-summary').length,
    snapshot: { rows: properties, summary: { properties: 2, idPending: 0, fieldsPending: 0, totalPending: 0 } } },
  { name: 'operations', create: createOperationsReportsView, number: 6, method: 'loadReport', filters: '.or-filters', count: root => root.querySelectorAll('.or-stage-card').length,
    snapshot: { number: 6, stages: branches.map(branch => ({ branch, stage: 'FUNDAÇÃO', start: '2026-09-01', end: '', status: 'INICIADO', percent: 25, activities: [] })) } },
  { name: 'spending', create: createSpendingReportsView, number: 9, method: 'loadSnapshot', filters: '.sr-filters', count: root => Number(root.querySelector('[data-metric="count"]').textContent),
    snapshot: { launches: branches.map((branch, index) => ({ id: String(index + 1), branch, date: '2026-09-12', paymentDate: '2026-09-25', supplier: 'Ana', product: 'Cimento', disbursement: 'SIM', order: '42', stage: 'Fundação', account: 'Obra', description: 'Entrega', unit: 20, quantity: 2, freight: 5, total: 45 })), productTypes: [{ product: 'Cimento', expenseType: 'Material' }] } },
  { name: 'presence payment', create: createPresencePaymentReportView, method: 'loadSnapshot', filters: '.pp-filters', count: root => Number(root.querySelector('[data-metric="presences"]').textContent),
    snapshot: { presences: branches.map((branch, index) => ({ id: String(index + 1), branch, date: '2026-09-21', paymentId: '3470', supplier: 'Ana', property: `Casa ${index + 1}`, stage: 'ALVENARIA', activity: 'EXECUÇÃO', presence: 'PRESENTE', dailyValue: 150, observation: '', motivation: '' })), launchesById: { 3470: { id: '3470', order: '346', date: '2026-09-30', supplier: 'Ana', branch: 'Alfa', stage: 'ALVENARIA', description: 'PAGAMENTO', product: 'ENGENHEIRO', account: 'CAIXA', total: 300 } }, supplierStatusByName: { Ana: 'ATIVO' }, warnings: [] } },
  { name: 'audit documents', create: createAuditReportsView, number: 13, method: 'loadReport', filters: '.ar-filters', count: root => root.querySelectorAll('[data-document-id]').length,
    snapshot: { rows: branches.map((branch, index) => ({ id: String(index + 1), branch, status: 'PENDENTE', documentType: 'SEGURO', validityDate: '2026-10-05', submittedDate: '2026-10-01', issuedDate: '2026-10-01' })) } },
];

function setup(t, spec) {
  const dom = new JSDOM('<form><main></main></form>', { url: 'https://example.test' });
  const doc = dom.window.document;
  // Initialize jsdom's own selector/style event tracking before counting view resources.
  dom.window.getComputedStyle(doc.querySelector('main'));
  let snapshot = structuredClone(spec.snapshot);
  const observers = new Set();
  const NativeObserver = dom.window.MutationObserver;
  dom.window.MutationObserver = class extends NativeObserver {
    observe(target, options) { super.observe(target, options); this.target = target; observers.add(this); }
    disconnect() { super.disconnect(); observers.delete(this); }
  };
  const listeners = new Set();
  for (const target of [doc, dom.window]) {
    const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
    target.addEventListener = (type, listener, options) => {
      if (['pointerdown', 'pointerup', 'pointercancel', 'click', 'scroll', 'resize'].includes(type)) listeners.add(listener);
      return add(type, listener, options);
    };
    target.removeEventListener = (type, listener, options) => { listeners.delete(listener); return remove(type, listener, options); };
  }
  const view = spec.create({ document: doc, data: { async [spec.method]() { return snapshot; } } });
  doc.querySelector('main').append(view.element);
  t.after(() => { view.destroy(); dom.window.close(); });
  return { dom, view, root: view.element, observers, listeners,
    open: () => view.open(spec.number),
    replaceSnapshot: () => { snapshot = JSON.parse(JSON.stringify(snapshot).replaceAll('Alfa', 'Gama')); },
  };
}

function field(root, name) {
  const select = root.querySelector(`select[name="${name}"]`);
  const picker = select?.nextElementSibling;
  const input = picker?.querySelector('.sfs-popup input.sfs-search');
  assert.ok(input, `${name} supports explicit Localizar itens search`);
  assert.equal(select.hidden, true);
  assert.equal(picker.querySelector('.sfs-trigger').readOnly, true);
  return { select, picker, input, popup: picker.querySelector('.sfs-popup') };
}

function type(dom, input, value) {
  input.closest('.sfs').querySelector('.sfs-trigger').click();
  input.focus(); input.value = value;
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

for (const spec of specs) {
  test(`${spec.name}: explicit option search leaves report values unchanged until a real choice`, async t => {
    const { dom, root, open } = setup(t, spec);
    await open();
    for (const select of root.querySelectorAll(`${spec.filters} select`)) field(root, select.name);
    assert.equal(spec.count(root), 2);
    const { select, picker, input, popup } = field(root, 'branch');
    let changes = 0;
    select.addEventListener('change', () => { changes++; });
    type(dom, input, 'not a branch');
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(select.value, '');
    assert.equal(new dom.window.FormData(root.closest('form')).get('branch'), '');
    assert.equal(changes, 0);
    assert.equal(spec.count(root), 2);
    assert.equal(picker.querySelectorAll('[role="option"]').length, 0);
    type(dom, input, 'alfa');
    assert.deepEqual([...picker.querySelectorAll('[role="option"]')].map(node => node.textContent), ['Alfa']);
    picker.querySelector('[role="option"]').click();
    assert.equal(select.value, 'Alfa');
    assert.equal(new dom.window.FormData(root.closest('form')).get('branch'), 'Alfa');
    assert.equal(changes, 1);
    assert.equal(spec.count(root), 1);
    assert.equal(popup.hidden, true);
    select.value = 'Beta'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(picker.querySelector('.sfs-trigger').value, 'Beta', 'native changes synchronize the visible selection');
    assert.equal(spec.count(root), 1);
    assert.equal(input.name, '', 'option queries are never submitted as report filters');
  });

  test(`${spec.name}: rebuilding options releases old pickers, closes immediately and destroys listeners`, async t => {
    const ctx = setup(t, spec);
    await ctx.open();
    const old = field(ctx.root, 'branch');
    type(ctx.dom, old.input, 'Alfa');
    assert.equal(old.popup.hidden, false);
    const observerCount = ctx.observers.size, listenerCount = ctx.listeners.size;
    assert.ok(observerCount > 0);
    const filters = ctx.root.querySelector(spec.filters);
    for (const target of [filters, ...filters.querySelectorAll('select')]) {
      const replace = target.replaceChildren.bind(target);
      target.replaceChildren = (...children) => {
        assert.equal([...ctx.observers].some(observer => observer.target?.tagName === 'SELECT' && target.contains(observer.target)), false, 'destroy observers before replacing controls/options');
        return replace(...children);
      };
    }
    ctx.replaceSnapshot();
    ctx.root.querySelector(spec.filters.replace('filters', 'refresh')).click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ctx.root.getAttribute('aria-busy'), 'false');
    assert.equal(old.input.isConnected, false);
    assert.equal(ctx.observers.size, observerCount, 'rebuild must not leak observers');
    assert.equal(ctx.listeners.size, listenerCount, 'rebuild must not leak global listeners');
    const current = field(ctx.root, 'branch');
    type(ctx.dom, current.input, 'gama');
    assert.deepEqual([...current.picker.querySelectorAll('[role="option"]')].map(node => node.textContent), ['Gama']);
    current.picker.querySelector('[role="option"]').click();
    assert.equal(spec.count(ctx.root), 1);
    type(ctx.dom, current.input, 'Beta');
    ctx.view.close();
    assert.equal(current.popup.hidden, true, 'view close closes the picker synchronously');
    await ctx.open();
    const reopened = field(ctx.root, 'branch');
    assert.equal(reopened.picker.querySelector('.sfs-trigger').value, reopened.select.selectedOptions[0].label);
    assert.equal(ctx.root.querySelectorAll('.sfs').length, ctx.root.querySelectorAll('select').length);
    type(ctx.dom, reopened.input, 'Gama');
    ctx.view.destroy();
    assert.equal(ctx.root.isConnected, false);
    assert.equal(ctx.observers.size, 0);
    assert.equal(ctx.listeners.size, 0);
    assert.equal(ctx.root.querySelector('.sfs'), null);
  });
}

test('operations report 8 searches multiple statuses inline, preserves selection on reload and clears through Todos', async t => {
  const statuses = ['ATIVIDADE CRIADA', 'EM ATENDIMENTO', 'CONCLUÍDO'];
  const spec = { create: createOperationsReportsView, method: 'loadReport', number: 8,
    snapshot: { number: 8, summary: { pending: 2, completed: 1, total: 3 }, rows: statuses.map((status, index) => ({ id: String(index + 1), status, task: `Tarefa ${index + 1}`, identified: '2026-09-20', due: '2026-10-05', responsible: 'Ana', responsibleKey: 'ANA', difficulty: 'ALTA', association: 'OBRA', priority: 'ATIVIDADE PRIORITÁRIA' })) } };
  const ctx = setup(t, spec);
  await ctx.open();
  let status = field(ctx.root, 'status');
  assert.equal(status.select.multiple, true);
  assert.equal(ctx.root.querySelectorAll('.or-task-card').length, 3);
  for (const query of ['criada', 'concluido']) {
    type(ctx.dom, status.input, query); status.picker.querySelector('[role="option"]').click();
    assert.equal(status.popup.hidden, false);
  }
  assert.deepEqual([...status.select.selectedOptions].map(option => option.value), ['ATIVIDADE CRIADA', 'CONCLUÍDO']);
  assert.equal(ctx.root.querySelectorAll('.or-task-card').length, 2);
  assert.equal(ctx.root.querySelector('[data-metric="total"]').textContent, '3');
  await ctx.open(); status = field(ctx.root, 'status');
  assert.deepEqual([...status.select.selectedOptions].map(option => option.value), ['ATIVIDADE CRIADA', 'CONCLUÍDO']);
  type(ctx.dom, status.input, 'todos'); status.picker.querySelector('[role="option"]').click();
  assert.deepEqual([...status.select.selectedOptions].map(option => option.value), ['']);
  assert.equal(ctx.root.querySelectorAll('.or-task-card').length, 3);
});
