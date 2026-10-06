import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';

// Literal routes catch wrong dispatch and cross-color navigation independently
// of the helper's neighbor calculation. Only UI/network boundaries are doubled.
const groups = [
  ['open-pending-provisions', 'open-provision-report', 'open-payment-ledger', 'open-management-report', 'open-order-validation-report', 'open-document-control-report'],
  ['open-cargos-table', 'open-attendance-summary', 'open-stage-progress'],
  ['open-commercial-receipts', 'open-commercial-milestones', 'open-commercial-documents', 'open-sac-pathologies'],
];
const factories = {
  'open-provision-report': 'provisionReportFactory',
  'open-payment-ledger': 'paymentLedgerFactory',
  'open-management-report': 'managementReportFactory',
  'open-order-validation-report': 'orderValidationReportFactory',
  'open-document-control-report': 'documentControlReportViewFactory',
  'open-cargos-table': 'cargosFactory',
  'open-attendance-summary': 'attendanceSummaryFactory',
  'open-stage-progress': 'stageProgressFactory',
  'open-commercial-receipts': 'commercialReceiptsViewFactory',
  'open-commercial-milestones': 'commercialMilestonesViewFactory',
  'open-commercial-documents': 'commercialDocumentsViewFactory',
  'open-sac-pathologies': 'sacPathologiesViewFactory',
  'open-quotation-report': 'quotationReportViewFactory',
  'open-depreciation-report': 'depreciationReportViewFactory',
  'open-task-association-report': 'taskAssociationReportViewFactory',
};
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

// Same real controller/store harness used by task-association-report-controller;
// kept here because that test defines its harness locally rather than exporting it.
function harness(t, options = {}, { dom = true } = {}) {
  const document = new JSDOM('<body><main id="app"></main></body>').window.document;
  const handlers = new Map(), calls = [], renders = [], panels = [];
  const view = {
    render(state) { renders.push(state); },
    on(type, handler) { handlers.set(type, handler); return () => handlers.delete(type); },
    emit(type, command = {}) { return handlers.get(type)?.({ type, ...command }); },
    focusComposer() {}, destroy() { handlers.clear(); },
  };
  const account = { homeAccountId: 'navigation-user', name: 'Usuário' };
  const auth = { initialize: async () => account, signIn: async () => account,
    getToken: async () => 'token', signOut: async () => {}, ...options.auth };
  let sequence = 0;
  const store = createConversationStore({ randomUUID: () => `navigation-${++sequence}` });
  const source = async () => ({ loadSnapshot: async () => ({}), loadPaymentsSnapshot: async () => ({}),
    loadProvisionReportSnapshot: async () => ({}), loadOrderValidationSnapshot: async () => ({}) });
  const factoryOptions = Object.fromEntries(Object.entries(factories).map(([action, factory]) => [factory, async ({ data }) => {
    const element = document.createElement('div');
    element.hidden = true;
    element.innerHTML = '<section class="pl-dialog" role="dialog"><header class="pl-header"><h2>Relatório</h2><button class="pl-close">Fechar</button></header></section>';
    document.body.append(element);
    const panel = { action, data, ...(dom ? { element } : {}), opens: 0, closes: 0, destroys: 0,
      open() { panel.opens++; element.hidden = false; },
      close() { panel.closes++; element.hidden = true; },
      destroy() { panel.destroys++; element.hidden = true; element.remove(); },
    };
    panels.push(panel);
    return panel;
  }]));
  const controller = createAppController({ store, view, auth,
    native: { importSharedItems: async () => [] },
    client: { async sendText(payload) { calls.push(payload); return { status: 'processed', messages: [] }; },
      getPendingProvisionSnapshot: async () => ({ rows: [] }) },
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [] }),
    ...Object.fromEntries(['paymentLedgerDataFactory', 'cargosDataFactory', 'attendanceSummaryDataFactory',
      'stageProgressDataFactory', 'commercialReceiptsDataFactory', 'commercialMilestonesDataFactory',
      'commercialDocumentsDataFactory', 'sacPathologiesDataFactory', 'documentControlReportDataFactory',
      'quotationReportDataFactory', 'depreciationReportDataFactory', 'taskAssociationReportDataFactory'].map(name => [name, source])),
    ...factoryOptions, ...options, auth,
  });
  t.after(() => { controller.stop(); document.defaultView.close(); });
  return { controller, view, handlers, store, calls, renders, panels, document };
}

