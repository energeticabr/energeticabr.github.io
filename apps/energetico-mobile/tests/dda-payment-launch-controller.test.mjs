import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { renderChatMarkup } from '../src/ui/chat-view.js';
import { createDdaPaymentConfirmation } from '../src/ui/dda-payment-confirmation.js';

const key = 'a'.repeat(64);
const request = signal => ({ itemId: 31, key, signal });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const launch = { id: 'launch', contextId: 'fake-launch', title: 'EFETUAR LANÇAMENTO' };
const remote = (id, fileName) => ({ id, fileName, mimeType: 'application/pdf', size: 8, mediaUrl: `/api/portal-media/${id}` });

async function setup(t, { kind = 'report', data: dataOverrides = {}, client: clientOverrides = {} } = {}) {
  const handlers = new Map(), factories = [], calls = [], uploaded = [];
  const store = createConversationStore();
  const view = { render() {}, focusComposer() {}, destroy() {},
    on(type, handler) { handlers.set(type, handler); return () => handlers.delete(type); },
    emit(type, args = {}) { return handlers.get(type)?.({ type, ...args }); } };
  const data = {
    async listAttachments(id, options) { calls.push(['list', id, options]); return [{ fileName: 'espelho.pdf' }, { fileName: 'boleto.pdf' }]; },
    async downloadAttachment(id, name, options) { calls.push(['download', id, name, options]); return new Blob([`fake-${name}`], { type: 'application/pdf' }); },
    ...dataOverrides,
  };
  const panel = { open() {}, close() { calls.push(['close']); }, destroy() {} };
  const factory = async options => { factories.push(options); return panel; };
  const client = {
    async sendText(payload) {
      calls.push(['text', payload]);
      return { status: 'processed', messages: [{ type: 'poll', question: 'QUAL O PEDIDO?', options: [] }], activeFlow: launch, attachments: [] };
    },
    async sendFile(file, options) {
      calls.push(['upload', file, options]);
      uploaded.push(remote(`file-${uploaded.length}`, file.name));
      return { status: 'processed', messages: [], activeFlow: launch, attachments: [...store.getState().attachments, uploaded.at(-1)] };
    },
    async confirmDdaPayment() { assert.fail('handoff must never reconfirm payment'); },
    ...clientOverrides,
  };
  const sendLaunch = client.sendText;
  client.sendText = (payload, options) => payload.replyId === 'action_launch'
    ? sendLaunch(payload, options) : Promise.resolve({ status: 'processed', messages: [] });
  const controller = createAppController({ store, view, client,
    auth: { initialize: async () => ({ homeAccountId: 'fake-dda-owner', name: 'Teste fictício' }), getToken: async () => 'fake', signOut: async () => {} },
    native: { importSharedItems: async () => [] },
    registrationGalleryDataFactory: async () => data,
    registrationGalleryFactory: factory, ddaReportFactory: factory,
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [] }),
    pendingConstructionDiaryDataFactory: async () => ({ loadPending: async () => [] }),
    diaryFieldVisitDataFactory: async () => ({ load: async () => [] }),
  });
  t.after(() => controller.stop());
  await controller.start();
  if (kind === 'report') await view.emit('open-dda-report');
  else await view.emit('select-reply', { replyId: kind === 'dda' ? 'action_dda_gallery' : 'action_asset_gallery', label: 'GALERIA' });
  calls.length = 0;
  return { controller, store, view, calls, data, client, options: factories[0], uploaded, panel };
}

