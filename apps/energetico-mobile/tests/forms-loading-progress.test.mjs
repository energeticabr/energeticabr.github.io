import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createTaskCompletionDialog } from '../src/ui/task-completion-dialog.js';
import { createPayrollSheetCreateView } from '../src/ui/payroll-sheet-create-view.js';
import { createPayrollPaymentComposer } from '../src/ui/payroll-payment-view.js';
import { createProvisionDescriptionDetail } from '../src/ui/provision-description-detail-view.js';
import { createHrPayrollReport } from '../src/ui/hr-payroll-report-view.js';
import { createSupplierPayrollView } from '../src/ui/supplier-payroll-view.js';
import { createMealVoucherView } from '../src/ui/meal-voucher-view.js';
import { createPayrollBreakdownView } from '../src/ui/payroll-breakdown-view.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const percent = loader => Number(loader.querySelector('[role=progressbar]').getAttribute('aria-valuenow'));
const supplier = { id: '1', label: 'Ana', branch: 'OBRA A', profession: 'PEDREIRO' };
const editor = { contract: { hasForm: true }, item: { id: '1', eTag: 'v1', fields: {} }, columns: [
  { name: 'date', label: 'DATA CONCLUSÃO', editable: true, control: 'date' },
  { name: 'done', label: 'CONCLUÍDO', editable: true, control: 'text' },
] };
const cases = [
  ['task completion', (doc, host, read) => {
    const view = createTaskCompletionDialog({ document: doc, host, data: { loadEditor: (_id, options) => read(options) }, today: () => '2026-10-27', onBlocked() {} });
    return { view, start: () => view.open({ id: '1' }, doc.querySelector('button')), value: editor, ready: '[data-task-completion-form]' };
  }],
  ['sheet composer', (doc, _host, read) => {
    const view = createPayrollSheetCreateView({ document: doc, loadOptions: read });
    return { view, start: () => view.open(), value: { suppliers: [supplier], defaultMonth: '2026-10' }, ready: 'form' };
  }],
  ['payment composer', (doc, host, read) => {
    const view = createPayrollPaymentComposer({ document: doc, host, loadOptions: read });
    return { view, start: () => view.open(), value: { launches: [], sheets: [], paymentTypes: [] }, ready: 'form' };
  }],
  ['provision group', (doc, host, read) => {
    const view = createProvisionDescriptionDetail({ document: doc, host, background: [], loadGroup: (_id, options) => read(options),
      field: (fields, aliases) => fields[aliases[0]], format: (_label, value) => String(value ?? ''), lineTotal: () => 0 });
    return { view, start: () => view.open('1', doc.querySelector('button')), value: { description: { id: '1', fields: {} }, provisions: [] }, ready: '.pg-description-content' };
  }],
  ['payroll report', (doc, host, read) => {
    const view = createHrPayrollReport({ document: doc, root: host, request: (_id, options) => read(options) });
    return { view, start: () => view.open({ id: '1' }), value: [], ready: '[data-report-total=overall]' };
  }],
  ['supplier wizard', (doc, host, read) => {
    const view = createSupplierPayrollView({ documentRef: doc, root: host, data: { loadSuppliers: read } });
    return { view, start: async () => {
      await view.open(); const date = doc.querySelector('[name=date]'); date.value = '2026-10-27';
      date.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true })); doc.querySelector('[data-payroll-next]').click();
    }, value: [supplier], ready: '.supplier-payroll-choices' };
  }],
  ['meal wizard', (doc, host, read) => {
    const view = createMealVoucherView({ documentRef: doc, root: host, data: { loadOptions: read } });
    return { view, start: () => view.open(), value: { suppliers: [supplier], accounts: [], stages: [] }, ready: '[data-meal-value="1"]' };
  }],
  ['breakdown wizard', (doc, host, read) => {
    const view = createPayrollBreakdownView({ documentRef: doc, root: host, data: { loadSuppliers: read } });
    return { view, start: () => view.open(), value: [supplier], ready: '[data-breakdown-supplier="1"]' };
  }],
];

