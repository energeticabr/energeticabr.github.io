import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { createChatView } from '../src/ui/chat-view.js';
import { createChatClient } from '../src/chat/chat-client.js';

const completed = () => ({
  status: 'processed', results: [{ status: 'completed' }], resetConversation: true,
  activeFlow: null, attachments: [], deferredMenu: { completionId: 'batch-1:completion', delaySeconds: 3 },
  messages: [{ type: 'text', text: 'Cadastro concluído com sucesso.' }],
});
const menu = () => ({
  status: 'processed', results: [{ status: 'sent' }], activeFlow: null, attachments: [],
  messages: [{ type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [{ id: 'group_supplies', reply: 'group_supplies', label: 'SUPRIMENTOS' }] }],
});
const flush = () => new Promise(resolve => setImmediate(resolve));

async function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector('#app');
  const store = createConversationStore({ historyMode: 'current-step' });
  const requests = [];
  const client = {
    sendText: async payload => { requests.push(payload); return payload.replyId === 'input_continue' ? { status: 'processed', messages: [{ type: 'text', text: 'Confirma o cadastro?' }] } : completed(); },
    sendFile: async () => completed(),
    getCompletionMenu: async id => { requests.push({ completionId: id }); return menu(); },
  };
  const controller = createAppController({
    store, view: createChatView(root), client,
    auth: { initialize: async () => ({ name: 'Teste' }), signOut: async () => {} },
    native: { importSharedItems: async () => [], pickDocuments: async () => [], closePreview() {} },
  });
  await controller.start();
  t.after(() => { controller.stop(); dom.window.close(); });
  async function tick(ms) { t.mock.timers.tick(ms); await flush(); }
  return { dom, root, store, client, controller, requests, tick };
}

test('comando interno de menu e textos vazios não viram bolhas em branco', () => {
  const store = createConversationStore({ historyMode: 'current-step' });
  store.ingestRemoteMessages([
    ...completed().messages,
    { type: 'deferred_control', delaySeconds: 3, control: { kind: 'post_completion_menu' } },
    { type: 'text', text: '  \n' },
  ], { resetConversation: true });
  assert.deepEqual(store.getState().messages.map(item => item.text), ['Cadastro concluído com sucesso.']);
});

test('confirma cadastro imediatamente e exibe menu real da VM só após 3 segundos', async t => {
  const h = await setup(t);
  await h.controller.sendText('SIM', 'confirm_yes');
  assert.match(h.root.textContent, /Cadastro concluído/);
  assert.equal(h.root.querySelector('[data-reply-id="group_supplies"]'), null);
  await h.tick(2999);
  assert.equal(h.requests.length, 2);
  await h.tick(1);
  assert.deepEqual(h.requests[2], { completionId: 'batch-1:completion' });
  assert.ok(h.root.querySelector('[data-reply-id="group_supplies"]'));
  assert.doesNotMatch(h.root.textContent, /Cadastro concluído/);
  assert.equal(h.root.querySelectorAll('.chat-message').length, 1);
  await h.tick(6000);
  assert.equal(h.requests.length, 3, 'não repete cadastro nem consulta automaticamente de novo');
});

test('conclusão recebida após anexo também agenda o menu', async t => {
  const h = await setup(t);
  h.store.queueFiles([{ name: 'foto.jpg', type: 'image/jpeg', size: 4 }]);
  await h.controller.uploadFile(h.store.getState().pendingFiles[0].id);
  await h.tick(3000);
  assert.ok(h.root.querySelector('[data-reply-id="group_supplies"]'));
});

for (const action of ['draft', 'new-flow', 'logout', 'stop']) {
  test(`menu pendente não interrompe ${action}`, async t => {
    const h = await setup(t);
    await h.controller.sendText('SIM');
    h.client.sendText = async () => ({ status: 'processed', activeFlow: { id: 'task', title: 'TAREFA' }, messages: [{ type: 'text', text: 'Qual é a filial?' }] });
    if (action === 'draft') {
      const input = h.root.querySelector('textarea');
      input.value = 'Minha próxima pergunta';
      input.dispatchEvent(new h.dom.window.Event('input', { bubbles: true }));
    } else if (action === 'new-flow') await h.controller.sendText('TAREFA');
    else if (action === 'logout') {
      h.root.querySelector('[data-action="sign-out"]').click();
      h.root.querySelector('[data-action="confirm-sign-out"]').click();
    }
    else h.controller.stop();
    await h.tick(3000);
    assert.equal(h.requests.filter(item => item.completionId).length, 0);
    if (action === 'draft') assert.equal(h.store.getState().draft, 'Minha próxima pergunta');
    if (action === 'new-flow') assert.match(h.root.textContent, /Qual é a filial/);
  });
}

test('menu que chega atrasado não substitui um novo fluxo', async t => {
  const h = await setup(t);
  let finish;
  h.client.getCompletionMenu = () => new Promise(resolve => { finish = resolve; });
  await h.controller.sendText('SIM');
  await h.tick(3000);
  assert.equal(typeof finish, 'function');
  h.client.sendText = async () => ({ status: 'processed', messages: [{ type: 'text', text: 'Qual é a filial?' }] });
  await h.controller.sendText('TAREFA');
  finish(menu()); await flush();
  assert.match(h.root.textContent, /Qual é a filial/);
  assert.equal(h.root.querySelector('[data-reply-id="group_supplies"]'), null);
});

test('menu obsoleto ou indisponível não apaga confirmação nem repete cadastro', async t => {
  const h = await setup(t);
  h.client.getCompletionMenu = async () => ({ status: 'processed', results: [{ status: 'obsolete' }], messages: [] });
  await h.controller.sendText('SIM'); await h.tick(3000);
  assert.match(h.root.textContent, /Cadastro concluído/);
  h.client.getCompletionMenu = async () => { throw new Error('Sem rede'); };
  await h.controller.sendText('SIM'); await h.tick(3000);
  assert.match(h.root.textContent, /Cadastro concluído/);
  assert.match(h.root.querySelector('[role="alert"]').textContent, /menu/i);
  assert.ok(h.root.querySelector('[data-action="retry-session"]'));
});

test('consulta do menu envia só conclusão e autenticação, sem comando de cadastro', async () => {
  const requests = [];
  const client = createChatClient({
    apiBaseUrl: 'https://example.test', tokenProvider: async () => 'microsoft-token',
    fetchImpl: async (url, options) => { requests.push({ url, ...options }); return new Response(JSON.stringify(menu())); },
  });
  assert.equal(typeof client.getCompletionMenu, 'function');
  const result = await client.getCompletionMenu('batch-1:completion');
  assert.equal(result.messages[0].options[0].reply, 'group_supplies');
  assert.equal(requests[0].url, 'https://example.test/api/portal-chat');
  assert.equal(requests[0].headers.Authorization, 'Bearer microsoft-token');
  assert.deepEqual(JSON.parse(requests[0].body), { action: 'completion_menu', completionId: 'batch-1:completion' });
});
