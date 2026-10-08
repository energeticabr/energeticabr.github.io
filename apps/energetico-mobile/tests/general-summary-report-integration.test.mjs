import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createAppController} from '../src/app-controller.js';
import {createConversationStore} from '../src/chat/conversation-store.js';

const action = 'open-general-summary-report';
const reply = 'header-general-summary-report';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
const snapshot = {
  metrics: {dueToday: 2, overdue: 0, auditOrders: 3, quotes: null, documents: 4,
    pendingTasks: 5, delegatedTasks: 6, activeContracts: 7, pendingPayments: 123.45,
    pendingDiaries: 8, commercialDocuments: 9, activePathologies: 10},
  today: '2026-10-08', updatedAt: '2026-10-08T12:00:00.000Z',
  warnings: ['Cotações indisponíveis.'],
};
function harness(t, options = {}) {
  const handlers = new Map(), panels = [], calls = [];
  const account = {homeAccountId: 'summary-user'};
  const view = {render(){}, on(type, handler){handlers.set(type, handler); return () => handlers.delete(type);},
    emit(type, value = {}){return handlers.get(type)?.({type, ...value});}, focusComposer(){}, destroy(){}};
  const auth = {initialize: async () => account, signIn: async () => account,
    signOut: async () => {}, getToken: async () => 'read-token', ...options.auth};
  const store = createConversationStore();
  const controller = createAppController({store, view, auth,
    client: {sendText: async payload => {calls.push(payload); return {status:'processed', messages:[]};}},
    native: {importSharedItems: async () => []},
    pendingProvisionAttachmentsDataFactory: async () => ({loadUpcomingPayments: async () => []}),
    generalSummaryReportViewFactory: async ({data, onClose, onHome}) => {
      const panel = {data, opens: 0, destroys: 0, open(){panel.opens++;},
        close(){onClose?.();}, home(){panel.close(); return onHome?.();}, destroy(){panel.destroys++;}};
      panels.push(panel); return panel;
    },
    generalSummaryReportDataFactory: async () => ({loadReport: async () => snapshot}),
    contractorControlReportViewFactory: async () => ({open(){}, destroy(){}}),
    pendingSupplierPaymentsReportViewFactory: async () => ({open(){}, destroy(){}}),
    ...options, auth});
  t.after(() => controller.stop());
  return {controller, view, store, auth, account, panels, calls};
}
async function open(h) {
  await h.controller.start();
  assert.equal(await h.view.emit(action), true, 'header action must open the standalone report');
  return h.panels[0].data;
}
async function settlesSoon(promise) {
  const timeout = deferred();
  const timer = setTimeout(() => timeout.reject(Error('cancellation waited for the ignored signal')), 1000);
  try {return await Promise.race([promise, timeout.promise]);} finally {clearTimeout(timer);}
}

// Missing local routing must fail before any remote business command is sent.
test('header opens locally and exposes only loadReport, retaining unavailable metrics', async t => {
  const h = harness(t); await h.controller.start(); const before = h.calls.length;
  assert.equal(await h.view.emit(action), true, 'header action must open the standalone report');
  assert.deepEqual(Object.keys(h.panels[0].data), ['loadReport']);
  assert.deepEqual(await h.panels[0].data.loadReport(), snapshot);
  assert.equal(h.panels[0].opens, 1); assert.equal(h.calls.length, before);
});

test('rapid header and resume requests share one pending view', async t => {
  const pending = deferred(); let factories = 0, opens = 0;
  const h = harness(t, {generalSummaryReportViewFactory: () => {factories++; return pending.promise;}});
  await h.controller.start(); const before = h.calls.length;
  const first = h.view.emit(action), second = h.view.emit('select-reply', {replyId: reply});
  await tick(); pending.resolve({open(){opens++;}, destroy(){}});
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(factories, 1); assert.equal(opens, 1); assert.equal(h.calls.length, before);
});

test('default lazy data factory loads the agreed source without fabricating zeros on unavailable data', async t => {
  let tokens = 0;
  const h = harness(t, {generalSummaryReportDataFactory: undefined,
    auth:{getToken: async scopes => {tokens++; assert.deepEqual(scopes, ['Sites.Read.All']); throw Error('offline');}}});
  const data = await open(h), report = await data.loadReport();
  assert.ok(tokens > 0, 'default data loader must reach the authenticated read boundary');
  assert.deepEqual(report.metrics, {dueToday:null, overdue:null, auditOrders:null, quotes:null, documents:null,
    pendingTasks:null, delegatedTasks:null, activeContracts:null, pendingPayments:null,
    pendingDiaries:null, commercialDocuments:null, activePathologies:null});
  assert.ok(report.warnings.length > 0);
});

