import test from 'node:test';
import assert from 'node:assert/strict';
import * as controllerModule from '../src/app-controller.js';
const { createAppController } = controllerModule;
import { createConversationStore } from '../src/chat/conversation-store.js';
import { createBrowserAuth } from '../src/web/browser-auth.js';
const sessionReports = [
  ['home-depreciation-report', 'depreciationReportViewFactory', 'depreciationReportDataFactory'],
  ['action_quotation_report', 'quotationReportViewFactory', 'quotationReportDataFactory'],
  ['action_sac_pathologies', 'sacPathologiesViewFactory', 'sacPathologiesDataFactory'],
  ['action_attendance_summary', 'attendanceSummaryFactory', 'attendanceSummaryDataFactory'],
  ['action_stage_progress', 'stageProgressFactory', 'stageProgressDataFactory'],
  ['action_commercial_receipts', 'commercialReceiptsViewFactory', 'commercialReceiptsDataFactory'],
  ['action_commercial_milestones', 'commercialMilestonesViewFactory', 'commercialMilestonesDataFactory'],
  ['action_commercial_documents', 'commercialDocumentsViewFactory', 'commercialDocumentsDataFactory'],
];

// A superseded asynchronous boundary must not open, authenticate, or report an error.
for (const [replyId, viewFactory, dataFactory] of sessionReports) {
  for (const stage of ['view', 'source']) {
    for (const outcome of ['resolve', 'reject']) {
      test(`document control cancels pending ${replyId} ${stage} ${outcome}`, async t => {
        const delayed = deferred();
        let loads = 0, opens = 0, destroys = 0, tokens = 0, settled = false;
        const panel = { open() { opens++; }, destroy() { destroys++; } };
        const h = harness(t, {
          [dataFactory]: () => delayed.promise,
          [viewFactory]: stage === 'view' ? () => delayed.promise
            : async ({ data }) => ({ open: () => data.loadSnapshot(), destroy() { destroys++; } }),
          auth: { getToken: async () => { tokens++; return 'token'; } },
        });
        await h.controller.start();
        const pending = h.view.emit('select-reply', { replyId }).then(value => { settled = true; return value; });
        await tick();
        assert.equal(await h.view.emit('open-document-control-report'), true);
        await tick();
        assert.equal(settled, true, 'old navigation settles without the delayed factory');
        assert.equal(await pending, false);
        const renders = h.renders.length;
        if (outcome === 'reject') delayed.reject(new Error('Stale source failure'));
        else delayed.resolve(stage === 'view' ? panel : { async loadSnapshot() {
          loads++; await h.auth.getToken(scopes); return snapshot;
        } });
        await tick();
        assert.equal(opens, 0);
        assert.equal(loads, 0);
        assert.equal(tokens, 0);
        assert.equal(destroys, stage === 'source' || outcome === 'resolve' ? 1 : 0);
        assert.equal(h.renders.length, renders);
        assert.equal(h.panels[0].destroys, 0);
      });
    }
  }

  test(`${replyId} promptly supersedes a pending document control factory`, async t => {
    const delayed = deferred();
    let opens = 0, destroys = 0, settled = false;
    const h = harness(t, {
      documentControlReportViewFactory: () => delayed.promise,
      [viewFactory]: async () => ({ open() {}, close() {}, destroy() {} }),
    });
    await h.controller.start();
    const pending = h.view.emit('open-document-control-report').then(value => { settled = true; return value; });
    await tick();
    assert.equal(await h.view.emit('select-reply', { replyId }), true);
    await tick();
    assert.equal(settled, true);
    assert.equal(await pending, false);
    delayed.resolve({ open() { opens++; }, destroy() { destroys++; } });
    await tick();
    assert.equal(opens, 0);
    assert.equal(destroys, 1);
  });
}

for (const outcome of ['success', 'auth-required']) {
  for (const end of ['same-account-login', 'stop']) {
    test(`late ${outcome} token cannot survive ${end} with the same account object`, async t => {
      const token = deferred();
      let tokens = 0, grants = 0;
      const h = harness(t, {
        documentControlReportDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
        auth: {
          getToken: () => ++tokens === 1 ? token.promise : Promise.resolve('current-token'),
          authorize: async () => { grants++; },
        },
      });
      const data = await open(h);
      const pending = data.loadSnapshot();
      const rejected = assert.rejects(pending, { name: 'AbortError' });
      await tick();
      if (end === 'stop') h.controller.stop();
      else {
        await h.view.emit('sign-in');
        assert.equal(await h.view.emit('open-document-control-report'), true);
        assert.equal(await h.panels[1].data.loadSnapshot(), 'current-token');
      }
      await rejected;
      if (outcome === 'success') token.resolve('stale-token');
      else token.reject(authRequired());
      await tick();
      await assert.rejects(data.loadSnapshot(), { name: 'AbortError' });
      assert.equal(grants, 0);
      assert.equal(tokens, end === 'stop' ? 1 : 2);
      assert.equal(h.panels[0].destroys, 1);
    });
  }
}

