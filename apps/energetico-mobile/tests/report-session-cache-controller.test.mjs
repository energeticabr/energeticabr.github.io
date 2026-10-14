import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { createGraphClient } from '../../../portal/data/graph-client.js';
import { notifyDataMutation } from '../../../portal/data/data-mutations.js';
import { createSupplierPayrollReportData } from '../src/chat/supplier-payroll-report-data.js';
import { createCargosData } from '../src/chat/cargos-data.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const reports = [
  ['open-payment-ledger', 'paymentLedgerFactory', 'paymentLedgerDataFactory', 'loadPaymentsSnapshot'],
  ['open-provision-report', 'provisionReportFactory', 'paymentLedgerDataFactory', 'loadProvisionReportSnapshot'],
  ['open-management-report', 'managementReportFactory', 'paymentLedgerDataFactory', 'loadSnapshot'],
  ['open-order-validation-report', 'orderValidationReportFactory', 'paymentLedgerDataFactory', 'loadOrderValidationSnapshot'],
  ['open-cargos-table', 'cargosFactory', 'cargosDataFactory', 'loadSnapshot'],
  ['open-attendance-summary', 'attendanceSummaryFactory', 'attendanceSummaryDataFactory', 'loadSnapshot'],
  ['open-stage-progress', 'stageProgressFactory', 'stageProgressDataFactory', 'loadSnapshot'],
  ['open-commercial-receipts', 'commercialReceiptsViewFactory', 'commercialReceiptsDataFactory', 'loadSnapshot'],
  ['open-commercial-milestones', 'commercialMilestonesViewFactory', 'commercialMilestonesDataFactory', 'loadSnapshot'],
  ['open-commercial-documents', 'commercialDocumentsViewFactory', 'commercialDocumentsDataFactory', 'loadSnapshot'],
  ['open-sac-pathologies', 'sacPathologiesViewFactory', 'sacPathologiesDataFactory', 'loadSnapshot'],
  ['open-quotation-report', 'quotationReportViewFactory', 'quotationReportDataFactory', 'loadSnapshot'],
  ['open-depreciation-report', 'depreciationReportViewFactory', 'depreciationReportDataFactory', 'loadSnapshot'],
  ['open-document-control-report', 'documentControlReportViewFactory', 'documentControlReportDataFactory', 'loadSnapshot'],
  ['open-task-association-report', 'taskAssociationReportViewFactory', 'taskAssociationReportDataFactory', 'loadSnapshot'],
  ['open-delegated-deadline-report', 'delegatedDeadlineReportViewFactory', 'delegatedDeadlineReportDataFactory', 'loadSnapshot'],
  ['open-supplier-workforce-report', 'supplierWorkforceReportViewFactory', 'supplierWorkforceReportDataFactory', 'loadSnapshot'],
  ['open-pending-supplier-payments-report', 'pendingSupplierPaymentsReportViewFactory', 'pendingSupplierPaymentsReportDataFactory', 'loadSnapshot'],
  ['open-pending-work-diaries-report', 'pendingWorkDiariesReportViewFactory', 'pendingWorkDiariesReportDataFactory', 'loadSnapshot'],
  ['open-general-summary-report', 'generalSummaryReportViewFactory', 'generalSummaryReportDataFactory', 'loadReport'],
  ['open-contractor-control-report', 'contractorControlReportViewFactory', 'contractorControlReportDataFactory', 'loadOverview'],
  ['open-supplier-payroll-report', 'supplierPayrollReportFactory', 'supplierPayrollReportDataFactory', 'loadSnapshot'],
];