test('session recovery aborts report data before waiting for the conversation transport', async t => {
  const source = deferred(), transport = deferred(); let stall = false, signal;
  const h = harness(t, {client:{sendText: async () => stall ? transport.promise : {status:'processed', messages:[]}},
    generalSummaryReportDataFactory: async () => ({loadReport: options => {signal = options.signal; return source.promise;}})});
  const data = await open(h), task = data.loadReport(), rejected = assert.rejects(task, {name:'AbortError'});
  await tick(); stall = true; const resume = h.view.emit('retry-session');
  try {
    await settlesSoon(rejected); assert.equal(signal.aborted, true); assert.equal(h.panels[0].destroys, 1);
  } finally {transport.resolve({status:'processed', messages:[]}); source.resolve(snapshot); await resume;}
});

test('Inicio returns to the real main menu after onClose disposes the report', async t => {
  const commands = [];
  const h = harness(t, {client:{sendText: async payload => {
    commands.push(payload);
    return {status:'processed', activeFlow:null, messages:[{id:'home', role:'assistant', type:'poll',
      question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options:[{id:'group_pending', label:'PENDÊNCIAS'}, {id:'group_supplies', label:'SUPRIMENTOS'}]}]};
  }}});
  await open(h); const before = commands.length;
  assert.equal(await h.panels[0].home(), true, 'Inicio must navigate after closing its session');
  assert.equal(h.panels[0].destroys, 1);
  assert.equal(commands.length, before + 1);
  assert.equal(commands.at(-1).replyId, 'portal_confirm_main_menu');
  assert.equal(commands.at(-1).text, '');
});

for (const end of ['sign-out', 'stop', 'account-change', 'auth-account', 'origin']) {
  test(`old Inicio callback cannot navigate after ${end}`, async t => {
    let current = {homeAccountId:'summary-user'};
    const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', {configurable:true, value:{origin:'https://first.test'}});
    t.after(() => {if (original) Object.defineProperty(globalThis, 'location', original); else delete globalThis.location;});
    const h = harness(t, {auth:{getAccount: () => current}}); await open(h);
    if (end === 'stop') h.controller.stop();
    else if (end === 'sign-out') await h.view.emit('sign-out');
    else if (end === 'account-change') await h.view.emit('sign-in');
    else if (end === 'auth-account') current = {homeAccountId:'other-user'};
    else globalThis.location.origin = 'https://second.test';
    const before = h.calls.length;
    assert.equal(await h.panels[0].home(), false);
    assert.equal(h.calls.length, before);
  });
}

test('token requests enforce read scopes and coalesce consent with the header resume action', async t => {
  const consent = deferred(), grants = []; let authorized = false;
  const h = harness(t, {auth: {
    getToken: async scopes => {assert.deepEqual(scopes, ['Sites.Read.All']);
      if (!authorized) throw Object.assign(Error('consent'), {code:'AUTH_REQUIRED'}); return 'read';},
    authorize: async (scopes, options) => {grants.push({scopes, options}); await consent.promise; authorized = true;},
  }, generalSummaryReportDataFactory: async ({tokenProvider}) => ({
    loadReport: () => Promise.all([tokenProvider(['Sites.ReadWrite.All']), tokenProvider()]),
  })});
  const data = await open(h), task = data.loadReport(); await tick();
  assert.deepEqual(grants, [{scopes:['Sites.Read.All'], options:{resumeAction:reply}}]);
  consent.resolve(); assert.deepEqual(await task, ['read', 'read']);
});

test('reopening the current report preserves its view and ongoing read', async t => {
  const pending = deferred(); let signal;
  const h = harness(t, {generalSummaryReportDataFactory: async () => ({
    loadReport: options => {signal = options.signal; return pending.promise;},
  })});
  const data = await open(h), task = data.loadReport(); await tick();
  assert.equal(await h.view.emit(action), true);
  assert.equal(h.panels.length, 1); assert.equal(h.panels[0].destroys, 0);
  assert.equal(h.panels[0].opens, 2); assert.equal(signal.aborted, false);
  pending.resolve(snapshot); assert.deepEqual(await task, snapshot);
});