test('every one of the fifteen separately opened mascot reports receives an accessible PDF printer',async t=>{
 for(const action of Object.keys(factories)){
  const h=harness(t);await h.controller.start();assert.equal(await h.view.emit(action),true,action);
  const printer=h.panels.at(-1).element.querySelector('[data-action="print-report-pdf"]');
  assert.ok(printer,action);assert.match(printer.getAttribute('aria-label'),/PDF/);assert.equal(printer.tagName,'BUTTON');
  h.controller.stop();
 }
});

for (const group of groups) {
  for (let index = 0; index < group.length - 1; index++) {
    for (const direction of ['next', 'previous']) {
      const from = group[index + (direction === 'previous' ? 1 : 0)];
      const target = group[index + (direction === 'next' ? 1 : 0)];
      test(`${from} ${direction} dispatches ${target} with only one visible report`, async t => {
        const h = harness(t);
        await h.controller.start();
        assert.equal(await h.view.emit(from), true);
        const beforeCalls = h.calls.length;
        const old = h.panels.at(-1);
        assert.equal(await h.view.emit('navigate-mascot-report', { from, direction }), true);
        if (target === 'open-pending-provisions') {
          assert.ok(h.renders.at(-1).pendingProvisions);
        } else {
          assert.equal(h.panels.at(-1).action, target);
          assert.equal(h.panels.at(-1).opens, 1);
        }
        if (old) assert.ok(old.element.hidden || !old.element.isConnected, 'origin is closed before destination opens');
        assert.equal(h.panels.filter(panel => panel.element.isConnected && !panel.element.hidden).length,
          target === 'open-pending-provisions' ? 0 : 1);
        if (from === 'open-pending-provisions') {
          assert.equal(h.renders.at(-1).pendingProvisions, null);
          assert.equal(h.renders.at(-1).pendingProvisionReminderOpen, false);
        }
        assert.equal(h.calls.length, beforeCalls, 'local navigation never sends a chat/business write');
        assert.equal(h.store.getState().activeFlow, null);
      });
    }
  }
}

for (const [from, direction] of [
  ['open-pending-provisions', 'previous'], ['open-document-control-report', 'next'],
  ['open-cargos-table', 'previous'], ['open-stage-progress', 'next'],
  ['open-commercial-receipts', 'previous'], ['open-sac-pathologies', 'next'],
  ['open-quotation-report', 'next'], ['open-depreciation-report', 'previous'],
  ['open-task-association-report', 'next'], ['unknown', 'next'],
  ['open-provision-report', 'sideways'], ['open-provision-report', '__proto__'],
]) {
  test(`rejects boundary/singleton/invalid route ${from} ${direction}`, async t => {
    const h = harness(t);
    await h.controller.start();
    if (from !== 'unknown') await h.view.emit(from);
    const count = h.panels.length;
    assert.equal(await h.view.emit('navigate-mascot-report', { from, direction }), false);
    assert.equal(h.panels.length, count);
  });
}

for (const guard of ['absent-origin', 'hidden-origin', 'detached-origin', 'wrong-color-origin', 'active-flow', 'busy', 'signed-out', 'stopped']) {
  test(`navigation rejects ${guard} before dispatch or cleanup`, async t => {
    const h = harness(t, guard === 'signed-out' ? { auth: { initialize: async () => null } } : {});
    await h.controller.start();
    if (!['signed-out', 'absent-origin'].includes(guard)) await h.view.emit(guard === 'wrong-color-origin' ? 'open-cargos-table' : 'open-payment-ledger');
    const old = h.panels.at(-1);
    if (guard === 'hidden-origin') old.element.hidden = true;
    if (guard === 'detached-origin') old.element.remove();
    if (guard === 'active-flow') h.store.restoreSnapshot({ messages: [], activeFlow: { id: 'validation' } });
    if (guard === 'busy') h.store.beginText('Enviando');
    const navigate = h.handlers.get('navigate-mascot-report');
    if (guard === 'stopped') h.controller.stop();
    const count = h.panels.length, closes = old?.closes;
    assert.equal(await navigate?.({ from: 'open-payment-ledger', direction: 'next' }), false);
    assert.equal(h.panels.length, count);
    assert.equal(old?.closes, closes);
  });
}

