import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatClient } from '../src/chat/chat-client.js';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { createChatView } from '../src/ui/chat-view.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const receipt = { status: 'processed', messages: [], attachments: [
  { id: 'uploaded', fileName: 'foto.jpg', mimeType: 'image/jpeg', mediaUrl: '/api/portal-media/uploaded' },
] };
const file = () => new File(['1234567890'], 'foto.jpg', { type: 'image/jpeg' });

// Only the network boundary is simulated: the real client validates the
// receipt, retries, authenticates and derives progress from these byte events.
function network({ apiPrefix } = {}) {
  const uploads = [], progress = [], fallback = [];
  const client = createChatClient({ apiBaseUrl: 'https://example.com', apiPrefix,
    tokenProvider: async () => 'token', randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    retryDelay: async () => {},
    fetchImpl: async (...args) => { fallback.push(args); return Response.json(receipt); },
    xhrFactory: () => {
      const xhr = { upload: {}, headers: {},
        open(method, url, async) { Object.assign(this, { method, url, async }); },
        setRequestHeader(name, value) { this.headers[name] = value; },
        send(body) { this.body = body; uploads.push(this); },
        abort() { this.aborted = true; this.onabort?.(); },
        bytes(loaded, total, lengthComputable = true) { this.upload.onprogress?.({ loaded, total, lengthComputable }); },
        respond(body = receipt, status = 200) { this.status = status; this.responseText = JSON.stringify(body); this.onload?.(); },
        fail() { this.onerror?.(); },
      };
      return xhr;
    },
  });
  return { client, uploads, progress, fallback, onProgress: value => progress.push(value.percent) };
}

test('attachment percentage measures upload bytes, waits at 99 and finishes only on a valid receipt', async () => {
  const h = network(), document = file();
  const pending = h.client.sendFile(document, { onProgress: h.onProgress }); await settle();
  assert.equal(h.uploads.length, 1, 'progress must use the measurable upload transport');
  const xhr = h.uploads[0];
  assert.equal(xhr.body, document);
  assert.equal(xhr.headers.Authorization, 'Bearer token');
  assert.equal(xhr.headers['X-Portal-File-Name'], 'foto.jpg');
  assert.equal(xhr.withCredentials, false);
  xhr.bytes(3, 10); xhr.bytes(10, 10);
  assert.deepEqual(h.progress, [0, 30, 99]);
  xhr.respond(); assert.deepEqual(await pending, receipt);
  assert.equal(h.progress.at(-1), 100);
  assert.equal(h.fallback.length, 0, 'never upload the same file through both transports');
});

for (const [body, status, error] of [[{ error: 'Sem acesso' }, 401, /Sem acesso/],
  [{ status: 'processed_with_recovery', messages: [] }, 200, /confirmação válida/],
  [{ status: 'queued' }, 200, /confirmação válida/]]) {
  test(`upload never reaches 100 on ${status}/${body.status || 'error'}`, async () => {
    const h = network(), pending = h.client.sendFile(file(), { onProgress: h.onProgress }); await settle();
    assert.equal(h.uploads.length, 1);
    h.uploads[0].bytes(10, 10); h.uploads[0].respond(body, status);
    await assert.rejects(pending, error);
    assert.deepEqual(h.progress, [0, 99]);
  });
}

test('unknown byte totals never manufacture an intermediate percentage', async () => {
  const h = network(), pending = h.client.sendFile(file(), { onProgress: h.onProgress }); await settle();
  assert.equal(h.uploads.length, 1);
  const xhr = h.uploads[0];
  for (const [loaded, total, computable] of [[4, 10, false], [4, 0, true], [NaN, 10, true], [-1, 10, true], [20, 10, true]]) xhr.bytes(loaded, total, computable);
  assert.deepEqual(h.progress, [0]);
  xhr.respond(); await pending; assert.equal(h.progress.at(-1), 100);
});

test('automatic retry resets measured bytes, retains the same receipt key and ignores old events', async () => {
  const h = network(), document = file();
  document.sourceId = '12345678-1234-4234-8234-123456789abc';
  const pending = h.client.sendFile(document, { onProgress: h.onProgress }); await settle();
  assert.equal(h.uploads.length, 1);
  const first = h.uploads[0]; first.bytes(8, 10); first.fail(); await settle();
  assert.equal(h.uploads.length, 2);
  first.bytes(9, 10);
  assert.deepEqual(h.progress, [0, 80, 0]);
  const second = h.uploads[1]; second.bytes(4, 10); second.respond(); await pending;
  assert.deepEqual(h.progress, [0, 80, 0, 40, 100]);
  assert.equal(first.headers['X-Portal-Message-Id'], document.sourceId);
  assert.equal(second.headers['X-Portal-Message-Id'], document.sourceId);
});

