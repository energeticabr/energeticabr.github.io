import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { renderChatMarkup } from '../src/ui/chat-view.js';
import { createRecoveryStorage } from '../src/web/recovery-storage.js';

const flow = { id: 'diary', title: 'DIÁRIO DE OBRAS', contextId: 'step-a', rows: [{ label: 'OBRA', value: 'Obra teste' }] };
const response = (activeFlow = flow) => ({ status: 'processed', activeFlow, messages: [{ type: 'text', text: 'Quais atividades foram realizadas?' }], attachments: [] });
function harness({ recovery, accountId = 'a1', sendText = async () => response() } = {}) {
  const commands = new Map(), renders = [], calls = [];
  const store = createConversationStore({ historyMode: 'current-step' });
  const view = { render: s => renders.push(s), on: (key, fn) => { commands.set(key, fn); return () => commands.delete(key); }, destroy() {} };
  const controller = createAppController({ store, view, recovery,
    auth: { initialize: async () => accountId ? { homeAccountId: accountId, name: 'Teste' } : null, signOut: async () => {} },
    native: { importSharedItems: async () => [], closePreview() {} },
    client: { sendText: async p => { calls.push(p); return sendText(p); } },
  });
  return { store, controller, renders, calls, emit: (name, args) => commands.get(name)?.(args) };
}
function memoryRecovery() {
  const saved = new Map();
  return createRecoveryStorage({ storage: { getItem: id => saved.get(id) || null,
    setItem: (id, serialized) => saved.set(id, serialized), removeItem: id => saved.delete(id) } });
}

// Break caught: restarting the controller drops the last preview/draft or restores before authentication.
test('reopen displays saved preview while waiting and restores draft only after same VM context', async () => {
  const recovery = memoryRecovery();
  const first = harness({ recovery });
  await first.controller.start();
  first.emit('draft-changed', { value: 'Concretagem parcial' });
  first.controller.stop();
  let resolve;
  const second = harness({ recovery, sendText: () => new Promise(done => { resolve = done; }) });
  const starting = second.controller.start();
  await new Promise(setImmediate);
  const waiting = second.renders.at(-1);
  assert.equal(waiting.recoveryPreview?.draft, 'Concretagem parcial');
  assert.equal(waiting.recoveryPreview?.activeFlow.title, 'DIÁRIO DE OBRAS');
  assert.equal(second.store.getState().draft, '');
  assert.match(renderChatMarkup(waiting), /Obra teste/);
  resolve(response());
  await starting;
  assert.equal(second.store.getState().draft, 'Concretagem parcial');
  assert.deepEqual(second.calls, [{ text: '', replyId: 'input_continue' }]);
  assert.equal(second.store.getState().messages.length, 1);
  second.controller.stop();
});

test('changed VM context keeps the old draft as reference, never sends it, and explicit recovery fills composer', async () => {
  const recovery = memoryRecovery(), first = harness({ recovery });
  await first.controller.start(); first.emit('draft-changed', { value: 'Rascunho anterior' }); first.controller.stop();
  const second = harness({ recovery, sendText: async () => response({ ...flow, contextId: 'step-b' }) });
  await second.controller.start();
  assert.equal(second.store.getState().draft, '');
  assert.equal(second.renders.at(-1).recoveryReference?.draft, 'Rascunho anterior');
  second.controller.stop();
  const third = harness({ recovery, sendText: async () => response(null) });
  await third.controller.start();
  assert.equal(third.renders.at(-1).recoveryReference?.draft, 'Rascunho anterior');
  third.emit('recover-draft');
  assert.equal(third.store.getState().draft, 'Rascunho anterior');
  assert.equal(third.calls.length, 1);
  third.controller.stop();
});

test('a new draft typed while resuming is never overwritten by a cached draft', async () => {
  const recovery = memoryRecovery(), first = harness({ recovery });
  await first.controller.start(); first.emit('draft-changed', { value: 'Anterior' }); first.controller.stop();
  let resolve;
  const second = harness({ recovery, sendText: () => new Promise(done => { resolve = done; }) });
  const starting = second.controller.start(); await new Promise(setImmediate);
  second.emit('draft-changed', { value: 'Novo' });
  resolve(response()); await starting;
  assert.equal(second.store.getState().draft, 'Novo');
  assert.equal(second.renders.at(-1).recoveryReference?.draft, 'Anterior');
  second.controller.stop();
});

