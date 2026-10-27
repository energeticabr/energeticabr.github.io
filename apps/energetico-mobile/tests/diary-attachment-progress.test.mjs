import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatClient } from '../src/chat/chat-client.js';
import { loadingIndicatorMarkup } from '../src/ui/loading-indicator.js';
import { renderChatMarkup, createChatView } from '../src/ui/chat-view.js';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';

const requestId = 'f7d76b08-62b3-4507-9ee4-8c49f5fa1801';
const settle = () => new Promise(setImmediate);
const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const finished = { status: 'processed', messages: [], diaryEvidenceProgress: { requestId, percent: 100, status: 'complete', stage: 'ready' } };

function clientHarness(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish;
  const requests = [], updates = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (body.action === 'diary_evidence_progress') {
      return json({ requestId, percent: 37, status: 'running', stage: 'photos' });
    }
    return new Promise(resolve => { finish = result => resolve(json(result)); });
  };
  const client = createChatClient({ apiBaseUrl: 'https://example.com', tokenProvider: async () => 'token',
    fetchImpl, randomUUID: () => requestId });
  return { client, updates, requests, finish: result => finish(result) };
}

test('pending finalization exposes measured progress but only the main confirmation reaches 100', async t => {
  const h = clientHarness(t);
  const sending = h.client.sendText({ replyId: 'diary_finish', text: 'FINALIZAR ANEXOS', onProgress: p => h.updates.push(p.percent) });
  await settle();
  assert.deepEqual(h.updates, [0]);
  t.mock.timers.tick(1000); await settle();
  assert.deepEqual(h.updates, [0, 37]);
  assert.equal(h.requests[0].trackDiaryEvidence, true);
  assert.equal(h.requests.filter(r => r.replyId === 'diary_finish').length, 1);
  h.finish(finished); await sending;
  assert.deepEqual(h.updates, [0, 37, 100]);
  t.mock.timers.tick(10000); await settle();
  assert.equal(h.requests.length, 2);
});

test('a valid VM error response does not falsely finish the percentage', async t => {
  const h = clientHarness(t);
  const sending = h.client.sendText({ replyId: 'diary_finish', onProgress: p => h.updates.push(p.percent) });
  await settle(); t.mock.timers.tick(1000); await settle();
  h.finish({ status: 'processed', messages: [], results: [{ status: 'diary_evidence_generation_failed' }] });
  await sending;
  assert.deepEqual(h.updates, [0, 37]);
});

test('a recovery response carrying an inconsistent 100 is not shown as successful', async t => {
  const h = clientHarness(t);
  const pending = h.client.sendText({ replyId: 'diary_finish', onProgress: p => h.updates.push(p.percent) });
  await settle();
  h.finish({ ...finished, status: 'processed_with_recovery', results: [{ status: 'flow_paused_after_error' }] });
  await pending;
  assert.deepEqual(h.updates, [0]);
});

test('telemetry failure does not hide a later successful main confirmation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish;
  const updates = [];
  const client = createChatClient({ apiBaseUrl: 'https://example.com', tokenProvider: async () => 'token', randomUUID: () => requestId,
    fetchImpl: async (_url, options) => {
      if (JSON.parse(options.body).action) return new Response('{}', { status: 404 });
      return new Promise(resolve => { finish = () => resolve(json(finished)); });
    } });
  const pending = client.sendText({ replyId: 'diary_finish', onProgress: p => updates.push(p.percent) });
  await settle(); t.mock.timers.tick(1000); await settle();
  finish(); await pending;
  assert.deepEqual(updates, [0, 100]);
});

test('polling 100 is fenced at 99 until the main confirmation, and regressions are ignored', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish, poll = 0;
  const updates = [];
  const client = createChatClient({ apiBaseUrl: 'https://example.com', tokenProvider: async () => 'token', randomUUID: () => requestId,
    fetchImpl: async (_url, options) => JSON.parse(options.body).action
      ? json({ requestId, percent: ++poll === 1 ? 100 : 37, status: 'complete', stage: 'ready' })
      : new Promise(resolve => { finish = () => resolve(json(finished)); }) });
  const pending = client.sendText({ replyId: 'diary_finish', onProgress: p => updates.push(p.percent) });
  await settle(); t.mock.timers.tick(1000); await settle();
  t.mock.timers.tick(1000); await settle();
  assert.deepEqual(updates, [0, 99, 99]);
  finish(); await pending; assert.equal(updates.at(-1), 100);
});

test('stopping telemetry aborts its read and ignores delayed replies without resending the main mutation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish, report, pollSignal;
  const updates = [], abort = new AbortController();
  const client = createChatClient({ apiBaseUrl: 'https://example.com', tokenProvider: async () => 'token', randomUUID: () => requestId,
    fetchImpl: async (_url, options) => JSON.parse(options.body).action
      ? (pollSignal = options.signal, new Promise(resolve => { report = () => resolve(json({ requestId, percent: 75, status: 'running', stage: 'photos' })); }))
      : new Promise(resolve => { finish = () => resolve(json(finished)); }) });
  const pending = client.sendText({ replyId: 'diary_finish', onProgress: p => updates.push(p.percent), progressSignal: abort.signal });
  await settle(); t.mock.timers.tick(1000); await settle();
  abort.abort(); report(); await settle();
  assert.equal(pollSignal.aborted, true);
  finish(); await pending;
  assert.deepEqual(updates, [0]);
});

