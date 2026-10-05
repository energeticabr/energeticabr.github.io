import test from 'node:test';
import assert from 'node:assert/strict';
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
  const account = { homeAccountId: 'provision-user', name: 'Usuário' };
  const auth = {
    initialize: async () => account, signIn: async () => account,
    getToken: async () => 'sharepoint-token', signOut: async () => {}, ...options.auth,
  };
  const client = {
    async sendText(payload) { calls.push(payload); return { status: 'processed', messages: [] }; },
  };
  const store = createConversationStore({ randomUUID: () => `provision-${++sequence}` });
  const controller = createAppController({
    store, view, auth, client, native: { importSharedItems: async () => [] },
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [] }),
    ...options, auth,
  });
  return { controller, view, auth, calls, renders, store };
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const authRequired = () => Object.assign(new Error('Expired'), { code: 'AUTH_REQUIRED' });

test('provision report HOME event opens one local report with authenticated scopes and unchanged query options', async t => {
  let opens = 0, destroys = 0, sourceCreates = 0, receivedOptions, receivedScopes, token;
  const options = { signal: new AbortController().signal, filters: { startDate: '2026-10-01' } };
  const snapshot = { provisions: [{ id: '42', supplier: 'Fornecedor', total: 120 }], launches: [] };
  let loaded;
  const h = harness({
    paymentLedgerDataFactory: async ({ tokenProvider }) => {
      sourceCreates++;
      return { async loadProvisionReportSnapshot(query) {
        receivedOptions = query;
        token = await tokenProvider(['Sites.Read.All']);
        return snapshot;
      } };
    },
    provisionReportFactory: async ({ data }) => ({
      async open() { opens++; loaded = await data.loadProvisionReportSnapshot(options); },
      destroy() { destroys++; },
    }),
  });
  h.auth.getToken = async scopes => { receivedScopes = scopes; return 'sharepoint-token'; };
  t.after(() => h.controller.stop());
  await h.controller.start();
  const before = h.calls.length;
  const results = await Promise.all([h.view.emit('open-provision-report'), h.view.emit('open-provision-report')]);
  assert.deepEqual(results, [true, true]);
  assert.equal(opens, 1);
  assert.equal(sourceCreates, 1);
  assert.equal(receivedOptions, options);
  assert.deepEqual(receivedScopes, ['Sites.Read.All']);
  assert.equal(token, 'sharepoint-token');
  assert.equal(loaded, snapshot);
  assert.equal(h.calls.length, before);
  await h.view.emit('sign-out');
  assert.equal(destroys, 1);
});