function harness(t, overrides = {}) {
  const dom = new JSDOM('<body><main id="app"></main></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const handlers = new Map(), panels = [];
  let currentAccount = { homeAccountId: 'cache-user', username: 'cache@example.test' }, sequence = 0;
  const auth = { initialize: async () => currentAccount, signIn: async () => currentAccount,
    getAccount: () => currentAccount, getToken: async () => 'token', signOut: async () => {} };
  const view = { render() {}, on(type, handler) { handlers.set(type, handler); return () => handlers.delete(type); },
    emit: (type, value = {}) => handlers.get(type)?.({ type, ...value }), focusComposer() {}, destroy() {} };
  function panelFactory(action, method) {
    return async ({ data, ...callbacks }) => {
      const element = dom.window.document.createElement('div');
      element.innerHTML = '<section role="dialog" class="pl-dialog"><header class="pl-header"><h2>Report</h2></header><button aria-label="Atualizar relatório"><span>⟳</span></button></section>';
      dom.window.document.body.append(element);
      let latest;
      const panel = { element, data, callbacks, action, options: {}, get latest() { return latest; },
        async open() { element.hidden = false; latest = await data[method](panel.options); },
        close() { element.hidden = true; }, destroy() { element.remove(); } };
      panel.refresh = element.querySelector('button');
      panel.refresh.addEventListener('click', () => { panel.refreshPromise = panel.open(); });
      panels.push(panel);
      return panel;
    };
  }
  const factories = Object.fromEntries(reports.map(([action, viewFactory, , method]) => [viewFactory, panelFactory(action, method)]));
  const controller = createAppController({ store: createConversationStore({ randomUUID: () => `cache-${++sequence}` }),
    view, auth, client: { sendText: async () => ({ status: 'processed', messages: [] }) },
    native: { importSharedItems: async () => [] },
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [] }),
    ...factories, ...overrides });
  t.after(() => { controller.stop(); globalThis.document = previous; dom.window.close(); });
  return { controller, view, panels, auth, setAccount(value) { currentAccount = value; } };
}

for (const [action, , dataFactory, method] of reports) {
  test(`${action} reuses its complete snapshot after panel/source recreation`, async t => {
    let reads = 0;
    const h = harness(t, {
      [dataFactory]: async () => Object.freeze({ [method]: async () => ({ rows: [{ id: '42', total: ++reads }] }) }),
      // Use a disjoint report to exercise the real controller disposal path.
      quotationReportDataFactory: async () => ({ loadSnapshot: async () => ({ rows: [] }) }),
      ...(action === 'open-quotation-report' ? { quotationReportDataFactory: async () => ({ loadSnapshot: async () => ({ rows: [{ id: '42', total: ++reads }] }) }),
        documentControlReportDataFactory: async () => ({ loadSnapshot: async () => ({ rows: [] }) }) } : {}),
    });
    await h.controller.start();
    assert.equal(await h.view.emit(action), true);
    assert.deepEqual(h.panels.at(-1).latest.rows, [{ id: '42', total: 1 }]);
    const first = h.panels.at(-1);
    assert.equal(await h.view.emit(action === 'open-quotation-report' ? 'open-document-control-report' : 'open-quotation-report'), true);
    assert.equal(await h.view.emit(action), true);
    assert.notEqual(h.panels.at(-1), first);
    assert.deepEqual(h.panels.at(-1).latest.rows, [{ id: '42', total: 1 }]);
    assert.equal(reads, 1);
  });
}

test('orders gallery sync makes a cached order validation report read its sources again', async t => {
  let reads = 0, galleryOptions;
  const h = harness(t, {
    paymentLedgerDataFactory: async () => ({ loadOrderValidationSnapshot: async () => ({ rows: [{ id: '42', version: ++reads }] }) }),
    ordersGalleryDataFactory: async () => ({ loadSnapshot: async () => ({ rows: [] }), invalidateRelatedReports() {} }),
    ordersGalleryFactory: async options => { galleryOptions = options; return { open() {}, destroy() {} }; },
  });
  await h.controller.start();
  assert.equal(await h.view.emit('open-order-validation-report'), true);
  assert.equal(h.panels.at(-1).latest.rows[0].version, 1);
  await h.view.emit('select-reply', { replyId: 'action_orders_gallery', label: 'GALERIA PEDIDOS' });
  assert.ok(galleryOptions?.invalidateRelatedReports);
  galleryOptions.invalidateRelatedReports();
  assert.equal(await h.view.emit('open-order-validation-report'), true);
  assert.equal(h.panels.at(-1).latest.rows[0].version, 2);
});

