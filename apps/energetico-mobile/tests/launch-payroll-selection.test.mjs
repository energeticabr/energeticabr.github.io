import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatView } from '../src/ui/chat-view.js';

const launch = (id, label, disabled = false) => ({ id: `choice:launch_payroll_entries:${id}`, label, disabled });
const poll = (overrides = {}) => ({
  id: 'payroll-selection', role: 'assistant', type: 'poll',
  presentation: 'launch_payroll_multi_select',
  question: 'MARQUE OS LANÇAMENTOS DE EMPREITEIRO QUE DESEJA INCLUIR NA FOLHA.',
  options: [launch('3542', 'HELISON ROSA LUIS'), launch('3543', 'FELICIANO ROGÉRIO'), launch('3544', 'EDGAR NELSON')],
  ...overrides,
});

function setup(t) {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root);
  const replies = [];
  view.on('select-reply', command => replies.push(command.replyId));
  t.after(() => { view.destroy(); dom.window.close(); });
  const render = (messages = [poll()], overrides = {}) => view.render({
    sessionStatus: 'authenticated', account: { name: 'Teste local' },
    draft: '', pendingFiles: [], messages, ...overrides,
  });
  const selectAll = () => root.querySelector('[data-action="launch-payroll-select-all"]');
  const selected = () => [...root.querySelectorAll('[data-action="launch-payroll-select-toggle"]:checked')].map(input => input.dataset.replyId);
  return { root, render, replies, selectAll, selected };
}

test('selecionar todas marca o lote sem enviar e permite desmarcar antes de prosseguir', t => {
  const h = setup(t);
  h.render();
  assert.equal(h.selectAll()?.tagName, 'BUTTON');
  assert.equal(h.selectAll().type, 'button');
  h.selectAll().click();
  assert.deepEqual(h.selected(), ['3542', '3543', '3544']);
  assert.deepEqual(h.replies, []);
  assert.equal(h.root.ownerDocument.activeElement, h.selectAll());
  h.selectAll().click();
  assert.deepEqual(h.selected(), ['3542', '3543', '3544']);
  h.root.querySelector('[data-reply-id="3543"]').click();
  h.root.querySelector('[data-action="launch-payroll-select-proceed"]').click();
  assert.deepEqual(h.replies, ['launch_payroll_selected:3542,3544']);
});

test('selecionar todas ignora ID inválido, opções desabilitadas e duplicatas', t => {
  const h = setup(t);
  h.render([poll({ options: [
    launch('3542', 'HELISON'), launch('3543', 'FORNECEDOR COMUM', true),
    { id: 'unknown', label: 'Sem ID' }, launch('3542', 'HELISON repetido'),
  ] })]);
  assert.ok(h.selectAll());
  h.selectAll().click();
  assert.equal(h.root.querySelector('input[data-reply-id="3543"]').checked, false);
  assert.equal(h.root.querySelector('.chat-launch-payroll-select__row--unavailable input:not([data-reply-id])').checked, false);
  h.root.querySelector('[data-action="launch-payroll-select-proceed"]').click();
  assert.deepEqual(h.replies, ['launch_payroll_selected:3542']);
});

test('seleção em lote respeita a filtragem visível sem perder a seleção anterior', t => {
  const h = setup(t);
  const message = poll({ databaseFilter: true, databaseFilterKey: 'launch_payroll_entries' });
  h.render([message]);
  h.root.querySelector('[data-reply-id="3544"]').click();
  h.render([message], { draft: 'HELISON' });
  assert.ok(h.selectAll());
  h.selectAll().click();
  assert.deepEqual(h.selected(), ['3542']);
  h.root.querySelector('[data-action="launch-payroll-select-proceed"]').click();
  assert.deepEqual(h.replies, ['launch_payroll_selected:3544,3542']);
  h.render([message], { draft: 'NENHUM RESULTADO' });
  assert.equal(h.selectAll().disabled, true);
});

test('selecionar todas fica inativo enquanto processa, no histórico e sem opções válidas', t => {
  const h = setup(t);
  h.render([poll()], { activeText: { status: 'sending' } });
  assert.ok(h.selectAll());
  assert.equal(h.selectAll().disabled, true);
  h.selectAll().click();
  assert.deepEqual(h.selected(), []);
  h.render([poll(), { role: 'assistant', type: 'poll', question: 'OUTRA PERGUNTA', options: [] }]);
  assert.equal(h.selectAll().disabled, true);
  h.selectAll().click();
  assert.deepEqual(h.selected(), []);
  h.render([poll({ options: [launch('3542', 'NÃO EMPREITEIRO', true)] })]);
  assert.equal(h.selectAll().disabled, true);
  assert.deepEqual(h.replies, []);
});

test('novo lote limpa a seleção em massa e opções que perdem elegibilidade são retiradas', t => {
  const h = setup(t);
  h.render();
  assert.ok(h.selectAll());
  h.selectAll().click();
  h.render([poll({ options: [launch('3542', 'HELISON', true), launch('3544', 'EDGAR')] })]);
  h.root.querySelector('[data-action="launch-payroll-select-proceed"]').click();
  assert.deepEqual(h.replies, ['launch_payroll_selected:3544']);
  h.render([poll({ id: 'another-batch' })]);
  assert.deepEqual(h.selected(), []);
  assert.match(h.root.querySelector('[data-action="launch-payroll-select-proceed"]').textContent, /SEM FOLHA/);
});
