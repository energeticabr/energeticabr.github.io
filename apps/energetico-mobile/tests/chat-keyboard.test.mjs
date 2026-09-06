import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createChatView } from "../src/ui/chat-view.js";
import { createAppController } from "../src/app-controller.js";
import { createConversationStore } from "../src/chat/conversation-store.js";

async function setup(t) {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector('#app');
  const store = createConversationStore({ historyMode: 'current-step' });
  const client = {
    sendText: async () => ({ messages: [{ type: 'text', text: 'Qual é a data?' }], attachments: [] }),
    getAttachments: async () => [],
  };
  const controller = createAppController({
    store, view: createChatView(root), client,
    auth: { initialize: async () => ({ name: 'Teste' }), signOut: async () => {} },
    native: { importSharedItems: async () => [] },
  });
  await controller.start();
  t.after(() => { controller.stop(); dom.window.close(); });
  function type(value) {
    const draft = root.querySelector('textarea');
    draft.value = value;
    draft.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  }
  return { dom, root, store, controller, client, type };
}

test('digitar uma data com atualizações de anexos preserva o mesmo campo e não refaz o foco', async t => {
  const { dom, root, store, controller, type } = await setup(t);
  const draft = root.querySelector('textarea');
  draft.focus();
  let focusChanges = 0;
  dom.window.document.addEventListener('focus', () => focusChanges++, true);
  dom.window.document.addEventListener('blur', () => focusChanges++, true);
  for (const value of ['0', '06', '06/', '06/0', '06/09', '06/09/', '06/09/2', '06/09/20', '06/09/202', '06/09/2026']) {
    type(value);
    await controller.refreshAttachments();
    assert.equal(root.querySelector('textarea'), draft, 'atualizar anexos não pode substituir o campo em edição');
    assert.equal(dom.window.document.activeElement, draft);
    assert.equal(draft.getAttribute('inputmode'), null, 'o aplicativo não deve forçar outro tipo de teclado');
  }
  assert.equal(store.getState().draft, '06/09/2026');
  assert.equal(focusChanges, 0, 'somente a ação do usuário deve mudar o foco durante a digitação');
});

test('nova pergunta preserva a seleção e o foco da data que está sendo editada', async t => {
  const { dom, root, store, type } = await setup(t);
  type('06/09/2026');
  const draft = root.querySelector('textarea');
  draft.focus();
  draft.setSelectionRange(3, 5, 'backward');
  store.ingestRemoteMessages([{ id: 'next', type: 'text', text: 'Confira a data.' }]);
  assert.equal(root.querySelector('textarea'), draft);
  assert.equal(dom.window.document.activeElement, draft);
  assert.equal(draft.selectionStart, 3);
  assert.equal(draft.selectionEnd, 5);
  assert.equal(draft.selectionDirection, 'backward');
  assert.match(root.querySelector('[role="log"]').textContent, /Confira a data/);
});

test('resposta em trânsito não desativa o campo nem apaga a próxima mensagem digitada', async t => {
  const { dom, root, store, controller, client, type } = await setup(t);
  type('06/09/2026');
  const draft = root.querySelector('textarea');
  draft.focus();
  let finish;
  client.sendText = () => new Promise(resolve => { finish = resolve; });
  const sending = controller.sendText();
  assert.equal(root.querySelector('textarea'), draft);
  assert.equal(draft.disabled, false, 'envio deve bloquear apenas novos envios, não a digitação');
  assert.equal(root.querySelector('[data-action="send-text"]').disabled, true);
  assert.equal(root.querySelector('[data-action="capture-photo"]').disabled, true);
  assert.equal(dom.window.document.activeElement, draft);
  type('07/09/2026');
  finish({ messages: [{ type: 'text', text: 'Qual é a próxima data?' }], attachments: [] });
  await sending;
  assert.equal(root.querySelector('textarea'), draft);
  assert.equal(store.getState().draft, '07/09/2026');
  assert.equal(draft.value, '07/09/2026');
});

test('resposta da VM não reabre o teclado depois que o usuário saiu do campo', async t => {
  const { dom, root, controller, client, type } = await setup(t);
  type('06/09/2026');
  root.querySelector('textarea').focus();
  let finish;
  client.sendText = () => new Promise(resolve => { finish = resolve; });
  const sending = controller.sendText();
  root.querySelector('textarea').blur();
  finish({ messages: [{ type: 'text', text: 'Data recebida.' }], attachments: [] });
  await sending;
  assert.notEqual(dom.window.document.activeElement, root.querySelector('textarea'));
});

test('sair remove o campo e o rascunho da conta anterior', async t => {
  const { root, type } = await setup(t);
  type('06/09/2026');
  const draft = root.querySelector('textarea');
  root.querySelector('[data-action="sign-out"]').click();
  assert.equal(draft.isConnected, false);
  assert.equal(root.querySelector('textarea'), null);
  assert.doesNotMatch(root.textContent, /06\/09\/2026/);
});
