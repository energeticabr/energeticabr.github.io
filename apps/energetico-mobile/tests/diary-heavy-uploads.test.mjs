import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';

const settle = () => new Promise(setImmediate);
const flow = { id: 'construction_diary_fill', title: 'PREENCHER DIÁRIO DE OBRAS', contextId: 'diary-217' };
const attachment = (id, size = 1000) => ({ id, size, fileName: `${id}.jpg`, mimeType: 'image/jpeg', mediaUrl: `/api/portal-media/${id}` });
function harness(t, attachments = []) {
  const store = createConversationStore(), commands = new Map(), renders = [], fetched = [];
  const native = { pickDocuments: async () => [], importSharedItems: async () => [], discardSharedItem: async () => {}, exportMedia: async () => {} };
  const client = {
    sendText: async () => ({ status: 'processed', activeFlow: flow, messages: [], attachments }),
    getAttachments: async () => attachments,
    fetchMedia: async item => { fetched.push(item.id); return new Blob(['image'], { type: 'image/jpeg' }); },
  };
  const controller = createAppController({ store, client, native,
    auth: { initialize: async () => ({ homeAccountId: 'preview-test', name: 'QA' }), getToken: async () => 'test' },
    view: { render: state => renders.push(state), on: (name, action) => { commands.set(name, action); return () => commands.delete(name); }, destroy() {} },
    diaryFieldVisitDataFactory: async () => ({ load: async () => [] }),
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [], listAttachments: async () => [] }),
  });
  t.after(() => controller.stop());
  return { store, client, native, controller, renders, fetched, emit: (name, data = {}) => commands.get(name)?.(data) };
}

test('automatic diary previews never download heavy originals, which remain available on demand', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const large = attachment('heavy-photo', 18_000_000), h = harness(t, [large]);
  await h.controller.start();
  t.mock.timers.tick(100); await settle();
  assert.deepEqual(h.fetched, [], 'an optional thumbnail must not redownload an 18MB original');
  await h.emit('open-file', { fileId: large.id });
  assert.deepEqual(h.fetched, [large.id], 'explicit opening still uses the original');
  assert.equal(h.store.getState().attachments[0].size, 18_000_000);
});

test('automatic previews decode only one original at a time', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t, [attachment('one'), attachment('two'), attachment('three')]);
  const releases = [];
  h.client.fetchMedia = item => { h.fetched.push(item.id); return new Promise(resolve => releases.push(resolve)); };
  await h.controller.start();
  t.mock.timers.tick(100); await settle();
  assert.deepEqual(h.fetched, ['one']);
  releases.shift()(new Blob(['image'], { type: 'image/jpeg' })); await settle();
  t.mock.timers.tick(100); await settle();
  assert.deepEqual(h.fetched, ['one', 'two']);
});

test('an upload batch takes priority over optional thumbnail downloads', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t, [attachment('old')]);
  await h.controller.start();
  let confirm;
  h.native.pickDocuments = async () => [{ name: 'next.txt', size: 4, type: 'text/plain' }];
  h.client.sendFile = () => new Promise(resolve => { confirm = resolve; });
  const uploading = h.emit('pick-files'); await settle();
  t.mock.timers.tick(100); await settle();
  assert.deepEqual(h.fetched, [], 'background GETs must not compete with the current upload');
  confirm({ status: 'processed', activeFlow: flow, messages: [], attachments: [attachment('old'), attachment('next')] });
  await uploading;
  t.mock.timers.tick(100); await settle();
  assert.deepEqual(h.fetched, ['old']);
});

test('diary batch upload does not launch an expensive compression question after each heavy file', async t => {
  const receipts = [], h = harness(t, receipts);
  const files = [1, 2].map(n => ({ name: `photo-${n}.jpg`, size: 8_000_000, type: 'image/jpeg' }));
  h.native.pickDocuments = async () => files;
  let compressions = 0, uploads = 0;
  h.client.sendFile = async file => {
    receipts.push({ ...attachment(file.name, file.size), fileName: file.name });
    return { status: 'processed', activeFlow: flow, messages: [], attachments: [...receipts] };
  };
  h.client.compressAttachment = async () => { compressions++; return { status: 'processed', messages: [], activeFlow: flow }; };
  const send = h.client.sendFile;
  h.client.sendFile = async (...args) => { uploads++; return send(...args); };
  await h.controller.start();
  assert.equal(await h.emit('pick-files'), true);
  assert.equal(uploads, 2);
  assert.equal(compressions, 0, 'manual compression remains an explicit user choice in the diary');
});

test('a stalled optional preview releases its slot without freezing the next file', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t, [attachment('stalled'), attachment('next')]);
  let signal;
  h.client.fetchMedia = (item, options) => {
    h.fetched.push(item.id);
    if (item.id === 'stalled') { signal = options?.signal; return new Promise(() => {}); }
    return Promise.resolve(new Blob(['image'], { type: 'image/jpeg' }));
  };
  await h.controller.start(); t.mock.timers.tick(100); await settle();
  t.mock.timers.tick(15_000); await settle(); t.mock.timers.tick(100); await settle();
  assert.equal(signal.aborted, true);
  assert.deepEqual(h.fetched, ['stalled', 'next']);
  assert.equal(h.renders.at(-1).error, null, 'optional preview failure is not an upload error');
});