test('launch gallery sync discards the supplier payroll report source and snapshot', async t => {
  let reads = 0, galleryOptions;
  const h = harness(t, {
    supplierPayrollReportDataFactory: async () => ({ loadSnapshot: async () => ({ rows: [{ id: '42', version: ++reads }] }), loadPaymentsForPayrollIds: async () => [] }),
    ordersGalleryDataFactory: async () => ({ loadSnapshot: async () => ({ rows: [] }), invalidateRelatedReports() {} }),
    launchGalleryFactory: async options => { galleryOptions = options; return { open() {}, destroy() {} }; },
  });
  await h.controller.start();
  assert.equal(await h.view.emit('open-supplier-payroll-report'), true);
  assert.equal(h.panels.at(-1).latest.rows[0].version, 1);
  await h.view.emit('select-reply', { replyId: 'action_launch_gallery', label: 'GALERIA LANÇAMENTOS' });
  assert.ok(galleryOptions?.invalidateRelatedReports);
  await galleryOptions.invalidateRelatedReports();
  assert.equal(await h.view.emit('open-supplier-payroll-report'), true);
  assert.equal(h.panels.at(-1).latest.rows[0].version, 2);
});

test('payroll gallery sync discards the supplier payroll report source and snapshot', async t => {
  let reads = 0, galleryOptions;
  const h = harness(t, {
    supplierPayrollReportDataFactory: async () => ({ loadSnapshot: async () => ({ rows: [{ id: '42', version: ++reads }] }), loadPaymentsForPayrollIds: async () => [] }),
    hrPayrollGalleryDataFactory: async () => ({ loadPage: async () => ({ rows: [] }), loadPaymentsForPayrollId: async () => [], invalidateRelatedReports() {} }),
    hrPayrollGalleryFactory: async options => { galleryOptions = options; return { open() {}, destroy() {} }; },
  });
  await h.controller.start();
  assert.equal(await h.view.emit('open-supplier-payroll-report'), true);
  assert.equal(h.panels.at(-1).latest.rows[0].version, 1);
  await h.view.emit('select-reply', { replyId: 'action_hr_gallery_idfolha', label: 'GALERIA IDFOLHA' });
  assert.ok(galleryOptions?.invalidateRelatedReports);
  galleryOptions.invalidateRelatedReports();
  assert.equal(await h.view.emit('open-supplier-payroll-report'), true);
  assert.equal(h.panels.at(-1).latest.rows[0].version, 2);
});

test('refresh capture invalidates before the view handler, including an icon click', async t => {
  let reads = 0;
  const h = harness(t, { quotationReportDataFactory: async () => ({ loadSnapshot: async () => ({ rows: [{ id: ++reads }] }) }) });
  await h.controller.start(); await h.view.emit('open-quotation-report');
  const panel = h.panels[0];
  await panel.open(); assert.equal(reads, 1);
  panel.refresh.querySelector('svg').dispatchEvent(new panel.element.ownerDocument.defaultView.MouseEvent('click', { bubbles: true })); await panel.refreshPromise;
  assert.deepEqual(panel.latest.rows, [{ id: 2 }]);
  await panel.open(); assert.equal(reads, 2);
});

test('parameter keys separate reads but ignore signals and object property order', async t => {
  let reads = 0;
  const h = harness(t, { quotationReportDataFactory: async () => ({ loadSnapshot: async () => ({ rows: [{ id: ++reads }] }) }) });
  await h.controller.start(); await h.view.emit('open-quotation-report');
  const { data } = h.panels[0];
  assert.equal((await data.loadSnapshot({ filters: { start: 'a', end: 'b' }, signal: new AbortController().signal })).rows[0].id, 2);
  assert.equal((await data.loadSnapshot({ signal: new AbortController().signal, filters: { end: 'b', start: 'a' } })).rows[0].id, 2);
  assert.equal((await data.loadSnapshot({ filters: { start: 'c', end: 'b' } })).rows[0].id, 3);
  await assert.rejects(data.loadSnapshot({ filters: { start: 'a', end: 'b' }, signal: AbortSignal.abort() }), { name: 'AbortError' });
});

