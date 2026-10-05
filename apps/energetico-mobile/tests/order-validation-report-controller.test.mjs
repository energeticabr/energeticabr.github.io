import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';

function harness(options = {}) {
  let sequence = 0;
  const handlers = new Map(), calls = [], renders = [];
  const view = {
    render(state) { renders.push(state); },
    on(type, handler) { handlers.set(type, handler); return () => handlers.delete(type); },
    emit(type, value = {}) { return handlers.get(type)?.({ type, ...value }); },
    focusComposer() {}, destroy() { handlers.clear(); },
  };
  const account = { homeAccountId: 'validation-user', name: 'Usuário' };
  const auth = {
    initialize: async () => account, signIn: async () => account,
    getToken: async () => 'sharepoint-token', signOut: async () => {}, ...options.auth,
  };
  const client = {
    async sendText(payload) { calls.push(payload); return { status: 'processed', messages: [] }; },
  };
  const store = createConversationStore({ randomUUID: () => `validation-${++sequence}` });
  const controller = createAppController({
    store, view, auth, client, native: { importSharedItems: async () => [] },
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [] }),
    ...options, auth,
  });
  return { controller, view, auth, calls, renders, store };
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const authRequired = () => Object.assign(new Error('Expired'), { code: 'AUTH_REQUIRED' });
const activeFlow = { id: 'order_registration', title: 'Pedido em andamento' };

test('HOME and select-reply coalesce validation opening and forward only its snapshot method and scopes', async t => {
  let opens = 0, sourceCreates = 0, receivedOptions, receivedScopes, receivedDocument, loaded;
  const query = { signal: new AbortController().signal };
  const snapshot = { orders: [{ id: '42', supplier: 'Fornecedor' }] };
  const h = harness({
    paymentLedgerDataFactory: async ({ tokenProvider }) => {
      sourceCreates++;
      return { async loadOrderValidationSnapshot(options) {
        receivedOptions = options;
        assert.equal(await tokenProvider(['Sites.Read.All']), 'sharepoint-token');
        return snapshot;
      } };
    },
    orderValidationReportFactory: async ({ data, document }) => {
      receivedDocument = document;
      assert.deepEqual(Object.keys(data), ['loadOrderValidationSnapshot']);
      return { async open() { opens++; loaded = await data.loadOrderValidationSnapshot(query); }, destroy() {} };
    },
  });
  h.auth.getToken = async scopes => { receivedScopes = scopes; return 'sharepoint-token'; };
  t.after(() => h.controller.stop());
  await h.controller.start();
  const before = h.calls.length;
  assert.deepEqual(await Promise.all([
    h.view.emit('open-order-validation-report'),
    h.view.emit('select-reply', { replyId: 'order-validation-report', label: 'Validação' }),
  ]), [true, true]);
  assert.equal(opens, 1);
  assert.equal(sourceCreates, 1);
  assert.equal(receivedOptions, query);
  assert.deepEqual(receivedScopes, ['Sites.Read.All']);
  assert.equal(receivedDocument, globalThis.document);
  assert.equal(loaded, snapshot);
  assert.equal(h.calls.length, before, 'local report must not send a chat reply');
});

