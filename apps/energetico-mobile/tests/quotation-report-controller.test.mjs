import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { JSDOM } from 'jsdom';

const localReports = [
  ['action_sac_pathologies', 'sacPathologiesViewFactory', 'sacPathologiesDataFactory'],
  ['action_payment_ledger', 'paymentLedgerFactory', 'paymentLedgerDataFactory'],
  ['action_management_report', 'managementReportFactory', 'paymentLedgerDataFactory'],
  ['provision-report', 'provisionReportFactory', 'paymentLedgerDataFactory'],
  ['order-validation-report', 'orderValidationReportFactory', 'paymentLedgerDataFactory'],
  ['action_cargos_table', 'cargosFactory', 'cargosDataFactory'],
  ['action_attendance_summary', 'attendanceSummaryFactory', 'attendanceSummaryDataFactory'],
  ['action_stage_progress', 'stageProgressFactory', 'stageProgressDataFactory'],
  ['action_commercial_receipts', 'commercialReceiptsViewFactory', 'commercialReceiptsDataFactory'],
  ['action_commercial_milestones', 'commercialMilestonesViewFactory', 'commercialMilestonesDataFactory'],
  ['action_commercial_documents', 'commercialDocumentsViewFactory', 'commercialDocumentsDataFactory'],
  ['action_launch_gallery', 'launchGalleryFactory', 'ordersGalleryDataFactory'],
  ['action_orders_gallery', 'ordersGalleryFactory', 'ordersGalleryDataFactory'],
  ['action_tasks_gallery', 'tasksGalleryFactory', 'tasksGalleryDataFactory'],
  ['action_payment_programming_gallery', 'paymentProgrammingGalleryFactory', 'paymentProgrammingGalleryDataFactory'],
  ['action_recurring_expenses_gallery', 'recurringExpensesGalleryFactory', 'recurringExpensesGalleryDataFactory'],
  ['action_asset_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory'],
  ['action_hr_gallery_idfolha', 'hrPayrollGalleryFactory', 'hrPayrollGalleryDataFactory'],
  ['action_hr_gallery_folhapgto', 'hrPayrollGalleryFactory', 'hrPayrollGalleryDataFactory'],
];

for (const [replyId, viewFactory, dataFactory] of localReports) {
  for (const direction of ['to quotation report', 'from quotation report']) {
    // Catches overlapping local modals and a superseded quotation report request retaining
    // credentials. The doubles replace only separately tested UI/network.
    test(`switching ${direction} with ${replyId} closes the old report locally`, async t => {
      let oldPanel, signal;
      const query = deferred();
      const h = harness(t, {
        [dataFactory]: async () => ({
          loadSnapshot: async () => snapshot,
          loadPage: async () => ({ rows: [], complete: true }),
          loadPaymentsForPayrollId: async () => [],
        }),
        [viewFactory]: async ({ data }) => (oldPanel = {
          data, closes: 0, opens: 0, open() { this.opens++; },
          close() { this.closes++; }, destroy() { this.close(); },
        }),
        presencePaymentReportDataFactory: async () => ({}),
        extraReportsFactory: async () => [],
        quotationReportDataFactory: async () => ({ loadSnapshot(options) {
          signal = options.signal; return query.promise;
        } }),
      });
      await h.controller.start();
      const before = h.calls.length;
      if (direction === 'to quotation report') {
        assert.equal(await h.view.emit('select-reply', { replyId }), true);
        assert.equal(await h.view.emit('open-quotation-report'), true);
        assert.equal(oldPanel.closes, 1);
      } else {
        assert.equal(await h.view.emit('open-quotation-report'), true);
        const data = h.panels[0].data;
        const load = data.loadSnapshot();
        const rejected = assert.rejects(load, { name: 'AbortError' });
        await tick();
        assert.equal(await h.view.emit('select-reply', { replyId }), true);
        assert.equal(signal.aborted, true);
        await rejected;
        assert.equal(h.panels[0].destroys, 1);
        await assert.rejects(data.loadSnapshot(), { name: 'AbortError' });
        query.resolve(snapshot);
        assert.equal(await h.view.emit('open-quotation-report'), true);
        assert.equal(h.panels.length, 2, 'cleanup requires a fresh view factory');
        assert.notEqual(h.panels[1].data, data);
      }
      assert.equal(h.calls.length, before);
      assert.equal(h.store.getState().activeFlow, null);
    });
  }
}

