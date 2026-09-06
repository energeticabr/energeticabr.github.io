import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createChatView } from "../src/ui/chat-view.js";
import { createConversationStore } from "../src/chat/conversation-store.js";

function setup(t) {
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://example.test/' });
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root);
  const store = createConversationStore({ historyMode: 'current-step' });
  store.ingestRemoteMessages([{ type: 'poll', question: 'Escolha', options: [{ id: 'yes', label: 'Sim' }] }]);
  const render = () => view.render({ ...store.getState(), account: { name: 'Teste' }, sessionStatus: 'authenticated' });
  store.subscribe(render); render();
  t.after(() => { view.destroy(); dom.window.close(); });
  return { root, store, view };
}

test('digitar preserva o mesmo campo, botões e imagens sem reconstruir a conversa', t => {
  const { root, store } = setup(t);
  const draft = root.querySelector('textarea');
  const poll = root.querySelector('[data-action="select-reply"]');
  const mascot = root.querySelector('img');
  draft.focus();
  for (const value of ['O', 'Ob', 'Obra']) store.setDraft(value);
  assert.equal(root.querySelector('textarea'), draft);
  assert.equal(root.querySelector('[data-action="select-reply"]'), poll);
  assert.equal(root.querySelector('img'), mascot);
  assert.equal(draft.value, 'Obra');
  assert.equal(root.querySelector('[type="submit"]').disabled, false);
});

test('toque recebe indicação imediata e bloqueia opções até a confirmação', t => {
  const { root, store } = setup(t);
  const operation = store.beginText('Sim');
  assert.equal(root.querySelector('[data-action="select-reply"]').disabled, true);
  assert.equal(root.querySelector('[data-action="capture-photo"]').disabled, true);
  assert.match(root.querySelector('[role="status"]').textContent, /Processando/);
  store.confirmText(operation, { messages: [{ type: 'poll', question: 'Próxima?', options: [{ id: 'no', label: 'Não' }] }] });
  assert.equal(root.querySelector('[data-action="select-reply"]').disabled, false);
  assert.equal(root.querySelector('[role="status"]'), null);
});

test('falha preserva pergunta e rascunho e reabilita os controles', t => {
  const { root, store } = setup(t);
  store.setDraft('Minha resposta');
  const operation = store.beginText();
  store.failText(operation, new Error('Conexão interrompida'));
  assert.match(root.querySelector('[role="log"]').textContent, /Escolha/);
  assert.equal(root.querySelector('textarea').value, 'Minha resposta');
  assert.equal(root.querySelector('[data-action="select-reply"]').disabled, false);
});