test('uncertain send after close is reference only even if VM still reports same step', async () => {
  const recovery = memoryRecovery(); let resolve;
  const first = harness({ recovery, sendText: p => p.replyId === 'input_continue' ? response() : new Promise(done => { resolve = done; }) });
  await first.controller.start(); first.emit('draft-changed', { value: 'Enviar uma vez' });
  const sending = first.controller.sendText(); first.controller.stop();
  resolve(response({ ...flow, contextId: 'advanced' })); await sending;
  const second = harness({ recovery }); await second.controller.start();
  assert.equal(second.store.getState().draft, '');
  assert.equal(second.renders.at(-1).recoveryReference?.draft, 'Enviar uma vez');
  assert.equal(second.renders.at(-1).recoveryReference?.uncertain, true);
  assert.equal(second.calls.length, 1);
  second.controller.stop();
});

test('cached preview is scoped to authenticated account and removed on explicit sign out', async () => {
  const recovery = memoryRecovery(), first = harness({ recovery }); await first.controller.start();
  first.emit('draft-changed', { value: 'Privado' }); first.controller.stop();
  for (const accountId of ['another-account', null]) {
    const other = harness({ recovery, accountId }); await other.controller.start();
    assert.equal(other.renders.some(s => s.recoveryPreview?.draft === 'Privado'), false); other.controller.stop();
  }
  const original = harness({ recovery }); await original.controller.start(); await original.emit('sign-out'); original.controller.stop();
  const next = harness({ recovery }); await next.controller.start();
  assert.equal(next.store.getState().draft, ''); next.controller.stop();
});

test('offline reopen retains preview but blocks writes until VM is reconciled', async () => {
  const recovery = memoryRecovery(), first = harness({ recovery }); await first.controller.start();
  first.emit('draft-changed', { value: 'Preservado offline' }); first.controller.stop();
  const second = harness({ recovery, sendText: async () => { throw new Error('Sem conexão'); } });
  await second.controller.start();
  assert.equal(second.renders.at(-1).recoveryPreview?.draft, 'Preservado offline');
  assert.equal(second.renders.at(-1).recoveryBlocked, true);
  assert.equal(await second.controller.sendText('Sim'), false);
  assert.equal(second.calls.length, 1); second.controller.stop();
});

test('inactivity choice keeps field draft as reference until user has resumed the flow', async () => {
  const recovery = memoryRecovery(), first = harness({ recovery }); await first.controller.start();
  first.emit('draft-changed', { value: 'Atividades da obra' }); first.controller.stop();
  const second = harness({ recovery, sendText: async () => response({ ...flow, paused: true }) });
  await second.controller.start();
  assert.equal(second.store.getState().draft, '');
  assert.equal(second.renders.at(-1).recoveryReference?.draft, 'Atividades da obra');
  second.controller.stop();
});

test('dismissed preview cannot repopulate a draft on later retry-session', async () => {
  const recovery = memoryRecovery(), first = harness({ recovery }); await first.controller.start();
  first.emit('draft-changed', { value: 'Anterior' }); first.controller.stop();
  const second = harness({ recovery }); await second.controller.start();
  second.emit('draft-changed', { value: '' }); second.emit('dismiss-recovery');
  await second.emit('retry-session');
  assert.equal(second.store.getState().draft, ''); second.controller.stop();
});

test('current draft and older reference both survive repeated reopens and another changed step', async () => {
  const recovery = memoryRecovery(), first = harness({ recovery }); await first.controller.start();
  first.emit('draft-changed', { value: 'Rascunho A' }); first.controller.stop();
  const second = harness({ recovery, sendText: async () => response({ ...flow, contextId: 'step-b' }) });
  await second.controller.start(); second.emit('draft-changed', { value: 'Rascunho B' }); second.controller.stop();
  const third = harness({ recovery, sendText: async () => response({ ...flow, contextId: 'step-b' }) });
  await third.controller.start();
  assert.equal(third.store.getState().draft, 'Rascunho B');
  assert.equal(third.renders.at(-1).recoveryReference.draft, 'Rascunho A'); third.controller.stop();
  const fourth = harness({ recovery, sendText: async () => response({ ...flow, contextId: 'step-c' }) });
  await fourth.controller.start(); fourth.controller.stop();
  const fifth = harness({ recovery, sendText: async () => response({ ...flow, contextId: 'step-c' }) });
  await fifth.controller.start();
  fifth.emit('recover-draft');
  assert.equal(fifth.store.getState().draft, 'Rascunho B');
  assert.equal(fifth.renders.at(-1).recoveryReference.draft, 'Rascunho A');
  fifth.controller.stop();
});

