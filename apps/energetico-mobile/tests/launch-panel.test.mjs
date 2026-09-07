import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { createChatView } from '../src/ui/chat-view.js';
import { createAppController } from '../src/app-controller.js';
import { createRecoveryStorage } from '../src/web/recovery-storage.js';

function snapshot(overrides = {}) {
  return {
    id: 'batch-one', currency: 'BRL', count: 1, total: '85.00', totalDisplay: 'R$ 85,00',
    lines: [{ index: 1, product: 'Cimento', unit: 'SC', quantity: '2.5',
      unitPrice: '30.00', unitPriceDisplay: 'R$ 30,00', freight: '10.00',
      freightDisplay: 'R$ 10,00', total: '85.00', totalDisplay: 'R$ 85,00' }],
    ...overrides,
  };
}
const flow = launches => ({ id: 'launch', title: 'LANÇAMENTO MÚLTIPLO', contextId: 'question-one', launches });
const question = text => [{ type: 'poll', question: text, options: [{ id: 'continue', label: 'Continuar' }] }];

function setup(t) {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector('#app');
  const store = createConversationStore({ historyMode: 'current-step' });
  const view = createChatView(root);
  const account = { homeAccountId: 'account-one', name: 'Teste' };
  const render = () => view.render({ ...store.getState(), account, sessionStatus: 'authenticated' });
  const unsubscribe = store.subscribe(render);
  view.on('draft-changed', command => store.setDraft(command.value));
  store.ingestRemoteMessages(question('Pergunta inicial'), { activeFlow: flow(snapshot()) });
  t.after(() => { unsubscribe(); view.destroy(); dom.window.close(); });
  return { dom, root, store, view, account };
}

test('snapshot de 65 linhas é próprio, congelado e não vaza campos internos ou entra no checkpoint', () => {
  const store = createConversationStore();
  const source = snapshot({ count: 65, secret: 'internal', lines: Array.from({ length: 65 }, (_, index) => ({
    ...snapshot().lines[0], index: index + 1, product: `Produto ${index + 1}`, objectName: 'private',
  })) });
  store.ingestRemoteMessages([], { activeFlow: flow(source) });
  const saved = store.getState().activeFlow.launches;
  assert.ok(saved, 'o store deve preservar o snapshot estruturado');
  assert.equal(saved.lines.length, 65);
  assert.equal(saved.lines[64].product, 'Produto 65');
  assert.equal(saved.secret, undefined);
  assert.equal(saved.lines[0].objectName, undefined);
  source.lines[0].product = 'Mutado';
  source.lines.push(snapshot().lines[0]);
  assert.equal(saved.lines[0].product, 'Produto 1');
  assert.equal(saved.lines.length, 65);
  assert.ok(Object.isFrozen(saved) && Object.isFrozen(saved.lines) && Object.isFrozen(saved.lines[0]));
  const data = new Map();
  const recovery = createRecoveryStorage({ storage: { setItem: (key, value) => data.set(key, value), getItem: key => data.get(key) } });
  recovery.schedule('account-one', { activeFlow: store.getState().activeFlow });
  recovery.flush();
  assert.equal(recovery.read('account-one').activeFlow.launches, undefined);
  assert.doesNotMatch([...data.values()][0], /Produto 65|internal|objectName/);
});