test('validation consent uses its own resume ID and reacquires exactly the requested scopes', async t => {
  let tokens = 0;
  const grants = [], scopesRequested = [];
  const h = harness({
    paymentLedgerDataFactory: async ({ tokenProvider }) => ({ loadOrderValidationSnapshot: () => tokenProvider(['Sites.Read.All']) }),
    orderValidationReportFactory: async ({ data }) => ({ open: () => data.loadOrderValidationSnapshot(), destroy() {} }),
    auth: {
      getToken: async scopes => { scopesRequested.push(scopes); if (++tokens === 1) throw authRequired(); return 'renewed-token'; },
      authorize: async (scopes, options) => { grants.push({ scopes, options }); },
    },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit('open-order-validation-report'), true);
  assert.deepEqual(grants, [{ scopes: ['Sites.Read.All'], options: { resumeAction: 'order-validation-report' } }]);
  assert.deepEqual(scopesRequested, [['Sites.Read.All'], ['Sites.Read.All']]);
});

test('pending validation redirect action reopens locally', async t => {
  let opens = 0;
  const h = harness({
    auth: { consumePendingAction: () => 'order-validation-report' },
    paymentLedgerDataFactory: async () => ({}),
    orderValidationReportFactory: async () => ({ open() { opens++; }, destroy() {} }),
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(opens, 1);
  assert.deepEqual(h.calls, [{ text: '', replyId: 'input_continue' }], 'startup resumes the conversation but does not send the report action');
});

for (const end of ['sign-out', 'stop']) {
  test(`validation factory resolved after ${end} is destroyed without opening`, async t => {
    let finish, opens = 0, destroys = 0;
    const h = harness({
      paymentLedgerDataFactory: async () => ({}),
      orderValidationReportFactory: () => new Promise(resolve => { finish = resolve; }),
    });
    t.after(() => h.controller.stop());
    await h.controller.start();
    const pending = h.view.emit('open-order-validation-report');
    await tick();
    assert.equal(typeof finish, 'function');
    if (end === 'stop') h.controller.stop();
    else await h.view.emit('sign-out');
    finish({ open() { opens++; }, destroy() { destroys++; } });
    assert.equal(await pending, false);
    assert.equal(opens, 0);
    assert.equal(destroys, 1);
  });

  test(`validation panel is disposed once on ${end} and its data cannot query afterwards`, async t => {
    let data, destroys = 0, loads = 0;
    const h = harness({
      paymentLedgerDataFactory: async () => ({ async loadOrderValidationSnapshot() { loads++; return {}; } }),
      orderValidationReportFactory: async options => {
        data = options.data;
        return { open() {}, destroy() { destroys++; } };
      },
    });
    t.after(() => h.controller.stop());
    await h.controller.start();
    assert.equal(await h.view.emit('open-order-validation-report'), true);
    if (end === 'stop') h.controller.stop();
    else await h.view.emit('sign-out');
    await assert.rejects(async () => data.loadOrderValidationSnapshot());
    h.controller.stop();
    assert.equal(destroys, 1);
    assert.equal(loads, 0);
  });
}

test('late validation AUTH_REQUIRED after same-account login cannot authorize or render an error', async t => {
  let rejectToken, authorizations = 0;
  const h = harness({
    paymentLedgerDataFactory: async ({ tokenProvider }) => ({ loadOrderValidationSnapshot: () => tokenProvider(['Sites.Read.All']) }),
    orderValidationReportFactory: async ({ data }) => ({ open: () => data.loadOrderValidationSnapshot(), destroy() {} }),
    auth: { authorize: async () => { authorizations++; } },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.auth.getToken = () => new Promise((_, reject) => { rejectToken = reject; });
  const pending = h.view.emit('open-order-validation-report');
  await tick();
  assert.equal(typeof rejectToken, 'function');
  await h.view.emit('sign-out');
  await h.view.emit('sign-in');
  const renderCount = h.renders.length;
  rejectToken(authRequired());
  assert.equal(await pending, false);
  assert.equal(authorizations, 0);
  assert.equal(h.renders.length, renderCount);
});

test('logout during validation consent prevents token reacquisition', async t => {
  let finishAuthorization, tokens = 0;
  const h = harness({
    paymentLedgerDataFactory: async ({ tokenProvider }) => ({ loadOrderValidationSnapshot: () => tokenProvider(['Sites.Read.All']) }),
    orderValidationReportFactory: async ({ data }) => ({ open: () => data.loadOrderValidationSnapshot(), destroy() {} }),
    auth: {
      getToken: async () => { tokens++; throw authRequired(); },
      authorize: () => new Promise(resolve => { finishAuthorization = resolve; }),
    },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const pending = h.view.emit('open-order-validation-report');
  await tick();
  assert.equal(typeof finishAuthorization, 'function');
  await h.view.emit('sign-out');
  finishAuthorization();
  assert.equal(await pending, false);
  assert.equal(tokens, 1);
});

test('orientation-aborted validation query cannot authorize while its replacement keeps its own token', async t => {
  let data, rejectOld, authorizations = 0, tokenCalls = 0;
  const h = harness({
    paymentLedgerDataFactory: async ({ tokenProvider }) => ({ loadOrderValidationSnapshot: () => tokenProvider(['Sites.Read.All']) }),
    orderValidationReportFactory: async options => { data = options.data; return { open() {}, destroy() {} }; },
    auth: { authorize: async () => { authorizations++; } },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit('open-order-validation-report'), true);
  h.auth.getToken = () => ++tokenCalls === 1
    ? new Promise((_, reject) => { rejectOld = reject; }) : Promise.resolve('fresh-token');
  const orientationRequest = new AbortController();
  const old = data.loadOrderValidationSnapshot({ signal: orientationRequest.signal });
  const rejected = assert.rejects(old, { name: 'AbortError' });
  orientationRequest.abort();
  assert.equal(await data.loadOrderValidationSnapshot({ signal: new AbortController().signal }), 'fresh-token');
  rejectOld(authRequired());
  await rejected;
  assert.equal(authorizations, 0);
});

test('superseded validation snapshot cannot succeed even when the source has already obtained its token', async t => {
  let data, finishOld, loads = 0;
  const h = harness({
    paymentLedgerDataFactory: async () => ({ loadOrderValidationSnapshot: () => ++loads === 1
      ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve({ orders: ['fresh'] }) }),
    orderValidationReportFactory: async options => { data = options.data; return { open() {}, destroy() {} }; },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit('open-order-validation-report'), true);
  const old = data.loadOrderValidationSnapshot();
  const rejected = assert.rejects(old, { name: 'AbortError' });
  assert.deepEqual(await data.loadOrderValidationSnapshot(), { orders: ['fresh'] });
  finishOld({ orders: ['stale'] });
  await rejected;
});

test('already aborted validation query does not start the source or Microsoft consent', async t => {
  let data, loads = 0, authorizations = 0;
  const h = harness({
    paymentLedgerDataFactory: async () => ({ async loadOrderValidationSnapshot() { loads++; } }),
    orderValidationReportFactory: async options => { data = options.data; return { open() {}, destroy() {} }; },
    auth: { authorize: async () => { authorizations++; } },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit('open-order-validation-report'), true);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(async () => data.loadOrderValidationSnapshot({ signal: abort.signal }), { name: 'AbortError' });
  assert.equal(loads, 0);
  assert.equal(authorizations, 0);
});

test('old validation opening cannot clear the new same-account single flight', async t => {
  const factories = [];
  let opens = 0, destroys = 0;
  const h = harness({
    paymentLedgerDataFactory: async () => ({}),
    orderValidationReportFactory: () => new Promise(resolve => { factories.push(resolve); }),
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const old = h.view.emit('open-order-validation-report');
  await tick();
  assert.equal(factories.length, 1);
  await h.view.emit('sign-out');
  await h.view.emit('sign-in');
  const fresh = h.view.emit('open-order-validation-report');
  await tick();
  assert.equal(factories.length, 2);
  factories[0]({ open() { opens++; }, destroy() { destroys++; } });
  assert.equal(await old, false);
  const duplicate = h.view.emit('open-order-validation-report');
  await tick();
  assert.equal(factories.length, 2);
  factories[1]({ open() { opens++; }, destroy() { destroys++; } });
  assert.deepEqual(await Promise.all([fresh, duplicate]), [true, true]);
  assert.equal(opens, 1);
  assert.equal(destroys, 1);
});

test('validation request generations and methods are independent of the three existing reports', async t => {
  const dataByKind = {}, loaded = [], destroyed = [];
  const methods = {
    payments: 'loadPaymentsSnapshot', management: 'loadSnapshot',
    provision: 'loadProvisionReportSnapshot', validation: 'loadOrderValidationSnapshot',
  };
  const factory = kind => async ({ data }) => {
    dataByKind[kind] = data;
    return { open() {}, destroy() { destroyed.push(kind); } };
  };
  const h = harness({
    paymentLedgerDataFactory: async ({ tokenProvider }) => Object.fromEntries(Object.entries(methods).map(([kind, method]) => [method,
      async options => { loaded.push([kind, options]); return tokenProvider(['Sites.Read.All']); },
    ])),
    paymentLedgerFactory: factory('payments'), managementReportFactory: factory('management'),
    provisionReportFactory: factory('provision'), orderValidationReportFactory: factory('validation'),
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.deepEqual(await Promise.all(['open-payment-ledger', 'open-management-report', 'open-provision-report', 'open-order-validation-report']
    .map(event => h.view.emit(event))), [true, true, true, true]);
  let finishValidation;
  h.auth.getToken = () => new Promise(resolve => { finishValidation = resolve; });
  const validation = dataByKind.validation.loadOrderValidationSnapshot();
  h.auth.getToken = async () => 'other-report-token';
  assert.deepEqual(await Promise.all([
    dataByKind.payments.loadPaymentsSnapshot(),
    dataByKind.management.loadSnapshot({ reportNumber: 9 }),
    dataByKind.provision.loadProvisionReportSnapshot(),
  ]), ['other-report-token', 'other-report-token', 'other-report-token']);
  finishValidation('validation-token');
  assert.equal(await validation, 'validation-token');
  assert.deepEqual(loaded, [['validation', {}], ['payments', {}], ['management', { reportNumber: 9 }], ['provision', {}]]);
  await h.view.emit('sign-out');
  assert.deepEqual(destroyed.sort(), ['management', 'payments', 'provision', 'validation']);
});

test('validation HOME and reply routes cannot open over an active flow or without authentication', async t => {
  let factories = 0;
  const h = harness({
    auth: { initialize: async () => null },
    paymentLedgerDataFactory: async () => { factories++; return {}; },
    orderValidationReportFactory: async () => { factories++; return { open() {}, destroy() {} }; },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit('open-order-validation-report'), false);
  await h.view.emit('sign-in');
  h.store.restoreSnapshot({ messages: [], activeFlow });
  assert.equal(await h.view.emit('open-order-validation-report'), false);
  assert.equal(await h.view.emit('select-reply', { replyId: 'order-validation-report' }), false);
  assert.equal(factories, 0);
  assert.equal(h.store.getState().activeFlow, activeFlow);
});

test('active flow started during validation factory loading prevents the pending panel from opening', async t => {
  let finish, opens = 0, destroys = 0;
  const h = harness({
    paymentLedgerDataFactory: async () => ({}),
    orderValidationReportFactory: () => new Promise(resolve => { finish = resolve; }),
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const pending = h.view.emit('open-order-validation-report');
  await tick();
  assert.equal(typeof finish, 'function');
  h.store.restoreSnapshot({ messages: [], activeFlow });
  finish({ open() { opens++; }, destroy() { destroys++; } });
  assert.equal(await pending, false);
  assert.equal(opens, 0);
  assert.equal(destroys, 1);
});

test('default validation factory waits for landscape, cancels on rotation, and removes the overlay on logout', async t => {
  const dom = new JSDOM('<main id="app"><button>Relatório</button></main>');
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  let portrait = true, loads = 0, tokenCalls = 0, authorizations = 0, rejectOld;
  const signals = [];
  dom.window.matchMedia = () => ({ matches: portrait });
  const h = harness({
    paymentLedgerDataFactory: async ({ tokenProvider }) => ({ async loadOrderValidationSnapshot({ signal }) {
      loads++;
      signals.push(signal);
      await tokenProvider(['Sites.Read.All']);
      return { orders: [], launches: [] };
    } }),
    auth: {
      getToken: () => ++tokenCalls === 1 ? new Promise((_, reject) => { rejectOld = reject; }) : Promise.resolve('fresh-token'),
      authorize: async () => { authorizations++; },
    },
  });
  t.after(() => { h.controller.stop(); globalThis.document = previousDocument; dom.window.close(); });
  await h.controller.start();
  assert.equal(await h.view.emit('open-order-validation-report'), true);
  const root = dom.window.document.querySelector('.ov-overlay');
  assert.ok(root);
  assert.equal(root.hidden, false);
  assert.equal(root.querySelector('.pl-orientation').hidden, false);
  assert.equal(loads, 0, 'portrait must not query SharePoint');
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
  assert.match(root.querySelector('.pl-notice').textContent, /Nenhum pedido/);
  rejectOld(authRequired());
  await tick();
  assert.equal(authorizations, 0);
  assert.match(root.querySelector('.pl-notice').textContent, /Nenhum pedido/);
  await h.view.emit('sign-out');
  assert.equal(dom.window.document.querySelector('.ov-overlay'), null);
  assert.equal(dom.window.document.body.style.overflow, '');
});

test('late validation snapshot after logout cannot fulfill a query in the next same-account session', async t => {
  let data, finishOld;
  const h = harness({
    paymentLedgerDataFactory: async () => ({ loadOrderValidationSnapshot: () => new Promise(resolve => { finishOld = resolve; }) }),
    orderValidationReportFactory: async options => { data = options.data; return { open() {}, destroy() {} }; },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit('open-order-validation-report'), true);
  const old = data.loadOrderValidationSnapshot();
  const rejected = assert.rejects(old, /sessão.*encerrada/);
  await h.view.emit('sign-out');
  await h.view.emit('sign-in');
  finishOld({ orders: ['stale'], launches: [] });
  await rejected;
});