for (const kind of ['report', 'dda']) test(`${kind}: exact DDA files become visible uploaded launch attachments without posting`, async t => {
  const h = await setup(t, { kind });
  assert.equal(typeof h.options.onStartLaunch, 'function');
  const previous = remote('existing', 'anterior.pdf');
  h.store.syncAttachments([previous]); h.store.setDraft('rascunho fictício');
  const abort = new AbortController();
  assert.equal(await h.options.onStartLaunch(request(abort.signal)), true);
  assert.deepEqual(h.calls.filter(c => c[0] !== 'close').map(c => c[0]), ['list', 'download', 'download', 'text', 'upload', 'upload']);
  assert.deepEqual(h.calls[0], ['list', 31, { refresh: true, signal: abort.signal }]);
  assert.deepEqual(h.calls.filter(c => c[0] === 'download').map(c => c.slice(1, 3)), [[31, 'espelho.pdf'], [31, 'boleto.pdf']]);
  for (const call of h.calls.filter(c => c[0] === 'download')) assert.equal(call[3].signal, abort.signal);
  assert.deepEqual(h.calls.find(c => c[0] === 'text')[1], { text: 'EFETUAR LANÇAMENTO', replyId: 'action_launch' });
  assert.equal(h.store.getState().activeFlow.id, 'launch');
  assert.deepEqual(h.store.getState().attachments.map(f => f.fileName), ['anterior.pdf', 'espelho.pdf', 'boleto.pdf']);
  assert.equal(h.store.getState().draft, 'rascunho fictício');
  assert.equal(h.store.getState().pendingFiles.length, 0);
  const dom = new JSDOM(renderChatMarkup({ ...h.store.getState(), sessionStatus: 'authenticated', account: { name: 'Teste' } }));
  t.after(() => dom.window.close());
  for (const name of ['anterior.pdf', 'espelho.pdf', 'boleto.pdf']) assert.ok(dom.window.document.querySelector('.chat-file-tray').textContent.includes(name));
  const count = h.calls.length;
  assert.equal(await h.options.onStartLaunch(request(new AbortController().signal)), true);
  assert.equal(h.calls.length, count, 'retry does not navigate or upload duplicates');
});

test('a failed second download leaves flow and tray untouched; retry never confirms payment again', async t => {
  const h = await setup(t);
  const old = remote('old', 'guardado.pdf'); h.store.syncAttachments([old]);
  const original = h.data.downloadAttachment;
  h.data.downloadAttachment = async (...args) => { if (args[1] === 'boleto.pdf') throw new Error('fake download failure'); return original(...args); };
  await assert.rejects(h.options.onStartLaunch(request()), /download/);
  assert.equal(h.store.getState().activeFlow, null);
  assert.deepEqual(h.store.getState().attachments.map(f => f.id), ['old']);
  assert.equal(h.store.getState().pendingFiles.length, 0);
  assert.equal(h.calls.some(c => ['text', 'upload'].includes(c[0])), false);
  h.data.downloadAttachment = original;
  assert.equal(await h.options.onStartLaunch(request()), true);
  assert.equal(h.calls.filter(c => c[0] === 'list').length, 2);
});

for (const end of ['abort', 'logout', 'stop', 'navigate']) test(`${end} during download prevents every late handoff write`, async t => {
  const wait = deferred();
  const h = await setup(t, { data: { downloadAttachment: () => wait.promise } });
  const abort = new AbortController();
  const pending = h.options.onStartLaunch(request(abort.signal)).catch(error => error);
  await tick();
  if (end === 'abort') abort.abort();
  if (end === 'logout') await h.view.emit('sign-out');
  if (end === 'stop') h.controller.stop();
  if (end === 'navigate') await h.view.emit('draft-changed', { value: 'outra tarefa' });
  const state = h.store.getState();
  wait.resolve(new Blob(['fake-pdf']));
  assert.notEqual(await pending, true);
  assert.deepEqual(h.store.getState(), state);
  assert.equal(h.calls.some(c => ['text', 'upload'].includes(c[0])), false);
});

test('unexpected flow response is not success and never uploads', async t => {
  const h = await setup(t, { client: { sendText: async () => ({ status: 'processed', messages: [], activeFlow: { id: 'other' } }) } });
  assert.notEqual(await h.options.onStartLaunch(request()).catch(error => error), true);
  assert.equal(h.calls.some(c => c[0] === 'upload'), false);
});

test('retry after upload failure reuses launch and sends only unconfirmed files', async t => {
  const h = await setup(t);
  const upload = h.client.sendFile; let fail = true;
  h.client.sendFile = async (file, options) => { if (file.name === 'boleto.pdf' && fail) throw new Error('fake upload failure'); return upload(file, options); };
  assert.notEqual(await h.options.onStartLaunch(request()).catch(error => error), true);
  assert.deepEqual(h.store.getState().attachments.map(f => f.fileName), ['espelho.pdf']);
  assert.deepEqual(h.store.getState().pendingFiles.map(f => f.file.name), ['boleto.pdf']);
  fail = false;
  assert.equal(await h.options.onStartLaunch(request()), true);
  assert.equal(h.calls.filter(c => c[0] === 'text').length, 1);
  assert.deepEqual(h.store.getState().attachments.map(f => f.fileName), ['espelho.pdf', 'boleto.pdf']);
  assert.equal(h.store.getState().pendingFiles.length, 0);
});

