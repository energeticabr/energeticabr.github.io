import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatView, renderChatMarkup } from '../src/ui/chat-view.js';
import { reviewState } from './helpers/provision-settlement-review-fixture.mjs';

const suffix = 'DESEJA ADICIONAR TODAS ESTAS LINHAS EM LANÇAMENTOS? SERÁ UTILIZADO UM ÚNICO PEDIDO PARA ESTE DESCRITIVO.';
const summary = (lines = ['PROVISÃO 347 — BRITA 01 — QTD 6 — TOTAL R$ 769,00'], notes = '') => ({
  id: 'synthetic-launch-summary', type: 'poll', role: 'assistant',
  question: ['DESCRITIVO 30 — RESUMO DAS LINHAS:', ...lines, notes, suffix].filter(Boolean).join('\n'),
  options: [
    { id: 'choice:submeter_lancamentos:1', reply: 'choice:submeter_lancamentos:1', label: '✅ SIM' },
    { id: 'choice:submeter_lancamentos:2', reply: 'choice:submeter_lancamentos:2', label: '❌ NÃO' },
  ],
});
const state = (message, overrides = {}) => reviewState(message, {
  activeFlow: { id: 'payment_settlement', title: 'BAIXAR PAGAMENTO AGENDADO', stepKey: 'submeter_lancamentos' }, ...overrides,
});
function render(t, message = summary(), overrides = {}) {
  const original = structuredClone(message);
  const dom = new JSDOM(renderChatMarkup(state(message, overrides)));
  t.after(() => dom.window.close());
  assert.deepEqual(message, original);
  return dom.window.document;
}

test('resumo da imagem mostra tabela com provisão, produto, quantidade e total geral', t => {
  const document = render(t), card = document.querySelector('[data-provision-launch-summary]');
  assert.ok(card, 'esta pergunta também precisa de uma tabela');
  assert.match(card.textContent, /DESCRITIVO 30/);
  const row = card.querySelector('tbody tr');
  assert.equal(row.dataset.provisionId, '347');
  assert.match(row.querySelector('th').textContent, /BRITA 01/);
  assert.match(row.querySelector('th').textContent, /347/);
  assert.deepEqual([...row.querySelectorAll('td')].map(cell => cell.textContent.trim()), ['6', 'R$ 769,00']);
  assert.deepEqual([...card.querySelectorAll('tfoot th,tfoot td')].map(cell => cell.textContent.trim()), ['TOTAL GERAL', 'R$ 769,00']);
  assert.match(card.textContent, /DESEJA ADICIONAR TODAS ESTAS LINHAS EM LANÇAMENTOS\?/);
  assert.match(card.textContent, /SERÁ UTILIZADO UM ÚNICO PEDIDO/);
  assert.equal(document.querySelectorAll('.chat-choice-card > p').length, 0, 'não duplicar o resumo em texto');
  assert.equal(card.querySelectorAll('input,button,select').length, 0, 'a tabela é somente visualização');
});

test('todas as linhas são mantidas e somadas em centavos sem deduzir valor unitário', t => {
  const document = render(t, summary([
    'PROVISÃO 347 — BRITA — 01 — QTD 6,25 — TOTAL R$ 769,00',
    'PROVISÃO 348 — AREIA MÉDIA — QTD 1 — TOTAL R$ 1.234,56',
    'PROVISÃO 349 — MATERIAL — QTD 0,5 — TOTAL R$ 0,10',
    'PROVISÃO 350 — MATERIAL — QTD 1 — TOTAL R$ 0,20',
  ]));
  const table = document.querySelector('[data-provision-launch-summary] table');
  assert.ok(table);
  assert.equal(table.querySelectorAll('tbody tr').length, 4);
  assert.match(table.querySelector('tbody th').textContent, /BRITA — 01/);
  assert.equal(table.querySelector('tbody td').textContent.trim(), '6,25');
  assert.equal(table.querySelector('tfoot td').textContent.trim(), 'R$ 2.003,86');
  assert.doesNotMatch(table.textContent, /UNITÁRIO/);
});

