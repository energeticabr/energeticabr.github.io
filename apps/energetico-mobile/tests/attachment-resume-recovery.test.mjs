import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppController } from '../src/app-controller.js';
import { createChatClient } from '../src/chat/chat-client.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { renderChatMarkup } from '../src/ui/chat-view.js';

const missingId = 'a'.repeat(64);
const validId = 'b'.repeat(64);
const unrelatedId = 'c'.repeat(64);
const missing = { id: missingId, fileName: 'comprovante.pdf', mimeType: 'application/pdf', size: 123, mediaUrl: '/api/portal-media/stale' };
const valid = { ...missing, id: validId, mediaUrl: '/api/portal-media/valid' };
const flow = { id: 'document_signing', title: 'ASSINAR DOCUMENTOS', contextId: 'sign-payment-preview', rows: [{ label: 'FORNECEDOR', value: 'FORNECEDOR TESTE' }] };
const unavailableMessage = 'Um anexo selecionado não está mais disponível ou já foi submetido.';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function harness(t, { metadata = true, rejectedIds = [missingId], errorMessage = unavailableMessage, errorStatus = 422, snapshot, resumeResult, resumeError = false, hangingSnapshot = false, hangingResume = false } = {}) {
  const requests = [], renders = [], commands = new Map();
  let resumeCount = 0, afterFailure = false;
  let currentAttachments = [missing, valid];
  const store = createConversationStore({ historyMode: 'current-step' });
  const view = { render: state => renders.push(state), on: (type, fn) => { commands.set(type, fn); return () => commands.delete(type); }, destroy() {} };
  const client = createChatClient({ apiBaseUrl: 'https://energetico.test', tokenProvider: async () => 'test-session',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (body.action === 'attachment_snapshot') {
        if (afterFailure && hangingSnapshot) return new Promise(() => {});
        if (afterFailure && snapshot instanceof Error) throw snapshot;
        if (afterFailure && typeof snapshot === 'function') return json({ status: 'processed', messages: [], attachments: await snapshot() });
        return json({ status: 'processed', messages: [], attachments: afterFailure && snapshot ? snapshot : currentAttachments });
      }
      if (body.action === 'home_attachment_transfer') {
        afterFailure = true;
        return json({ error: errorMessage, ...(metadata ? { code: 'ATTACHMENT_UNAVAILABLE', unavailableAttachmentIds: rejectedIds } : {}) }, errorStatus);
      }
      if (body.replyId === 'input_continue') {
        resumeCount += 1;
        if (afterFailure && hangingResume) return new Promise(() => {});
        if (afterFailure && resumeError) return json({ error: 'Sem conexão com a VM.' }, 503);
        return json(afterFailure && resumeResult ? (typeof resumeResult === 'function' ? resumeResult(store.getState()) : resumeResult) : { status: 'processed', activeFlow: flow, messages: [{ type: 'text', text: 'Confira a prévia do PDF antes de confirmar.' }], attachments: currentAttachments });
      }
      throw new Error(`A recuperação não pode enviar ${JSON.stringify(body)}`);
    },
    retryDelay: async () => {},
  });
  const cachedAccount = { homeAccountId: 'a1', name: 'Teste' };
  const controller = createAppController({ store, view, client,
    auth: { initialize: async () => cachedAccount, signIn: async () => cachedAccount, signOut: async () => {} },
    native: { importSharedItems: async () => [] },
  });
  t.after(() => controller.stop());
  return { store, controller, client, renders, requests, setSnapshot: items => { currentAttachments = items; }, emit: (name, args) => commands.get(name)?.(args), get resumeCount() { return resumeCount; } };
}

async function rejectHome(h) {
  await h.controller.start();
  h.store.setDraft('12/10/2026 — rascunho não enviado');
  assert.equal(await h.emit('select-reply', { replyId: 'navigation_main_menu' }), false);
  assert.match(h.renders.at(-1).error, /anexo selecionado/);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), [missingId, validId]);
}

// Break caught: retry ignores the rejected attachment identity or deletes by filename.
test('Retomar conversa detaches only the rejected ID, even when two filenames are equal', async t => {
  const h = harness(t);
  await rejectHome(h);
  h.store.queueFiles([Object.assign(new Blob(['pendente']), { name: 'novo-pendente.txt' })]);
  assert.equal(await h.emit('retry-session'), true);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), [validId]);
  assert.equal(h.store.getState().draft, '12/10/2026 — rascunho não enviado');
  assert.equal(h.store.getState().activeFlow.contextId, 'sign-payment-preview');
  assert.deepEqual(h.store.getState().pendingFiles.map(item => item.file.name), ['novo-pendente.txt']);
  assert.equal(h.renders.at(-1).error, null);
  assert.equal(h.renders.at(-1).resuming, false);
  assert.match(renderChatMarkup(h.renders.at(-1)), /Anexos \(1\)/);
  assert.equal(h.requests.filter(item => item.action === 'home_attachment_transfer').length, 1);
  assert.equal(h.requests.some(item => /delete|discard|submit/.test(item.action || item.replyId || '')), false);
  assert.equal(h.requests.some(item => item.text?.includes('rascunho')), false);
});