for (const percent of [0, 37, 100]) test('loading badge safely displays ' + percent + '% beside the spinner', () => {
  const dom = new JSDOM(loadingIndicatorMarkup('Processando sua resposta…', { compact: true, progress: percent }));
  const badge = dom.window.document.querySelector('[role="progressbar"]');
  assert.ok(badge);
  assert.equal(badge.textContent, percent + '%');
  assert.equal(badge.getAttribute('aria-valuenow'), String(percent));
  assert.equal(badge.parentElement.querySelector('.app-loading__spinner') !== null, true);
  dom.window.close();
});

test('unknown percentages keep the cluster visible without inventing a numeric value', () => {
  for (const progress of [null, NaN, Infinity, '<img src=x>', -1, 101]) {
    const dom = new JSDOM(loadingIndicatorMarkup('Carregando…', { progress }));
    const badge = dom.window.document.querySelector('[role="progressbar"]');
    assert.equal(badge?.textContent, '—%');
    assert.equal(badge.hasAttribute('aria-valuenow'), false);
    dom.window.close();
  }
});

test('chat loading card receives diary progress instead of rendering it elsewhere', () => {
  const html = renderChatMarkup({ account: { name: 'QA' }, sessionStatus: 'authenticated', messages: [],
    activeText: { id: 'op' }, diaryAttachmentProgress: { percent: 37 } });
  const dom = new JSDOM(html);
  assert.equal(dom.window.document.querySelector('.chat-progress [role="progressbar"]')?.textContent, '37%');
  dom.window.close();
});

test('the live view updates the badge when only measured progress changes', t => {
  const dom = new JSDOM('<main id="app"></main>', { url: 'https://example.com' });
  const root = dom.window.document.querySelector('#app'), view = createChatView(root);
  t.after(() => { view.destroy(); dom.window.close(); });
  const state = { account: { name: 'QA' }, sessionStatus: 'authenticated', messages: [],
    activeText: { id: 'op' }, draft: '', pendingFiles: [], attachments: [], diaryAttachmentProgress: { percent: 0 } };
  view.render(state);
  assert.equal(root.querySelector('[role="progressbar"]').textContent, '0%');
  view.render({ ...state, diaryAttachmentProgress: { percent: 37 } });
  assert.equal(root.querySelector('[role="progressbar"]').textContent, '37%');
  view.render({ ...state, diaryAttachmentProgress: { percent: 100 } });
  assert.equal(root.querySelector('[role="progressbar"]').textContent, '100%');
});

function controllerHarness(t, flowId = 'construction_diary_fill') {
  const store = createConversationStore(), renders = [], events = new Map();
  const flow = { id: flowId, title: 'DIÁRIO', contextId: 'test-diary' };
  const poll = { type: 'poll', question: 'Como deseja prosseguir com as evidências?',
    options: [{ id: 'diary_finish', label: '✅ FINALIZAR ANEXOS' }, { id: 'diary_abandon', label: 'ABANDONAR' }] };
  let calls = 0, finish, callback, signal;
  const client = {
    sendText: async options => {
      if (++calls === 1) return { status: 'processed', activeFlow: flow, messages: [poll], attachments: [] };
      callback = options.onProgress; signal = options.progressSignal;
      return new Promise(resolve => { finish = () => resolve(finished); });
    },
    getAttachments: async () => [],
  };
  const controller = createAppController({ store, client,
    native: { pickDocuments: async () => [], importSharedItems: async () => [], discardSharedItem: async () => {} },
    auth: { initialize: async () => ({ homeAccountId: 'QA', name: 'QA' }), getToken: async () => 'token' },
    view: { render: state => renders.push(state), on: (n, action) => { events.set(n, action); return () => events.delete(n); }, destroy() {} },
    diaryFieldVisitDataFactory: async () => ({ load: async () => [] }),
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [], listAttachments: async () => [] }),
  });
  t.after(() => controller.stop());
  return { controller, renders, finish: () => finish(), progress: p => callback?.(p),
    get callback() { return callback; }, get signal() { return signal; } };
}

test('diary finalization starts at zero and renders only its current operation progress', async t => {
  const h = controllerHarness(t); await h.controller.start();
  const pending = h.controller.sendText('FINALIZAR ANEXOS', 'diary_finish'); await settle();
  assert.equal(h.renders.at(-1).diaryAttachmentProgress?.percent, 0);
  h.progress({ percent: 37, status: 'running', stage: 'photos' });
  assert.equal(h.renders.at(-1).diaryAttachmentProgress?.percent, 37);
  h.finish(); await pending;
  assert.equal(h.renders.at(-1).diaryAttachmentProgress, null);
  h.progress({ percent: 75, status: 'running', stage: 'photos' });
  assert.equal(h.renders.at(-1).diaryAttachmentProgress, null);
});

test('other flow finish options do not acquire a diary percentage', async t => {
  const h = controllerHarness(t, 'document'); await h.controller.start();
  const pending = h.controller.sendText('FINALIZAR ANEXOS', 'diary_finish'); await settle();
  assert.equal(typeof h.callback, 'undefined');
  h.finish(); await pending;
});

test('controller stop aborts progress while the real response can still arrive safely', async t => {
  const h = controllerHarness(t); await h.controller.start();
  const pending = h.controller.sendText('FINALIZAR ANEXOS', 'diary_finish'); await settle();
  h.controller.stop();
  assert.equal(h.signal?.aborted, true);
  h.progress({ percent: 75, status: 'running', stage: 'photos' });
  h.finish(); assert.equal(await pending, false);
});
