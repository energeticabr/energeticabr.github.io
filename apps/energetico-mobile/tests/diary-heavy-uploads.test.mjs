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