// Break caught: a later server echo repopulates the dismissed ID and repeats the error.
test('a late attachment snapshot cannot restore a rejected reference but accepts a new file with the same name', async t => {
  const h = harness(t);
  await rejectHome(h);
  await h.emit('retry-session');
  await h.controller.refreshAttachments();
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), [validId]);
  h.store.restoreSnapshot({ messages: h.store.getState().messages, activeFlow: flow, attachments: [missing, valid] });
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), [validId]);
  h.store.syncAttachments([missing, valid, { ...missing, id: unrelatedId, mediaUrl: '/api/portal-media/reuploaded' }]);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), [validId, unrelatedId]);
  h.store.clearSession();
  h.store.syncAttachments([missing]);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), [missingId]);
});

// Break caught: cleanup waits for resume success and leaves the stale item when the VM is offline.
test('known rejected references are removed before resuming, even when resuming fails', async t => {
  const h = harness(t, { resumeError: true });
  await rejectHome(h);
  assert.equal(await h.emit('retry-session'), false);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), [validId]);
  assert.equal(h.store.getState().draft, '12/10/2026 — rascunho não enviado');
  assert.equal(h.renders.at(-1).resuming, false);
});

// Break caught: legacy generic errors are retried without first checking the current attachment snapshot.
test('legacy VM error reconciles the snapshot before resuming and removes only a missing selected file', async t => {
  const h = harness(t, { metadata: false, snapshot: [valid] });
  await rejectHome(h);
  h.requests.length = 0;
  assert.equal(await h.emit('retry-session'), true);
  assert.equal(h.requests[0].action, 'attachment_snapshot');
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), [validId]);
});

// Break caught: accepting a renewed file without dismissing its obsolete ID restores it on a later echo.
test('legacy unique renewal replaces the old reference before continuing and blocks stale echoes', async t => {
  const renewed = { ...missing, id: unrelatedId, mediaUrl: '/api/portal-media/renewed' };
  const h = harness(t, { metadata: false, snapshot: [renewed, valid], resumeResult: state => {
    assert.deepEqual(state.attachments.map(item => item.id), [unrelatedId, validId]);
    return { status: 'processed', activeFlow: flow, messages: [], attachments: [renewed, valid] };
  } });
  await rejectHome(h);
  assert.equal(await h.emit('retry-session'), true);
  h.store.syncAttachments([missing, valid, renewed]);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), [validId, unrelatedId]);
  assert.equal(h.store.getState().draft, '12/10/2026 — rascunho não enviado');
});

test('legacy ambiguous renewal does not assign one replacement to two old homonymous files', async t => {
  const renewed = { ...missing, id: unrelatedId, mediaUrl: '/api/portal-media/renewed' };
  const h = harness(t, { metadata: false, snapshot: [renewed], resumeResult: state => {
    assert.deepEqual(state.attachments.map(item => item.id), [missingId, validId]);
    return { status: 'processed', activeFlow: flow, messages: [], attachments: [renewed] };
  } });
  await rejectHome(h);
  assert.equal(await h.emit('retry-session'), true);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), [unrelatedId]);
});

// Break caught: IDs outside the rejected request are trusted or unrelated errors clear the tray.
test('unrelated response IDs cannot detach a file that was not selected for transfer', async t => {
  const h = harness(t, { rejectedIds: [unrelatedId] });
  await rejectHome(h);
  const unrelated = { ...missing, id: unrelatedId, mediaUrl: '/api/portal-media/unrelated', existing: true };
  h.setSnapshot([missing, valid, unrelated]);
  h.store.syncAttachments([missing, valid, unrelated]);
  await h.emit('retry-session');
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), [missingId, validId, unrelatedId]);
});

test('a non-attachment failure never discards valid selected attachments', async t => {
  const h = harness(t, { metadata: false, errorMessage: 'A conexão foi interrompida.' });
  await h.controller.start();
  await h.emit('select-reply', { replyId: 'navigation_main_menu' });
  await h.emit('retry-session');
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), [missingId, validId]);
});

test('legacy snapshot failure retains all files instead of guessing which attachment is missing', async t => {
  const h = harness(t, { metadata: false, snapshot: new Error('Snapshot indisponível') });
  await rejectHome(h);
  await h.emit('retry-session');
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), [missingId, validId]);
  assert.equal(h.store.getState().draft, '12/10/2026 — rascunho não enviado');
  assert.equal(h.renders.at(-1).resuming, false);
});