test('pending tray files survive navigation but are not uploaded by the DDA handoff', async t => {
  const h = await setup(t);
  h.store.queueFiles([new File(['fake'], 'pessoal.pdf', { type: 'application/pdf' })]);
  assert.equal(await h.options.onStartLaunch(request()), true);
  assert.deepEqual(h.store.getState().pendingFiles.map(f => f.file.name), ['pessoal.pdf']);
  assert.deepEqual(h.uploaded.map(f => f.fileName), ['espelho.pdf', 'boleto.pdf']);
});

test('cancellation while launch response is pending does not install the late flow', async t => {
  const wait = deferred(), abort = new AbortController();
  const h = await setup(t, { client: { sendText: () => wait.promise } });
  const pending = h.options.onStartLaunch(request(abort.signal)).catch(error => error);
  await tick(); abort.abort();
  wait.resolve({ status: 'processed', messages: [], activeFlow: launch });
  assert.notEqual(await pending, true);
  assert.equal(h.store.getState().activeFlow, null);
  assert.equal(h.store.getState().activeText, null);
  assert.equal(h.calls.some(c => c[0] === 'upload'), false);
});

test('concurrent offers do not duplicate navigation or uploads', async t => {
  const wait = deferred(); const h = await setup(t);
  const original = h.data.listAttachments;
  h.data.listAttachments = async (...args) => { await wait.promise; return original(...args); };
  const first = h.options.onStartLaunch(request());
  const second = h.options.onStartLaunch(request());
  wait.resolve(); await Promise.all([first, second]);
  assert.equal(h.calls.filter(c => c[0] === 'text').length, 1);
  assert.equal(h.uploaded.length, 2);
});

test('real offer consumes success before its panel closes and aborts the modal signal', async t => {
  const h = await setup(t);
  const dom = new JSDOM('<main id="host"><button id="trigger">DDA fictício</button></main>');
  t.after(() => dom.window.close());
  const doc = dom.window.document, host = doc.querySelector('#host');
  let accepted = false, offeredSignal;
  const dialog = createDdaPaymentConfirmation({ document: doc, host,
    confirmPayment: async () => ({ status: 'confirmed', itemId: 31, key, confirmedBy: 'Fictício', confirmedAt: '2026-10-30T12:00:00Z' }),
    onConfirmed() {},
    onStartLaunch: async input => { offeredSignal = input.signal; const result = await h.options.onStartLaunch(input); accepted = result; return result; },
    onLaunchStarted: () => h.panel.close(),
  });
  t.after(() => dialog.destroy());
  h.panel.close = () => { assert.equal(accepted, true); dialog.close(); host.hidden = true; };
  dialog.show({ itemId: 31, key, supplier: 'Fornecedor fictício', amount: 'R$ 1,00', due: '30/10/2026' }, doc.querySelector('#trigger'));
  doc.querySelector('[data-dda-payment-yes]').click(); await tick();
  doc.querySelector('[data-dda-launch-yes]').click();
  for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(accepted, true);
  assert.equal(offeredSignal.aborted, true);
  assert.equal(dialog.isOpen, false);
  assert.equal(host.hidden, true, 'launch chat must be reachable after accepting');
  assert.deepEqual(h.store.getState().attachments.map(f => f.fileName), ['espelho.pdf', 'boleto.pdf']);
});

test('handoff preserves existing uploaded tray even when each upload response contains only the new file', async t => {
  const h = await setup(t);
  h.store.syncAttachments([remote('existing', 'pessoal.pdf')]);
  h.client.sendFile = async file => ({ status: 'processed', messages: [], activeFlow: launch,
    attachments: [remote(file.name, file.name)] });
  assert.equal(await h.options.onStartLaunch(request()), true);
  assert.deepEqual(h.store.getState().attachments.map(f => f.fileName), ['pessoal.pdf', 'espelho.pdf', 'boleto.pdf']);
});

