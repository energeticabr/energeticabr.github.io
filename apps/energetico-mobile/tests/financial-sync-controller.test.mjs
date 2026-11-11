import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';

for (const action of ['open-sicoob-transaction-report', 'open-dda-report', 'open-nfe-report', 'action_financial_movement_gallery', 'action_dda_gallery', 'action_notas_fiscais_sefaz_gallery']) test(`${action} refresh dispatches all three source collectors`, async t => {
  const handlers = new Map(), starts = [], destroyed = [], sessions = {}, options = {};
  const factory = name => input => {
    options[name] = input;
    return sessions[name] = { running: false, resume: async () => {}, suspend() {}, destroy() { destroyed.push(name); },
      subscribe(fn) { fn({ running: false }); return () => {}; }, async start() { starts.push(name); } };
  };
  const client = { sendText: async () => ({ status: 'processed', messages: [] }) };
  for (const name of ['Dda', 'Sefaz', 'Sicoob']) for (const prefix of ['refresh', 'get', 'acknowledge']) {
    if (prefix === 'refresh') client[`refresh${name}`] = async () => {};
    else if (prefix === 'get') { client[`get${name}RefreshStatus`] = async () => {}; client[`get${name}RefreshPending`] = async () => {}; }
    else client[`acknowledge${name}Refresh`] = async () => {};
  }
  let panel;
  const report = async input => { panel = input; return { open() {}, close() {}, destroy() {} }; };
  const controller = createAppController({ client, store: createConversationStore(),
    view: { render() {}, focusComposer() {}, destroy() {}, on(name, handler) { handlers.set(name, handler); return () => {}; } },
    auth: { initialize: async () => ({ homeAccountId: 'owner' }), getToken: async () => 'test', signOut: async () => {} },
    native: { importSharedItems: async () => [] },
    ddaSyncSessionFactory: factory('dda'), sefazSyncSessionFactory: factory('fiscal'), sicoobSyncSessionFactory: factory('sicoob'),
    registrationGalleryDataFactory: async () => ({}), registrationGalleryFactory: report, ddaReportFactory: report, nfeReportFactory: report, sicoobTransactionReportFactory: report,
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [] }),
    pendingConstructionDiaryDataFactory: async () => ({ loadPending: async () => [] }), diaryFieldVisitDataFactory: async () => ({ load: async () => [] }),
  }); t.after(() => controller.stop());
  await controller.start();
  if (action.startsWith('action_')) await handlers.get('select-reply')({ type: 'select-reply', replyId: action, label: 'Galeria' });
  else await handlers.get(action)({ type: action });
  assert.ok(panel?.syncMonitor, 'the report receives the source coordinator');
  await panel.syncMonitor.start(); assert.deepEqual(starts.sort(), ['dda', 'fiscal', 'sicoob']);
  await handlers.get('sign-out')({ type: 'sign-out' });
  await assert.rejects(panel.syncMonitor.start(), /Sessão encerrada/);
  assert.deepEqual(destroyed.sort(), ['dda', 'fiscal', 'sicoob']);
  assert.equal(options.sicoob.isCurrent(), false);
});