test('avisos sobre vínculos e todas as instruções posteriores permanecem visíveis', t => {
  const warning = 'ATENÇÃO: HÁ LANÇAMENTOS VINCULADOS. SIM EXIGE A SENHA PARA SUBSTITUÍ-LOS.';
  const message = summary(undefined, warning);
  message.question += '\nOs anexos serão mantidos no pedido.';
  const document = render(t, message), card = document.querySelector('[data-provision-launch-summary]');
  assert.ok(card);
  assert.ok(card.textContent.includes(warning));
  assert.ok(card.textContent.includes('Os anexos serão mantidos no pedido.'));
});

test('produtos com HTML e IDs grandes são exibidos literalmente', t => {
  const hostile = '<img src=x onerror="bad()"> & <script>bad()</script>';
  const document = render(t, summary([`PROVISÃO 90071992547409931 — ${hostile} — QTD 1 — TOTAL R$ 7,10`]));
  const card = document.querySelector('[data-provision-launch-summary]');
  assert.ok(card);
  assert.equal(card.querySelector('script,img,iframe'), null);
  assert.ok(card.textContent.includes(hostile));
  assert.equal(card.querySelector('tbody tr').dataset.provisionId, '90071992547409931');
});

test('formato incompleto, valores inválidos, provisões duplicadas ou linhas ambíguas mantêm texto completo', t => {
  for (const message of [
    summary([]), summary(['PROVISÃO 347 — BRITA 01 — QTD 6 — TOTAL PENDENTE']),
    summary(['PROVISÃO 347 — BRITA 01 — QTD 6 — TOTAL R$ 1,2']),
    summary(['PROVISÃO 347 — BRITA 01 — QTD 6 — TOTAL R$ 769,00', 'PROVISÃO 347 — OUTRA — QTD 1 — TOTAL R$ 1,00']),
    summary(['PROVISÃO 347 — BRITA 01 — QTD 6 — TOTAL R$ 769,00', 'PROVISÃO INCOMPLETA']),
    { ...summary(), question: summary().question.replace(suffix, 'ATENÇÃO: PAGAMENTO BLOQUEADO.') },
    { ...summary(), question: summary().question.replace('DESCRITIVO 30', 'OUTRO RESUMO') },
  ]) {
    const document = render(t, message);
    assert.equal(document.querySelector('[data-provision-launch-summary]'), null);
    for (const line of message.question.split('\n')) assert.ok(document.body.textContent.includes(line));
  }
});

test('Sim e Não mantêm replies, opções desabilitadas e bloqueio durante envio', t => {
  const dom = new JSDOM('<main id="app"></main>'), root = dom.window.document.querySelector('#app');
  const view = createChatView(root), message = summary(), replies = [];
  t.after(() => { view.destroy(); dom.window.close(); });
  view.on('select-reply', event => replies.push(event.replyId));
  view.render(state(message));
  assert.ok(root.querySelector('[data-provision-launch-summary]'));
  root.querySelector('[data-reply-id="choice:submeter_lancamentos:1"]').click();
  root.querySelector('[data-reply-id="choice:submeter_lancamentos:2"]').click();
  assert.deepEqual(replies, ['choice:submeter_lancamentos:1', 'choice:submeter_lancamentos:2']);
  view.render(state(message, { activeText: { id: 'synthetic-request' } }));
  assert.ok([...root.querySelectorAll('[data-action="select-reply"]')].every(button => button.disabled));
  const disabled = structuredClone(message);
  disabled.options[0].disabled = true;
  view.render(state(disabled));
  assert.equal(root.querySelector('[data-reply-id="choice:submeter_lancamentos:1"]').disabled, true);
  assert.equal(root.querySelector('[data-reply-id="choice:submeter_lancamentos:2"]').disabled, false);
});
