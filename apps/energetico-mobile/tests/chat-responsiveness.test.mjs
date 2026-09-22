import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createChatView } from "../src/ui/chat-view.js";
import { createConversationStore } from "../src/chat/conversation-store.js";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

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

test('opção única fica maior e centralizada no tablet horizontal', () => {
  assert.match(styles, /\.chat-choice-list--single\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);\s*\}/);
  assert.match(styles, /\.chat-choice-list--single \.chat-choice-button\s*\{[^}]*width:\s*min\(100%,\s*760px\);[^}]*justify-self:\s*center;/s);
});

test('menus e botões de escolha crescem com a viewport, mas respeitam limites', () => {
  assert.match(styles, /\.chat-choice-list\s*\{[^}]*width:\s*min\(100%,\s*1120px\);[^}]*margin-inline:\s*auto;[^}]*gap:\s*clamp\(8px,\s*1vw,\s*14px\);/s);
  assert.match(styles, /\.chat-choice-list button, \.chat-media-button\s*\{[^}]*min-height:\s*var\(--control-height\);[^}]*padding:\s*var\(--control-padding-block\)\s+var\(--control-padding-inline\);/s);
  assert.match(styles, /--control-height:\s*clamp\(44px,\s*5vw,\s*60px\);/);
  assert.match(styles, /--control-padding-inline:\s*clamp\(12px,\s*1\.8vw,\s*24px\);/);
});

test('barra de fluxo e compositor usam controles responsivos', () => {
  assert.match(styles, /\.chat-flow-nav-button\s*\{[^}]*width:\s*var\(--compact-control-size\);[^}]*min-height:\s*var\(--compact-control-size\);/s);
  assert.match(styles, /\.chat-flow-finish, \.chat-flow-summary\s*\{[^}]*min-height:\s*var\(--compact-control-height\);[^}]*padding:\s*var\(--compact-control-padding-block\)\s+var\(--compact-control-padding-inline\);/s);
  assert.match(styles, /\.attachment-actions button\s*\{[^}]*width:\s*var\(--control-height\);[^}]*min-height:\s*var\(--control-height\);/s);
  assert.match(styles, /\.send-button\s*\{[^}]*min-height:\s*var\(--control-height\);[^}]*padding-inline:\s*var\(--control-padding-inline\);/s);
});

test('tabela de presença mantém rótulo e valor compactos na mesma linha', () => {
  const css = styles;
  const cell = css.match(/\.chat-presence-table-cell\s*\{[^}]*\}/)?.[0] || "";

  assert.match(cell, /display:\s*grid/);
  assert.match(cell, /grid-template-columns:\s*max-content\s+minmax\(0,\s*1fr\)/);
  assert.match(cell, /align-items:\s*baseline/);
  assert.match(cell, /gap:\s*6px/);
});

test('tabela de presença expande linhas com um único campo para toda a largura', () => {
  assert.match(
    styles,
    /\.chat-presence-table-row\s*>\s*\.chat-presence-table-cell:only-child\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s,
  );
});