for (const [name, build] of cases) {
  test(`${name}: measured acquisition reaches the loader and completes after accepted content`, async t => {
    const dom = new JSDOM('<button>Abrir</button><main></main>'); const doc = dom.window.document;
    let options, resolve;
    const read = value => { options = value; return new Promise(done => { resolve = done; }); };
    const h = build(doc, doc.querySelector('main'), read);
    t.after(() => { h.view.destroy?.(); h.view.close?.(); dom.window.close(); });
    const opening = h.start(); await tick();
    const loader = doc.querySelector('.app-loading'); assert.ok(loader);
    assert.equal(typeof options?.onProgress, 'function', 'each actual read must receive its own progress callback');
    assert.equal(percent(loader), 33);
    options.onProgress({ percent: 25 }); assert.equal(percent(loader), 41);
    options.onProgress({ percent: 75 }); assert.equal(percent(loader), 58);
    assert.equal(doc.querySelector(h.ready), null);
    resolve(h.value); await opening; await tick();
    assert.ok(doc.querySelector(h.ready), `accepted ${name} content is mounted`);
    assert.equal(percent(loader), 100);
    options.onProgress({ percent: 100 }); assert.equal(percent(loader), 100);
  });
  test(`${name}: a closed read ignores late progress and data`, async t => {
    const dom = new JSDOM('<button>Abrir</button><main></main>'); const doc = dom.window.document;
    let options, resolve;
    const h = build(doc, doc.querySelector('main'), value => { options = value; return new Promise(done => { resolve = done; }); });
    t.after(() => { h.view.destroy?.(); h.view.close?.(); dom.window.close(); });
    const opening = h.start(); await tick(); const loader = doc.querySelector('.app-loading');
    assert.equal(typeof options?.onProgress, 'function'); options.onProgress({ percent: 40 });
    const before = percent(loader); h.view.close();
    options.onProgress({ percent: 100 }); resolve(h.value); await opening; await tick();
    assert.equal(percent(loader), before, 'cancelled operation must never reach 100');
    assert.equal(doc.querySelector(h.ready), null);
  });
  test(`${name}: old callbacks cannot change the next open operation`, async t => {
    const dom = new JSDOM('<button>Abrir</button><main></main>'), doc = dom.window.document, reads = [];
    const h = build(doc, doc.querySelector('main'), options => new Promise(resolve => { reads.push({ options, resolve }); }));
    t.after(() => { h.view.destroy?.(); h.view.close?.(); dom.window.close(); });
    const first = h.start(); await tick(); h.view.close();
    const second = h.start(); await tick(); const loader = doc.querySelector('.app-loading');
    reads[1].options.onProgress({ percent: 25 }); const before = percent(loader);
    reads[0].options.onProgress({ percent: 100 }); reads[0].resolve(h.value); await first; await tick();
    assert.equal(percent(loader), before); assert.equal(doc.querySelector(h.ready), null);
    reads[1].resolve(h.value); await second; await tick();
    assert.ok(doc.querySelector(h.ready)); assert.equal(percent(loader), 100);
  });
  test(`${name}: a failed request never completes its loader`, async t => {
    const dom = new JSDOM('<button>Abrir</button><main></main>'), doc = dom.window.document; let reject, options;
    const h = build(doc, doc.querySelector('main'), value => { options = value; return new Promise((_resolve, fail) => { reject = fail; }); });
    t.after(() => { h.view.destroy?.(); h.view.close?.(); dom.window.close(); });
    const opening = h.start(); await tick(); const loader = doc.querySelector('.app-loading');
    options.onProgress({ percent: 60 }); reject(new Error('Offline')); await opening; await tick();
    const failed = percent(loader); options.onProgress({ percent: 100 });
    assert.ok(failed < 100); assert.equal(percent(loader), failed);
    assert.equal(doc.querySelector(h.ready), null);
    assert.ok(doc.querySelector('[data-action=retry-hr-payroll-report]') || [...doc.querySelectorAll('[role=alert]')].some(node => !node.hidden));
  });
}

test('invalid editor data stops the loader without a successful completion', async t => {
  const dom = new JSDOM('<main></main>'), doc = dom.window.document; let resolve;
  const view = createTaskCompletionDialog({ document: doc, host: doc.querySelector('main'), today: () => '2026-10-27', onBlocked() {},
    data: { loadEditor: () => new Promise(done => { resolve = done; }), } });
  t.after(() => { view.destroy(); dom.window.close(); });
  const opening = view.open({ id: '1' }); const loader = doc.querySelector('.app-loading');
  resolve({ item: { id: '2' }, columns: [] }); await opening;
  assert.notEqual(percent(loader), 100); assert.equal(doc.querySelector('[data-task-completion-form]'), null);
  assert.equal(doc.querySelector('[role=alert]').hidden, false);
});