test('another report cancels a pending quotation report factory promptly and disposes its late view', async t => {
  const factory = deferred();
  let opens = 0, destroys = 0, settled = false;
  const h = harness(t, {
    quotationReportViewFactory: () => factory.promise,
    commercialDocumentsViewFactory: async () => ({ open() {}, close() {}, destroy() {} }),
  });
  await h.controller.start();
  const pending = Promise.resolve(h.view.emit('open-quotation-report')).then(result => { settled = true; return result; });
  await tick();
  assert.equal(await h.view.emit('open-commercial-documents'), true);
  await tick();
  assert.equal(settled, true);
  assert.equal(await pending, false);
  factory.resolve({ open() { opens++; }, destroy() { destroys++; } });
  await tick();
  assert.equal(opens, 0);
  assert.equal(destroys, 1);
});

test('quotation report supersedes a pending commercial documents factory without allowing its late view', async t => {
  const factory = deferred();
  let opens = 0, destroys = 0, settled = false;
  const h = harness(t, { commercialDocumentsViewFactory: () => factory.promise });
  await h.controller.start();
  const pending = h.view.emit('open-commercial-documents').then(result => { settled = true; return result; });
  await tick();
  assert.equal(await h.view.emit('open-quotation-report'), true);
  await tick();
  assert.equal(settled, true);
  assert.equal(await pending, false);
  factory.resolve({ open() { opens++; }, destroy() { destroys++; } });
  await tick();
  assert.equal(opens, 0);
  assert.equal(destroys, 1);
});

test('CARGOS can reopen with fresh data after switching through quotation report', async t => {
  const cargosPanels = [];
  const h = harness(t, {
    cargosDataFactory: async ({ tokenProvider }) => ({ async loadSnapshot() { await tokenProvider(['Sites.Read.All']); return snapshot; } }),
    cargosFactory: async ({ data }) => {
      const panel = { destroys: 0, async open() { await data.loadSnapshot(); }, close() {}, destroy() { this.destroys++; } };
      cargosPanels.push(panel); return panel;
    },
  });
  await h.controller.start();
  assert.equal(await h.view.emit('open-cargos-table'), true);
  assert.equal(await h.view.emit('open-quotation-report'), true);
  assert.equal(await h.view.emit('open-cargos-table'), true);
  assert.equal(cargosPanels.length, 2);
  assert.equal(cargosPanels[0].destroys, 1);
});

for (const stage of ['source', 'view']) {
  test(`quotation report invalidates a pending CARGOS ${stage} and discards a late panel`, async t => {
    const pendingStage = deferred();
    let opens = 0, destroys = 0;
    const panel = { open() { opens++; }, close() {}, destroy() { destroys++; } };
    const h = harness(t, {
      cargosDataFactory: () => stage === 'source' ? pendingStage.promise : Promise.resolve({ loadSnapshot: async () => snapshot }),
      cargosFactory: () => stage === 'view' ? pendingStage.promise : Promise.resolve(panel),
    });
    await h.controller.start();
    const pending = h.view.emit('open-cargos-table');
    await tick();
    assert.equal(await h.view.emit('open-quotation-report'), true);
    pendingStage.resolve(stage === 'source' ? { loadSnapshot: async () => snapshot } : panel);
    assert.equal(await pending, false);
    assert.equal(opens, 0, 'superseded CARGOS must never open over quotation report');
    assert.equal(destroys, stage === 'view' ? 1 : 0);
    assert.equal(h.panels[0].destroys, 0);
  });
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const authRequired = () => Object.assign(new Error('Expired'), { code: 'AUTH_REQUIRED' });
const scopes = ['Sites.Read.All'];
const activeFlow = { id: 'stage_validation', title: 'Validação em andamento' };
const snapshot = { quotes: [], budgets: [] };

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Exercise the real controller/store; replace only native/auth/network and
// the report UI, which are separately owned integration boundaries.
function harness(t, options = {}) {
  let sequence = 0;
  const handlers = new Map(), calls = [], renders = [], panels = [];
  const view = {
    render(state) { renders.push(state); },
    on(type, handler) { handlers.set(type, handler); return () => handlers.delete(type); },
    emit(type, value = {}) { return handlers.get(type)?.({ type, ...value }); },
    focusComposer() {}, destroy() { handlers.clear(); },
  };
  const account = { homeAccountId: 'commercial-user', name: 'Usuário' };
  const auth = {
    initialize: async () => account, signIn: async () => account,
    getToken: async () => 'sharepoint-token', signOut: async () => {}, ...options.auth,
  };
  const store = createConversationStore({ randomUUID: () => `commercial-${++sequence}` });
  const controller = createAppController({
    store, view, auth, client: { async sendText(payload) {
      calls.push(payload); return { status: 'processed', messages: [] };
    } },
    native: { importSharedItems: async () => [] },
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [] }),
    quotationReportDataFactory: async () => ({ loadSnapshot: async () => snapshot }),
    quotationReportViewFactory: async ({ data, document }) => {
      const panel = { data, document, opens: 0, closes: 0, destroys: 0,
        open() { this.opens++; }, close() { this.closes++; }, destroy() { this.destroys++; } };
      panels.push(panel);
      return panel;
    },
    ...options, auth,
  });
  t.after(() => controller.stop());
  return { controller, view, auth, calls, renders, store, panels };
}