// Break caught: a failed legacy snapshot leaves a rejected Home intention armed.
test('legacy snapshot failure followed by a VM menu keeps the draft and pending signature', async t => {
  const h = harness(t, { metadata: false, snapshot: new Error('Snapshot indisponível'),
    resumeResult: { status: 'processed', stage: 'choosing_group', activeFlow: null, messages: [] } });
  await rejectHome(h);
  h.store.queueFiles([Object.assign(new Blob(['assinatura']), { name: 'assinatura-pendente.png' })], { hideFromAttachmentTray: true });
  assert.equal(await h.emit('retry-session'), true);
  assert.equal(h.store.getState().draft, '12/10/2026 — rascunho não enviado');
  assert.deepEqual(h.store.getState().pendingFiles.map(item => item.file.name), ['assinatura-pendente.png']);
  assert.equal(h.requests.some(item => /discard|submit/.test(item.action || item.replyId || '')), false);
});

test('legacy snapshot failure cannot automatically accept an old transfer confirmation', async t => {
  const h = harness(t, { metadata: false, snapshot: new Error('Snapshot indisponível'), resumeResult: {
    status: 'processed', activeFlow: { ...flow, contextId: 'old-transfer-confirmation', homeAttachmentTransfer: {
      requestId: 'old-home-selection', contextId: flow.contextId, attachmentIds: [missingId, validId],
    } }, attachments: [missing, valid], messages: [{ type: 'poll',
      question: 'TEM CERTEZA QUE DESEJA ABANDONAR ESTE FLUXO? OS ANEXOS SERÃO TRANSFERIDOS PARA O PRÓXIMO FLUXO.',
      options: [{ id: 'portal_transfer_draft_discard', label: 'SIM, TRANSFERIR' }, { id: 'portal_transfer_cancel', label: 'NÃO, CONTINUAR' }],
    }],
  } });
  await rejectHome(h);
  assert.equal(await h.emit('retry-session'), true);
  assert.equal(h.requests.some(item => item.replyId === 'portal_transfer_draft_discard'), false);
  assert.equal(h.store.getState().draft, '12/10/2026 — rascunho não enviado');
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), [missingId, validId]);
});

// Break caught: a transport failure with coincidental wording authorizes tray cleanup.
test('an unavailable-message HTTP503 is a server failure, not proof that a file disappeared', async t => {
  const h = harness(t, { metadata: false, errorStatus: 503, snapshot: [valid], resumeError: true });
  await rejectHome(h);
  assert.equal(await h.emit('retry-session'), false);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), [missingId, validId]);
});

test('rejected selection from another flow cannot detach attachments in the current flow', async t => {
  const h = harness(t);
  await rejectHome(h);
  h.store.ingestRemoteMessages([], { activeFlow: { ...flow, contextId: 'another-draft' }, attachments: [missing, valid] });
  await h.emit('retry-session');
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), [missingId, validId]);
});

// Break caught: a renewed session may reuse the same cached account object during an old lookup.
test('same-account reauthentication invalidates a pending legacy retry before any resume request', async t => {
  let resolveSnapshot;
  const lookup = new Promise(resolve => { resolveSnapshot = resolve; });
  const h = harness(t, { metadata: false, snapshot: () => lookup });
  await rejectHome(h);
  const beforeResume = h.resumeCount;
  const retrying = h.emit('retry-session');
  await new Promise(setImmediate);
  assert.equal(await h.emit('sign-in'), true);
  resolveSnapshot([valid]);
  assert.equal(await retrying, false);
  assert.equal(h.resumeCount, beforeResume);
  assert.equal(h.store.getState().draft, '12/10/2026 — rascunho não enviado');
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), [missingId, validId]);
});

// Break caught: a stalled optional snapshot leaves the resume button/composer disabled forever.
test('a stalled attachment snapshot cannot freeze a successful unavailable-file recovery', async t => {
  const h = harness(t, { hangingSnapshot: true });
  await rejectHome(h);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const resuming = h.emit('retry-session');
  await new Promise(setImmediate);
  t.mock.timers.tick(15_000);
  await new Promise(setImmediate);
  assert.equal(h.renders.at(-1).resuming, false);
  assert.equal(await resuming, true);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), [validId]);
});

test('a stalled VM resume releases the interface without resending the draft or restoring the rejected file', async t => {
  const h = harness(t, { hangingResume: true });
  await rejectHome(h);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const resuming = h.emit('retry-session');
  await new Promise(setImmediate);
  t.mock.timers.tick(30_000);
  await new Promise(setImmediate);
  assert.equal(h.renders.at(-1).resuming, false);
  assert.equal(await resuming, false);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), [validId]);
  assert.equal(h.store.getState().draft, '12/10/2026 — rascunho não enviado');
});