test('cancellation aborts only the current upload and cannot retry or complete it', async () => {
  const h = network(), abort = new AbortController();
  const pending = h.client.sendFile(file(), { onProgress: h.onProgress, progressSignal: abort.signal }); await settle();
  assert.equal(h.uploads.length, 1);
  const xhr = h.uploads[0]; xhr.bytes(3, 10); abort.abort(); xhr.bytes(8, 10); xhr.respond();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(xhr.aborted, true); assert.equal(h.uploads.length, 1);
  assert.deepEqual(h.progress, [0, 30]);
});

test('three interrupted attempts preserve the uncertain-delivery error and never report completion', async () => {
  const h = network(), pending = h.client.sendFile(file(), { onProgress: h.onProgress });
  const rejected = assert.rejects(pending, { code: 'NETWORK_UNCERTAIN' });
  for (let attempt = 0; attempt < 3; attempt++) {
    await settle(); assert.equal(h.uploads.length, attempt + 1);
    h.uploads[attempt].bytes(10, 10); h.uploads[attempt].fail();
  }
  await rejected;
  assert.deepEqual(h.progress, [0, 99, 0, 99, 0, 99]);
  assert.equal(new Set(h.uploads.map(xhr => xhr.headers['X-Portal-Message-Id'])).size, 1);
});

test('an already cancelled upload never acquires a token or sends a body', async () => {
  const abort = new AbortController(); abort.abort(); let tokens = 0, sends = 0;
  const client = createChatClient({ apiBaseUrl: 'https://example.com',
    tokenProvider: async () => { tokens++; return 'token'; },
    fetchImpl: async () => { sends++; return Response.json(receipt); } });
  await assert.rejects(client.sendFile(file(), { onProgress() {}, progressSignal: abort.signal }), { name: 'AbortError' });
  assert.equal(tokens, 0); assert.equal(sends, 0);
});

test('cancelling from the retry-reset notification prevents that retry from sending its body', async () => {
  const h = network(), abort = new AbortController(); let starts = 0;
  const pending = h.client.sendFile(file(), { progressSignal: abort.signal, onProgress(value) {
    if (value.percent === 0 && ++starts === 2) abort.abort();
  } });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await settle(); h.uploads[0].bytes(8, 10); h.uploads[0].fail();
  await rejected;
  assert.equal(h.uploads.length, 1, 'a cancelled retry must never send a second body');
});

test('unsupported upload telemetry falls back to one authenticated fetch without artificial intermediate progress', async () => {
  const progress = [], calls = [];
  const client = createChatClient({ apiBaseUrl: 'https://example.com', xhrFactory: null,
    tokenProvider: async () => 'token', fetchImpl: async (...args) => { calls.push(args); return Response.json(receipt); } });
  await client.sendFile(file(), { onProgress: value => progress.push(value.percent) });
  assert.deepEqual(progress, [0, 100]); assert.equal(calls.length, 1);
  assert.equal(calls[0][1].headers.Authorization, 'Bearer token');
});

test('a presentation callback failure cannot turn a confirmed receipt into another upload', async () => {
  const h = network();
  const pending = h.client.sendFile(file(), { onProgress() { throw new Error('View detached'); } }); await settle();
  assert.equal(h.uploads.length, 1); h.uploads[0].bytes(5, 10); h.uploads[0].respond();
  assert.deepEqual(await pending, receipt); assert.equal(h.uploads.length, 1);
});

test('demo preserves redirect-protected fetch instead of switching to XHR', async () => {
  const h = network({ apiPrefix: '/api/demo' });
  await h.client.sendFile(file(), { onProgress: h.onProgress });
  assert.equal(h.uploads.length, 0); assert.equal(h.fallback.length, 1);
  assert.equal(h.fallback[0][1].redirect, 'error');
  assert.deepEqual(h.progress, [0, 100]);
});

test('live upload card updates beside the spinner without changing the draft or pending file', t => {
  const dom = new JSDOM('<main id="app"></main>', { url: 'https://example.com' });
  const root = dom.window.document.querySelector('#app'), view = createChatView(root);
  t.after(() => { view.destroy(); dom.window.close(); });
  const state = { account: { name: 'QA' }, sessionStatus: 'authenticated', messages: [], draft: '',
    attachments: [], pendingFiles: [{ id: 'file', file: file(), status: 'sending' }] };
  for (const percent of [0, 37, 99, 100]) {
    view.render({ ...state, attachmentUploadProgress: { fileId: 'file', percent } });
    const badge = root.querySelector('.chat-progress [role="progressbar"]');
    assert.equal(badge?.textContent, `${percent}%`);
    assert.equal(badge.getAttribute('aria-label'), 'Envio do anexo');
    assert.ok(badge.parentElement.querySelector('.app-loading__spinner'));
  }
});