test('failed, aborted and superseded completions cannot fill or overwrite the cache', async t => {
  let mode = 'fail', reads = 0;
  const slow = deferred();
  const h = harness(t, { quotationReportDataFactory: async () => ({ async loadSnapshot() {
    reads++; if (mode === 'fail') throw new Error('unavailable');
    if (mode === 'slow') return slow.promise;
    return { rows: [{ id: 'current' }] };
  } }) });
  await h.controller.start(); assert.equal(await h.view.emit('open-quotation-report'), false);
  mode = 'slow'; const data = h.panels[0].data;
  const old = data.loadSnapshot(); const rejection = assert.rejects(old, { name: 'AbortError' });
  await tick(); mode = 'ok';
  assert.deepEqual((await data.loadSnapshot()).rows, [{ id: 'current' }]);
  await rejection; slow.resolve({ rows: [{ id: 'obsolete' }] }); await tick();
  assert.deepEqual((await data.loadSnapshot()).rows, [{ id: 'current' }]);
  assert.equal(reads, 3);
});

test('logout and a new account reset cached snapshots and reject previous source handles', async t => {
  let reads = 0;
  const h = harness(t, { quotationReportDataFactory: async () => ({ loadSnapshot: async () => ({ rows: [{ id: ++reads }] }) }) });
  await h.controller.start(); await h.view.emit('open-quotation-report'); const old = h.panels[0].data;
  await h.view.emit('sign-out'); h.setAccount({ homeAccountId: 'second-user' }); await h.view.emit('sign-in');
  await assert.rejects(old.loadSnapshot(), { name: 'AbortError' });
  await h.view.emit('open-quotation-report'); assert.deepEqual(h.panels.at(-1).latest.rows, [{ id: 2 }]);
  h.controller.stop(); await assert.rejects(h.panels.at(-1).data.loadSnapshot(), { name: 'AbortError' });
});

test('a changed auth account rejects a snapshot hit before network work', async t => {
  let reads = 0;
  const h = harness(t, { quotationReportDataFactory: async () => ({ loadSnapshot: async () => ({ rows: [{ id: ++reads }] }) }) });
  await h.controller.start(); await h.view.emit('open-quotation-report');
  h.setAccount({ homeAccountId: 'other-user' });
  await assert.rejects(h.panels[0].data.loadSnapshot(), { name: 'AbortError' });
  assert.equal(reads, 1);
});

test('real Graph read batches retain snapshots; writes and uncertain writes invalidate them', async t => {
  let reads = 0, fail = false;
  const graph = createGraphClient(async () => 'token', { fetch: async () => {
    if (fail) throw new Error('lost response');
    return { ok: true, status: 200, json: async () => ({ responses: [] }) };
  } });
  const h = harness(t, { quotationReportDataFactory: async () => ({ loadSnapshot: async () => ({ rows: [{ id: ++reads }] }) }) });
  await h.controller.start(); await h.view.emit('open-quotation-report'); const panel = h.panels[0];
  await graph.request('/$batch', { method: 'POST', body: { requests: [{ id: '1', method: 'GET', url: '/sites/site/lists' }] } });
  await panel.open(); assert.equal(reads, 1);
  await graph.request('/$batch', { method: 'POST', body: JSON.stringify({ requests: [{ id: '2', method: 'PATCH', url: '/sites/site/lists/list/items/1/fields', body: { Title: 'new' } }] }) });
  await panel.open(); assert.equal(reads, 2);
  fail = true;
  await assert.rejects(graph.request('/sites/site/lists/list/items', { method: 'POST', body: { fields: { Title: 'new' } } }));
  await panel.open(); assert.equal(reads, 3);
});