test('a queued thumbnail cannot redownload an attachment removed from the current diary', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t, [attachment('removed')]);
  await h.controller.start(); h.store.syncAttachments([]);
  t.mock.timers.tick(100); await settle();
  assert.deepEqual(h.fetched, []);
});

test('a successful batch uses the newest media URLs for all queued attachment previews', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const receipts = [], h = harness(t, receipts), urls = [];
  h.native.pickDocuments = async () => ['one', 'two'].map(id => ({ name: `${id}.jpg`, type: 'image/jpeg', size: 1000 }));
  h.client.sendFile = async file => {
    receipts.push(attachment(file.name));
    for (const item of receipts) item.mediaUrl = `/api/portal-media/${item.id}-echo-${receipts.length}`;
    return { status: 'processed', activeFlow: flow, messages: [], attachments: receipts.map(item => ({ ...item })) };
  };
  h.client.fetchMedia = async item => { urls.push(item.mediaUrl); return new Blob(['photo'], { type: 'image/jpeg' }); };
  await h.controller.start(); await h.emit('pick-files');
  for (let i = 0; i < 4; i++) { t.mock.timers.tick(100); await settle(); }
  assert.deepEqual(urls, ['/api/portal-media/one.jpg-echo-2', '/api/portal-media/two.jpg-echo-2']);
  assert.equal(h.store.getState().attachments.every(item => Boolean(item.previewUrl)), true);
});

test('an in-flight preview invalidated by a new URL queues that current version after it settles', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const receipts = [attachment('one')], h = harness(t, receipts), pending = [];
  h.client.fetchMedia = item => new Promise(resolve => pending.push({ url: item.mediaUrl, resolve }));
  await h.controller.start(); t.mock.timers.tick(100); await settle();
  receipts[0] = { ...receipts[0], mediaUrl: '/api/portal-media/one-renewed' };
  await h.controller.refreshAttachments();
  pending[0].resolve(new Blob(['old'], { type: 'image/jpeg' })); await settle();
  t.mock.timers.tick(100); await settle();
  assert.deepEqual(pending.map(item => item.url), ['/api/portal-media/one', '/api/portal-media/one-renewed']);
  pending[1].resolve(new Blob(['current'], { type: 'image/jpeg' })); await settle();
  assert.match(h.store.getState().attachments[0].previewUrl, /^blob:/);
});

test('removing an in-flight attachment never restores it or retries its obsolete preview', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const receipts = [attachment('removed')], h = harness(t, receipts);
  let finish, downloads = 0;
  h.client.fetchMedia = () => { downloads++; return new Promise(resolve => { finish = resolve; }); };
  await h.controller.start(); t.mock.timers.tick(100); await settle();
  receipts.splice(0); await h.controller.refreshAttachments();
  finish(new Blob(['old'], { type: 'image/jpeg' })); await settle();
  t.mock.timers.tick(1000); await settle();
  assert.deepEqual(h.store.getState().attachments, []); assert.equal(downloads, 1);
});

test('an unchanged unavailable preview is not automatically retried in a loop', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t, [attachment('unavailable')]);
  let downloads = 0;
  h.client.fetchMedia = async () => { downloads++; throw new Error('404'); };
  await h.controller.start();
  for (let i = 0; i < 5; i++) { t.mock.timers.tick(1000); await settle(); }
  assert.equal(downloads, 1); assert.equal(h.renders.at(-1).error, null);
});

for (const id of ['construction_stage_registration', 'construction_stage_demonstrative_create']) {
  test(`${id} offers compression only through the tray icon, just like work diaries`, async t => {
    const receipts = [], h = harness(t, receipts), activeFlow = { id, title: 'ETAPA DE OBRA' };
    h.client.sendText = async () => ({ status: 'processed', activeFlow, messages: [], attachments: receipts });
    h.native.pickDocuments = async () => [{ name: 'report.pdf', type: 'application/pdf', size: 8_000_000 }];
    h.client.sendFile = async file => {
      receipts.push({ ...attachment('report', file.size), fileName: file.name, mimeType: file.type });
      return { status: 'processed', activeFlow, messages: [], attachments: [...receipts] };
    };
    let offers = 0;
    h.client.compressAttachment = async () => { offers++; return { status: 'processed', activeFlow, messages: [{
      type: 'poll', question: 'ESCOLHA O NÍVEL DE COMPRESSÃO', options: [
        { id: 'attachment_compression_level_high', label: 'ALTA COMPRESSÃO' },
        { id: 'attachment_compression_use_original', label: 'MANTER ORIGINAL' },
      ],
    }], attachments: [...receipts] }; };
    await h.controller.start(); await h.emit('pick-files');
    assert.equal(offers, 0);
    assert.equal(h.store.getState().attachments[0].size, 8_000_000);
    assert.equal(await h.emit('compress-attachment', { fileId: 'report' }), true);
    assert.equal(offers, 1);
    assert.equal(h.store.getState().messages.at(-1).question, 'ESCOLHA O NÍVEL DE COMPRESSÃO');
  });
}
