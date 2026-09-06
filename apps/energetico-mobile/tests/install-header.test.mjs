import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createChatView } from "../src/ui/chat-view.js";
import { createInstallView } from "../src/web/install-view.js";

function setup(t) {
  const dom = new JSDOM('<div id="app"></div><aside id="app-tools"></aside>');
  const document = dom.window.document;
  const root = document.querySelector('#app');
  const tools = document.querySelector('#app-tools');
  const installer = createInstallView(tools, {
    client: {}, standalone: false,
    storageRef: { getItem: () => '1', setItem() {} },
  });
  const view = createChatView(root, { onOpenSettings: () => installer.open() });
  const state = {
    sessionStatus: 'authenticated', account: { name: 'Teste' }, draft: 'Rascunho preservado',
    messages: [{ id: '1', type: 'text', text: 'Qual é a obra?' }],
  };
  view.render(state);
  t.after(() => { view.destroy(); installer.destroy(); dom.window.close(); });
  return { root, tools, view, state };
}

test('engrenagem fica no cabeçalho imediatamente antes de Sair, fora da conversa', t => {
  const { root, tools } = setup(t);
  const gear = root.querySelector('.chat-header [data-action="open-settings"]');
  assert.ok(gear, 'a engrenagem deve pertencer ao cabeçalho');
  assert.equal(gear.nextElementSibling.dataset.action, 'sign-out');
  assert.equal(root.querySelector('[role="log"] [data-action="open-settings"]'), null);
  assert.equal(tools.querySelector('button'), null, 'não deve restar um botão flutuante sobre a conversa');
});

test('engrenagem abre as opções e continua funcionando depois de atualizar a pergunta', t => {
  const { root, tools, view, state } = setup(t);
  const gear = root.querySelector('[data-action="open-settings"]');
  assert.ok(gear);
  gear.click();
  assert.match(tools.querySelector('[role="dialog"]').textContent, /Instalar o aplicativo no iPhone/);
  tools.querySelector('button[data-tool-action="close"]').click();
  assert.equal(tools.querySelector('[role="dialog"]'), null);
  view.render({ ...state, messages: [{ id: '2', type: 'text', text: 'Qual é a atividade?' }] });
  root.querySelector('[data-action="open-settings"]').click();
  assert.ok(tools.querySelector('[role="dialog"]'));
  assert.equal(root.querySelector('textarea').value, 'Rascunho preservado');
  assert.match(root.querySelector('[role="log"]').textContent, /Qual é a atividade/);
});

test('instalação permanece acessível antes de entrar sem abrir automaticamente', t => {
  const { root, tools, view } = setup(t);
  view.render({ sessionStatus: 'signed-out' });
  assert.equal(tools.querySelector('[role="dialog"]'), null);
  const gear = root.querySelector('.auth-card [data-action="open-settings"]');
  assert.ok(gear);
  gear.click();
  assert.ok(tools.querySelector('[role="dialog"]'));
});

test('cliente sem instalador não exibe um botão sem ação', t => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root);
  t.after(() => { view.destroy(); dom.window.close(); });
  view.render({ sessionStatus: 'authenticated', account: { name: 'Teste' } });
  assert.equal(root.querySelector('[data-action="open-settings"]'), null);
});