for (const end of ['abort', 'logout', 'stop', 'navigate']) test(`${end} during upload cannot install late files or continue the batch`, async t => {
  const wait = deferred(), abort = new AbortController(); let uploads = 0, uploadSignal;
  const h = await setup(t, { client: { sendFile: (file, options) => { uploads++; uploadSignal = options.progressSignal; return wait.promise; } } });
  const pending = h.options.onStartLaunch(request(abort.signal)).catch(error => error);
  await tick();
  assert.equal(uploads, 1);
  if (end === 'abort') abort.abort();
  if (end === 'logout') await h.view.emit('sign-out');
  if (end === 'stop') h.controller.stop();
  if (end === 'navigate') await h.view.emit('draft-changed', { value: 'outra tarefa' });
  const state = h.store.getState();
  wait.resolve({ status: 'processed', messages: [], activeFlow: launch, attachments: [remote('late', 'espelho.pdf')] });
  assert.notEqual(await pending, true);
  assert.equal(uploadSignal.aborted, true);
  assert.deepEqual(h.store.getState(), state);
  assert.equal(uploads, 1);
});

test('a DDA with no attachments still opens normal launch preserving the tray', async t => {
  const h = await setup(t, { data: { listAttachments: async () => [] } });
  h.store.syncAttachments([remote('old', 'guardado.pdf')]);
  assert.equal(await h.options.onStartLaunch(request()), true);
  assert.equal(h.store.getState().activeFlow.id, 'launch');
  assert.deepEqual(h.store.getState().attachments.map(f => f.id), ['old']);
  assert.equal(h.uploaded.length, 0);
});

for (const phase of ['list', 'download', 'navigation', 'upload']) test(`cancelled ${phase} releases the handoff even if transport ignores abort`, async t => {
  const wait = deferred(), abort = new AbortController();
  const h = await setup(t);
  if (phase === 'list') h.data.listAttachments = () => wait.promise;
  if (phase === 'download') h.data.downloadAttachment = () => wait.promise;
  if (phase === 'navigation') h.client.sendText = () => wait.promise;
  if (phase === 'upload') h.client.sendFile = () => wait.promise;
  const pending = h.options.onStartLaunch(request(abort.signal)).catch(error => error);
  await tick(); abort.abort();
  const result = await Promise.race([pending, tick().then(() => 'still waiting')]);
  // Release the fake transport even on a failing assertion, to leave no task running.
  wait.resolve(phase === 'list' ? [] : phase === 'download' ? new Blob(['fake'])
    : { status: 'processed', messages: [], activeFlow: launch, attachments: [] });
  await pending;
  assert.notEqual(result, 'still waiting');
  assert.equal(h.store.getState().activeText, null);
  assert.equal(h.store.getState().pendingFiles.some(file => file.status === 'sending'), false);
});

test('a missing launch confirmation cannot reuse a previous launch as successful navigation', async t => {
  const h = await setup(t, { kind: 'dda', client: { sendText: async () => ({ status: 'processed', messages: [] }) } });
  h.store.ingestRemoteMessages([], { activeFlow: launch });
  assert.notEqual(await h.options.onStartLaunch(request()).catch(error => error), true);
  assert.equal(h.uploaded.length, 0);
});

test('other registration galleries never receive the DDA launch handoff', async t => {
  const h = await setup(t, { kind: 'asset' });
  assert.equal(h.options.kind, 'asset');
  assert.equal(h.options.onStartLaunch, undefined);
});

test('navigation during pending text clears busy immediately and late response cannot change the new draft', async t => {
  const wait = deferred(), h = await setup(t);
  h.client.sendText = () => wait.promise;
  const pending = h.options.onStartLaunch(request()).catch(error => error);
  await tick(); assert.ok(h.store.getState().activeText);
  await h.view.emit('draft-changed', { value: 'outra tarefa fictícia' });
  assert.equal(h.store.getState().activeText, null);
  assert.notEqual(await Promise.race([pending, tick().then(() => 'waiting')]), 'waiting');
  const state = h.store.getState();
  wait.resolve({ status: 'processed', messages: [], activeFlow: launch });
  await tick();
  assert.deepEqual(h.store.getState(), state);
  assert.equal(h.store.getState().draft, 'outra tarefa fictícia');
});

