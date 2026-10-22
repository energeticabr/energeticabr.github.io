import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';

const oldId = 'a'.repeat(64), nextId = 'b'.repeat(64), finalId = 'c'.repeat(64);
async function pdf(width = 300) {
  const doc = await PDFDocument.create(); doc.addPage([width, 400]);
  return new File([await doc.save()], 'base.pdf', { type: 'application/pdf' });
}
async function harness(t) {
  const original = await pdf(), extra = await pdf(200), handlers = new Map(), previews = [];
  const store = createConversationStore();
  const view = { render() {}, on(type, fn) { handlers.set(type, fn); return () => handlers.delete(type); },
    emit(type, value = {}) { return handlers.get(type)?.({ type, ...value }); }, destroy() {}, focusComposer() {},
    chooseCaptureMode: async () => 'scan' };
  const calls = [], blobs = new Map([[oldId, original]]);
  const client = { async fetchMedia(item) { return blobs.get(item.id); },
    async sendText() { calls.push('sendText'); return { status: 'processed', messages: [] }; },
    async sendFile() { calls.push('sendFile'); throw new Error('append must not upload chat media'); },
    async replaceAttachment(id, file, options) {
      calls.push({ id, file, options });
      const replacement = { id: id === oldId ? nextId : finalId, fileName: file.name, size: file.size, mimeType: file.type, mediaUrl: '/api/portal-media/replaced' };
      blobs.set(replacement.id, file);
      return { status: 'processed', operation: 'attachment_replaced', requestId: options.requestId,
        previousAttachmentId: id, replacement, attachments: [replacement], messages: [] };
    } };
  const native = { pickDocuments: async () => [extra], capturePhoto: async () => [extra], scanDocument: async () => [extra],
    importSharedItems: async () => [], discardSharedItem: async () => {},
    previewMedia: async (source, name, options) => { previews.push({ blob: await source({}), name, ...options }); } };
  const account = { homeAccountId: 'append-owner', name: 'Teste' };
  const controller = createAppController({ store, view, client, native,
    auth: { initialize: async () => account, getToken: async () => 'token', signOut: async () => {} },
    diaryFieldVisitDataFactory: async () => ({ load: async () => [] }),
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [], listAttachments: async () => [] }) });
  t.after(() => controller.stop());
  await controller.start();
  store.ingestRemoteMessages([{ id: 'question', type: 'poll', question: 'Qual a filial?', options: [{ id: '1', label: 'A' }] }],
    { activeFlow: { id: 'document_create', contextId: 'batch-1', title: 'Documento' }, attachments: [
      { id: oldId, fileName: original.name, size: original.size, mimeType: original.type, mediaUrl: '/api/portal-media/original' }] });
  store.setDraft('rascunho preservado'); calls.length = 0;
  await view.emit('open-file', { fileId: oldId });
  return { controller, store, view, client, native, calls, previews, original, extra };
}

test('tray append composes and replaces only the open PDF while preserving question and draft; repeat append targets the replacement', async t => {
  const h = await harness(t), preview = h.previews[0], messages = h.store.getState().messages;
  assert.equal(typeof preview.onAppendPages, 'function');
  let result = await preview.onAppendPages('files', { blob: h.original, fileName: h.original.name, signal: new AbortController().signal });
  assert.equal(h.calls.length, 1);
  const first = h.calls[0];
  assert.equal(first.id, oldId);
  assert.equal(first.options.expectedSha256, createHash('sha256').update(Buffer.from(await h.original.arrayBuffer())).digest('hex'));
  assert.match(first.options.requestId, /^[a-f0-9-]{36}$/);
  assert.equal((await PDFDocument.load(await result.blob.arrayBuffer())).getPageCount(), 2);
  assert.equal(h.store.getState().attachments.length, 1);
  assert.equal(h.store.getState().attachments[0].id, nextId);
  assert.equal(h.store.getState().draft, 'rascunho preservado');
  assert.deepEqual(h.store.getState().messages, messages);
  result = await preview.onAppendPages('camera', { blob: result.blob, fileName: result.fileName, signal: new AbortController().signal });
  assert.equal(h.calls[1].id, nextId);
  assert.equal((await PDFDocument.load(await result.blob.arrayBuffer())).getPageCount(), 3);
});

test('cancelled selection, stale flow and close during picker never call replacement or queue loose files', async t => {
  for (const kind of ['cancel', 'flow', 'close']) {
    const h = await harness(t), preview = h.previews[0], abort = new AbortController();
    h.native.pickDocuments = async () => {
      if (kind === 'flow') h.store.ingestRemoteMessages([], { activeFlow: { id: 'other', contextId: 'batch-2' } });
      if (kind === 'close') abort.abort();
      return kind === 'cancel' ? [] : [h.extra];
    };
    const result = await preview.onAppendPages('files', { blob: h.original, fileName: h.original.name, signal: abort.signal });
    assert.equal(result, null, kind);
    assert.equal(h.calls.length, 0, kind);
    assert.equal(h.store.getState().pendingFiles.length, 0, kind);
  }
});

test('uncertain replacement retry reuses composed PDF and request id instead of opening picker or appending twice', async t => {
  const h = await harness(t), preview = h.previews[0], replace = h.client.replaceAttachment;
  let attempts = 0, selections = 0, failedRequest;
  h.native.pickDocuments = async () => { selections += 1; return [h.extra]; };
  h.client.replaceAttachment = async (...args) => {
    attempts += 1;
    if (attempts === 1) { failedRequest = args; throw new Error('confirmação perdida'); }
    assert.equal(args[1], failedRequest[1]);
    assert.equal(args[2].requestId, failedRequest[2].requestId);
    return replace(...args);
  };
  const input = { blob: h.original, fileName: h.original.name, signal: new AbortController().signal };
  await assert.rejects(preview.onAppendPages('files', input), /confirmação perdida/);
  assert.equal(h.store.getState().attachments[0].id, oldId);
  const result = await preview.onAppendPages('files', input);
  assert.equal(selections, 1);
  assert.equal((await PDFDocument.load(await result.blob.arrayBuffer())).getPageCount(), 2);
});