async function open(h) {
  await h.controller.start();
  assert.equal(await h.view.emit('open-quotation-report'), true);
  return h.panels.at(-1).data;
}

test('HOME and reply open one local quotation report report, with an independent read-only data source', async t => {
  let sourceCreates = 0, receivedOptions;
  const requestedScopes = [];
  const h = harness(t, {
    paymentLedgerDataFactory: async () => { assert.fail('quotation report must not use spending data'); },
    attendanceSummaryDataFactory: async () => { assert.fail('quotation report must not use attendance data'); },
    stageProgressDataFactory: async () => { assert.fail('quotation report must not use stage data'); },
    commercialReceiptsDataFactory: async () => { assert.fail('quotation report must not use receipts data'); },
    commercialMilestonesDataFactory: async () => { assert.fail('quotation report must not use milestones data'); },
    quotationReportDataFactory: async ({ tokenProvider }) => {
      sourceCreates++;
      return { async loadSnapshot(options) {
        receivedOptions = options;
        assert.equal(await tokenProvider(scopes), 'sharepoint-token');
        return snapshot;
      } };
    },
    auth: { getToken: async value => { requestedScopes.push(value); return 'sharepoint-token'; } },
  });
  await h.controller.start();
  const before = h.calls.length;
  assert.equal(sourceCreates, 0);
  assert.deepEqual(await Promise.all([
    h.view.emit('open-quotation-report'),
    h.view.emit('select-reply', { replyId: 'action_quotation_report', label: 'Marcos comerciais' }),
  ]), [true, true]);
  assert.equal(h.panels.length, 1);
  assert.equal(h.panels[0].opens, 1);
  assert.equal(h.panels[0].document, globalThis.document);
  assert.deepEqual(Object.keys(h.panels[0].data), ['loadSnapshot']);
  assert.equal(sourceCreates, 0, 'opening the popup does not eagerly load SharePoint');
  const caller = new AbortController();
  assert.equal(await h.panels[0].data.loadSnapshot({ signal: caller.signal, trace: 'commercial' }), snapshot);
  assert.equal(sourceCreates, 1);
  assert.equal(receivedOptions.trace, 'commercial');
  assert.equal(receivedOptions.signal.aborted, false);
  assert.deepEqual(requestedScopes, [['Sites.Read.All']]);
  assert.equal(await h.view.emit('open-quotation-report'), true);
  assert.equal(h.panels.length, 1, 'the same session reuses its report');
  assert.equal(h.calls.length, before, 'report actions never submit chat, stage, or payments');
});

test('quotation report consent preserves scopes and its own redirect resume action', async t => {
  let tokens = 0;
  const grants = [], requestedScopes = [];
  const h = harness(t, {
    quotationReportDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
    auth: {
      getToken: async value => { requestedScopes.push(value); if (++tokens === 1) throw authRequired(); return 'renewed-token'; },
      authorize: async (value, options) => { grants.push({ scopes: value, options }); },
    },
  });
  const data = await open(h);
  assert.equal(await data.loadSnapshot(), 'renewed-token');
  assert.deepEqual(grants, [{ scopes: ['Sites.Read.All'], options: { resumeAction: 'action_quotation_report' } }]);
  assert.deepEqual(requestedScopes, [['Sites.Read.All'], ['Sites.Read.All']]);
});
test('four parallel SharePoint token requests share one consent and preserve quotation resume', async t => {
  const grant = deferred(), grants = [];
  let authorized = false;
  const h = harness(t, {
    quotationReportDataFactory: async ({ tokenProvider }) => ({
      loadSnapshot: () => Promise.all(Array.from({ length: 4 }, () => tokenProvider(scopes))),
    }),
    auth: {
      getToken: async () => { if (!authorized) throw authRequired(); return 'renewed-token'; },
      authorize: async (value, options) => {
        grants.push({ scopes: value, options });
        await grant.promise;
        authorized = true;
      },
    },
  });
  const data = await open(h), load = data.loadSnapshot();
  await tick();
  assert.equal(grants.length, 1);
  assert.deepEqual(grants[0], {
    scopes: ['Sites.Read.All'], options: { resumeAction: 'action_quotation_report' },
  });
  grant.resolve();
  assert.deepEqual(await load, ['renewed-token', 'renewed-token', 'renewed-token', 'renewed-token']);
});