test('injected gallery writes invalidate other report snapshots even when a partial write throws', async t => {
  let reads = 0, gallery;
  const h = harness(t, {
    quotationReportDataFactory: async () => ({ loadSnapshot: async () => ({ rows: [{ id: ++reads }] }) }),
    paymentProgrammingGalleryDataFactory: async () => ({ loadSnapshot: async () => ({}), async saveEditor() { throw new Error('partial write'); } }),
    paymentProgrammingGalleryFactory: async options => { gallery = options; return { open() {}, destroy() {} }; },
  });
  await h.controller.start(); await h.view.emit('open-quotation-report');
  assert.equal(await h.view.emit('select-reply', { replyId: 'action_payment_programming_gallery' }), true);
  await assert.rejects(gallery.data.saveEditor(), /partial write/);
  await h.view.emit('open-quotation-report'); assert.deepEqual(h.panels.at(-1).latest.rows, [{ id: 2 }]);
});

test('payroll priming retries are shared by all surviving detail readers', async t => {
  const primes=[];
  let reads=0;
  const h=harness(t,{supplierPayrollReportDataFactory:async()=>({
    loadSnapshot({signal}={}) {
      if(++reads===1)return Promise.resolve({complete:true,sheets:[]});
      const pending=deferred();primes.push(pending);
      signal.addEventListener('abort',()=>pending.reject(Object.assign(new Error('cancelled'),{name:'AbortError'})),{once:true});
      return pending.promise;
    },
    loadPaymentsForPayrollIds:async ids=>ids.map(id=>({id,launchId:'fresh-'+id})),
  })});
  await h.controller.start();await h.view.emit('open-supplier-payroll-report');
  const data=h.panels[0].data;
  notifyDataMutation();
  const callers=Array.from({length:3},()=>new AbortController());
  const requests=callers.map((caller,index)=>data.loadPaymentsForPayrollIds([String(index)],{signal:caller.signal}));
  const outcomes=Promise.allSettled(requests);
  await tick();assert.equal(primes.length,1);
  callers[0].abort();await tick();await tick();
  for(const prime of primes.slice(1))prime.resolve({complete:true,sheets:[]});
  const results=await outcomes;
  assert.equal(results[0].status,'rejected');assert.equal(results[0].reason.name,'AbortError');
  assert.deepEqual(results.slice(1).map(result=>result.status),['fulfilled','fulfilled']);
  assert.deepEqual(results.slice(1).map(result=>result.value[0].launchId),['fresh-1','fresh-2']);
  assert.equal(reads,3,'one initial snapshot, one aborted prime and one shared retry');
});

