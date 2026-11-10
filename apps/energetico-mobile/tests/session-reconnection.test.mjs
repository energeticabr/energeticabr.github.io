import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { createChatClient } from '../src/chat/chat-client.js';
import { createRecoveryStorage } from '../src/web/recovery-storage.js';
import { renderChatMarkup } from '../src/ui/chat-view.js';

const menu = () => ({ status: 'processed', stage: 'choosing_group', activeFlow: null, attachments: [],
  messages: [{ type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [{ id: 'group_supplies', label: 'SUPRIMENTOS' }] }] });
const json = payload => Response.json(payload);
const turn = () => new Promise(setImmediate);

function harness(t, { client, timeoutMs = 20, native = {} } = {}) {
  const commands = new Map(), renders = [], saved = new Map();
  const store = createConversationStore({ historyMode: 'current-step' });
  const recovery = createRecoveryStorage({ storage: {
    getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key),
  } });
  const controller = createAppController({ store, recovery, client,
    view: { render: state => renders.push(state), on: (name, fn) => { commands.set(name, fn); return () => commands.delete(name); }, destroy() {} },
    auth: { initialize: async () => ({ homeAccountId: 'reconnection-test', name: 'Teste' }), getToken: async () => 'synthetic', signOut: async () => {} },
    native: { importSharedItems: async () => [], ...native },
    conversationResumeTimeoutMs: timeoutMs, conversationResumeRetryDelay: async () => {},
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [], listAttachments: async () => [] }),
    pendingConstructionDiaryDataFactory: async () => ({ loadPending: async () => [] }),
    diaryFieldVisitDataFactory: async () => ({ load: async () => [] }),
  });
  t.after(() => controller.stop());
  return { store, controller, renders, emit: (name, body) => commands.get(name)?.(body), state: () => renders.at(-1) };
}

test('a shared receipt that clears the send error still exposes Retomar and uploads once after synchronization', async t => {
  const file = Object.assign(new File(['synthetic proof'], 'comprovante.pdf', { type: 'application/pdf' }), { sourceId: 'shared-proof' });
  const hrMenu = { status: 'processed', stage: 'choosing_subaction',
    activeFlow: { id: 'menu:choosing_subaction', title: 'RECURSOS HUMANOS' },
    messages: [{ type: 'poll', question: 'QUAL FLUXO VOCÊ DESEJA INICIAR?', options: [{ id: 'hr_presence', label: 'CRIAR PRESENÇA DE FORNECEDOR' }] }] };
  let activate, imports = [], uploads = 0, offline = false;
  const sent = [];
  const h = harness(t, {
    client: {
      sendText: async body => {
        sent.push(body.replyId || body.text);
        if (body.replyId === 'input_continue') {
          if (offline) throw Object.assign(new Error('Sem conexão com a VM.'), { code: 'NETWORK_UNAVAILABLE' });
          return hrMenu;
        }
        throw Object.assign(new Error('A confirmação da VM se perdeu.'), { code: 'NETWORK_UNCERTAIN' });
      },
      sendFile: async uploaded => {
        assert.equal(uploaded, file);
        uploads++;
        return { ...hrMenu, messages: [], attachments: [{ id: 'proof', fileName: file.name, mediaUrl: '/proof' }] };
      },
    },
    native: {
      onResume: handler => { activate = handler; },
      importSharedItems: async () => imports,
      discardSharedItem: async () => { imports = []; },
    },
  });
  await h.controller.start();
  h.emit('draft-changed', { value: 'rascunho preservado' });
  assert.equal(await h.controller.sendText(), false);
  assert.match(h.state().error, /confirmação/);
  imports = [file];
  const share = activate();
  await turn();
  assert.equal(h.state().recoveryUncertain, true);
  assert.equal(h.state().error, null);
  assert.equal(h.store.getState().pendingFiles[0].file, file);
  assert.equal(uploads, 0);
  assert.match(renderChatMarkup(h.state()), /data-action="retry-session">Retomar conversa/);

  offline = true;
  assert.equal(await h.emit('retry-session'), false);
  assert.match(renderChatMarkup(h.state()), /data-action="retry-session">Retomar conversa/);
  assert.equal(h.store.getState().pendingFiles[0].file, file);
  assert.equal(uploads, 0);

  offline = false;
  assert.equal(await h.emit('retry-session'), true);
  await share;
  assert.equal(h.state().recoveryUncertain, false);
  assert.equal(h.store.getState().draft, 'rascunho preservado');
  assert.equal(h.store.getState().pendingFiles.length, 0);
  assert.equal(h.store.getState().attachments[0].fileName, file.name);
  assert.equal(h.store.getState().activeFlow.title, 'RECURSOS HUMANOS');
  assert.equal(uploads, 1);
  assert.deepEqual(sent.filter(command => command !== 'input_continue'), ['rascunho preservado']);
});

