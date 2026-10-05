import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const authRequired = () => Object.assign(new Error('Expired'), { code: 'AUTH_REQUIRED' });
const scopes = ['Sites.Read.All'];
const activeFlow = { id: 'attendance_validation', title: 'Validação em andamento' };
const snapshot = { presences: [], suppliers: [] };

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
  const account = { homeAccountId: 'attendance-user', name: 'Usuário' };
  const auth = {
    initialize: async () => account, signIn: async () => account,
    getToken: async () => 'sharepoint-token', signOut: async () => {}, ...options.auth,
  };
  const store = createConversationStore({ randomUUID: () => `attendance-${++sequence}` });
  const controller = createAppController({
    store, view, auth, client: { async sendText(payload) {
      calls.push(payload); return { status: 'processed', messages: [] };
    } },
    native: { importSharedItems: async () => [] },
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [] }),
    attendanceSummaryDataFactory: async () => ({ loadSnapshot: async () => snapshot }),
    attendanceSummaryFactory: async ({ data, document }) => {
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
  assert.equal(await h.view.emit('open-attendance-summary'), true);
  return h.panels.at(-1).data;
}

test('HOME and reply open one local attendance report, with an independent read-only data source', async t => {
  let sourceCreates = 0, receivedOptions;
  const requestedScopes = [];
  const h = harness(t, {
    paymentLedgerDataFactory: async () => { assert.fail('attendance must not use spending data'); },
    attendanceSummaryDataFactory: async ({ tokenProvider }) => {
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
  assert.deepEqual(await Promise.all([
    h.view.emit('open-attendance-summary'),
    h.view.emit('select-reply', { replyId: 'action_attendance_summary', label: 'Resumo de presença' }),
  ]), [true, true]);
  assert.equal(h.panels.length, 1);
  assert.equal(h.panels[0].opens, 1);
  assert.equal(h.panels[0].document, globalThis.document);
  assert.deepEqual(Object.keys(h.panels[0].data), ['loadSnapshot']);
  const caller = new AbortController();
  assert.equal(await h.panels[0].data.loadSnapshot({ signal: caller.signal, trace: 'attendance' }), snapshot);
  assert.equal(sourceCreates, 1);
  assert.equal(receivedOptions.trace, 'attendance');
  assert.equal(receivedOptions.signal.aborted, false);
  assert.deepEqual(requestedScopes, [['Sites.Read.All']]);
  assert.equal(await h.view.emit('open-attendance-summary'), true);
  assert.equal(h.panels.length, 1, 'the same session reuses its report');
  assert.equal(h.calls.length, before, 'report actions never submit chat, attendance, or payments');
});

test('attendance consent preserves scopes and its own redirect resume action', async t => {
  let tokens = 0;
  const grants = [], requestedScopes = [];
  const h = harness(t, {
    attendanceSummaryDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
    auth: {
      getToken: async value => { requestedScopes.push(value); if (++tokens === 1) throw authRequired(); return 'renewed-token'; },
      authorize: async (value, options) => { grants.push({ scopes: value, options }); },
    },
  });
  const data = await open(h);
  assert.equal(await data.loadSnapshot(), 'renewed-token');
  assert.deepEqual(grants, [{ scopes: ['Sites.Read.All'], options: { resumeAction: 'action_attendance_summary' } }]);
  assert.deepEqual(requestedScopes, [['Sites.Read.All'], ['Sites.Read.All']]);
});

test('pending attendance redirect resumes the report locally after conversation recovery', async t => {
  const h = harness(t, { auth: { consumePendingAction: () => 'action_attendance_summary' } });
  await h.controller.start();
  assert.equal(h.panels.length, 1);
  assert.equal(h.panels[0].opens, 1);
  assert.deepEqual(h.calls, [{ text: '', replyId: 'input_continue' }]);
});

for (const guard of ['signed-out', 'active-flow', 'busy']) {
  test(`attendance HOME and reply cannot open while ${guard}`, async t => {
    const h = harness(t, guard === 'signed-out' ? { auth: { initialize: async () => null } } : {});
    await h.controller.start();
    if (guard === 'active-flow') h.store.restoreSnapshot({ messages: [], activeFlow });
    if (guard === 'busy') h.store.beginText('Mensagem em andamento');
    const before = h.calls.length;
    assert.equal(await h.view.emit('open-attendance-summary'), false);
    assert.equal(await h.view.emit('select-reply', { replyId: 'action_attendance_summary' }), false);
    assert.equal(h.panels.length, 0);
    assert.equal(h.calls.length, before);
    if (guard === 'active-flow') assert.equal(h.store.getState().activeFlow, activeFlow);
  });
}

for (const end of ['sign-out', 'stop', 'account-change', 'active-flow', 'busy']) {
  test(`attendance panel resolved after ${end} is destroyed without opening`, async t => {
    const factory = deferred();
    let factoryCalls = 0, opens = 0, destroys = 0;
    const h = harness(t, { attendanceSummaryFactory: () => { factoryCalls++; return factory.promise; } });
    await h.controller.start();
    const pending = h.view.emit('open-attendance-summary');
    await tick();
    assert.equal(factoryCalls, 1);
    if (end === 'stop') h.controller.stop();
    else if (end === 'account-change') {
      h.auth.signIn = async () => ({ homeAccountId: 'other-account' });
      await h.view.emit('sign-in');
    } else if (end === 'active-flow') h.store.restoreSnapshot({ messages: [], activeFlow });
    else if (end === 'busy') h.store.beginText('Mensagem em andamento');
    else await h.view.emit('sign-out');
    factory.resolve({ open() { opens++; }, destroy() { destroys++; } });
    assert.equal(await pending, false);
    assert.equal(opens, 0);
    assert.equal(destroys, 1);
  });
}

for (const end of ['sign-out', 'stop', 'same-account-login']) {
  test(`attendance queries are aborted and report disposed once on ${end}`, async t => {
    const source = deferred();
    let signal, loads = 0;
    const h = harness(t, { attendanceSummaryDataFactory: async () => ({ loadSnapshot(options) {
      signal = options.signal; loads++; return source.promise;
    } }) });
    const data = await open(h);
    const old = data.loadSnapshot();
    const rejected = assert.rejects(old, { name: 'AbortError' });
    await tick();
    if (end === 'stop') h.controller.stop();
    else await h.view.emit(end === 'same-account-login' ? 'sign-in' : 'sign-out');
    assert.equal(signal.aborted, true, 'controller cancels SharePoint even without a caller signal');
    await rejected;
    await assert.rejects(data.loadSnapshot(), { name: 'AbortError' });
    assert.equal(loads, 1);
    assert.equal(h.panels[0].destroys, 1);
    source.resolve(snapshot);
    if (end === 'same-account-login') {
      assert.equal(await h.view.emit('open-attendance-summary'), true);
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
    attendanceSummaryDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
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
  test(`attendance consent cannot reacquire a token after ${end}`, async t => {
    const grant = deferred();
    let tokens = 0, authorizations = 0;
    const h = harness(t, {
      attendanceSummaryDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
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
    attendanceSummaryDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: () => tokenProvider(scopes) }),
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
    attendanceSummaryDataFactory: async ({ tokenProvider }) => ({ async loadSnapshot({ signal }) {
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
  test(`superseded attendance ${result} cannot escape even if the source ignores abort`, async t => {
    const stale = deferred();
    let loads = 0;
    const h = harness(t, { attendanceSummaryDataFactory: async () => ({ loadSnapshot: () => ++loads === 1
      ? stale.promise : Promise.resolve({ presences: ['fresh'], suppliers: [] }) }) });
    const data = await open(h);
    const old = data.loadSnapshot();
    const rejected = assert.rejects(old, { name: 'AbortError' });
    await tick();
    assert.deepEqual(await data.loadSnapshot(), { presences: ['fresh'], suppliers: [] });
    await rejected;
    if (result === 'success') stale.resolve(snapshot);
    else stale.reject(new Error('Old SharePoint failure'));
    await tick();
  });
}

test('already aborted attendance query does not create its source or request consent', async t => {
  let creates = 0, tokens = 0;
  const h = harness(t, {
    attendanceSummaryDataFactory: async () => { creates++; return { loadSnapshot: async () => snapshot }; },
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
  const h = harness(t, { attendanceSummaryDataFactory: () => factory.promise });
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

test('old attendance opening cannot clear the new session single flight', async t => {
  const factories = [];
  let opens = 0, destroys = 0;
  const h = harness(t, { attendanceSummaryFactory: () => {
    const factory = deferred(); factories.push(factory); return factory.promise;
  } });
  await h.controller.start();
  const old = h.view.emit('open-attendance-summary');
  await tick();
  assert.equal(factories.length, 1);
  await h.view.emit('sign-out');
  await h.view.emit('sign-in');
  const fresh = h.view.emit('open-attendance-summary');
  await tick();
  assert.equal(factories.length, 2);
  factories[0].resolve({ open() { opens++; }, destroy() { destroys++; } });
  assert.equal(await old, false);
  const duplicate = h.view.emit('open-attendance-summary');
  await tick();
  assert.equal(factories.length, 2);
  factories[1].resolve({ open() { opens++; }, destroy() { destroys++; } });
  assert.deepEqual(await Promise.all([fresh, duplicate]), [true, true]);
  assert.equal(opens, 1);
  assert.equal(destroys, 1);
});

for (const guard of ['active-flow', 'busy']) {
  test(`starting ${guard} closes the attendance report and aborts outstanding data`, async t => {
    const source = deferred();
    let signal;
    const h = harness(t, { attendanceSummaryDataFactory: async () => ({ loadSnapshot(options) {
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

test('attendance opening errors are reported once and a new attempt can open', async t => {
  let factories = 0;
  const h = harness(t, { attendanceSummaryFactory: async () => {
    if (++factories === 1) throw new Error('Report unavailable');
    return { open() {}, destroy() {} };
  } });
  await h.controller.start();
  assert.equal(await h.view.emit('open-attendance-summary'), false);
  assert.equal(h.renders.at(-1).error, 'Report unavailable');
  assert.equal(await h.view.emit('open-attendance-summary'), true);
  assert.equal(factories, 2);
});