const localReports = [
  ['home-depreciation-report', 'depreciationReportViewFactory', 'depreciationReportDataFactory'],
  ['action_quotation_report', 'quotationReportViewFactory', 'quotationReportDataFactory'],
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
  for (const direction of ['to document-control report', 'from document-control report']) {
    // Catches overlapping local modals and a superseded document-control report request retaining
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
        documentControlReportDataFactory: async () => ({ loadSnapshot(options) {
          signal = options.signal; return query.promise;
        } }),
      });
      await h.controller.start();
      const before = h.calls.length;
      if (direction === 'to document-control report') {
        assert.equal(await h.view.emit('select-reply', { replyId }), true);
        assert.equal(await h.view.emit('open-document-control-report'), true);
        assert.equal(oldPanel.closes, 1);
      } else {
        assert.equal(await h.view.emit('open-document-control-report'), true);
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
        assert.equal(await h.view.emit('open-document-control-report'), true);
        assert.equal(h.panels.length, 2, 'cleanup requires a fresh view factory');
        assert.notEqual(h.panels[1].data, data);
      }
      assert.equal(h.calls.length, before);
      assert.equal(h.store.getState().activeFlow, null);
    });
  }
}

test('another report cancels a pending document-control report factory promptly and disposes its late view', async t => {
  const factory = deferred();
  let opens = 0, destroys = 0, settled = false;
  const h = harness(t, {
    documentControlReportViewFactory: () => factory.promise,
    commercialDocumentsViewFactory: async () => ({ open() {}, close() {}, destroy() {} }),
  });
  await h.controller.start();
  const pending = Promise.resolve(h.view.emit('open-document-control-report')).then(result => { settled = true; return result; });
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

test('document-control report supersedes a pending commercial documents factory without allowing its late view', async t => {
  const factory = deferred();
  let opens = 0, destroys = 0, settled = false;
  const h = harness(t, { commercialDocumentsViewFactory: () => factory.promise });
  await h.controller.start();
  const pending = h.view.emit('open-commercial-documents').then(result => { settled = true; return result; });
  await tick();
  assert.equal(await h.view.emit('open-document-control-report'), true);
  await tick();
  assert.equal(settled, true);
  assert.equal(await pending, false);
  factory.resolve({ open() { opens++; }, destroy() { destroys++; } });
  await tick();
  assert.equal(opens, 0);
  assert.equal(destroys, 1);
});

test('CARGOS can reopen with fresh data after switching through document-control report', async t => {
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
  assert.equal(await h.view.emit('open-document-control-report'), true);
  assert.equal(await h.view.emit('open-cargos-table'), true);
  assert.equal(cargosPanels.length, 2);
  assert.equal(cargosPanels[0].destroys, 1);
});

for (const stage of ['source', 'view']) {
  test(`document-control report invalidates a pending CARGOS ${stage} and discards a late panel`, async t => {
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
    assert.equal(await h.view.emit('open-document-control-report'), true);
    pendingStage.resolve(stage === 'source' ? { loadSnapshot: async () => snapshot } : panel);
    assert.equal(await pending, false);
    assert.equal(opens, 0, 'superseded CARGOS must never open over document-control report');
    assert.equal(destroys, stage === 'view' ? 1 : 0);
    assert.equal(h.panels[0].destroys, 0);
  });
}

const pendingLegacyReports = [
  ['action_launch_gallery', 'launchGalleryFactory', []],
  ['action_orders_gallery', 'ordersGalleryFactory', ['ordersGalleryDataFactory']],
  ['action_tasks_gallery', 'tasksGalleryFactory', ['tasksGalleryDataFactory']],
  ['action_payment_programming_gallery', 'paymentProgrammingGalleryFactory', ['paymentProgrammingGalleryDataFactory']],
  ['action_recurring_expenses_gallery', 'recurringExpensesGalleryFactory', ['recurringExpensesGalleryDataFactory']],
  ['action_asset_gallery', 'registrationGalleryFactory', ['registrationGalleryDataFactory']],
  ['action_hr_gallery_idfolha', 'hrPayrollGalleryFactory', ['hrPayrollGalleryDataFactory']],
  ['action_hr_gallery_folhapgto', 'hrPayrollGalleryFactory', ['hrPayrollGalleryDataFactory']],
];

function legacyReportOptions() {
  const source = () => Promise.resolve({
    loadSnapshot: async () => snapshot,
    loadPage: async () => ({ rows: [], complete: true }),
    loadPaymentsForPayrollId: async () => [],
  });
  return {
    ...Object.fromEntries(pendingLegacyReports.flatMap(([, , sources]) => sources.map(name => [name, source]))),
    extraReportsFactory: async () => [],
  };
}

// Removing the opening revision checks allows an old factory to open over the
// current report, continue construction, publish an error, or clear a fresh request.
for (const [replyId, viewFactory, dataFactories] of pendingLegacyReports) {
  for (const stage of [...dataFactories, viewFactory]) {
    for (const outcome of ['resolve', 'reject']) {
      test(`document-control supersedes pending ${replyId} ${stage} ${outcome}`, async t => {
        const delayed = deferred();
        let entered = 0, views = 0, opens = 0, destroys = 0, laterFactories = 0;
        const panel = { open() { opens++; }, close() {}, destroy() { destroys++; } };
        const options = legacyReportOptions();
        for (const name of dataFactories.slice(dataFactories.indexOf(stage) + 1)) {
          if (stage === viewFactory) break;
          const factory = options[name];
          options[name] = (...args) => { laterFactories++; return factory(...args); };
        }
        options[viewFactory] = async () => { views++; return panel; };
        options[stage] = () => { entered++; return delayed.promise; };
        const h = harness(t, options);
        await h.controller.start();
        const beforeCalls = h.calls.length;
        const pending = h.view.emit('select-reply', { replyId });
        await tick();
        assert.equal(entered, 1, 'the intended factory is pending');
        assert.equal(await h.view.emit('open-document-control-report'), true);
        const renders = h.renders.length;
        if (outcome === 'reject') delayed.reject(new Error('Superseded factory unavailable'));
        else delayed.resolve(stage === viewFactory ? panel : await legacyReportOptions()[stage]());
        assert.equal(await pending, false, 'superseded navigation cannot succeed');
        assert.equal(opens, 0, 'the old panel must never open over document-control');
        assert.equal(destroys, outcome === 'resolve' && stage === viewFactory ? 1 : 0);
        assert.equal(views, 0, 'a late source must not create a panel');
        assert.equal(laterFactories, 0, 'check validity after every source factory');
        assert.equal(h.renders.length, renders, 'a stale failure must not render a session error');
        assert.equal(h.panels[0].opens, 1);
        assert.equal(h.panels[0].destroys, 0);
        assert.equal(h.calls.length, beforeCalls);
      });
    }
  }

  test(`superseded ${replyId} cannot clear a fresh opening after reverse switching`, async t => {
    const factories = [];
    let opens = 0, destroys = 0;
    const h = harness(t, {
      ...legacyReportOptions(),
      [viewFactory]: () => {
        const factory = deferred(); factories.push(factory); return factory.promise;
      },
    });
    await h.controller.start();
    const old = h.view.emit('select-reply', { replyId });
    await tick();
    assert.equal(factories.length, 1);
    assert.equal(await h.view.emit('open-document-control-report'), true);
    const fresh = h.view.emit('select-reply', { replyId });
    await tick();
    assert.equal(factories.length, 2, 'reverse switching must start a fresh opening');
    assert.equal(h.panels[0].destroys, 1);
    factories[0].resolve({ open() { opens++; }, destroy() { destroys++; } });
    assert.equal(await old, false);
    const duplicate = h.view.emit('select-reply', { replyId });
    await tick();
    assert.equal(factories.length, 2, 'late cleanup must preserve the fresh single flight');
    factories[1].resolve({ open() { opens++; }, close() {}, destroy() {} });
    assert.deepEqual(await Promise.all([fresh, duplicate]), [true, true]);
    assert.equal(opens, 1);
    assert.equal(destroys, 1);
  });

  test(`established ${replyId} still reopens after document-control switching`, async t => {
    let creates = 0, opens = 0;
    const h = harness(t, {
      ...legacyReportOptions(),
      [viewFactory]: async () => { creates++; return { open() { opens++; }, close() {}, destroy() {} }; },
    });
    await h.controller.start();
    assert.equal(await h.view.emit('select-reply', { replyId }), true);
    assert.equal(await h.view.emit('open-document-control-report'), true);
    assert.equal(await h.view.emit('select-reply', { replyId }), true);
    assert.equal(creates, 1, 'completed galleries retain their existing reuse behavior');
    assert.equal(opens, 2);
    assert.equal(h.panels[0].destroys, 1);
  });
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const authRequired = () => Object.assign(new Error('Expired'), { code: 'AUTH_REQUIRED' });
const scopes = ['Sites.Read.All'];
const activeFlow = { id: 'stage_validation', title: 'Validação em andamento' };
const snapshot = { documents: [{ id: 7, submittedDate: '2026-10-01', issuedDate: '2026-09-01', expirationDate: '2026-10-20', branch: 'Matriz', homologation: 'Aprovado', documentType: 'Certidão', person: 'Pessoa', stage: 'Etapa', property: 'Imóvel', status: 'Enviado' }] };

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
    documentControlReportDataFactory: async () => ({ loadSnapshot: async () => snapshot }),
    documentControlReportViewFactory: async ({ data, document }) => {
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
  assert.equal(await h.view.emit('open-document-control-report'), true);
  return h.panels.at(-1).data;
}

test('HOME and reply open one local document-control report, with an independent read-only data source', async t => {
  let sourceCreates = 0, receivedOptions;
  const requestedScopes = [];
  const h = harness(t, {
    paymentLedgerDataFactory: async () => { assert.fail('document-control report must not use spending data'); },
    attendanceSummaryDataFactory: async () => { assert.fail('document-control report must not use attendance data'); },
    stageProgressDataFactory: async () => { assert.fail('document-control report must not use stage data'); },
    commercialReceiptsDataFactory: async () => { assert.fail('document-control report must not use receipts data'); },
    commercialMilestonesDataFactory: async () => { assert.fail('document-control report must not use milestones data'); },
    documentControlReportDataFactory: async ({ tokenProvider }) => {
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
    h.view.emit('open-document-control-report'),
    h.view.emit('select-reply', { replyId: 'home-document-control-report', label: 'Marcos comerciais' }),
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
  assert.equal(await h.view.emit('open-document-control-report'), true);
  assert.equal(h.panels.length, 1, 'the same session reuses its report');
  assert.equal(h.calls.length, before, 'report actions never submit chat, stage, or payments');
});

test('document-control report consent preserves scopes and its own redirect resume action', async t => {
  let tokens = 0;
  const grants = [], requestedScopes = [];
  const h = harness(t, {
    documentControlReportDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
    auth: {
      getToken: async value => { requestedScopes.push(value); if (++tokens === 1) throw authRequired(); return 'renewed-token'; },
      authorize: async (value, options) => { grants.push({ scopes: value, options }); },
    },
  });
  const data = await open(h);
  assert.equal(await data.loadSnapshot(), 'renewed-token');
  assert.deepEqual(grants, [{ scopes: ['Sites.Read.All'], options: { resumeAction: 'home-document-control-report' } }]);
  assert.deepEqual(requestedScopes, [['Sites.Read.All'], ['Sites.Read.All']]);
});
test('four parallel SharePoint token requests share one consent and preserve document-control resume', async t => {
  const grant = deferred(), grants = [];
  let authorized = false;
  const h = harness(t, {
    documentControlReportDataFactory: async ({ tokenProvider }) => ({
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
    scopes: ['Sites.Read.All'], options: { resumeAction: 'home-document-control-report' },
  });
  grant.resolve();
  assert.deepEqual(await load, ['renewed-token', 'renewed-token', 'renewed-token', 'renewed-token']);
});

test('cancelling between AUTH_REQUIRED and queued consent never starts authorization', async t => {
  const caller = new AbortController();
  let grants = 0;
  const h = harness(t, {
    documentControlReportDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
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

test('pending document-control report redirect resumes the report locally after conversation recovery', async t => {
  const h = harness(t, { auth: { consumePendingAction: () => 'home-document-control-report' } });
  await h.controller.start();
  assert.equal(h.panels.length, 1);
  assert.equal(h.panels[0].opens, 1);
  assert.deepEqual(h.calls, [{ text: '', replyId: 'input_continue' }]);
});

for (const guard of ['signed-out', 'active-flow', 'busy']) {
  test(`document-control report HOME and reply cannot open while ${guard}`, async t => {
    const h = harness(t, guard === 'signed-out' ? { auth: { initialize: async () => null } } : {});
    await h.controller.start();
    if (guard === 'active-flow') h.store.restoreSnapshot({ messages: [], activeFlow });
    if (guard === 'busy') h.store.beginText('Mensagem em andamento');
    const before = h.calls.length;
    assert.equal(await h.view.emit('open-document-control-report'), false);
    assert.equal(await h.view.emit('select-reply', { replyId: 'home-document-control-report' }), false);
    assert.equal(h.panels.length, 0);
    assert.equal(h.calls.length, before);
    if (guard === 'active-flow') assert.equal(h.store.getState().activeFlow, activeFlow);
  });
}

for (const end of ['sign-out', 'stop', 'account-change', 'same-account-login', 'active-flow', 'busy']) {
  test(`document-control report panel resolved after ${end} is destroyed without opening`, async t => {
    const factory = deferred();
    let factoryCalls = 0, opens = 0, destroys = 0;
    const h = harness(t, { documentControlReportViewFactory: () => { factoryCalls++; return factory.promise; } });
    await h.controller.start();
    const pending = h.view.emit('open-document-control-report');
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
  test(`document-control report queries are aborted and report disposed once on ${end}`, async t => {
    const source = deferred();
    let signal, loads = 0;
    const h = harness(t, { documentControlReportDataFactory: async () => ({ loadSnapshot(options) {
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
      assert.equal(await h.view.emit('open-document-control-report'), true);
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
    documentControlReportDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
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
  test(`document-control report consent cannot reacquire a token after ${end}`, async t => {
    const grant = deferred();
    let tokens = 0, authorizations = 0;
    const h = harness(t, {
      documentControlReportDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
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
    documentControlReportDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
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
    documentControlReportDataFactory: async ({ tokenProvider }) => ({ async loadSnapshot({ signal }) {
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
  test(`superseded document-control report ${result} cannot escape even if the source ignores abort`, async t => {
    const stale = deferred();
    let loads = 0;
    const h = harness(t, { documentControlReportDataFactory: async () => ({ loadSnapshot: () => ++loads === 1
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

test('already aborted document-control report query does not create its source or request consent', async t => {
  let creates = 0, tokens = 0;
  const h = harness(t, {
    documentControlReportDataFactory: async () => { creates++; return { loadSnapshot: async () => snapshot }; },
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
  const h = harness(t, { documentControlReportDataFactory: () => factory.promise });
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

test('old document-control report opening cannot clear the new session single flight', async t => {
  const factories = [];
  let opens = 0, destroys = 0;
  const h = harness(t, { documentControlReportViewFactory: () => {
    const factory = deferred(); factories.push(factory); return factory.promise;
  } });
  await h.controller.start();
  const old = h.view.emit('open-document-control-report');
  await tick();
  assert.equal(factories.length, 1);
  await h.view.emit('sign-out');
  await h.view.emit('sign-in');
  const fresh = h.view.emit('open-document-control-report');
  await tick();
  assert.equal(factories.length, 2);
  factories[0].resolve({ open() { opens++; }, destroy() { destroys++; } });
  assert.equal(await old, false);
  const duplicate = h.view.emit('open-document-control-report');
  await tick();
  assert.equal(factories.length, 2);
  factories[1].resolve({ open() { opens++; }, destroy() { destroys++; } });
  assert.deepEqual(await Promise.all([fresh, duplicate]), [true, true]);
  assert.equal(opens, 1);
  assert.equal(destroys, 1);
});

for (const guard of ['active-flow', 'busy']) {
  test(`starting ${guard} closes the document-control report and aborts outstanding data`, async t => {
    const source = deferred();
    let signal;
    const h = harness(t, { documentControlReportDataFactory: async () => ({ loadSnapshot(options) {
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

test('document-control report opening errors are reported once and a new attempt can open', async t => {
  let factories = 0;
  const h = harness(t, { documentControlReportViewFactory: async () => {
    if (++factories === 1) throw new Error('Report unavailable');
    return { open() {}, destroy() {} };
  } });
  await h.controller.start();
  assert.equal(await h.view.emit('open-document-control-report'), false);
  assert.equal(h.renders.at(-1).error, 'Report unavailable');
  assert.equal(await h.view.emit('open-document-control-report'), true);
  assert.equal(factories, 2);
});

test('document-control report requests read-only scopes even if its source asks for broader permission', async t => {
  const requested = [], grants = [];
  let tokens = 0;
  const h = harness(t, {
    documentControlReportDataFactory: async ({ tokenProvider }) => ({
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
  assert.deepEqual(grants, [{ scopes: ['Sites.Read.All'], options: { resumeAction: 'home-document-control-report' } }]);
});

test('a closed document-control report view cancels its query without reusing a late token on reopen', async t => {
  const token = deferred();
  let tokens = 0, grants = 0;
  const h = harness(t, {
    documentControlReportDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
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
  assert.equal(await h.view.emit('open-document-control-report'), true);
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
    documentControlReportDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
    auth: { getToken: () => ++tokens === 1 ? token.promise : Promise.resolve('new-account-token') },
  });
  const oldData = await open(h);
  const old = oldData.loadSnapshot();
  const rejected = assert.rejects(old, { name: 'AbortError' });
  await tick();
  await h.view.emit('sign-out');
  h.auth.signIn = async () => ({ homeAccountId: 'new-account' });
  await h.view.emit('sign-in');
  assert.equal(await h.view.emit('open-document-control-report'), true);
  assert.equal(await h.panels[1].data.loadSnapshot(), 'new-account-token');
  token.resolve('old-account-token');
  await rejected;
  await tick();
  await assert.rejects(oldData.loadSnapshot(), { name: 'AbortError' });
  assert.equal(tokens, 2);
});

for (const end of ['stop', 'account-change', 'same-account-login', 'active-flow', 'busy']) {
  test(`document-control consent cannot reacquire a token after ${end}`, async t => {
    const grant = deferred();
    let tokens = 0, grants = 0;
    const h = harness(t, {
      documentControlReportDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
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
    documentControlReportDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
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
  const h = harness(t, { documentControlReportViewFactory: () => factory.promise });
  await h.controller.start();
  const pending = Promise.resolve(h.view.emit('open-document-control-report')).then(value => { settled = true; return value; });
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
  const h = harness(t, { documentControlReportViewFactory: async () => ({
    open: () => opening.promise, destroy() { destroys++; },
  }) });
  await h.controller.start();
  const pending = Promise.resolve(h.view.emit('open-document-control-report')).then(value => { settled = true; return value; });
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

test('opening Power BI disposes document-control data before the external dashboard opens', async t => {
  const source = deferred();
  let signal, dashboardOpens = 0;
  const h = harness(t, {
    documentControlReportDataFactory: async () => ({ loadSnapshot(options) {
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
 test(`opening document-control discards a late ${replyId} panel and permits a fresh later open`,async t=>{
  const delayed=deferred();let creates=0,opens=0,destroys=0;
  const h=harness(t,{[factoryName]:async()=>{creates++;if(creates===1)return delayed.promise;return {open(){opens++;},close(){},destroy(){destroys++;}};},paymentLedgerDataFactory:async()=>({})});
  await h.controller.start();const old=h.view.emit('select-reply',{replyId});await tick();assert.equal(creates,1);
  await h.view.emit('open-document-control-report');delayed.resolve({open(){opens++;},close(){},destroy(){destroys++;}});assert.equal(await old,false);assert.equal(opens,0);assert.equal(destroys,1);
  assert.equal(await h.view.emit('select-reply',{replyId}),true);assert.equal(creates,2);assert.equal(opens,1);
 });
}

test('exported HOME reply routes to the local document-control report', async t => {
  const h = harness(t);
  await h.controller.start();
  const { DOCUMENT_CONTROL_REPORT_ID } = controllerModule;
  assert.equal(DOCUMENT_CONTROL_REPORT_ID, 'home-document-control-report');
  const before = h.calls.length;
  assert.equal(await h.view.emit('select-reply', { replyId: DOCUMENT_CONTROL_REPORT_ID }), true);
  assert.equal(h.panels[0].opens, 1);
  assert.equal(h.calls.length, before);
});

test('document-control projects every snapshot field and restricts token scopes to read only', async t => {
  const requested = [];
  const full = { documents: [{ id: 9, submittedDate: null, issuedDate: '2026-09-01', expirationDate: null, branch: 'Filial', homologation: 'Pendente', documentType: 'Contrato', person: 'Fornecedor', stage: 'Obra', property: 'Sede', status: 'Pendente' }] };
  const h = harness(t, {
    documentControlReportDataFactory: async ({ tokenProvider }) => ({ async loadSnapshot() {
      await tokenProvider(['Sites.ReadWrite.All']);
      return full;
    } }),
    auth: { getToken: async scopes => { requested.push(scopes); return 'read-token'; } },
  });
  const data = await open(h);
  assert.deepEqual(await data.loadSnapshot(), full);
  assert.deepEqual(requested, [['Sites.Read.All']]);
  assert.deepEqual(Object.keys(data), ['loadSnapshot']);
});

test('a source factory failure permits a fresh retry without reusing failed source state', async t => {
  let creates = 0;
  const h = harness(t, { documentControlReportDataFactory: async () => {
    if (++creates === 1) throw new Error('SharePoint unavailable');
    return { loadSnapshot: async () => snapshot };
  } });
  const data = await open(h);
  await assert.rejects(data.loadSnapshot(), /SharePoint unavailable/);
  assert.equal(await data.loadSnapshot(), snapshot);
  assert.equal(creates, 2);
});

test('a view factory failure permits a fresh later open', async t => {
  let creates = 0, opens = 0;
  const h = harness(t, { documentControlReportViewFactory: async () => {
    if (++creates === 1) throw new Error('View unavailable');
    return { open() { opens++; }, destroy() {} };
  } });
  await h.controller.start();
  assert.equal(await h.view.emit('open-document-control-report'), false);
  assert.match(h.renders.at(-1).error, /View unavailable/);
  assert.equal(await h.view.emit('open-document-control-report'), true);
  assert.equal(creates, 2);
  assert.equal(opens, 1);
});

for (const end of ['stop', 'same-account-login', 'account-change', 'active-flow', 'busy', 'quotation']) {
  test(`a document-control source factory arriving after ${end} never loads or authenticates`, async t => {
    const factory = deferred();
    let loads = 0, tokens = 0;
    const h = harness(t, {
      documentControlReportDataFactory: () => factory.promise,
      quotationReportViewFactory: async () => ({ open() {}, destroy() {} }),
      auth: { getToken: async () => { tokens++; return 'token'; } },
    });
    const data = await open(h);
    const pending = data.loadSnapshot();
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await tick();
    if (end === 'stop') h.controller.stop();
    else if (end === 'same-account-login') await h.view.emit('sign-in');
    else if (end === 'account-change') {
      h.auth.signIn = async () => ({ homeAccountId: 'new-account' });
      await h.view.emit('sign-in');
    } else if (end === 'active-flow') h.store.restoreSnapshot({ messages: [], activeFlow });
    else if (end === 'busy') h.store.beginText('In progress');
    else await h.view.emit('open-quotation-report');
    await rejected;
    factory.resolve({ async loadSnapshot() { loads++; await h.auth.getToken(scopes); return snapshot; } });
    await tick();
    assert.equal(loads, 0);
    assert.equal(tokens, 0);
  });
}

for (const [replyId, factoryName] of [
  ['action_payment_ledger', 'paymentLedgerFactory'],
  ['action_management_report', 'managementReportFactory'],
  ['provision-report', 'provisionReportFactory'],
  ['order-validation-report', 'orderValidationReportFactory'],
]) {
  test(`document-control invalidates the pending spending SOURCE for ${replyId} before it creates a view`, async t => {
    const source = deferred();
    let sources = 0, views = 0;
    const h = harness(t, {
      paymentLedgerDataFactory: async () => ++sources === 1 ? source.promise : {},
      [factoryName]: async () => { views++; return { open() {}, close() {}, destroy() {} }; },
    });
    await h.controller.start();
    const pending = h.view.emit('select-reply', { replyId });
    await tick();
    assert.equal(await h.view.emit('open-document-control-report'), true);
    source.resolve({});
    assert.equal(await pending, false);
    assert.equal(views, 0);
    assert.equal(await h.view.emit('select-reply', { replyId }), true);
    assert.equal(views, 1);
  });
}

test('document-control disposes a pending quotation factory promptly and destroys its late panel', async t => {
  const factory = deferred();
  let opens = 0, destroys = 0, settled = false;
  const h = harness(t, { quotationReportViewFactory: () => factory.promise });
  await h.controller.start();
  const pending = h.view.emit('open-quotation-report').then(value => { settled = true; return value; });
  await tick();
  assert.equal(await h.view.emit('open-document-control-report'), true);
  await tick();
  assert.equal(settled, true);
  assert.equal(await pending, false);
  factory.resolve({ open() { opens++; }, destroy() { destroys++; } });
  await tick();
  assert.equal(opens, 0);
  assert.equal(destroys, 1);
});

test('quotation disposes a pending document-control factory promptly and destroys its late panel', async t => {
  const factory = deferred();
  let opens = 0, destroys = 0;
  const h = harness(t, {
    documentControlReportViewFactory: () => factory.promise,
    quotationReportViewFactory: async () => ({ open() {}, destroy() {} }),
  });
  await h.controller.start();
  const pending = h.view.emit('open-document-control-report');
  await tick();
  assert.equal(await h.view.emit('open-quotation-report'), true);
  assert.equal(await pending, false);
  factory.resolve({ open() { opens++; }, destroy() { destroys++; } });
  await tick();
  assert.equal(opens, 0);
  assert.equal(destroys, 1);
});

for (const event of ['open-media', 'open-file', 'resize-signature', 'open-rhid-attendance-today', 'open-pending-provisions']) {
  test(`opening ${event} disposes document-control before the next overlay`, async t => {
    const factory = deferred();
    let opens = 0, destroys = 0;
    const h = harness(t, { documentControlReportViewFactory: () => factory.promise });
    await h.controller.start();
    const pending = h.view.emit('open-document-control-report');
    await tick();
    await h.view.emit(event);
    assert.equal(await pending, false);
    factory.resolve({ open() { opens++; }, destroy() { destroys++; } });
    await tick();
    assert.equal(opens, 0);
    assert.equal(destroys, 1);
  });
}

for (const event of ['capture-photo', 'pick-photos', 'pick-document-files']) {
  test(`opening the native ${event} overlay disposes the report even when no file is selected`, async t => {
    const h = harness(t, { native: {
      importSharedItems: async () => [],
      capturePhoto: async () => [], pickPhotos: async () => [], pickDocuments: async () => [],
    } });
    const data = await open(h);
    const before = h.calls.length;
    await h.view.emit(event);
    assert.equal(h.panels[0].destroys, 1);
    await assert.rejects(data.loadSnapshot(), { name: 'AbortError' });
    assert.equal(h.calls.length, before);
  });
}


const browserAccount = { homeAccountId: 'commercial-user', username: 'person@example.invalid' };
const browserConfig = { scopes: ['User.Read'], webRedirectUri: 'https://www.energeticabr.com/energetico/' };
const pendingKey = 'energetico:msal-pending-action:v1';

function browserHarness(redirect = null, values = new Map()) {
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const requests = [];
  const auth = createBrowserAuth({ storage, config: browserConfig, client: {
    async initialize() {},
    async handleRedirectPromise() { return redirect; },
    getAllAccounts() { return [browserAccount]; },
    async acquireTokenRedirect(request) { requests.push(request); },
    async logoutRedirect() {},
  } });
  return { auth, values, requests };
}

test('read-only document-control report consent persists its own account and redirect action', async () => {
  const h = browserHarness();
  await h.auth.initialize();
  await h.auth.authorize(['Sites.Read.All'], { resumeAction: 'home-document-control-report' });
  assert.deepEqual(JSON.parse(h.values.get(pendingKey) ?? 'null'), {
    version: 1, action: 'home-document-control-report', accountId: 'commercial-user', scopes: ['Sites.Read.All'],
  });
  assert.deepEqual(h.requests, [{ account: browserAccount, scopes: ['Sites.Read.All'], redirectUri: browserConfig.webRedirectUri }]);
});

for (const [name, redirect, expected] of [
  ['matching account and read scopes', { account: browserAccount, accessToken: 'read-token', scopes: ['Sites.Read.All'] }, 'home-document-control-report'],
  ['case-insensitive read scopes', { account: browserAccount, accessToken: 'read-token', scopes: ['sites.read.all'] }, 'home-document-control-report'],
  ['another account', { account: { ...browserAccount, homeAccountId: 'other' }, accessToken: 'token', scopes: ['Sites.Read.All'] }, null],
  ['missing read scope', { account: browserAccount, accessToken: 'token', scopes: ['User.Read'] }, null],
  ['write scope instead of read', { account: browserAccount, accessToken: 'token', scopes: ['Sites.ReadWrite.All'] }, null],
  ['missing token', { account: browserAccount, scopes: ['Sites.Read.All'] }, null],
  ['cached account without redirect', null, null],
]) {
  test(`document-control report redirect resumes once only with ${name}`, async () => {
    const first = browserHarness();
    await first.auth.initialize();
    await first.auth.authorize(['Sites.Read.All'], { resumeAction: 'home-document-control-report' });
    const second = browserHarness(redirect, first.values);
    await second.auth.initialize();
    assert.equal(second.auth.consumePendingAction(), expected);
    assert.equal(second.auth.consumePendingAction(), null);
    assert.equal(first.values.has(pendingKey), false);
  });
}

test('sign-out removes pending document-control report consent before any redirect can resume it', async () => {
  const first = browserHarness();
  await first.auth.initialize();
  await first.auth.authorize(['Sites.Read.All'], { resumeAction: 'home-document-control-report' });
  await first.auth.signOut();
  assert.equal(first.values.has(pendingKey), false);
  assert.equal(first.auth.consumePendingAction(), null);
  await assert.rejects(first.auth.authorize(['Sites.Read.All'], { resumeAction: 'home-document-control-report' }), { code: 'AUTH_REQUIRED' });
  const second = browserHarness({ account: browserAccount, accessToken: 'late-token', scopes: ['Sites.Read.All'] }, first.values);
  await second.auth.initialize();
  assert.equal(second.auth.consumePendingAction(), null);
});

test('pending document-control report action is accepted without allowing an arbitrary mutating reply', async () => {
  const values = new Map([[pendingKey, JSON.stringify({
    version: 1, action: 'action_delete_stage', accountId: 'commercial-user', scopes: ['Sites.Read.All'],
  })]]);
  const h = browserHarness({ account: browserAccount, accessToken: 'token', scopes: ['Sites.Read.All'] }, values);
  await h.auth.initialize();
  assert.equal(h.auth.consumePendingAction(), null);
});