test('cancelling between AUTH_REQUIRED and queued consent never starts authorization', async t => {
  const caller = new AbortController();
  let grants = 0;
  const h = harness(t, {
    quotationReportDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
    auth: {
      getToken: () => ({ then(_resolve, reject) {
        reject(authRequired());
        queueMicrotask(() => caller.abort());
      } }),
      authorize: async () => { grants++; },
    },
  });
  const data = await open(h);
  await assert.rejects(data.loadSnapshot({ signal: caller.signal }), { name: 'AbortError' });
  await tick();
  assert.equal(grants, 0);
});

test('pending quotation report redirect resumes the report locally after conversation recovery', async t => {
  const h = harness(t, { auth: { consumePendingAction: () => 'action_quotation_report' } });
  await h.controller.start();
  assert.equal(h.panels.length, 1);
  assert.equal(h.panels[0].opens, 1);
  assert.deepEqual(h.calls, [{ text: '', replyId: 'input_continue' }]);
});

for (const guard of ['signed-out', 'active-flow', 'busy']) {
  test(`quotation report HOME and reply cannot open while ${guard}`, async t => {
    const h = harness(t, guard === 'signed-out' ? { auth: { initialize: async () => null } } : {});
    await h.controller.start();
    if (guard === 'active-flow') h.store.restoreSnapshot({ messages: [], activeFlow });
    if (guard === 'busy') h.store.beginText('Mensagem em andamento');
    const before = h.calls.length;
    assert.equal(await h.view.emit('open-quotation-report'), false);
    assert.equal(await h.view.emit('select-reply', { replyId: 'action_quotation_report' }), false);
    assert.equal(h.panels.length, 0);
    assert.equal(h.calls.length, before);
    if (guard === 'active-flow') assert.equal(h.store.getState().activeFlow, activeFlow);
  });
}

for (const end of ['sign-out', 'stop', 'account-change', 'same-account-login', 'active-flow', 'busy']) {
  test(`quotation report panel resolved after ${end} is destroyed without opening`, async t => {
    const factory = deferred();
    let factoryCalls = 0, opens = 0, destroys = 0;
    const h = harness(t, { quotationReportViewFactory: () => { factoryCalls++; return factory.promise; } });
    await h.controller.start();
    const pending = h.view.emit('open-quotation-report');
    await tick();
    assert.equal(factoryCalls, 1);
    if (end === 'stop') h.controller.stop();
    else if (end === 'account-change') {
      h.auth.signIn = async () => ({ homeAccountId: 'other-account' });
      await h.view.emit('sign-in');
    } else if (end === 'same-account-login') await h.view.emit('sign-in');
    else if (end === 'active-flow') h.store.restoreSnapshot({ messages: [], activeFlow });
    else if (end === 'busy') h.store.beginText('Mensagem em andamento');
    else await h.view.emit('sign-out');
    factory.resolve({ open() { opens++; }, destroy() { destroys++; } });
    assert.equal(await pending, false);
    assert.equal(opens, 0);
    assert.equal(destroys, 1);
  });
}

for (const end of ['sign-out', 'stop', 'account-change', 'same-account-login']) {
  test(`quotation report queries are aborted and report disposed once on ${end}`, async t => {
    const source = deferred();
    let signal, loads = 0;
    const h = harness(t, { quotationReportDataFactory: async () => ({ loadSnapshot(options) {
      signal = options.signal; loads++; return source.promise;
    } }) });
    const data = await open(h);
    const old = data.loadSnapshot();
    const rejected = assert.rejects(old, { name: 'AbortError' });
    await tick();
    if (end === 'stop') h.controller.stop();
    else if (end === 'account-change') {
      h.auth.signIn = async () => ({ homeAccountId: 'other-account' });
      await h.view.emit('sign-in');
    } else await h.view.emit(end === 'same-account-login' ? 'sign-in' : 'sign-out');
    assert.equal(signal.aborted, true, 'controller cancels SharePoint even without a caller signal');
    await rejected;
    await assert.rejects(data.loadSnapshot(), { name: 'AbortError' });
    assert.equal(loads, 1);
    assert.equal(h.panels[0].destroys, 1);
    source.resolve(snapshot);
    if (end === 'same-account-login') {
      assert.equal(await h.view.emit('open-quotation-report'), true);
      assert.equal(h.panels.length, 2, 'same-account login still requires new session data');
    }
    h.controller.stop();
    assert.equal(h.panels[0].destroys, 1);
  });
}