test('network-uncertain failure remains uncertain in checkpoint after active request ends', async () => {
  const recovery = memoryRecovery();
  const first = harness({ recovery, sendText: async p => {
    if (p.replyId === 'input_continue') return response();
    throw Object.assign(new Error('A resposta pode ter sido recebida.'), { code: 'NETWORK_UNCERTAIN' });
  } });
  await first.controller.start(); first.emit('draft-changed', { value: 'Confirmar lote' });
  assert.equal(await first.controller.sendText(), false); first.controller.stop();
  const second = harness({ recovery }); await second.controller.start();
  assert.equal(second.store.getState().draft, '');
  assert.equal(second.renders.at(-1).recoveryReference?.uncertain, true);
  second.controller.stop();
});

test('explicit VM save-to-menu keeps unsent text with that flow and restores it when selected again', async () => {
  const recovery = memoryRecovery();
  const h = harness({ recovery, sendText: async p => {
    if (p.replyId === 'save_draft_main_menu') return { ...response(null), results: [{ status: 'awaiting_action', draft_saved: true, draft_batch_id: 'batch-a' }], messages: [{ type: 'poll', question: 'MENU PRINCIPAL', options: [{ id: 'draft_menu', label: '1 rascunho aguardando' }] }] };
    if (p.replyId === 'draft_resume:batch-a') return { ...response(), results: [{ status: 'draft_resumed', draft_resumed: true, batch_id: 'batch-a' }] };
    return response();
  } });
  await h.controller.start(); h.emit('draft-changed', { value: 'Texto em preenchimento' });
  await h.controller.sendText('Salvar rascunho e retornar ao menu principal', 'save_draft_main_menu');
  assert.equal(h.store.getState().draft, '');
  assert.equal(h.renders.at(-1).recoveryReference?.draft, 'Texto em preenchimento');
  assert.equal(h.store.getState().activeFlow, null);
  await h.controller.sendText('Diário da obra', 'draft_resume:batch-a');
  assert.equal(h.store.getState().draft, 'Texto em preenchimento');
  assert.equal(h.renders.at(-1).recoveryReference, null);
  assert.equal(h.calls.some(p => p.text === 'Texto em preenchimento'), false); h.controller.stop();
});

test('offline draft cleared by user stays empty in next checkpoint', async () => {
  const recovery = memoryRecovery(), h = harness({ recovery, sendText: async () => { throw Error('offline'); } });
  await h.controller.start(); h.emit('draft-changed', { value: 'Texto apagado' }); h.emit('draft-changed', { value: '' }); h.controller.stop();
  assert.equal(recovery.read('a1').draft, '');
});

test('editing while reopen is offline preserves both previous draft and older reference', async () => {
  const recovery = memoryRecovery();
  recovery.schedule('a1', { activeFlow: flow, draft: 'B', reference: { activeFlow: { ...flow, contextId: 'older' }, draft: 'A' } });
  recovery.flush();
  const h = harness({ recovery, sendText: async () => { throw Error('offline'); } });
  await h.controller.start(); h.emit('draft-changed', { value: 'C' }); h.controller.stop();
  const saved = recovery.read('a1');
  assert.equal(saved.draft, 'C');
  assert.equal(saved.reference.draft, 'B');
  assert.deepEqual(saved.references.map(item => item.draft), ['A']);
});

test('preview is read-only escaped text and never renders stale reply buttons', () => {
  const markup = renderChatMarkup({ sessionStatus: 'authenticated', account: { name: 'Teste' }, messages: [],
    recoveryPreview: { activeFlow: { ...flow, title: '<img src=x>' }, question: '<script>bad()</script>', draft: 'Não enviado', pendingNames: ['foto.jpg'], savedAt: Date.now() }, recoveryBlocked: true,
  });
  assert.match(markup, /&lt;img src=x&gt;/);
  assert.match(markup, /&lt;script&gt;/);
  assert.match(markup, /foto\.jpg/);
  assert.doesNotMatch(markup, /data-action="select-reply"/);
  assert.doesNotMatch(markup, /<script>/);
});
