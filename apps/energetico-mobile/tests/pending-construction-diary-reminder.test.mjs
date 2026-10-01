import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatView } from '../src/ui/chat-view.js';

function setup(t, overrides = {}) {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root);
  const state = { sessionStatus: 'authenticated', account: { name: 'Bernardo' }, draft: '', messages: [], pendingFiles: [],
    pendingConstructionDiaries: { rows: [{ id: '17', status: 'PENDENTE', date: '2026-09-30', branch: 'Obra A', responsible: 'Responsável A' }] }, ...overrides };
  view.render(state);
  t.after(() => { view.destroy(); dom.window.close(); });
  return { root, view, state, dom };
}

test('popup de diários identifica data, filial e responsável e fecha pelo botão', t => {
  const { root, view } = setup(t);
  const dialog = root.querySelector('[data-pending-construction-diaries-dialog]');
  assert.ok(dialog);
  assert.match(dialog.textContent, /Diários de obra pendentes/);
  assert.match(dialog.textContent, /30\/09\/2026/);
  assert.match(dialog.textContent, /Obra A/);
  assert.match(dialog.textContent, /Responsável A/);
  assert.match(dialog.textContent, /ID 17/);
  const events = [];
  view.on('dismiss-pending-construction-diaries', event => events.push(event));
  dialog.querySelector('[data-action="dismiss-pending-construction-diaries"]').click();
  assert.equal(events.length, 1);
});

test('diários têm prioridade sobre notas mas aguardam o popup de pagamentos', t => {
  const { root, view, state } = setup(t, { pendingNotes: { rows: [{ id: '13', supplier: 'Fornecedor' }] } });
  assert.ok(root.querySelector('[data-pending-construction-diaries-dialog]'));
  assert.equal(root.querySelector('[data-pending-notes-dialog]'), null);
  view.render({ ...state, pendingProvisions: { due: true, rows: [{ id: '306', supplier: 'Fornecedor' }] } });
  assert.ok(root.querySelector('[data-pending-provisions-dialog]'));
  assert.equal(root.querySelector('[data-pending-construction-diaries-dialog]'), null);
});

test('popup não aparece vazio e trata os nomes dos registros como texto', t => {
  const { root, view, state } = setup(t, { pendingConstructionDiaries: { rows: [] } });
  assert.equal(root.querySelector('[data-pending-construction-diaries-dialog]'), null);
  view.render({ ...state, pendingConstructionDiaries: { rows: [{ id: '17', date: '2026-09-30', branch: '<img src=x onerror=alert(1)>', responsible: '<script>erro</script>' }] } });
  const dialog = root.querySelector('[data-pending-construction-diaries-dialog]');
  assert.equal(dialog.querySelector('script, img'), null);
  assert.match(dialog.textContent, /<script>erro<\/script>/);
});

test('ícone de preencher identifica o ID do cartão e emite o comando correspondente', t => {
  const { root, view } = setup(t);
  let command;
  view.on('fill-pending-construction-diary', value => { command = value; });
  const button = root.querySelector('[data-action="fill-pending-construction-diary"]');
  assert.ok(button);
  assert.equal(button.getAttribute('aria-label'), 'Preencher diário de obra de ID 17');
  button.click();
  assert.equal(command.diaryId, '17');
});

test('preenchimento em andamento bloqueia cliques repetidos e mostra erro dentro do popup', t => {
  const { root } = setup(t, { pendingConstructionDiaryFillingId: '17', pendingConstructionDiaryError: 'A VM não confirmou o ID 17.' });
  assert.equal(root.querySelector('[data-action="fill-pending-construction-diary"]').disabled, true);
  assert.equal(root.querySelector('[data-action="dismiss-pending-construction-diaries"]').disabled, true);
  assert.match(root.querySelector('[role="alert"]').textContent, /ID 17/);
});