test('real supplier payroll source retains complete payment state for unseen expansions after recreation', async t => {
  const scans = [], gets = [];
  let launchOffset = 70;
  const columns = {
    FORNECEDORES: ['CADASTRO', 'PROFISSÃO'], IDFOLHA: ['FORNECEDOR', 'MESREFERENCIA'],
    FOLHAPGTO: ['FORNECEDOR', 'TIPOPGTO', 'DATA', 'IDFOLHA', 'IDLANCAMENTO', 'VALORUNITARIO', 'QTD'],
    LANCAMENTOS: ['VALOR UNITÁRIO', 'QUANTIDADE'],
  };
  const repository = {
    resolveList: async (_site, names) => ({ status: 'resolved', id: names[0] }),
    getColumns: async (_site, list) => columns[list].map((displayName, i) => ({ name: `f${i}`, displayName })),
    async getItemsPage(_site, list) {
      scans.push(list);
      const items = list === 'FORNECEDORES' ? [{ id: '1', fields: { f0: 'Ana', f1: 'Pedreira' } }]
        : list === 'IDFOLHA' ? [2, 3].map(id => ({ id: String(id), fields: { f0: 'Ana', f1: '10/2026' } }))
          : [2, 3].map(id => ({ id: String(id), fields: { f0: 'Ana', f1: 'SALÁRIO', f2: '2026-11-05', f3: String(id), f4: String(id + launchOffset), f5: 10, f6: 2 } }));
      return { items, hasMore: false, nextLink: '' };
    },
    async getItem(_site, list, id) { gets.push([list, id]); return { id, fields: { f0: 10, f1: 2 } }; },
  };
  const h = harness(t, {
    supplierPayrollReportDataFactory: async () => createSupplierPayrollReportData({ repository }),
    quotationReportDataFactory: async () => ({ loadSnapshot: async () => ({ rows: [] }) }),
  });
  await h.controller.start(); await h.view.emit('open-supplier-payroll-report');
  assert.equal((await h.panels.at(-1).data.loadPaymentsForPayrollIds(['2']))[0].totalCents, 2000);
  await h.view.emit('open-quotation-report'); await h.view.emit('open-supplier-payroll-report');
  assert.equal((await h.panels.at(-1).data.loadPaymentsForPayrollIds(['3']))[0].totalCents, 2000);
  assert.equal(scans.length, 3, 'the three complete lists survive panel recreation');
  assert.deepEqual(gets, [['LANCAMENTOS', '72'], ['LANCAMENTOS', '73']]);
  const panel = h.panels.at(-1);
  assert.equal((await panel.data.loadPaymentsForPayrollIds(['2']))[0].launchId, '72');
  assert.equal(gets.length, 2, 'expanded payroll IDs are also cached across recreation');
  launchOffset = 80;
  panel.refresh.click(); await panel.refreshPromise;
  assert.equal(scans.length, 6, 'refresh rebuilds the retained source full list state');
  assert.equal((await panel.data.loadPaymentsForPayrollIds(['2']))[0].launchId, '82');
  assert.equal((await panel.data.loadPaymentsForPayrollIds(['3']))[0].launchId, '83');
  assert.deepEqual(gets.slice(2), [['LANCAMENTOS', '82'], ['LANCAMENTOS', '83']]);
  launchOffset = 90;
  notifyDataMutation();
  // A still-mounted report can expand an unseen group after another flow's
  // write; its old overview is not permission to reuse the old source links.
  assert.equal((await panel.data.loadPaymentsForPayrollIds(['2']))[0].launchId, '92');
  assert.equal((await panel.data.loadPaymentsForPayrollIds(['3']))[0].launchId, '93');
  assert.equal(scans.length,9,'mutation must rebuild source state before a detail-first read');
});

for (const reason of ['refresh', 'write', 'logout']) {
  test(`a slow completion after ${reason} cannot populate the new cache generation`, async t => {
    const slow = deferred(); let reads = 0;
    const h = harness(t, { quotationReportDataFactory: async () => ({ loadSnapshot: async () => ++reads === 1 ? slow.promise : { rows: [{ id: 'new' }] } }) });
    await h.controller.start();
    const opening = h.view.emit('open-quotation-report'); await tick();
    if (reason === 'refresh') {
      h.panels[0].refresh.click(); await h.panels[0].refreshPromise;
    } else if (reason === 'write') {
      const graph = createGraphClient(async () => 'token', { fetch: async () => ({ status: 204, ok: true }) });
      await graph.request('/sites/a/lists/b/items/1', { method: 'DELETE' });
    } else {
      await h.view.emit('sign-out'); await h.view.emit('sign-in');
    }
    slow.resolve({ rows: [{ id: 'old' }] }); assert.equal(await opening, false);
    assert.equal(await h.view.emit('open-quotation-report'), true);
    assert.deepEqual(h.panels.at(-1).latest.rows, [{ id: 'new' }]);
    assert.equal(reads, 2);
  });
}