test('mock panels without an element can use the controller route', async t => {
  const h = harness(t, {}, { dom: false });
  await h.controller.start();
  await h.view.emit('open-payment-ledger');
  assert.equal(await h.view.emit('navigate-mascot-report', { from: 'open-payment-ledger', direction: 'next' }), true);
  assert.equal(h.panels.at(-1).action, 'open-management-report');
});

for (const [from, target, direction] of [
  ['open-provision-report', 'open-payment-ledger', 'next'],
  ['open-payment-ledger', 'open-management-report', 'next'],
  ['open-management-report', 'open-order-validation-report', 'next'],
  ['open-order-validation-report', 'open-document-control-report', 'next'],
  ['open-document-control-report', 'open-order-validation-report', 'previous'],
  ['open-cargos-table', 'open-attendance-summary', 'next'],
  ['open-attendance-summary', 'open-stage-progress', 'next'],
  ['open-stage-progress', 'open-attendance-summary', 'previous'],
  ['open-commercial-receipts', 'open-commercial-milestones', 'next'],
  ['open-commercial-milestones', 'open-commercial-documents', 'next'],
  ['open-commercial-documents', 'open-sac-pathologies', 'next'],
  ['open-sac-pathologies', 'open-commercial-documents', 'previous'],
]) {
  test(`decorated ${from} arrow calls the real controller to open ${target}`, async t => {
    const h = harness(t);
    await h.controller.start();
    await h.view.emit(from);
    const old = h.panels.at(-1);
    const button = old.element.querySelector(`[data-report-direction="${direction}"]`);
    assert.ok(button, 'factory output receives its navigation controls');
    button.click();
    await tick();
    assert.equal(h.panels.at(-1).action, target);
    assert.equal(h.panels.at(-1).opens, 1);
    assert.equal(h.panels.filter(panel => panel.element.isConnected && !panel.element.hidden).length, 1);
    const count = h.panels.length;
    button.click();
    await tick();
    assert.equal(h.panels.length, count, 'destroyed origin cannot navigate again');
  });
}

test('double arrow activation opens one neighbor and awaits its asynchronous factory', async t => {
  const delayed = deferred();
  let creates = 0;
  const h = harness(t, { commercialMilestonesViewFactory: async () => {
    creates++; return delayed.promise;
  } });
  await h.controller.start();
  await h.view.emit('open-commercial-receipts');
  const old = h.panels.at(-1);
  const button = old.element.querySelector('[data-report-direction="next"]');
  assert.ok(button);
  button.click(); button.click();
  await tick();
  assert.equal(creates, 1);
  assert.equal(old.destroys, 1);
  let opens = 0;
  delayed.resolve({ open() { opens++; }, close() {}, destroy() {} });
  await tick();
  assert.equal(opens, 1);
});

for (const [from, dataFactory, target, direction] of [
  ['open-attendance-summary', 'attendanceSummaryDataFactory', 'open-stage-progress', 'next'],
  ['open-stage-progress', 'stageProgressDataFactory', 'open-attendance-summary', 'previous'],
  ['open-commercial-receipts', 'commercialReceiptsDataFactory', 'open-commercial-milestones', 'next'],
  ['open-commercial-milestones', 'commercialMilestonesDataFactory', 'open-commercial-documents', 'next'],
  ['open-commercial-documents', 'commercialDocumentsDataFactory', 'open-sac-pathologies', 'next'],
  ['open-sac-pathologies', 'sacPathologiesDataFactory', 'open-commercial-documents', 'previous'],
  ['open-document-control-report', 'documentControlReportDataFactory', 'open-order-validation-report', 'previous'],
]) {
test(`navigation aborts ${from} load and rejects retained data after switching`, async t => {
  const query = deferred();
  let signal;
  const h = harness(t, { [dataFactory]: async () => ({ loadSnapshot(options) {
    signal = options.signal; return query.promise;
  } }) });
  await h.controller.start();
  await h.view.emit(from);
  const old = h.panels.at(-1);
  const load = old.data.loadSnapshot();
  const cancelled = assert.rejects(load, { name: 'AbortError' });
  await tick();
  assert.equal(await h.view.emit('navigate-mascot-report', { from, direction }), true);
  assert.equal(signal.aborted, true);
  await cancelled;
  assert.equal(old.destroys, 1);
  await assert.rejects(old.data.loadSnapshot(), { name: 'AbortError' });
  query.resolve({});
  assert.equal(await h.view.emit('navigate-mascot-report', {
    from: target, direction: direction === 'next' ? 'previous' : 'next',
  }), true);
  assert.notEqual(h.panels.at(-1).data, old.data);
});
}