test('fechado mostra só total da VM; aberto exibe os campos escapados com os formatos decimais definidos', t => {
  const { root, store } = setup(t);
  const source = snapshot({ total: '9007199254740993.01', totalDisplay: 'R$ 9.007.199.254.740.993,01' });
  source.lines[0] = { ...source.lines[0], product: '<img src=x onerror=alert(1)>',
    quantity: '12345678901234567890.123456789', totalDisplay: 'R$ 84,99' };
  store.ingestRemoteMessages(question('Pergunta atual'), { activeFlow: flow(source) });
  const panel = root.querySelector('.chat-launches');
  assert.ok(panel, 'painel de lançamentos deve existir');
  assert.equal(panel.open, false);
  assert.equal(panel.querySelector('summary').textContent.trim(), 'Total: R$ 9.007.199.254.740.993,01');
  panel.querySelector('summary').click();
  assert.equal(panel.open, true);
  const row = panel.querySelector('.chat-launch-row:not(.chat-launch-row--header)');
  assert.match(row.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(panel.querySelector('img'), null);
  assert.match(row.textContent, /12\.345\.678\.901\.234\.567\.890,1/);
  assert.doesNotMatch(row.textContent, /SC|Padrão do produto|⭐/i);
  assert.deepEqual([...panel.querySelectorAll('.chat-launch-row--header span')].map(node => node.textContent), ['Produto', 'Unitário', 'Qtd.', 'Frete', 'Total']);
  assert.match(row.textContent, /R\$ 30,0/);
  assert.match(row.textContent, /R\$ 10,0/);
  assert.match(row.textContent, /R\$ 84,99/);
  assert.equal(root.querySelector('[data-chat-form]').previousElementSibling.lastElementChild, panel);
});

test('nova pergunta mantém expansão e rolagem do lote, remove botões antigos e preserva campo/IME', t => {
  const { dom, root, store } = setup(t);
  const panel = root.querySelector('.chat-launches');
  assert.ok(panel);
  panel.open = true;
  root.querySelector('.chat-file-tray').scrollTop = 120;
  const draft = root.querySelector('textarea');
  draft.focus();
  draft.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }));
  draft.value = 'ação';
  store.ingestRemoteMessages(question('Pergunta substituta'), { activeFlow: { ...flow(snapshot()), contextId: 'question-two' } });
  assert.equal(root.querySelector('.chat-launches').open, true);
  assert.equal(root.querySelector('.chat-file-tray').scrollTop, 120);
  assert.equal(root.querySelector('textarea'), draft);
  assert.equal(dom.window.document.activeElement, draft);
  assert.equal(draft.value, 'ação');
  assert.doesNotMatch(root.querySelector('[role="log"]').textContent, /Pergunta inicial/);
  assert.match(root.querySelector('[role="log"]').textContent, /Pergunta substituta/);
  draft.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true }));
  assert.equal(store.getState().draft, 'ação');
});

test('65 linhas continuam acessíveis e digitar não reconstrói painel nem percorre controles', t => {
  const { dom, root, store } = setup(t);
  store.ingestRemoteMessages(question('Quantidade?'), { activeFlow: flow(snapshot({ count: 65,
    lines: Array.from({ length: 65 }, (_, index) => ({ ...snapshot().lines[0], index: index + 1, product: `Produto ${index + 1}` })),
  })) });
  const panel = root.querySelector('.chat-launches');
  assert.ok(panel);
  assert.equal(panel.querySelectorAll('.chat-launch-row:not(.chat-launch-row--header)').length, 65);
  panel.open = true;
  assert.match(panel.lastElementChild.lastElementChild.textContent, /Produto 65/);
  const draft = root.querySelector('textarea');
  draft.focus();
  const query = root.querySelector.bind(root);
  let scans = 0;
  root.querySelector = (...args) => { scans++; return query(...args); };
  for (let i = 1; i <= 200; i++) {
    draft.value = '1'.repeat(i);
    draft.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  }
  assert.equal(scans, 0);
  assert.equal(query('.chat-launches'), panel);
  assert.equal(query('textarea'), draft);
});