test('Retomar after interrupted startup recovers when connectivity returns beyond the first failed preflight', async t => {
  let offline = true, pendingReads = 0;
  const sent = [];
  const wire = createChatClient({ apiBaseUrl: 'https://example.test', tokenProvider: async () => 'synthetic', retryDelay: async () => {},
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body); sent.push(body);
      if (offline) throw new TypeError('Load failed');
      if (body.action === 'diary_evidence_pending') {
        if (++pendingReads <= 2) throw new TypeError('Load failed');
        return json({ status: 'unavailable' });
      }
      if (body.action === 'attachment_snapshot') return json({ status: 'processed', messages: [], attachments: [] });
      assert.equal(body.replyId, 'input_continue');
      return json(menu());
    },
  });
  const h = harness(t, { client: { sendText: wire.sendText, waitForDiaryEvidence: wire.waitForDiaryEvidence, getAttachments: wire.getAttachments }, timeoutMs: 1000 });
  await h.controller.start();
  assert.equal(h.state().recoveryBlocked, true);
  assert.match(h.state().error, /conexão/i);
  h.emit('draft-changed', { value: 'rascunho preservado' });
  const file = new File(['synthetic proof'], 'comprovante.pdf', { type: 'application/pdf' });
  h.store.queueFiles([file]);
  offline = false; sent.length = 0;
  assert.equal(await h.emit('retry-session'), true);
  assert.equal(h.state().recoveryBlocked, false);
  assert.equal(h.state().resuming, false);
  assert.equal(h.state().error, null);
  assert.equal(h.store.getState().draft, 'rascunho preservado');
  assert.equal(h.store.getState().pendingFiles[0].file, file);
  assert.equal(h.store.getState().messages.at(-1).question, 'QUAL ÁREA VOCÊ DESEJA ACESSAR?');
  assert.ok(renderChatMarkup(h.state()).includes('data-reply-id="group_supplies"'));
  assert.doesNotMatch(renderChatMarkup(h.state()), /Aguardando sincronização|error-banner/);
  assert.equal(sent.filter(body => body.replyId).length, 1);
  assert.ok(sent.every(body => body.replyId === 'input_continue' || ['diary_evidence_pending', 'attachment_snapshot'].includes(body.action)));
});

test('a hung startup preflight is canceled and Retomar becomes usable without losing the local queue', async t => {
  const signals = [];
  const client = { sendText: async () => menu(), waitForDiaryEvidence: ({ signal }) => { signals.push(signal); return new Promise(() => {}); } };
  const h = harness(t, { client });
  h.store.setDraft('texto antes da falha');
  const file = new File(['local'], 'local.pdf', { type: 'application/pdf' });
  h.store.queueFiles([file]);
  assert.equal(await Promise.race([h.controller.start().then(() => true), delay(250, false)]), true, 'startup must release its recovery lock');
  assert.equal(h.state().resuming, false);
  assert.equal(h.state().recoveryBlocked, true);
  assert.ok(signals.every(signal => signal.aborted));
  assert.equal(h.store.getState().draft, 'texto antes da falha');
  assert.equal(h.store.getState().pendingFiles[0].file, file);
  client.waitForDiaryEvidence = async () => {};
  assert.equal(await h.emit('retry-session'), true);
  assert.equal(h.state().recoveryBlocked, false);
});

