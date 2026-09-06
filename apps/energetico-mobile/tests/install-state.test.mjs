import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createInstallView } from '../src/web/install-view.js';
import { createChatView } from '../src/ui/chat-view.js';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';

function setup(t, { standalone = true, status = async () => ({ status: 'active' }) } = {}) {
  const dom = new JSDOM('<div id="app"></div><aside id="tools"></aside>');
  const root = dom.window.document.querySelector('#tools');
  let issued = 0;
  const view = createInstallView(root, {
    standalone, storageRef: null,
    client: { status, issue: async () => { issued++; return { token: 'private-token', uploadUrl: '/upload' }; }, revoke: async () => {} },
  });
  view.setReady(true);
  t.after(() => { view.destroy(); dom.window.close(); });
  return { dom, root, view, issued: () => issued };
}

test('instalação só abre por ação explícita, mesmo sem armazenamento ou fora do modo app', async t => {
  const { root, view } = setup(t, { standalone: false });
  assert.equal(root.querySelector('[role="dialog"]'), null);
  await view.open();
  assert.ok(root.querySelector('[role="dialog"]'));
});

test('credencial ativa aparece como existente e não é substituída ao abrir configurações', async t => {
  const { root, view, issued } = setup(t);
  await view.open();
  assert.match(root.textContent, /Credencial de compartilhamento ativa/);
  assert.equal(root.querySelector('[data-tool-action="issue"]'), null);
  assert.equal(root.querySelector('[data-role="shortcut-token"]'), null);
  assert.equal(issued(), 0);
  root.querySelector('[data-tool-action="reconfigure"]').click();
  assert.match(root.textContent, /invalida a credencial atual/);
  assert.ok(root.querySelector('[data-tool-action="issue"]'));
});

test('falha de consulta não afirma que falta configuração nem oferece substituição', async t => {
  const { root, view } = setup(t, { status: async () => { throw new Error('Sem conexão'); } });
  await view.open();
  assert.match(root.querySelector('[role="alert"]').textContent, /Sem conexão/);
  assert.equal(root.querySelector('[data-tool-action="issue"]'), null);
  assert.ok(root.querySelector('[data-tool-action="refresh-status"]'));
});

test('fechar ou sair durante a consulta não reabre a janela nem restaura a conta antiga', async t => {
  let finish;
  const { root, view } = setup(t, { status: () => new Promise(resolve => { finish = resolve; }) });
  const opening = view.open();
  root.querySelector('button[data-tool-action="close"]').click();
  view.setReady(false);
  finish({ status: 'active' });
  await opening;
  assert.equal(root.querySelector('[role="dialog"]'), null);
  await view.open();
  assert.doesNotMatch(root.textContent, /Credencial de compartilhamento ativa/);
});

test('digitar, voltar do segundo plano e receber respostas não abre o compartilhamento', async t => {
  let reads = 0;
  const { dom, root, view } = setup(t, { status: async () => { reads++; return { status: 'active' }; } });
  const app = dom.window.document.querySelector('#app');
  const store = createConversationStore({ historyMode: 'current-step' });
  const controller = createAppController({
    store, view: createChatView(app, { onOpenSettings: () => view.open() }),
    auth: { initialize: async () => ({ name: 'Teste' }) }, native: { importSharedItems: async () => [] },
    client: { sendText: async () => ({ messages: [{ type: 'text', text: 'Qual é a data?' }], attachments: [] }), getAttachments: async () => [] },
  });
  t.after(() => controller.stop());
  await controller.start();
  const draft = app.querySelector('textarea');
  for (const value of ['0', '06', '06/09/2026']) {
    draft.value = value;
    draft.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await controller.refreshAttachments();
  }
  await controller.sendText();
  assert.equal(root.querySelector('[role="dialog"]'), null);
  assert.equal(reads, 0, 'consulta de configuração também deve depender da engrenagem');
});