function controllerHarness(t, { historyMode } = {}) {
  const store = createConversationStore({ historyMode }), renders = [], events = new Map(), uploads = [];
  const account = { homeAccountId: 'QA', name: 'QA' };
  const auth = { initialize: async () => account, signIn: async () => account, signOut: async () => {}, getToken: async () => 'token' };
  const client = {
    sendText: async () => ({ status: 'processed', messages: [], attachments: [] }),
    sendFile: (file, options) => new Promise((resolve, reject) => uploads.push({ file, ...options, resolve, reject })),
  };
  const controller = createAppController({ store, client,
    native: { pickDocuments: async () => [], importSharedItems: async () => [], discardSharedItem: async () => {} },
    auth,
    view: { render: state => renders.push(state), on: (key, action) => { events.set(key, action); return () => events.delete(key); }, destroy() {} },
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [], listAttachments: async () => [] }),
  });
  t.after(() => controller.stop());
  return { controller, client, auth, store, renders, uploads, events };
}

test('controller resets per attachment, renders completion, and ignores callbacks of the previous file', async t => {
  const h = controllerHarness(t); await h.controller.start();
  h.store.queueFiles([file(), file()]);
  const [a, b] = h.store.getState().pendingFiles;
  const one = h.controller.uploadFile(a.id); await settle();
  assert.equal(h.renders.at(-1).attachmentUploadProgress?.percent, 0);
  const first = h.uploads[0]; first.onProgress({ percent: 37 });
  assert.equal(h.renders.at(-1).attachmentUploadProgress.percent, 37);
  first.onProgress({ percent: 100 });
  assert.equal(h.renders.at(-1).attachmentUploadProgress.percent, 99, 'server receipt still pending');
  first.resolve(receipt); assert.equal(await one, true);
  assert.ok(h.renders.some(s => s.attachmentUploadProgress?.percent === 100));
  assert.equal(h.renders.at(-1).attachmentUploadProgress, null);
  const two = h.controller.uploadFile(b.id); await settle();
  assert.equal(h.renders.at(-1).attachmentUploadProgress.percent, 0);
  first.onProgress({ percent: 90 });
  assert.equal(h.renders.at(-1).attachmentUploadProgress.percent, 0);
  h.uploads[1].resolve(receipt); await two;
});

for (const action of ['stop', 'sign-out']) test(`leaving via ${action} cannot redraw or apply a delayed upload receipt`, async t => {
  const h = controllerHarness(t); await h.controller.start(); h.store.queueFiles([file()]);
  const pending = h.controller.uploadFile(h.store.getState().pendingFiles[0].id); await settle();
  const upload = h.uploads[0];
  if (action === 'stop') h.controller.stop(); else await h.events.get('sign-out')();
  assert.equal(upload.progressSignal?.aborted, true);
  const count = h.renders.length;
  upload.onProgress({ percent: 95 }); upload.resolve(receipt);
  assert.equal(await pending, false);
  assert.equal(h.renders.length, count);
  assert.equal(h.store.getState().attachments.length, 0);
});

test('a failed upload clears progress without displaying completion', async t => {
  const h = controllerHarness(t); await h.controller.start(); h.store.queueFiles([file()]);
  const pending = h.controller.uploadFile(h.store.getState().pendingFiles[0].id); await settle();
  const upload = h.uploads[0]; upload.onProgress?.({ percent: 99 }); upload.reject(new Error('Falha de conexão'));
  assert.equal(await pending, false);
  assert.equal(h.renders.at(-1).attachmentUploadProgress, null);
  assert.ok(!h.renders.some(s => s.attachmentUploadProgress?.percent === 100));
});

test('an acknowledged upload stays busy below 100 while its attachment snapshot is still pending', async t => {
  const h = controllerHarness(t); await h.controller.start(); let confirmSnapshot;
  h.client.getAttachments = () => new Promise(resolve => { confirmSnapshot = resolve; });
  h.store.queueFiles([file()]);
  const pending = h.controller.uploadFile(h.store.getState().pendingFiles[0].id); await settle();
  h.uploads[0].onProgress({ percent: 100 });
  h.uploads[0].resolve({ status: 'processed', messages: [] }); await settle();
  assert.equal(h.store.getState().pendingFiles.length, 0, 'the local receipt was accepted before snapshot reconciliation');
  assert.equal(h.renders.at(-1).attachmentUploadProgress.percent, 99);
  assert.equal(await h.controller.sendText('próxima pergunta'), false, 'receipt reconciliation must keep the flow locked');
  confirmSnapshot(receipt.attachments);
  assert.equal(await pending, true);
  assert.ok(h.renders.some(s => s.attachmentUploadProgress?.percent === 100));
  assert.equal(h.renders.at(-1).attachmentUploadProgress, null);
});