test('a timed-out resume is aborted and its late response cannot replace the restored question', async t => {
  let oldResolve, requests = 0, oldSignal;
  const client = { sendText: (_body, options) => {
    if (++requests === 1) { oldSignal = options.progressSignal; return new Promise(resolve => { oldResolve = resolve; }); }
    return Promise.resolve(menu());
  } };
  const h = harness(t, { client });
  assert.equal(await Promise.race([h.controller.start().then(() => true), delay(250, false)]), true);
  assert.ok(oldSignal.aborted);
  assert.equal(requests, 2);
  assert.equal(h.state().recoveryBlocked, false);
  oldResolve({ ...menu(), messages: [{ type: 'poll', question: 'PERGUNTA ANTIGA', options: [] }] });
  await turn();
  assert.equal(h.store.getState().messages.at(-1).question, 'QUAL ÁREA VOCÊ DESEJA ACESSAR?');
  assert.doesNotMatch(renderChatMarkup(h.state()), /PERGUNTA ANTIGA/);
  assert.equal(h.state().resuming, false);
});

test('Retomar hides a stale error while making a fresh request and restores composer controls on success', async t => {
  let phase = 'failed', resolve;
  const h = harness(t, { timeoutMs: 1000, client: { sendText: async () => {
    if (phase === 'failed') throw Object.assign(new Error('A conexão foi interrompida.'), { code: 'NETWORK_UNAVAILABLE' });
    return new Promise(done => { resolve = done; });
  } } });
  await h.controller.start();
  phase = 'recovering';
  const operation = h.store.beginText('resposta anterior');
  h.store.failText(operation, new Error('erro antigo da resposta'));
  const pending = h.emit('retry-session'); await turn();
  assert.equal(h.state().resuming, true);
  assert.equal(h.state().error, null, 'old error must not masquerade as another failed recovery');
  assert.match(renderChatMarkup(h.state()), /Retomando|Restabelecendo/);
  resolve(menu()); assert.equal(await pending, true);
  assert.equal(h.state().error, null);
  assert.equal(h.state().recoveryBlocked, false);
});

test('an unavailable optional attachment snapshot cannot keep the restored form locked on startup', async t => {
  let late;
  const client = {
    sendText: async () => ({ status: 'processed', activeFlow: { id: 'supplies', title: 'SUPRIMENTOS', contextId: 'current' },
      messages: [{ type: 'poll', question: 'QUAL É A DATA?', options: [] }] }),
    getAttachments: () => new Promise(resolve => { late = resolve; }),
  };
  const h = harness(t, { client });
  assert.equal(await Promise.race([h.controller.start().then(() => true), delay(250, false)]), true);
  assert.equal(h.state().resuming, false);
  assert.equal(h.state().recoveryBlocked, false);
  assert.equal(h.state().error, null);
  late([{ id: 'old-attachment', fileName: 'stale.pdf' }]); await turn();
  assert.equal(h.store.getState().attachments.some(item => item.id === 'old-attachment'), false);
});

test('a stuck automatic field advance releases recovery and is never retried as a business write', async t => {
  const sent = []; let advanced = false;
  const client = { sendText: async body => {
    sent.push(body.replyId);
    if (body.replyId === 'blank') return new Promise(() => {});
    return { status: 'processed', activeFlow: { id: 'payment_provision', title: 'PROVISÃO', contextId: 'provision' },
      messages: [{ type: 'poll', question: advanced ? 'QUAL É O VALOR?' : 'QUAL É A FORMA DE PAGAMENTO?', options: advanced ? [] : [{ id: 'blank', label: 'EM BRANCO' }] }] };
  } };
  const h = harness(t, { client });
  assert.equal(await Promise.race([h.controller.start().then(() => true), delay(250, false)]), true);
  assert.equal(h.state().resuming, false);
  assert.equal(h.state().recoveryUncertain, true);
  assert.deepEqual(sent, ['input_continue', 'blank']);
  advanced = true;
  assert.equal(await h.emit('retry-session'), true);
  assert.equal(h.state().recoveryUncertain, false);
  assert.equal(sent.filter(id => id === 'blank').length, 1);
});