test('real controller, CARGOS source, repository and Graph reuse both pages after recreation', async t => {
  const requests = [];
  let salary = 1000;
  const sourceFactory = async ({ tokenProvider }) => createCargosData({ tokenProvider,
    siteConfig: { personal: { host: 'example.sharepoint.com', path: '/sites/work' } },
    fetchImpl: async (url, options) => {
      requests.push({ url, method: options.method });
      assert.equal(options.headers.Authorization, 'Bearer token');
      let payload;
      const path = new URL(url).pathname;
      if (path.endsWith(':/sites/work')) payload = { id: 'site' };
      else if (path.endsWith('/lists')) payload = { value: [{ id: 'roles', displayName: 'CARGOS', list: { template: 'genericList' } }] };
      else if (path.endsWith('/columns')) payload = { value: ['CARGO', 'SALARIO', 'VALEALIMENTACAO', 'PREMIO', 'VALE TRANSPORTE']
        .map((displayName, i) => ({ name: `f${i}`, displayName })) };
      else if (path.endsWith('/items')) {
        const second = new URL(url).searchParams.has('$skiptoken');
        payload = { value: second ? [{ id: '2', fields: { f0: 'PEDREIRO I', f1: salary, f2: 10, f3: 20, f4: 30 } }] : [],
          ...(!second ? { '@odata.nextLink': 'https://graph.microsoft.com/v1.0/sites/site/lists/roles/items?$skiptoken=next' } : {}) };
      } else assert.fail(`Unexpected Graph URL: ${url}`);
      return { status: 200, ok: true, json: async () => payload };
    },
  });
  const h = harness(t, { cargosDataFactory: sourceFactory,
    quotationReportDataFactory: async () => ({ loadSnapshot: async () => ({ rows: [] }) }) });
  await h.controller.start(); assert.equal(await h.view.emit('open-cargos-table'), true);
  const first = h.panels.at(-1).latest;
  assert.equal(first.rows.find(row => row.cargo === 'PEDREIRO I').total, 1060);
  assert.equal(requests.filter(request => new URL(request.url).pathname.endsWith('/items')).length, 2);
  const initialReads = requests.length;
  await h.view.emit('open-quotation-report'); await h.view.emit('open-cargos-table');
  assert.deepEqual(h.panels.at(-1).latest, first); assert.equal(requests.length, initialReads);
  salary = 2000;
  h.panels.at(-1).refresh.click(); await h.panels.at(-1).refreshPromise;
  assert.equal(h.panels.at(-1).latest.rows.find(row => row.cargo === 'PEDREIRO I').total, 2060);
  assert.equal(requests.length, initialReads * 2);
});

test('contractor loadDetails separates IDs, survives recreation and is invalidated with overview refresh', async t => {
  const calls = []; let version = 1;
  const h = harness(t, {
    contractorControlReportDataFactory: async () => ({ loadOverview: async () => ({ rows: [{ id: version }] }),
      loadDetails: async id => { calls.push(id); return { launches: [{ id, version }], measurements: [] }; } }),
    quotationReportDataFactory: async () => ({ loadSnapshot: async () => ({ rows: [] }) }),
  });
  await h.controller.start(); await h.view.emit('open-contractor-control-report');
  let data = h.panels.at(-1).data;
  assert.deepEqual((await data.loadDetails('a')).launches, [{ id: 'a', version: 1 }]);
  assert.deepEqual((await data.loadDetails('b')).launches, [{ id: 'b', version: 1 }]);
  await h.view.emit('open-quotation-report'); await h.view.emit('open-contractor-control-report');
  const panel = h.panels.at(-1); data = panel.data;
  await data.loadDetails('a', { signal: new AbortController().signal });
  await data.loadDetails('b'); assert.deepEqual(calls, ['a', 'b']);
  version = 2; panel.refresh.click(); await panel.refreshPromise;
  assert.deepEqual((await data.loadDetails('a')).launches, [{ id: 'a', version: 2 }]);
  assert.deepEqual((await data.loadDetails('b')).launches, [{ id: 'b', version: 2 }]);
  assert.deepEqual(calls, ['a', 'b', 'a', 'b']);
});
