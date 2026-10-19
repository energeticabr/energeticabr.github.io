import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const poll = () => ({ type: 'poll', question: 'QUAL DIÁRIO DE OBRA PENDENTE DESEJA PREENCHER?', options: [
  { id: 'choice:diario_obra_pendente:219', label: '219 - 004 - EDIFÍCIO XAVANTE - (16/10/2026)' },
  { id: 'choice:diario_obra_pendente:218', label: '218 - 004 - EDIFÍCIO XAVANTE - (15/10/2026)' },
  { id: 'abandon_construction_diary', label: 'ABANDONAR DIÁRIO DE OBRAS' },
] });
async function fixture(t, load, { factory } = {}) {
  const store = createConversationStore(), renders = [], handlers = new Map(); let writes = 0;
  const view = { render: state => renders.push(state), on: (type, fn) => { handlers.set(type, fn); return () => handlers.delete(type); }, destroy() {}, focusComposer() {} };
  const controller = createAppController({ store, view,
    auth: { initialize: async () => ({ homeAccountId: 'one', name: 'Bernardo' }), getToken: async () => 'token', signOut: async () => {} },
    native: { importSharedItems: async () => [] },
    client: { sendText: async () => { writes++; return { messages: [] }; } },
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [] }),
    diaryFieldVisitDataFactory: factory || (async () => ({ load })),
  });
  t.after(() => controller.stop()); await controller.start();
  assert.equal(renders.at(-1).sessionStatus, 'authenticated', JSON.stringify(renders.at(-1).error));
  return { store, controller, renders, writes: () => writes, lastPoll: () => renders.at(-1).messages.at(-1),
    open: (value = poll()) => store.ingestRemoteMessages([value], { activeFlow: { id: 'construction_diary_fill', title: 'PREENCHER DIÁRIO DE OBRAS', contextId: 'diary-picker' } }) };
}

test('consulta em segundo plano só na seleção de diários e decora sem alterar ID, label, rascunho ou opções originais', async t => {
  let release, signal, reads = 0;
  const f = await fixture(t, async input => { reads++; signal = input.signal; assert.deepEqual(input.diaryIds, ['219', '218']); return new Promise(resolve => { release = resolve; }); });
  const before = f.writes(); f.open(); await tick();
  assert.equal(reads, 1); assert.equal(signal.aborted, false);
  assert.notEqual(f.lastPoll().options[0].diaryFieldVisit, true);
  f.store.setDraft('219'); await tick(); assert.equal(reads, 1, 'digitação não repete consulta');
  release(['219']); await tick();
  assert.equal(f.lastPoll().options[0].diaryFieldVisit, true);
  assert.notEqual(f.lastPoll().options[1].diaryFieldVisit, true);
  assert.equal(f.lastPoll().options[0].label, poll().options[0].label);
  assert.equal(f.lastPoll().options[0].id, poll().options[0].id);
  assert.equal(f.store.getState().draft, '219');
  assert.equal(f.store.getState().messages.at(-1).options[0].diaryFieldVisit, undefined);
  assert.equal(f.writes(), before);
});

test('sair da pergunta cancela a consulta e ignora resposta tardia; voltar consulta de novo', async t => {
  let release, signal, reads = 0;
  const f = await fixture(t, async input => { reads++; signal = input.signal; return new Promise(resolve => { release = resolve; }); });
  f.open(); await tick();
  assert.ok(signal, 'seleção deve iniciar consulta cancelável');
  f.open({ type: 'poll', question: 'QUAL O TEMPO?', options: [{ id: 'sun', label: 'Sol' }] });
  assert.equal(signal.aborted, true);
  release(['219']); await tick();
  assert.equal(f.lastPoll().question, 'QUAL O TEMPO?');
  assert.equal(f.lastPoll().options[0].diaryFieldVisit, undefined);
  f.open(); await tick(); assert.equal(reads, 2);
  f.controller.stop(); assert.equal(signal.aborted, true); release(['219']); await tick();
});

test('falha da consulta é visível sem bloquear a escolha nem inventar uma visita', async t => {
  const f = await fixture(t, async () => { throw new Error('Sem permissão'); });
  f.open(); await tick();
  assert.equal(f.lastPoll().diaryFieldVisitsError, true);
  assert.equal(f.lastPoll().options.length, 3);
  assert.ok(f.lastPoll().options.every(option => option.diaryFieldVisit !== true));
  assert.equal(f.store.getState().activeText, null);
});

test('marcação antiga recebida na opção não substitui consulta atual confirmada', async t => {
  const f = await fixture(t, async () => []);
  const value = poll(); value.options[0].diaryFieldVisit = true;
  f.open(value); await tick();
  assert.notEqual(f.lastPoll().options[0].diaryFieldVisit, true);
});

test('consulta travada expira, aborta a leitura e mantém as opções disponíveis', async t => {
  let signal;
  const f = await fixture(t, async input => { signal = input.signal; return new Promise(() => {}); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  f.open(); await tick(); assert.ok(signal);
  t.mock.timers.tick(8_001); await tick();
  assert.equal(signal.aborted, true); assert.equal(f.lastPoll().diaryFieldVisitsError, true);
  assert.equal(f.lastPoll().diaryFieldVisitsLoading, false); assert.equal(f.lastPoll().options.length, 3);
});

test('prazo inclui a factory e serviço carregado depois do timeout não inicia leitura', async t => {
  let release; let reads = 0;
  const f = await fixture(t, undefined, { factory: () => new Promise(resolve => { release = resolve; }) });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  f.open(); await tick(); assert.equal(typeof release, 'function');
  t.mock.timers.tick(8_001); await tick();
  assert.equal(f.lastPoll().diaryFieldVisitsError, true);
  assert.equal(f.lastPoll().diaryFieldVisitsLoading, false);
  release({ load: async () => { reads++; return ['219']; } }); await tick();
  assert.equal(reads, 0); assert.notEqual(f.lastPoll().options[0].diaryFieldVisit, true);
});