test('late AUTH_REQUIRED from an old account cannot authorize or render a session error', async t => {
  const token = deferred();
  let authorizations = 0;
  const h = harness(t, {
    quotationReportDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
    auth: { getToken: () => token.promise, authorize: async () => { authorizations++; } },
  });
  const data = await open(h);
  const old = data.loadSnapshot();
  const rejected = assert.rejects(old, { name: 'AbortError' });
  await tick();
  await h.view.emit('sign-out');
  await h.view.emit('sign-in');
  const before = h.renders.length;
  token.reject(authRequired());
  await rejected;
  await tick();
  assert.equal(authorizations, 0);
  assert.equal(h.renders.length, before);
});

for (const end of ['sign-out', 'caller-abort', 'replacement']) {
  test(`quotation report consent cannot reacquire a token after ${end}`, async t => {
    const grant = deferred();
    let tokens = 0, authorizations = 0;
    const h = harness(t, {
      quotationReportDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
      auth: {
        getToken: async () => { tokens++; if (tokens === 1) throw authRequired(); return 'fresh-token'; },
        authorize: () => { authorizations++; return grant.promise; },
      },
    });
    const data = await open(h), caller = new AbortController();
    const old = data.loadSnapshot({ signal: caller.signal });
    const rejected = assert.rejects(old, { name: 'AbortError' });
    await tick();
    assert.equal(authorizations, 1);
    if (end === 'sign-out') await h.view.emit('sign-out');
    else if (end === 'caller-abort') caller.abort();
    else assert.equal(await data.loadSnapshot(), 'fresh-token');
    grant.resolve();
    await rejected;
    await tick();
    assert.equal(tokens, end === 'replacement' ? 2 : 1);
  });
}

test('rotation replacement rejects stale AUTH_REQUIRED while retaining its own token', async t => {
  const token = deferred();
  let tokens = 0, authorizations = 0;
  const h = harness(t, {
    quotationReportDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
    auth: {
      getToken: () => ++tokens === 1 ? token.promise : Promise.resolve('fresh-token'),
      authorize: async () => { authorizations++; },
    },
  });
  const data = await open(h), orientation = new AbortController();
  const old = data.loadSnapshot({ signal: orientation.signal });
  const rejected = assert.rejects(old, { name: 'AbortError' });
  await tick();
  orientation.abort();
  assert.equal(await data.loadSnapshot(), 'fresh-token');
  token.reject(authRequired());
  await rejected;
  await tick();
  assert.equal(authorizations, 0);
});

test('superseded source cannot borrow replacement credentials after delaying token retrieval', async t => {
  const delayed = deferred();
  let loads = 0, tokens = 0;
  const signals = [];
  const h = harness(t, {
    quotationReportDataFactory: async ({ tokenProvider }) => ({ async loadSnapshot({ signal }) {
      signals.push(signal);
      if (++loads === 1) await delayed.promise;
      return tokenProvider(scopes);
    } }),
    auth: { getToken: async () => { tokens++; return 'fresh-token'; } },
  });
  const data = await open(h);
  const old = data.loadSnapshot();
  const rejected = assert.rejects(old, { name: 'AbortError' });
  await tick();
  assert.equal(await data.loadSnapshot(), 'fresh-token');
  assert.equal(signals[0].aborted, true);
  delayed.resolve();
  await rejected;
  await tick();
  assert.equal(tokens, 1, 'stale source must not query Microsoft under the new request');
});

for (const result of ['success', 'error']) {
  test(`superseded quotation report ${result} cannot escape even if the source ignores abort`, async t => {
    const stale = deferred();
    let loads = 0;
    const h = harness(t, { quotationReportDataFactory: async () => ({ loadSnapshot: () => ++loads === 1
      ? stale.promise : Promise.resolve({ rows: ['fresh'] }) }) });
    const data = await open(h);
    const old = data.loadSnapshot();
    const rejected = assert.rejects(old, { name: 'AbortError' });
    await tick();
    assert.deepEqual(await data.loadSnapshot(), { rows: ['fresh'] });
    await rejected;
    if (result === 'success') stale.resolve(snapshot);
    else stale.reject(new Error('Old SharePoint failure'));
    await tick();
  });
}

