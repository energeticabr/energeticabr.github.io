import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {decorateReportPrint} from '../src/ui/report-print.js';

const reportCloseCss = readFileSync(new URL('../src/ui/report-close-control.css', import.meta.url), 'utf8');
const createDOM = body => new JSDOM(`<style>${reportCloseCss}</style>${body}`);

const cases = [
  ['payment-ledger-view', 'createPaymentLedgerView', 'loadPaymentsSnapshot'],
  ['attendance-summary-view', 'createAttendanceSummaryReportView'],
  ['stage-progress-view', 'createStageProgressReportView'],
  ['commercial-receipts-view', 'createCommercialReceiptsReportView'],
  ['commercial-milestones-view', 'createCommercialMilestonesReportView'],
  ['commercial-documents-view', 'createCommercialDocumentsReportView'],
  ['sac-pathologies-view', 'createSacPathologiesReportView'],
  ['contractor-control-report-view', 'createContractorControlReportView', 'loadOverview'],
  ['general-summary-report-view', 'createGeneralSummaryReportView', 'loadReport'],
  ['delegated-deadline-report-view', 'createDelegatedDeadlineReportView'],
  ['document-control-report-view', 'createDocumentControlReportView'],
  ['depreciation-report-view', 'createDepreciationReportView'],
  ['management-report-view', 'createManagementReportView'],
  ['order-validation-report-view', 'createOrderValidationReportView', 'loadOrderValidationSnapshot'],
  ['pending-work-diaries-report-view', 'createPendingWorkDiariesReportView'],
  ['pending-supplier-payments-report-view', 'createPendingSupplierPaymentsReportView'],
  ['provision-report-view', 'createProvisionReportView', 'loadProvisionReportSnapshot'],
  ['quotation-report-view', 'createQuotationReportView'],
  ['supplier-payroll-report-view', 'createSupplierPayrollReportView'],
  ['supplier-workforce-report-view', 'createSupplierWorkforceReportView'],
  ['task-association-report-view', 'createTaskAssociationReportView'],
  ['rhid-monthly-report-view', 'createRhidMonthlyReportView', 'loadSuppliers'],
  ['hr-payroll-report-view', 'createHrPayrollReport', 'request'],
  ['cargos-view', 'createCargosView'],
];
for (const entry of cases) {
  entry[2] ||= 'loadSnapshot';
  entry[3] = (await import(`../src/ui/${entry[0]}.js`))[entry[1]];
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const emptySnapshot = () => ({complete:true, rows:[], count:0, tasks:[], documents:[], assets:[],
  launches:[], activities:[], suppliers:[], presences:[], properties:[], milestones:[], payments:[],
  payrolls:[], orders:[], quotes:[], provisions:[], documentStatuses:{}, warnings:[],
  today:'2026-10-13', updatedAt:'2026-10-13T12:00:00.000Z', metrics:{dueToday:0, overdue:0,
    auditOrders:0, quotes:0, documents:0, pendingTasks:0, delegatedTasks:0, activeContracts:0,
    pendingPayments:0, pendingDiaries:0, commercialDocuments:0, activePathologies:0}});

function setup(t, entry, {fail = false, immediate = false} = {}) {
  const [name, , method = 'loadSnapshot', factory] = entry;
  const dom = createDOM('<main id="app"><button id="trigger">Abrir relatório</button></main>');
  const doc = dom.window.document;
  let portrait = false, homes = 0, closes = 0;
  dom.window.matchMedia = () => ({get matches() {return portrait;}});
  const requests = [];
  const response = () => method === 'loadSuppliers' || method === 'request' ? [] : emptySnapshot();
  const loader = (...args) => {
    const options = args.at(-1);
    if (fail) return Promise.reject(new Error('Consulta indisponível'));
    if (immediate) return Promise.resolve(response());
    let resolve;
    const promise = new Promise(done => {resolve = done;});
    requests.push({signal:options?.signal, resolve:() => resolve(response())});
    return promise;
  };
  const data = {[method]:loader, loadDetails:async () => ({}), loadPaymentsForPayrollIds:async () => [], loadMonth:async () => ({})};
  const view = factory({document:doc, data, request:loader, now:() => new Date('2026-10-13T12:00:00Z'),
    onHome:() => homes++, onClose:() => closes++});
  const root = () => (name === 'cargos-view' && doc.querySelector('.cargos-backdrop')) ||
    view.element || doc.querySelector('.hr-payroll-report-backdrop') || doc.querySelector('.hr-payroll-report-overlay');
  const open = () => view.open(name === 'hr-payroll-report-view' ? {id:'12', FORNECEDOR:'Alfa', MESREFERENCIA:'10/2026'} : undefined);
  t.after(async () => {view.destroy(); for (const request of requests) request.resolve(); await tick(); dom.window.close();});
  return {view, doc, dom, root, open, requests, homes:() => homes, closes:() => closes,
    rotate(value) {portrait = value; dom.window.dispatchEvent(new dom.window.Event('resize'));}};
}

function closeControl(root) {
  const exits = [...root.querySelectorAll('button')].filter(node => !node.closest('[hidden]') &&
    /fechar|voltar(?: ao menu inicial)?|início/i.test(node.getAttribute('aria-label') || node.textContent));
  assert.equal(exits.length, 1, 'each report exposes exactly one visible emoji dismissal control');
  const button = exits[0];
  assert.equal(button.textContent.trim(), '❌', 'the visible dismissal is the requested emoji');
  assert.match(button.getAttribute('aria-label') || '', /^Fechar\b/i);
  assert.equal(button.type, 'button');
  assert.equal(button.disabled, false);
  assert.equal(button.tabIndex, 0);
  return button;
}

test('RHID monthly Cancelar is an additional action that closes like the sole emoji exit',async t=>{
  const ctx=setup(t,cases.find(entry=>entry[0]==='rhid-monthly-report-view'),{immediate:true});
  await ctx.open();
  const root=ctx.root(),emoji=closeControl(root),cancel=root.querySelector('.rhid-monthly-cancel');
  assert.ok(cancel);assert.notEqual(cancel,emoji);assert.equal(cancel.type,'button');
  cancel.click();assert.equal(root.hidden,true);assert.equal(ctx.closes(),1);assert.equal(ctx.homes(),0);
});

for (const entry of cases) {
  const name = entry[0];

  // Break: a report has no emoji exit, duplicated home exits, or an exit disabled during loading.
  test(`${name}: the sole emoji exit closes loading and rejects the late response`, async t => {
    const ctx = setup(t, entry);
    const opening = ctx.open(); await tick();
    const root = ctx.root(), button = closeControl(root);
    button.click();
    assert.equal(root.hidden, true);
    assert.equal(ctx.requests.length, 1);
    assert.equal(ctx.requests[0].signal.aborted, true);
    ctx.requests[0].resolve(); await opening;
    assert.equal(root.hidden, true, 'a late response cannot reopen the report');
    assert.equal(ctx.homes(), 0, 'close never navigates to the home menu');
  });

  // Break: an inner click dismisses the report, an error loses the exit, or backdrop close affects another report.
  test(`${name}: error panel clicks stay inside and only its backdrop dismisses`, async t => {
    const ctx = setup(t, entry, {fail:true});
    await ctx.open();
    const root = ctx.root(), panel = root.matches('[role="dialog"]') ? root : root.querySelector('[role="dialog"]');
    assert.match(root.textContent, /não foi possível|indisponível/i);
    closeControl(root);
    panel.click(); assert.equal(root.hidden, false);
    const other = ctx.doc.createElement('section'); other.setAttribute('role', 'dialog'); ctx.doc.body.append(other);
    root.click(); assert.equal(root.hidden, true); assert.equal(other.hidden, false);
    assert.equal(ctx.homes(), 0);
  });

  // Break: re-opening creates duplicate exits/listeners, or a stale first request overwrites the active report.
  test(`${name}: reopen keeps one exit and ignores a previous opening's response`, async t => {
    const ctx = setup(t, entry);
    const first = ctx.open(); await tick();
    closeControl(ctx.root()).click();
    const second = ctx.open(); await tick();
    const root = ctx.root();
    assert.equal(root.hidden, false); closeControl(root);
    assert.equal(ctx.requests.length, 2);
    ctx.requests[0].resolve(); await first;
    assert.equal(root.hidden, false); assert.equal(ctx.requests[1].signal.aborted, false);
    ctx.requests[1].resolve(); await second;
    closeControl(root).click(); assert.equal(root.hidden, true);
  });

  // Break: rotation hides the close control, shrinks its touch target, or it loses keyboard focus.
  test(`${name}: rotation retains a reachable keyboard close with a 44px target`, async t => {
    const ctx = setup(t, entry, {immediate:true});
    await ctx.open();
    const root = ctx.root(), button = closeControl(root);
    button.focus(); assert.equal(ctx.doc.activeElement, button);
    for (const portrait of [true, false]) {
      ctx.rotate(portrait);
      assert.equal(closeControl(root), button);
      assert.equal(ctx.doc.activeElement, button);
      const style = ctx.dom.window.getComputedStyle(button);
      assert.ok(parseFloat(style.minWidth) >= 44, 'touch target reserves at least 44px of width');
      assert.ok(parseFloat(style.minHeight) >= 44, 'touch target reserves at least 44px of height');
      assert.equal(style.position, 'static', 'close occupies its own toolbar space instead of covering filters');
      assert.notEqual(style.display, 'none');
    }
    button.click(); assert.equal(root.hidden, true);
  });

  // Break: a destroyed report leaves its overlay behind or a late request mounts it again.
  test(`${name}: destroy aborts a pending request and removes the report`, async t => {
    const ctx = setup(t, entry);
    const opening = ctx.open(); await tick();
    const root = ctx.root(), button = closeControl(root);
    ctx.view.destroy();
    assert.equal(ctx.requests[0].signal.aborted, true);
    assert.equal(root.isConnected, false);
    ctx.requests[0].resolve(); await opening;
    button.click(); ctx.view.destroy();
    assert.equal(root.isConnected, false);
    assert.equal(ctx.homes(), 0);
  });
}

// Break: report dismissal accidentally removes a date-clear action or the commercial print action.
test('non-dismissal cross and print actions stay available inside reports', async t => {
  const task = setup(t, cases.find(entry => entry[0] === 'task-association-report-view'), {immediate:true});
  await task.open();
  const clear = task.root().querySelector('[aria-label="Limpar data fatal"]');
  assert.equal(clear.textContent, '×'); clear.click(); assert.equal(task.root().hidden, false);
  const commercial = setup(t, cases.find(entry => entry[0] === 'commercial-receipts-view'), {immediate:true});
  await commercial.open();
  assert.equal(commercial.root().querySelector('[aria-label="Imprimir relatório comercial"]').textContent, '⎙');
});

// Break: adding a close beside filters makes a PDF error share their row and push the exit off-screen.
test('PDF failure reserves a full message row while the report close stays available', async t => {
  const dom = createDOM('<main id="app"></main>'), doc = dom.window.document;
  const view = cases[0][3]({document:doc, data:{loadPaymentsSnapshot:async () => ({launches:[
    {id:'1', paymentDate:'2026-10-13', supplier:'Alfa', branch:'BH', account:'Caixa', order:'1',
      product:'Material', description:'', unit:10, quantity:1, freight:0, total:10},
  ]})}});
  const decorated = decorateReportPrint(view, {action:'open-payment-ledger', loadLogo:async () => new Uint8Array(),
    buildPdf:async () => {throw new Error('PDF unavailable');}, previewMedia:async pending => await pending});
  t.after(() => {decorated.destroy(); dom.window.close();});
  await decorated.open();
  view.element.querySelector('.report-print-button').click(); await tick(); await tick();
  const notice = view.element.querySelector('.report-pdf-status');
  assert.equal(notice.hidden, false); assert.match(notice.textContent, /não foi possível/i);
  assert.equal(dom.window.getComputedStyle(notice).gridColumn, '1 / -1', 'PDF errors have their own full toolbar row');
  closeControl(view.element).click(); assert.equal(view.element.hidden, true);
});

// Break: replacing the exposed dialog with a backdrop breaks existing keyboard consumers.
test('cargos public dialog retains its keyboard entry and traversal', async t => {
  const ctx = setup(t, cases.find(entry => entry[0] === 'cargos-view'), {immediate:true});
  await ctx.open();
  const dialog = ctx.view.element;
  dialog.focus(); assert.equal(ctx.doc.activeElement, dialog);
  dialog.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', {key:'Tab', bubbles:true, cancelable:true}));
  assert.equal(ctx.doc.activeElement, dialog.querySelector('[aria-label="Atualizar tabela de cargos"]'));
});
