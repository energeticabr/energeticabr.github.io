import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { PAYROLL_BREAKDOWN_REPLY_ID } from '../src/chat/payroll-breakdown.js';

test('atalho abre fluxo local sem enviar comando financeiro à VM e encerra dados no logout', async t => {
  const handlers = new Map(), store = createConversationStore(), calls = [];
  const view = { render() {}, on: (type, handler) => { handlers.set(type, handler); return () => handlers.delete(type); }, focusComposer() {} };
  let opened = 0, destroyed = 0, session, dataOptions;
  const controller = createAppController({ store, view, client: { sendText: async payload => { calls.push(payload); return { status: 'processed', messages: [] }; } },
    auth: { initialize: async () => ({ homeAccountId: 'account-one', name: 'Teste' }), getToken: async () => 'test-token', signOut: async () => {} }, native: { importSharedItems: async () => [] },
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [] }),
    payrollBreakdownDataFactory: async options => { dataOptions = options; return { prepare: async () => { await options.tokenProvider(['Sites.ReadWrite.All']); } }; },
    payrollBreakdownFactory: async options => { session = options; return { open: async () => { opened++; }, destroy: () => { destroyed++; } }; },
  });
  t.after(() => controller.stop()); await controller.start();
  await handlers.get('select-reply')({ replyId: PAYROLL_BREAKDOWN_REPLY_ID }); assert.equal(opened, 0);
  store.ingestRemoteMessages([{ type: 'poll', question: 'PROVISÃO DE PAGAMENTOS', options: [{ id: 'action_payment' }, { id: 'action_recurring_expense' }] }]);
  const before = calls.length;
  await handlers.get('select-reply')({ replyId: PAYROLL_BREAKDOWN_REPLY_ID }); assert.equal(opened, 1); assert.equal(calls.length, before);
  assert.equal(session.sessionKey, 'account-one'); assert.equal(await dataOptions.tokenProvider(['Sites.Read.All']), 'test-token');
  await handlers.get('sign-out')({}); assert.equal(destroyed, 1); assert.throws(() => session.assertSession(), /encerrada/);
});