test('already aborted quotation report query does not create its source or request consent', async t => {
  let creates = 0, tokens = 0;
  const h = harness(t, {
    quotationReportDataFactory: async () => { creates++; return { loadSnapshot: async () => snapshot }; },
    auth: { getToken: async () => { tokens++; throw authRequired(); } },
  });
  const data = await open(h), caller = new AbortController();
  caller.abort();
  const before = creates;
  await assert.rejects(data.loadSnapshot({ signal: caller.signal }), { name: 'AbortError' });
  assert.equal(creates, before);
  assert.equal(tokens, 0);
});

test('source factory resolved after query cancellation cannot start its load', async t => {
  const factory = deferred();
  let loads = 0;
  const h = harness(t, { quotationReportDataFactory: () => factory.promise });
  const data = await open(h), caller = new AbortController();
  const pending = data.loadSnapshot({ signal: caller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await tick();
  caller.abort();
  await rejected;
  factory.resolve({ loadSnapshot() { loads++; return snapshot; } });
  await tick();
  assert.equal(loads, 0);
});

test('old quotation report opening cannot clear the new session single flight', async t => {
  const factories = [];
  let opens = 0, destroys = 0;
  const h = harness(t, { quotationReportViewFactory: () => {
    const factory = deferred(); factories.push(factory); return factory.promise;
  } });
  await h.controller.start();
  const old = h.view.emit('open-quotation-report');
  await tick();
  assert.equal(factories.length, 1);
  await h.view.emit('sign-out');
  await h.view.emit('sign-in');
  const fresh = h.view.emit('open-quotation-report');
  await tick();
  assert.equal(factories.length, 2);
  factories[0].resolve({ open() { opens++; }, destroy() { destroys++; } });
  assert.equal(await old, false);
  const duplicate = h.view.emit('open-quotation-report');
  await tick();
  assert.equal(factories.length, 2);
  factories[1].resolve({ open() { opens++; }, destroy() { destroys++; } });
  assert.deepEqual(await Promise.all([fresh, duplicate]), [true, true]);
  assert.equal(opens, 1);
  assert.equal(destroys, 1);
});

for (const guard of ['active-flow', 'busy']) {
  test(`starting ${guard} closes the quotation report report and aborts outstanding data`, async t => {
    const source = deferred();
    let signal;
    const h = harness(t, { quotationReportDataFactory: async () => ({ loadSnapshot(options) {
      signal = options.signal; return source.promise;
    } }) });
    const data = await open(h);
    const pending = data.loadSnapshot();
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await tick();
    if (guard === 'active-flow') h.store.restoreSnapshot({ messages: [], activeFlow });
    else h.store.beginText('Mensagem em andamento');
    assert.equal(signal.aborted, true);
    await rejected;
    assert.equal(h.panels[0].destroys, 1);
    source.resolve(snapshot);
  });
}

test('quotation report opening errors are reported once and a new attempt can open', async t => {
  let factories = 0;
  const h = harness(t, { quotationReportViewFactory: async () => {
    if (++factories === 1) throw new Error('Report unavailable');
    return { open() {}, destroy() {} };
  } });
  await h.controller.start();
  assert.equal(await h.view.emit('open-quotation-report'), false);
  assert.equal(h.renders.at(-1).error, 'Report unavailable');
  assert.equal(await h.view.emit('open-quotation-report'), true);
  assert.equal(factories, 2);
});


test('quotation report requests read-only scopes even if its source asks for broader permission', async t => {
  const requested = [], grants = [];
  let tokens = 0;
  const h = harness(t, {
    quotationReportDataFactory: async ({ tokenProvider }) => ({
      loadSnapshot: () => tokenProvider(['Sites.ReadWrite.All']),
    }),
    auth: {
      getToken: async value => { requested.push(value); if (++tokens === 1) throw authRequired(); return 'read-token'; },
      authorize: async (value, options) => { grants.push({ scopes: value, options }); },
    },
  });
  const data = await open(h);
  assert.equal(await data.loadSnapshot(), 'read-token');
  assert.deepEqual(requested, [['Sites.Read.All'], ['Sites.Read.All']]);
  assert.deepEqual(grants, [{ scopes: ['Sites.Read.All'], options: { resumeAction: 'action_quotation_report' } }]);
});

test('a closed quotation report view cancels its query without reusing a late token on reopen', async t => {
  const token = deferred();
  let tokens = 0, grants = 0;
  const h = harness(t, {
    quotationReportDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
    auth: {
      getToken: () => ++tokens === 1 ? token.promise : Promise.resolve('reopened-token'),
      authorize: async () => { grants++; },
    },
  });
  const data = await open(h), caller = new AbortController();
  const old = data.loadSnapshot({ signal: caller.signal });
  const rejected = assert.rejects(old, { name: 'AbortError' });
  await tick();
  h.panels[0].close();
  caller.abort(); // The view owns cancellation of its current render.
  await rejected;
  assert.equal(await h.view.emit('open-quotation-report'), true);
  assert.equal(await data.loadSnapshot(), 'reopened-token');
  token.reject(authRequired());
  await tick();
  assert.equal(grants, 0);
  assert.equal(tokens, 2);
});



test('successful old-account token cannot escape after sign-out and a new login', async t => {
  const token = deferred();
  let tokens = 0;
  const h = harness(t, {
    quotationReportDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
    auth: { getToken: () => ++tokens === 1 ? token.promise : Promise.resolve('new-account-token') },
  });
  const oldData = await open(h);
  const old = oldData.loadSnapshot();
  const rejected = assert.rejects(old, { name: 'AbortError' });
  await tick();
  await h.view.emit('sign-out');
  h.auth.signIn = async () => ({ homeAccountId: 'new-account' });
  await h.view.emit('sign-in');
  assert.equal(await h.view.emit('open-quotation-report'), true);
  assert.equal(await h.panels[1].data.loadSnapshot(), 'new-account-token');
  token.resolve('old-account-token');
  await rejected;
  await tick();
  await assert.rejects(oldData.loadSnapshot(), { name: 'AbortError' });
  assert.equal(tokens, 2);
});






for (const end of ['stop', 'account-change', 'same-account-login', 'active-flow', 'busy']) {
  test(`quotation consent cannot reacquire a token after ${end}`, async t => {
    const grant = deferred();
    let tokens = 0, grants = 0;
    const h = harness(t, {
      quotationReportDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
      auth: {
        getToken: async () => { tokens++; throw authRequired(); },
        authorize: () => { grants++; return grant.promise; },
      },
    });
    const data = await open(h);
    const pending = data.loadSnapshot();
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await tick();
    assert.equal(grants, 1);
    if (end === 'stop') h.controller.stop();
    else if (end === 'account-change') {
      h.auth.signIn = async () => ({ homeAccountId: 'other-account' });
      await h.view.emit('sign-in');
    } else if (end === 'same-account-login') await h.view.emit('sign-in');
    else if (end === 'active-flow') h.store.restoreSnapshot({ messages: [], activeFlow });
    else h.store.beginText('Mensagem em andamento');
    await rejected;
    grant.resolve();
    await tick();
    assert.equal(tokens, 1);
    assert.equal(h.panels[0].destroys, 1);
  });
}


test('queued consent follows the CURRENT load after replacement', async t => {
  let data, replacement, tokens = 0, grants = 0;
  const h = harness(t, {
    quotationReportDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
    auth: {
      getToken: () => ++tokens === 1 ? { then(_resolve, reject) {
        reject(authRequired());
        queueMicrotask(() => { replacement = data.loadSnapshot(); });
      } } : tokens === 2 ? Promise.reject(authRequired()) : Promise.resolve('current-token'),
      authorize: async () => { grants++; },
    },
  });
  data = await open(h);
  const old = data.loadSnapshot();
  await assert.rejects(old, { name: 'AbortError' });
  await tick();
  assert.equal(await replacement, 'current-token');
  assert.equal(grants, 1);
  assert.equal(tokens, 3, 'only the current load retries after consent');
});

test('disposal settles a pending view factory promptly and destroys its late panel', async t => {
  const factory = deferred();
  let opens = 0, destroys = 0, settled = false;
  const h = harness(t, { quotationReportViewFactory: () => factory.promise });
  await h.controller.start();
  const pending = Promise.resolve(h.view.emit('open-quotation-report')).then(value => { settled = true; return value; });
  await tick();
  h.controller.stop();
  await tick();
  assert.equal(settled, true, 'opening must settle without waiting for an ignored factory abort');
  assert.equal(await pending, false);
  factory.resolve({ open() { opens++; }, destroy() { destroys++; } });
  await tick();
  assert.equal(opens, 0);
  assert.equal(destroys, 1);
});

test('disposal settles a panel open that ignores abort promptly', async t => {
  const opening = deferred();
  let settled = false, destroys = 0;
  const h = harness(t, { quotationReportViewFactory: async () => ({
    open: () => opening.promise, destroy() { destroys++; },
  }) });
  await h.controller.start();
  const pending = Promise.resolve(h.view.emit('open-quotation-report')).then(value => { settled = true; return value; });
  await tick();
  h.controller.stop();
  await tick();
  assert.equal(settled, true);
  assert.equal(await pending, false);
  assert.equal(destroys, 1);
  opening.resolve();
  await tick();
  assert.equal(destroys, 1);
});

test('opening Power BI disposes quotation data before the external dashboard opens', async t => {
  const source = deferred();
  let signal, dashboardOpens = 0;
  const h = harness(t, {
    quotationReportDataFactory: async () => ({ loadSnapshot(options) {
      signal = options.signal; return source.promise;
    } }),
  });
  h.view.openPowerBiDashboard = async () => {
    dashboardOpens++;
    assert.equal(signal.aborted, true);
    assert.equal(h.panels[0].destroys, 1);
    return true;
  };
  const data = await open(h);
  const query = data.loadSnapshot();
  const rejected = assert.rejects(query, { name: 'AbortError' });
  await tick();
  const before = h.calls.length;
  assert.equal(await h.view.emit('select-reply', { replyId: 'action_powerbi_dashboard' }), true);
  await rejected;
  assert.equal(dashboardOpens, 1);
  assert.equal(h.calls.length, before);
  source.resolve(snapshot);
});

for(const [replyId,factoryName] of [['action_payment_ledger','paymentLedgerFactory'],['action_management_report','managementReportFactory'],['provision-report','provisionReportFactory'],['order-validation-report','orderValidationReportFactory']]){
 test(`opening quotations discards a late ${replyId} panel and permits a fresh later open`,async t=>{
  const delayed=deferred();let creates=0,opens=0,destroys=0;
  const h=harness(t,{[factoryName]:async()=>{creates++;if(creates===1)return delayed.promise;return {open(){opens++;},close(){},destroy(){destroys++;}};},paymentLedgerDataFactory:async()=>({})});
  await h.controller.start();const old=h.view.emit('select-reply',{replyId});await tick();assert.equal(creates,1);
  await h.view.emit('open-quotation-report');delayed.resolve({open(){opens++;},close(){},destroy(){destroys++;}});assert.equal(await old,false);assert.equal(opens,0);assert.equal(destroys,1);
  assert.equal(await h.view.emit('select-reply',{replyId}),true);assert.equal(creates,2);assert.equal(opens,1);
 });
}

test('default quotation view waits for landscape, aborts rotation and removes the overlay on logout', async t => {
  const dom = new JSDOM('<main id="app"><button>Relatório</button></main>');
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  let portrait = true, loads = 0, tokens = 0, grants = 0;
  const staleToken = deferred(), signals = [];
  dom.window.matchMedia = () => ({ matches: portrait });
  const h = harness(t, {
    quotationReportViewFactory: undefined,
    quotationReportDataFactory: async ({ tokenProvider }) => ({ async loadSnapshot({ signal }) {
      loads++; signals.push(signal);
      await tokenProvider(['Sites.Read.All']);
      return snapshot;
    } }),
    auth: {
      getToken: () => ++tokens === 1 ? staleToken.promise : Promise.resolve('fresh-token'),
      authorize: async () => { grants++; },
    },
  });
  t.after(() => { h.controller.stop(); globalThis.document = previousDocument; dom.window.close(); });
  await h.controller.start();
  assert.equal(await h.view.emit('open-quotation-report'), true, h.renders.at(-1)?.error);
  const root = dom.window.document.querySelector('.qr-overlay');
  assert.ok(root);
  assert.equal(root.hidden, false);
  assert.equal(root.querySelector('.qr-orientation').hidden, false);
  assert.equal(loads, 0, 'portrait must not create the SharePoint source');
  assert.equal(tokens, 0);
  portrait = false;
  dom.window.dispatchEvent(new dom.window.Event('orientationchange'));
  await tick();
  assert.equal(loads, 1);
  portrait = true;
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  assert.equal(signals[0].aborted, true);
  portrait = false;
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  await tick();
  assert.equal(loads, 2);
  assert.match(root.textContent, /Nenhuma cotação encontrada/);
  staleToken.reject(authRequired());
  await tick();
  assert.equal(grants, 0);
  assert.match(root.textContent, /Nenhuma cotação encontrada/);
  await h.view.emit('sign-out');
  assert.equal(dom.window.document.querySelector('.qr-overlay'), null);
  assert.equal(dom.window.document.body.style.overflow, '');
});