test('novo lote fecha painel e não herda rolagem; menu, conclusão e logout não retêm lançamentos', t => {
  const { root, store, view } = setup(t);
  assert.ok(root.querySelector('.chat-launches'));
  root.querySelector('.chat-launches').open = true;
  root.querySelector('.chat-file-tray').scrollTop = 90;
  store.ingestRemoteMessages(question('Outro lote'), { activeFlow: flow(snapshot({ id: 'batch-two' })) });
  assert.equal(root.querySelector('.chat-launches').open, false);
  assert.equal(root.querySelector('.chat-file-tray').scrollTop, 0);
  store.ingestRemoteMessages(question('Menu'), { activeFlow: null, resetConversation: true });
  assert.equal(root.querySelector('.chat-launches'), null);
  store.ingestRemoteMessages(question('Retomado'), { activeFlow: flow(snapshot()) });
  assert.equal(root.querySelector('.chat-launches').open, false);
  const operation = store.beginText('Concluir');
  store.confirmText(operation, { activeFlow: null, messages: [{ type: 'text', text: 'Concluído' }] });
  assert.equal(root.querySelector('.chat-launches'), null);
  store.ingestRemoteMessages(question('Retomado'), { activeFlow: flow(snapshot()) });
  store.clearSession();
  view.render({ ...store.getState(), sessionStatus: 'signed-out' });
  assert.equal(root.querySelector('.chat-launches'), null);
  assert.doesNotMatch(root.textContent, /Cimento|85,00/);
});

test('falha preserva último total confirmado; upload e retomada atualizam snapshot sem acrescentar mensagens antigas', t => {
  const { root, store } = setup(t);
  const saved = store.getState().activeFlow.launches;
  assert.ok(saved);
  const operation = store.beginText('Nova linha');
  store.failText(operation, new Error('Sem conexão'));
  assert.equal(store.getState().activeFlow.launches, saved);
  assert.match(root.querySelector('.chat-launches summary').textContent, /85,00/);
  const [file] = store.queueFiles([{ name: 'foto.jpg', size: 1, type: 'image/jpeg' }]);
  const upload = store.beginFile(file.id);
  store.confirmFile(upload, { activeFlow: flow(snapshot({ total: '86.00', totalDisplay: 'R$ 86,00' })), messages: question('Após anexo') });
  assert.match(root.querySelector('.chat-launches summary').textContent, /86,00/);
  assert.equal(store.getState().messages.length, 1);
  store.ingestRemoteMessages(question('Retomada'), { activeFlow: flow(snapshot({ total: '87.00', totalDisplay: 'R$ 87,00' })) });
  assert.match(root.querySelector('.chat-launches summary').textContent, /87,00/);
});

test('zero linhas mostra zero autoritativo e explicação; snapshot inválido ou ausente não mostra painel antigo', t => {
  const { root, store } = setup(t);
  store.ingestRemoteMessages(question('Primeiro produto?'), { activeFlow: flow(snapshot({ count: 0, lines: [], total: '0.00', totalDisplay: 'R$ 0,00' })) });
  const panel = root.querySelector('.chat-launches');
  assert.ok(panel);
  assert.match(panel.querySelector('summary').textContent, /R\$ 0,00/);
  panel.open = true;
  assert.match(panel.textContent, /Nenhuma linha adicionada/);
  for (const invalid of [undefined, null, {}, snapshot({ lines: null }), snapshot({ count: 2 }), snapshot({ total: 'NaN' })]) {
    store.ingestRemoteMessages(question('Atual'), { activeFlow: flow(invalid) });
    assert.equal(root.querySelector('.chat-launches'), null);
  }
});

test('abrir e fechar é local: controlador não envia mensagem, não altera pergunta nem rascunho', async t => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector('#app');
  const store = createConversationStore({ historyMode: 'current-step' });
  let calls = 0;
  const controller = createAppController({ store, view: createChatView(root),
    auth: { initialize: async () => ({ homeAccountId: 'account-one', name: 'Teste' }) },
    native: { importSharedItems: async () => [] },
    client: { sendText: async () => { calls++; return { messages: question('Atual'), activeFlow: flow(snapshot()) }; } },
  });
  await controller.start();
  t.after(() => { controller.stop(); dom.window.close(); });
  store.setDraft('2,5');
  const messages = store.getState().messages;
  const panel = root.querySelector('.chat-launches');
  assert.ok(panel);
  panel.querySelector('summary').click();
  panel.querySelector('summary').click();
  assert.equal(panel.open, false);
  assert.equal(calls, 1);
  assert.equal(store.getState().messages, messages);
  assert.equal(store.getState().draft, '2,5');
});
