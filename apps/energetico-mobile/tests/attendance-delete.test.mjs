import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { createAttendanceIrregularityData } from '../src/chat/attendance-irregularity-data.js';
import { createChatView } from '../src/ui/chat-view.js';

const date = '2026-11-16';
const poll = {
  id: 'pending', role: 'assistant', type: 'poll', presentation: 'attendance_multi_select',
  question: 'QUAL PRESENÇA DESEJA VALIDAR?',
  options: [
    { id: 'pending_attendance_record:2489', label: '2489 - LUIZ BERNARDO DOS SANTOS', date },
    { id: 'pending_attendance_record:2488', label: '2488 - CLEITON CESAR NONATO', date },
    { id: 'pending_attendance_other_date', label: 'AVALIAR OUTRA DATA' },
  ],
};
const target = { id: '2489', date, name: 'LUIZ BERNARDO DOS SANTOS' };
const openButton = '[data-action="open-attendance-delete"][data-reply-id="2489"]';
const dialog = '[data-attendance-delete-dialog]';
const confirm = '[data-action="confirm-attendance-delete"]';
const cancel = '[data-action="cancel-attendance-delete"]';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('presence deletion confirms the exact record, only sends once, and retains the row on failure', async t => {
  const dom = new JSDOM('<main></main>');
  const root = dom.window.document.querySelector('main');
  const view = createChatView(root);
  t.after(() => { view.destroy(); dom.window.close(); });
  const calls = [], replies = [];
  let reject;
  view.on('select-reply', command => replies.push(command));
  view.on('delete-attendance', command => {
    calls.push(command);
    return new Promise((_, fail) => { reject = fail; });
  });
  const state = { sessionStatus: 'authenticated', account: { homeAccountId: 'user', name: 'Teste' },
    draft: '', pendingFiles: [], messages: [poll], activeFlow: { id: 'attendance_validation' } };
  view.render(state);
  assert.equal(root.querySelectorAll('[data-action="open-attendance-delete"]').length, 2);
  root.querySelector(openButton).click();
  assert.equal(root.querySelector(dialog + ' h2').textContent,
    'Tem certeza que deseja deletar o ID 2489 da presença do FORNECEDOR LUIZ BERNARDO DOS SANTOS na DATA 16/11/2026?');
  root.querySelector(confirm).focus();
  view.render({ ...state, messages: [{ ...poll, options: poll.options.map(option => ({ ...option })) }] });
  assert.equal(root.ownerDocument.activeElement, root.querySelector(confirm));
  assert.ok(root.querySelector('[role="log"]').closest('[inert]'));
  root.querySelector(cancel).click();
  assert.equal(root.querySelector(dialog), null);
  assert.equal(root.querySelector('[role="log"]').closest('[inert]'), null);
  assert.deepEqual(calls, []);
  root.querySelector(openButton).click();
  root.querySelector(confirm).click();
  root.querySelector(confirm).click();
  assert.deepEqual(calls, [{ ...target, messageId: 'pending' }]);
  reject(new Error('O registro foi alterado.'));
  await tick();
  assert.match(root.querySelector(dialog + ' [role="alert"]').textContent, /registro foi alterado/);
  assert.ok(root.querySelector(openButton));
  assert.deepEqual(replies, []);
});

test('presence deletion checks the fresh identity, pending state and version before SharePoint deletion', async () => {
  let item = { id: '2489', eTag: '"7"', fields: { DATA: date, FORNECEDOR: target.name, PRESENCA: 'PENDENTE' } };
  const calls = [];
  const source = createAttendanceIrregularityData({ repository: {
    resolveList: async (site, lists) => {
      assert.equal(site, 'personal');
      assert.deepEqual(lists, ['DESCRITIVOPRESENCA']);
      return { status: 'resolved', id: 'presence-list' };
    },
    getItem: async () => item,
    deleteItem: async (...args) => { calls.push(args); },
  } });
  for (const changes of [{ DATA: '2026-11-15' }, { FORNECEDOR: 'OUTRO NOME' }, { PRESENCA: 'PRESENTE' }]) {
    const before = item;
    item = { ...item, fields: { ...item.fields, ...changes } };
    await assert.rejects(() => source.remove(target));
    item = before;
  }
  const before = item;
  item = { ...item, eTag: '*' };
  await assert.rejects(() => source.remove(target), /versão/);
  assert.deepEqual(calls, []);
  item = before;
  await source.remove(target);
  assert.deepEqual(calls, [['personal', 'presence-list', '2489', { eTag: '"7"' }]]);
});

test('confirming one pending presence only removes that ID from the active and expanded lists', async t => {
  const handlers = new Map();
  const view = { render() {}, destroy() {}, on(type, handler) {
    handlers.set(type, handler);
    return () => handlers.delete(type);
  } };
  const owner = { homeAccountId: 'user' };
  const removed = [];
  const store = createConversationStore();
  const controller = createAppController({ view, store,
    auth: { initialize: async () => owner, getAccount: () => owner },
    client: { sendText: async () => ({ status: 'processed', messages: [] }) },
    native: { importSharedItems: async () => [] },
    attendanceIrregularityDataFactory: () => ({ remove: async record => { removed.push(record); } }),
  });
  t.after(() => controller.stop());
  await controller.start();
  store.ingestRemoteMessages([{ ...poll, presenceDateAllOptions: poll.options }], { activeFlow: { id: 'attendance_validation' } });
  const remove = handlers.get('delete-attendance');
  await assert.rejects(() => remove({ ...target, messageId: 'previous' }));
  await assert.rejects(() => remove({ ...target, name: 'OUTRO NOME', messageId: 'pending' }));
  await remove({ ...target, messageId: 'pending' });
  assert.deepEqual(removed, [target]);
  const updated = store.getState().messages.at(-1);
  for (const options of [updated.options, updated.presenceDateAllOptions]) {
    assert.deepEqual(options.map(option => option.id), ['pending_attendance_record:2488', 'pending_attendance_other_date']);
  }
});