test('a missing attachment snapshot uses existing failure cleanup without ever showing 100', async t => {
  const h = controllerHarness(t); await h.controller.start();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.client.getAttachments = async () => [];
  h.store.queueFiles([file()]);
  const pending = h.controller.uploadFile(h.store.getState().pendingFiles[0].id); await settle();
  h.uploads[0].onProgress({ percent: 100 }); h.uploads[0].resolve({ status: 'processed', messages: [] }); await settle();
  for (const delay of [250, 500, 1000, 1500]) { t.mock.timers.tick(delay); await settle(); }
  assert.equal(await pending, false);
  assert.equal(h.store.getState().pendingFiles.length, 0);
  assert.match(h.store.getState().error, /não foi confirmado/);
  assert.ok(!h.renders.some(s => s.attachmentUploadProgress?.percent === 100));
  assert.equal(h.renders.at(-1).attachmentUploadProgress, null);
});

test('an old attachment snapshot cannot populate a fresh session even when auth reuses the same account object', async t => {
  const h = controllerHarness(t); await h.controller.start(); let oldSnapshot;
  h.client.getAttachments = () => oldSnapshot ? Promise.resolve([]) : new Promise(resolve => { oldSnapshot = resolve; });
  h.store.queueFiles([file()]);
  const pending = h.controller.uploadFile(h.store.getState().pendingFiles[0].id); await settle();
  h.uploads[0].resolve({ status: 'processed', messages: [] }); await settle();
  await h.events.get('sign-out')(); await h.events.get('sign-in')();
  oldSnapshot(receipt.attachments);
  assert.equal(await pending, false);
  assert.equal(h.store.getState().attachments.length, 0, 'discard the old snapshot before it writes to the new session');
});

for (const sameAccount of [false, true]) test(`a late automatic compression cannot write or transition after reauthentication (${sameAccount ? 'same account' : 'other account'})`, async t => {
  const h = controllerHarness(t, { historyMode: 'current-step' }); await h.controller.start(); let finishCompression;
  const large = { name: 'comprovante.pdf', type: 'application/pdf', size: 6400000 };
  h.client.compressAttachment = () => new Promise(resolve => { finishCompression = resolve; });
  h.store.queueFiles([large]);
  const pending = h.controller.uploadFile(h.store.getState().pendingFiles[0].id); await settle();
  h.uploads[0].resolve({ status: 'processed', activeFlow: { id: 'document_create', title: 'ADICIONAR UM NOVO DOCUMENTO' },
    messages: [{ type: 'text', text: 'Anexo recebido com sucesso' }, { type: 'text', text: 'Pergunta antiga da conta A' }],
    attachments: [{ ...receipt.attachments[0], fileName: large.name, mimeType: large.type, size: large.size }] });
  await settle(); assert.equal(typeof finishCompression, 'function', JSON.stringify(h.store.getState()));
  await h.events.get('sign-out')();
  if (!sameAccount) h.auth.signIn = async () => ({ homeAccountId: 'OTHER', name: 'Outra conta' });
  await h.events.get('sign-in')();
  finishCompression({ status: 'processed', attachments: receipt.attachments, messages: [{ type: 'text', text: 'Compactação antiga da conta A' }] });
  assert.equal(await pending, false);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(h.store.getState().attachments.length, 0);
  assert.ok(!h.store.getState().messages.some(m => /antiga da conta A/.test(m.text || '')));
});

test('composer stays disabled while upload receipt reconciliation keeps the 99% overlay visible', t => {
  const dom = new JSDOM('<main id="app"></main>', { url: 'https://example.com' });
  const root = dom.window.document.querySelector('#app'), view = createChatView(root);
  t.after(() => { view.destroy(); dom.window.close(); });
  view.render({ account: { name: 'QA' }, sessionStatus: 'authenticated', messages: [], draft: 'Próxima resposta',
    pendingFiles: [], attachments: [], attachmentUploadProgress: { fileId: 'confirmed-file', percent: 99 } });
  assert.equal(root.querySelector('[role="progressbar"]').textContent, '99%');
  for (const action of ['send-text', 'capture-photo', 'pick-files']) {
    assert.equal(root.querySelector(`[data-action="${action}"]`).disabled, true, `${action} must agree with the visible upload overlay`);
  }
});
