import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { createChatView } from '../src/ui/chat-view.js';

const flush = () => new Promise(setImmediate);
function harness(t) {
  const requests = [], renders = [], store = createConversationStore();
  const controller = createAppController({ store,
    client: { sendText: (options, progress) => new Promise(resolve => requests.push({ ...options, ...progress, resolve })), getAttachments: async () => [] },
    auth: { initialize: async () => ({ homeAccountId: 'QA', name: 'QA' }), getToken: async () => 'token' },
    native: { pickDocuments: async () => [], importSharedItems: async () => [], discardSharedItem: async () => {} },
    view: { render: state => renders.push(state), on: () => () => {}, destroy() {} },
    diaryFieldVisitDataFactory: async () => ({ load: async () => [] }),
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [], listAttachments: async () => [] }),
  });
  t.after(() => controller.stop());
  return { controller, requests, renders, store };
}

test('resume and regular answers expose owned live VM progress rather than a default zero', async t => {
  const h = harness(t), starting = h.controller.start();
  await flush();
  assert.equal(typeof h.requests[0].onOperationProgress, 'function');
  h.requests[0].onOperationProgress({ percent: 60 });
  assert.equal(h.renders.at(-1).operationProgress.percent, 53);
  h.requests[0].resolve({ status: 'processed', messages: [{ type: 'text', text: 'Escolha' }], attachments: [] });
  await starting;
  const sending = h.controller.sendText('SIM'); await flush();
  const request = h.requests.at(-1);
  assert.equal(typeof request.onOperationProgress, 'function');
  request.onOperationProgress({ percent: 45 });
  assert.equal(h.renders.at(-1).operationProgress.percent, 48);
  request.resolve({ status: 'processed', messages: [], attachments: [] }); await sending;
  const last = h.renders.at(-1).operationProgress;
  request.onOperationProgress({ percent: 99 });
  assert.equal(h.renders.at(-1).operationProgress, last);
});

test('stopping the app detaches telemetry while the outstanding resume can safely finish', async t => {
  const h = harness(t), starting = h.controller.start(); await flush();
  assert.equal(typeof h.requests[0].onOperationProgress, 'function');
  h.controller.stop();
  assert.equal(h.requests[0].progressSignal.aborted, true);
  const count = h.renders.length;
  h.requests[0].onOperationProgress({ percent: 90 });
  h.requests[0].resolve({ status: 'processed', messages: [], attachments: [] }); await starting;
  assert.equal(h.renders.length, count);
});

test('live chat view observes generic operation progress changes and keeps the badge beside its spinner', t => {
  const dom = new JSDOM('<main></main>'); t.after(() => dom.window.close());
  const root = dom.window.document.querySelector('main');
  const view = createChatView(root); t.after(() => view.destroy());
  const state = { sessionStatus: 'authenticated', account: { name: 'QA' }, messages: [], pendingFiles: [], resuming: true };
  view.render({ ...state, operationProgress: { percent: 33 } });
  assert.equal(root.querySelector('.chat-progress [role=progressbar]').textContent, '33%');
  view.render({ ...state, operationProgress: { percent: 53 } });
  const badge = root.querySelector('.chat-progress [role=progressbar]');
  assert.equal(badge.textContent, '53%');
  assert.ok(badge.previousElementSibling.matches('.app-loading__spinner'));
});

for (const status of ['processed_with_recovery', 'processed']) test(`a confirmed response containing a business failure never paints 100: ${status}`, async t => {
  const h = harness(t), starting = h.controller.start(); await flush();
  h.requests[0].resolve({ status: 'processed', messages: [], attachments: [] }); await starting;
  h.renders.length = 0;
  const sending = h.controller.sendText('SIM'); await flush();
  h.requests.at(-1).resolve({ status, messages: [{ type: 'text', text: 'Não foi possível gravar.' }],
    results: [{ status: 'flow_paused_after_error' }], attachments: [] });
  await sending;
  assert.ok(h.renders.every(state => state.operationProgress?.percent !== 100));
});

test('a failed resume response cannot complete the visible task merely by being ingested', async t => {
  const h = harness(t), starting = h.controller.start(); await flush();
  h.requests[0].resolve({ status: 'processed_with_recovery', messages: [],
    results: [{ status: 'flow_paused_after_error' }], attachments: [] });
  await starting;
  assert.ok(h.renders.every(state => state.operationProgress?.percent !== 100));
});