test('provision report uses its own authorization resume ID and reacquires the requested scopes', async t => {
  let tokens = 0;
  const grants = [], scopesRequested = [];
  const h = harness({
    paymentLedgerDataFactory: async ({ tokenProvider }) => ({
      loadProvisionReportSnapshot: () => tokenProvider(['Sites.Read.All']),
    }),
    provisionReportFactory: async ({ data }) => ({ open: () => data.loadProvisionReportSnapshot(), destroy() {} }),
    auth: {
      getToken: async scopes => { scopesRequested.push(scopes); if (++tokens === 1) throw authRequired(); return 'renewed-token'; },
      authorize: async (scopes, options) => { grants.push({ scopes, options }); },
    },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit('open-provision-report'), true);
  assert.deepEqual(grants, [{ scopes: ['Sites.Read.All'], options: { resumeAction: 'provision-report' } }]);
  assert.deepEqual(scopesRequested, [['Sites.Read.All'], ['Sites.Read.All']]);
});

test('provision-report pending authorization action reopens the provision view locally', async t => {
  let opens = 0;
  const h = harness({
    auth: { consumePendingAction: () => 'provision-report' },
    paymentLedgerDataFactory: async () => ({}),
    provisionReportFactory: async () => ({ open() { opens++; }, destroy() {} }),
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(opens, 1);
});

for (const end of ['sign-out', 'stop']) {
  test(`provision report factory resolved after ${end} is destroyed without opening`, async t => {
    let finish, opens = 0, destroys = 0;
    const h = harness({
      paymentLedgerDataFactory: async () => ({}),
      provisionReportFactory: () => new Promise(resolve => { finish = resolve; }),
    });
    t.after(() => h.controller.stop());
    await h.controller.start();
    const pending = h.view.emit('open-provision-report');
    await tick();
    assert.equal(typeof finish, 'function');
    if (end === 'stop') h.controller.stop();
    else await h.view.emit('sign-out');
    finish({ open() { opens++; }, destroy() { destroys++; } });
    assert.equal(await pending, false);
    assert.equal(opens, 0);
    assert.equal(destroys, 1);
  });
}

test('provision report stop destroys an existing panel once', async t => {
  let destroys = 0;
  const h = harness({
    paymentLedgerDataFactory: async () => ({}),
    provisionReportFactory: async () => ({ open() {}, destroy() { destroys++; } }),
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit('open-provision-report'), true);
  h.controller.stop();
  h.controller.stop();
  assert.equal(destroys, 1);
});

test('late provision AUTH_REQUIRED after logout cannot authorize or affect the next session', async t => {
  let rejectToken, authorizations = 0;
  const h = harness({
    paymentLedgerDataFactory: async ({ tokenProvider }) => ({ loadProvisionReportSnapshot: () => tokenProvider(['Sites.Read.All']) }),
    provisionReportFactory: async ({ data }) => ({ open: () => data.loadProvisionReportSnapshot(), destroy() {} }),
    auth: { authorize: async () => { authorizations++; } },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.auth.getToken = () => new Promise((_, reject) => { rejectToken = reject; });
  const pending = h.view.emit('open-provision-report');
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

test('logout during provision consent prevents token reacquisition', async t => {
  let finishAuthorization, tokens = 0;
  const h = harness({
    paymentLedgerDataFactory: async ({ tokenProvider }) => ({ loadProvisionReportSnapshot: () => tokenProvider(['Sites.Read.All']) }),
    provisionReportFactory: async ({ data }) => ({ open: () => data.loadProvisionReportSnapshot(), destroy() {} }),
    auth: {
      getToken: async () => { tokens++; throw authRequired(); },
      authorize: () => new Promise(resolve => { finishAuthorization = resolve; }),
    },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const pending = h.view.emit('open-provision-report');
  await tick();
  assert.equal(typeof finishAuthorization, 'function');
  await h.view.emit('sign-out');
  finishAuthorization();
  assert.equal(await pending, false);
  assert.equal(tokens, 1);
});

test('an aborted provision query cannot authorize, while its replacement keeps its own token', async t => {
  let data, rejectOld, authorizations = 0, tokenCalls = 0;
  const h = harness({
    paymentLedgerDataFactory: async ({ tokenProvider }) => ({ loadProvisionReportSnapshot: () => tokenProvider(['Sites.Read.All']) }),
    provisionReportFactory: async options => { data = options.data; return { open() {}, destroy() {} }; },
    auth: { authorize: async () => { authorizations++; } },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit('open-provision-report'), true);
  h.auth.getToken = () => ++tokenCalls === 1
    ? new Promise((_, reject) => { rejectOld = reject; }) : Promise.resolve('fresh-token');
  const abort = new AbortController();
  const old = data.loadProvisionReportSnapshot({ signal: abort.signal });
  const rejected = assert.rejects(old, { name: 'AbortError' });
  abort.abort();
  assert.equal(await data.loadProvisionReportSnapshot({ signal: new AbortController().signal }), 'fresh-token');
  rejectOld(authRequired());
  await rejected;
  assert.equal(authorizations, 0);
});

test('a superseded provision token response cannot fulfill the newer query', async t => {
  let data, resolveOld, tokenCalls = 0;
  const h = harness({
    paymentLedgerDataFactory: async ({ tokenProvider }) => ({ loadProvisionReportSnapshot: () => tokenProvider(['Sites.Read.All']) }),
    provisionReportFactory: async options => { data = options.data; return { open() {}, destroy() {} }; },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit('open-provision-report'), true);
  h.auth.getToken = () => ++tokenCalls === 1
    ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve('replacement-token');
  const old = data.loadProvisionReportSnapshot();
  const rejected = assert.rejects(old, { name: 'AbortError' });
  assert.equal(await data.loadProvisionReportSnapshot(), 'replacement-token');
  resolveOld('stale-token');
  await rejected;
});

test('new provision opening after same-account login is not cleared by the old pending factory', async t => {
  const factories = [];
  let opens = 0, destroys = 0;
  const h = harness({
    paymentLedgerDataFactory: async () => ({}),
    provisionReportFactory: () => new Promise(resolve => { factories.push(resolve); }),
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const old = h.view.emit('open-provision-report');
  await tick();
  assert.equal(factories.length, 1);
  await h.view.emit('sign-out');
  await h.view.emit('sign-in');
  const fresh = h.view.emit('open-provision-report');
  await tick();
  assert.equal(factories.length, 2);
  factories[0]({ open() { opens++; }, destroy() { destroys++; } });
  assert.equal(await old, false);
  const duplicate = h.view.emit('open-provision-report');
  await tick();
  assert.equal(factories.length, 2);
  factories[1]({ open() { opens++; }, destroy() { destroys++; } });
  assert.deepEqual(await Promise.all([fresh, duplicate]), [true, true]);
  assert.equal(opens, 1);
  assert.equal(destroys, 1);
});

test('provision report remains independent of payment and management HOME handlers', async t => {
  const loaded = [], panels = [], destroyed = [];
  const factory = kind => async ({ data }) => ({
    async open() {
      panels.push(kind);
      if (kind === 'payments') await data.loadPaymentsSnapshot();
      else if (kind === 'management') await data.loadSnapshot({ reportNumber: 9 });
      else await data.loadProvisionReportSnapshot();
    },
    destroy() { destroyed.push(kind); },
  });
  const h = harness({
    paymentLedgerDataFactory: async () => ({
      async loadPaymentsSnapshot() { loaded.push('payments'); },
      async loadSnapshot({ reportNumber }) { loaded.push(reportNumber); },
      async loadProvisionReportSnapshot() { loaded.push('provisions'); },
    }),
    paymentLedgerFactory: factory('payments'), managementReportFactory: factory('management'),
    provisionReportFactory: factory('provisions'),
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  await Promise.all(['open-payment-ledger', 'open-management-report', 'open-provision-report'].map(event => h.view.emit(event)));
  assert.deepEqual(panels.sort(), ['management', 'payments', 'provisions']);
  assert.deepEqual(loaded, ['payments', 9, 'provisions']);
  await h.view.emit('sign-out');
  assert.deepEqual(destroyed.sort(), ['management', 'payments', 'provisions']);
});

test('provision report cannot open without authentication or after stop', async t => {
  let factories = 0;
  const h = harness({
    auth: { initialize: async () => null },
    paymentLedgerDataFactory: async () => { factories++; return {}; },
    provisionReportFactory: async () => { factories++; return { open() {}, destroy() {} }; },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit('open-provision-report'), false);
  assert.equal(factories, 0);
  await h.view.emit('sign-in');
  h.controller.stop();
  assert.equal(factories, 0);
});
