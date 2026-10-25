import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatView, renderChatMarkup } from '../src/ui/chat-view.js';
import { reviewTable, reviewMessage, reviewState } from './helpers/provision-settlement-review-fixture.mjs';

function render(t, table = reviewTable(), overrides = {}) {
  const message = reviewMessage(table);
  const original = structuredClone(message);
  Object.freeze(message.options);
  Object.freeze(message);
  const dom = new JSDOM(renderChatMarkup(reviewState(message, overrides)));
  t.after(() => dom.window.close());
  assert.deepEqual(message, original, 'rendering must preserve received message metadata');
  return { document: dom.window.document, message };
}

test('revisão exibe uma tabela de quatro colunas com todas as provisões e total geral na última linha', t => {
  const { document } = render(t);
  const table = document.querySelector('[data-provision-settlement-review] table');
  assert.ok(table, 'o detalhamento deve ser uma tabela semântica');
  assert.deepEqual([...table.querySelectorAll('thead th')].map(cell => cell.textContent.trim()),
    ['PRODUTO', 'QTD', 'VALOR UNITÁRIO', 'VALOR TOTAL']);
  assert.equal(table.querySelectorAll('tbody tr').length, 4);
  assert.deepEqual([...table.querySelectorAll('tbody tr')].map(row => row.dataset.provisionId), ['11', '12', '13', '14']);
  assert.deepEqual([...table.querySelectorAll('tfoot th,tfoot td')].map(cell => cell.textContent.trim()), ['TOTAL GERAL', 'R$ 65,00']);
  assert.equal(table.querySelectorAll('button,input,select').length, 0, 'a revisão é única, não linha a linha');
  assert.doesNotMatch(document.body.textContent, /PRODUTO \| QTD/);
});

test('frete e linhas já baixadas ficam identificados e total pendente não se confunde com total geral', t => {
  const { document } = render(t);
  const root = document.querySelector('[data-provision-settlement-review]');
  assert.ok(root);
  assert.match(root.querySelector('[data-provision-id="11"]').textContent, /Frete.*R\$ 3,00/i);
  assert.match(root.querySelector('[data-provision-id="14"]').textContent, /Já baixada.*consulta/i);
  assert.match(root.textContent, /Total pendente a baixar.*R\$ 60,00/i);
});

test('valores desconhecidos permanecem pendentes e o botão submeter respeita o bloqueio recebido', t => {
  const source = reviewTable();
  source.rows[1] = { ...source.rows[1], quantityDisplay: 'PENDENTE', totalDisplay: 'PENDENTE' };
  const { document } = render(t, { ...source, canSubmit: false, totalDisplay: 'VALOR PENDENTE',
    pendingTotalDisplay: 'VALOR PENDENTE', notice: 'PREENCHA OS VALORES PENDENTES ANTES DE SUBMETER.' });
  const row = document.querySelector('[data-provision-id="12"]');
  assert.ok(row);
  assert.match(row.textContent, /PENDENTE/);
  assert.doesNotMatch(row.textContent, /R\$ 0,00/);
  assert.equal(document.querySelector('[data-reply-id="description_review_submit"]').disabled, true);
  assert.equal(document.querySelector('[data-reply-id="description_review_edit"]').disabled, false);
  assert.match(document.querySelector('[data-provision-settlement-review]').textContent, /PREENCHA OS VALORES PENDENTES/);
});

test('produto e demais dados são texto literal, sem executar HTML ou perder precisão monetária', t => {
  const table = reviewTable();
  const hostile = '<img src=x onerror="alert(1)"><script>bad()</script> & CIMENTO';
  table.rows[0] = { ...table.rows[0], product: hostile, unitPriceDisplay: 'R$ 10,123456789' };
  const { document } = render(t, table);
  const root = document.querySelector('[data-provision-settlement-review]');
  assert.ok(root);
  assert.equal(root.querySelector('script,img,iframe'), null);
  assert.ok(root.textContent.includes(hostile));
  assert.match(root.textContent, /R\$ 10,123456789/);
});

test('metadado inválido ou de outro tipo mantém o resumo textual original', t => {
  for (const table of [null, { kind: 'other', rows: [] }, reviewTable({ rows: null }), reviewTable({ rows: [null] })]) {
    const { document } = render(t, table);
    assert.equal(document.querySelector('[data-provision-settlement-review]'), null);
    assert.match(document.body.textContent, /PRODUTO \| QTD/);
  }
});

test('submeter e editar usam os replies reais do chat e ficam bloqueados durante o envio', t => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root);
  t.after(() => { view.destroy(); dom.window.close(); });
  const replies = [];
  view.on('select-reply', event => replies.push(event.replyId));
  view.render(reviewState());
  root.querySelector('[data-reply-id="description_review_submit"]').click();
  root.querySelector('[data-reply-id="description_review_edit"]').click();
  assert.deepEqual(replies, ['description_review_submit', 'description_review_edit']);
  view.render(reviewState(undefined, { activeText: { id: 'synthetic-request' } }));
  assert.equal(root.querySelector('[data-reply-id="description_review_submit"]').disabled, true);
  assert.equal(root.querySelector('[data-reply-id="description_review_edit"]').disabled, true);
});