test('superseding a neighbor factory cancels navigation and destroys its late panel', async t => {
  const factory = deferred();
  let opens = 0, destroys = 0;
  const h = harness(t, { stageProgressFactory: () => factory.promise });
  await h.controller.start();
  await h.view.emit('open-attendance-summary');
  let settled = false;
  const navigation = Promise.resolve(h.view.emit('navigate-mascot-report', {
    from: 'open-attendance-summary', direction: 'next',
  })).then(result => { settled = true; return result; });
  await tick();
  assert.equal(await h.view.emit('open-task-association-report'), true);
  await tick();
  assert.equal(settled, true);
  assert.equal(await navigation, false);
  factory.resolve({ open() { opens++; }, destroy() { destroys++; } });
  await tick();
  assert.equal(opens, 0);
  assert.equal(destroys, 1);
  assert.equal(h.panels.at(-1).action, 'open-task-association-report');
});

test('navigation invalidates an older pending gallery so its late panel cannot cover the neighbor', async t => {
  const delayed = deferred();
  let opens = 0, destroys = 0;
  const h = harness(t, {
    ordersGalleryDataFactory: async () => ({}),
    ordersGalleryFactory: () => delayed.promise,
  });
  await h.controller.start();
  await h.view.emit('open-payment-ledger');
  const gallery = h.view.emit('select-reply', { replyId: 'action_orders_gallery' });
  await tick();
  assert.equal(await h.view.emit('navigate-mascot-report', { from: 'open-payment-ledger', direction: 'next' }), true);
  delayed.resolve({ open() { opens++; }, destroy() { destroys++; } });
  assert.equal(await gallery, false);
  assert.equal(opens, 0);
  assert.equal(destroys, 1);
  assert.equal(h.panels.at(-1).action, 'open-management-report');
});

test('a late pending snapshot cannot cover a newer HOME report after arrow navigation',async t=>{
 const query=deferred();let delayed=false;
 const h=harness(t,{client:{sendText:async()=>({status:'processed',messages:[]}),getPendingProvisionSnapshot:()=>delayed?query.promise:Promise.resolve({rows:[]})}});
 await h.controller.start();await h.view.emit('open-provision-report');delayed=true;
 const navigating=h.view.emit('navigate-mascot-report',{from:'open-provision-report',direction:'previous'});await tick();
 await h.view.emit('open-task-association-report');query.resolve({rows:[]});assert.equal(await navigating,false);await tick();
 assert.equal(h.renders.at(-1).pendingProvisions,null);assert.equal(h.panels.at(-1).action,'open-task-association-report');
});
test('a late management factory cannot open over cargos after arrow navigation is superseded',async t=>{
 const factory=deferred();let opens=0,destroys=0;
 const h=harness(t,{managementReportFactory:()=>factory.promise});await h.controller.start();await h.view.emit('open-payment-ledger');
 const navigating=h.view.emit('navigate-mascot-report',{from:'open-payment-ledger',direction:'next'});await tick();await h.view.emit('open-cargos-table');
 factory.resolve({open(){opens++;},destroy(){destroys++;}});assert.equal(await navigating,false);await tick();assert.equal(opens,0);assert.equal(destroys,1);assert.equal(h.panels.at(-1).action,'open-cargos-table');
});