for (const guard of ['signed-out', 'active-flow', 'busy', 'stopped', 'different-auth-account']) {
  test(`header and local resume refuse to open during ${guard}`, async t => {
    const h = harness(t, guard === 'signed-out' ? {auth:{initialize: async () => null}}
      : guard === 'different-auth-account' ? {auth:{getAccount: () => ({homeAccountId:'other-user'})}} : {});
    await h.controller.start();
    if (guard === 'active-flow') h.store.restoreSnapshot({messages:[], activeFlow:{id:'flow'}});
    if (guard === 'busy') h.store.beginText('busy');
    if (guard === 'stopped') h.controller.stop();
    // stop removes all event handlers, so an absent handler is also refusal.
    assert.notEqual(await h.view.emit(action), true);
    assert.notEqual(await h.view.emit('select-reply', {replyId:reply}), true);
    assert.equal(h.panels.length, 0);
  });
}

for (const end of ['sign-out', 'stop', 'account-change', 'active-flow', 'busy', 'close',
  'contract-report', 'other-report', 'media-navigation']) {
  test(`loadReport aborts immediately on ${end} even when the source ignores signals`, async t => {
    const pending = deferred(); let signal;
    const h = harness(t, {generalSummaryReportDataFactory: async () => ({
      loadReport: options => {signal = options.signal; return pending.promise;},
    })});
    const data = await open(h), task = data.loadReport();
    const rejected = assert.rejects(task, {name:'AbortError'}); await tick();
    if (end === 'stop') h.controller.stop();
    else if (end === 'account-change') await h.view.emit('sign-in');
    else if (end === 'active-flow') h.store.restoreSnapshot({messages:[], activeFlow:{id:'flow'}});
    else if (end === 'busy') h.store.beginText('busy');
    else if (end === 'close') h.panels[0].close();
    else if (end === 'contract-report') await h.view.emit('open-contractor-control-report');
    else if (end === 'other-report') await h.view.emit('open-pending-supplier-payments-report');
    else if (end === 'media-navigation') await h.view.emit('open-media', {messageId:'missing'});
    else await h.view.emit('sign-out');
    await settlesSoon(rejected); assert.equal(signal.aborted, true);
    assert.equal(h.panels[0].destroys, 1);
    pending.resolve(snapshot); await assert.rejects(data.loadReport(), {name:'AbortError'});
  });
}

test('a refresh cancels the older load and delivers only the fresh snapshot', async t => {
  const pending = deferred(); let loads = 0;
  const h = harness(t, {generalSummaryReportDataFactory: async () => ({
    loadReport: () => ++loads === 1 ? pending.promise : snapshot,
  })});
  const data = await open(h), old = data.loadReport(), rejected = assert.rejects(old, {name:'AbortError'});
  await tick(); assert.deepEqual(await data.loadReport(), snapshot); await settlesSoon(rejected);
  pending.resolve({...snapshot, metrics:{...snapshot.metrics, dueToday:99}});
});

test('caller abort rejects immediately before an ignored source completes', async t => {
  const pending = deferred(), controller = new AbortController(); let signal;
  const h = harness(t, {generalSummaryReportDataFactory: async () => ({
    loadReport: options => {signal = options.signal; return pending.promise;},
  })});
  const data = await open(h), task = data.loadReport({signal:controller.signal});
  const rejected = assert.rejects(task, {name:'AbortError'}); await tick(); controller.abort();
  await settlesSoon(rejected); assert.equal(signal.aborted, true); pending.resolve(snapshot);
  await assert.rejects(data.loadReport({signal:controller.signal}), {name:'AbortError'});
});

test('superseded token failure cannot start a stale consent prompt', async t => {
  const token = deferred(); let tokens = 0, grants = 0;
  const h = harness(t, {auth:{getToken: () => ++tokens === 1 ? token.promise : Promise.resolve('fresh'),
    authorize: async () => grants++}, generalSummaryReportDataFactory: async ({tokenProvider}) => ({loadReport: () => tokenProvider()})});
  const data = await open(h), old = data.loadReport(), rejected = assert.rejects(old, {name:'AbortError'});
  await tick(); assert.equal(await data.loadReport(), 'fresh'); await settlesSoon(rejected);
  token.reject(Object.assign(Error('late'), {code:'AUTH_REQUIRED'})); await tick(); assert.equal(grants, 0);
});