test('upload without receipt waits for real attachment snapshots before removing pending files', async t => {
  const h = await setup(t), snapshots = [], uploaded = [];
  h.store.syncAttachments([remote('old', 'anterior.pdf')]);
  h.client.sendFile = async file => {
    uploaded.push({ ...remote(`uploaded-${uploaded.length}`, file.name), mimeType: file.type, size: file.size });
    return { status: 'processed', messages: [], activeFlow: launch };
  };
  h.client.getAttachments = async () => {
    snapshots.push(h.store.getState().pendingFiles.map(file => file.file.name));
    return [remote('old', 'anterior.pdf'), ...uploaded];
  };
  assert.equal(await h.options.onStartLaunch(request()), true);
  assert.deepEqual(snapshots, [['espelho.pdf', 'boleto.pdf'], ['boleto.pdf']]);
  assert.deepEqual(h.store.getState().attachments.map(file => file.fileName), ['anterior.pdf', 'espelho.pdf', 'boleto.pdf']);
  assert.equal(h.store.getState().pendingFiles.length, 0);
});

test('upload lacking receipt and snapshot keeps its pending file for a successful retry', async t => {
  const h = await setup(t);
  h.store.syncAttachments([remote('old', 'anterior.pdf')]);
  const upload = h.client.sendFile;
  h.client.sendFile = async () => ({ status: 'processed', messages: [], activeFlow: launch });
  assert.equal(await h.options.onStartLaunch(request()), false);
  assert.deepEqual(h.store.getState().pendingFiles.map(file => file.file.name), ['espelho.pdf', 'boleto.pdf']);
  assert.equal(h.store.getState().pendingFiles[0].status, 'failed');
  h.client.sendFile = upload;
  assert.equal(await h.options.onStartLaunch(request()), true);
  assert.equal(h.calls.filter(c => c[0] === 'text').length, 1);
  assert.equal(h.store.getState().pendingFiles.length, 0);
});

test('renewed public IDs reconcile existing and earlier DDA uploads without duplicate files or blocking the next reply', async t => {
  const h = await setup(t), old = remote('old', 'anterior.pdf');
  h.store.syncAttachments([old]);
  h.client.sendText = async () => ({ status: 'processed', messages: [], activeFlow: launch,
    attachments: [{ ...old, id: 'renewed-menu', mediaUrl: '/api/portal-media/renewed-menu' }] });
  let sequence = 0;
  h.client.sendFile = async file => {
    sequence++;
    return { status: 'processed', messages: [], activeFlow: launch, attachments: [
      ...h.store.getState().attachments.map(item => ({ ...item, id: `${item.fileName}-${sequence}`, mediaUrl: `/api/portal-media/renewed-${sequence}-${item.fileName}` })),
      { ...remote(`new-${sequence}`, file.name), size: file.size, mimeType: file.type },
    ] };
  };
  assert.equal(await h.options.onStartLaunch(request()), true);
  assert.deepEqual(h.store.getState().attachments.map(file => file.fileName), ['anterior.pdf', 'espelho.pdf', 'boleto.pdf']);
  const confirmed = h.store.getState().attachments;
  let queries = 0, replies = 0;
  h.client.getAttachments = async () => { queries++; return confirmed; };
  h.client.sendText = async () => { replies++; return { status: 'processed', messages: [], activeFlow: launch, attachments: confirmed }; };
  assert.equal(await h.view.emit('select-reply', { replyId: 'choice:pedido_lancamento:2', label: 'EXEMPLO FICTÍCIO' }), true);
  assert.equal(queries, 1);
  assert.equal(replies, 1);
});

test('preservation does not coalesce files sharing a name but having different metadata', async t => {
  const h = await setup(t, { data: { listAttachments: async () => [] } });
  const old = remote('old', 'mesmo-nome.pdf'), other = { ...remote('other', 'mesmo-nome.pdf'), size: 99 };
  h.store.syncAttachments([old]);
  h.client.sendText = async () => ({ status: 'processed', messages: [], activeFlow: launch, attachments: [other] });
  assert.equal(await h.options.onStartLaunch(request()), true);
  assert.deepEqual(h.store.getState().attachments.map(file => file.id), ['old', 'other']);
});