for (const completion of ['resolve', 'reject']) test(`consent ${completion} after logout cannot retry tokens or deliver a snapshot`, async t => {
  const consent = deferred(); let tokens = 0, grants = 0;
  const h = harness(t, {auth:{getToken: async () => {tokens++; throw Object.assign(Error('consent'), {code:'AUTH_REQUIRED'});},
    authorize: () => {grants++; return consent.promise;}},
    generalSummaryReportDataFactory: async ({tokenProvider}) => ({loadReport: async () => {await tokenProvider(); return snapshot;}})});
  const data = await open(h), task = data.loadReport(), rejected = assert.rejects(task, {name:'AbortError'});
  await tick(); assert.equal(grants, 1); await h.view.emit('sign-out'); await settlesSoon(rejected);
  if (completion === 'resolve') consent.resolve(); else consent.reject(Error('late grant failure'));
  await tick(); assert.equal(tokens, 1); assert.equal(h.panels[0].destroys, 1);
});

test('late data factory after cancellation never loads its stale snapshot', async t => {
  const pending = deferred(); let loads = 0;
  const h = harness(t, {generalSummaryReportDataFactory: () => pending.promise});
  const data = await open(h), task = data.loadReport(), rejected = assert.rejects(task, {name:'AbortError'});
  await tick(); h.panels[0].close(); await settlesSoon(rejected);
  pending.resolve({loadReport: () => {loads++; return snapshot;}}); await tick(); assert.equal(loads, 0);
});

for (const end of ['sign-out', 'stop', 'other-report']) test(`pending view cancels on ${end} and destroys a late factory result`, async t => {
  const pending = deferred(); let opens = 0, destroys = 0;
  const h = harness(t, {generalSummaryReportViewFactory: () => pending.promise});
  await h.controller.start(); const task = h.view.emit(action); await tick();
  if (end === 'stop') h.controller.stop();
  else if (end === 'other-report') await h.view.emit('open-contractor-control-report');
  else await h.view.emit('sign-out');
  assert.equal(await settlesSoon(task), false);
  pending.resolve({open(){opens++;}, destroy(){destroys++;}}); await tick();
  assert.equal(opens, 0); assert.equal(destroys, 1);
});

test('redirect pending action resumes locally exactly once', async t => {
  let consumed = 0;
  const h = harness(t, {auth:{consumePendingAction: () => {consumed++; return reply;}}});
  await h.controller.start(); await h.controller.start();
  assert.equal(consumed, 1); assert.equal(h.panels.length, 1); assert.equal(h.panels[0].opens, 1);
});

for (const change of ['auth-account', 'mutated-account', 'origin']) test(`late snapshot is rejected after ${change} changes`, async t => {
  const pending = deferred(); let current = {homeAccountId:'summary-user'};
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {configurable:true, value:{origin:'https://first.test'}});
  t.after(() => {if (original) Object.defineProperty(globalThis, 'location', original); else delete globalThis.location;});
  const h = harness(t, {auth:{getAccount: () => current},
    generalSummaryReportDataFactory: async () => ({loadReport: () => pending.promise})});
  const data = await open(h), task = data.loadReport(), rejected = assert.rejects(task, {name:'AbortError'});
  await tick();
  if (change === 'origin') globalThis.location.origin = 'https://second.test';
  else if (change === 'mutated-account') {h.account.homeAccountId = 'other-user'; current = h.account;}
  else current = {homeAccountId:'other-user'};
  pending.resolve(snapshot); await rejected;
  assert.equal(h.panels[0].destroys, 1, 'a stale account or origin must dispose its panel');
});

test('general report gets shared print decoration without mascot family arrows', async t => {
  const dom = new JSDOM('<main></main>'); t.after(() => dom.window.close());
  const root = dom.window.document.createElement('section'); root.setAttribute('role', 'dialog');
  root.innerHTML = '<header class="general-summary-toolbar"><button data-action="refresh">Atualizar</button></header><p>Resumo geral</p>';
  dom.window.document.body.append(root);
  const h = harness(t, {generalSummaryReportViewFactory: async () => ({element:root, open(){}, destroy(){root.remove();}})});
  await h.controller.start(); assert.equal(await h.view.emit(action), true);
  assert.equal(root.dataset.reportAction, action);
  assert.ok(root.querySelector('.report-print-button'), 'shared print control missing');
  assert.equal(root.querySelector('[data-report-direction]'), null);
  assert.equal(await h.view.emit('navigate-mascot-report', {from:action, direction:'next'}), false);
});
