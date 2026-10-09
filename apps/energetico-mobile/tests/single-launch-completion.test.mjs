import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderChatMarkup } from '../src/ui/chat-view.js';
import { createConversationStore } from '../src/chat/conversation-store.js';

const confirmation = `✅ *🟢 LANÇAMENTO GRAVADO NA BASE DE DADOS LANCAMENTOS ÀS 17:16.* 🕒
🆔 *REGISTROS CONFIRMADOS:*
• *LANÇAMENTO:* ID 3551
• *PEDIDO:* ID 390
💰 *VALOR TOTAL DOS LANÇAMENTOS: R$ 746,00*`;

function documentFor(message, rest = {}) {
  return new JSDOM(renderChatMarkup({
    sessionStatus: 'authenticated', account: { name: 'Bernardo' }, draft: '',
    pendingFiles: [], attachments: [], messages: [{ role: 'assistant', type: 'text', text: confirmation, ...message }],
    activeText: null, error: null, ...rest,
  })).window.document;
}

test('confirmed single launch renders the reference success card with exact source IDs, amount and time', () => {
  const doc = documentFor({});
  const card = doc.querySelector('.launch-completion');
  assert.ok(card);
  assert.equal(card.querySelector('h2').textContent, 'LANÇAMENTO GRAVADO!');
  assert.match(card.textContent, /Os dados foram registrados com sucesso na base de dados LANCAMENTOS às 17:16\./);
  assert.deepEqual([...card.querySelectorAll('dt')].map(el => el.textContent.trim()), ['LANÇAMENTO', 'PEDIDO', 'VALOR TOTAL DOS LANÇAMENTOS']);
  assert.deepEqual([...card.querySelectorAll('dd')].map(el => el.textContent.trim()), ['ID 3551', 'ID 390', 'R$ 746,00']);
  assert.equal(card.querySelector('footer').textContent.trim(), 'Registrado às 17:16');
  assert.equal(card.querySelectorAll('button, input, [data-action]').length, 0);
  assert.ok(doc.querySelector('.launch-completion-sender').textContent.includes('Energético'));
});

test('the receipt does not invent an order, date or a recalculated total', () => {
  const text = confirmation.replace('• *PEDIDO:* ID 390\n', '').replace('R$ 746,00', 'R$ 0,00');
  const card = documentFor({ text }).querySelector('.launch-completion');
  assert.ok(card);
  assert.deepEqual([...card.querySelectorAll('dd')].map(el => el.textContent.trim()), ['ID 3551', 'R$ 0,00']);
  assert.doesNotMatch(card.querySelector('footer').textContent, /\d{2}\/\d{2}\/\d{4}/);
});

test('the worker notice also renders without Markdown around the identifier labels', () => {
  assert.ok(documentFor({ text: confirmation.replaceAll('*', '') }).querySelector('.launch-completion'));
});

test('structured auxiliary information is not hidden behind a receipt', () => {
  const doc = documentFor({ presenceDateSummary: { count: 1, date: '2026-10-09' } });
  assert.equal(doc.querySelector('.launch-completion'), null);
  assert.match(doc.querySelector('.chat-bubble').textContent, /REGISTROS CONFIRMADOS/);
  assert.match(doc.querySelector('.chat-presence-date-summary').textContent, /09\/10\/2026/);
  assert.match(doc.querySelector('.chat-presence-date-summary').textContent, /1 presença\(s\) pendente\(s\)/);
});

test('receipt source is preserved on re-render, including large IDs and currency', () => {
  const message = Object.freeze({ text: confirmation.replace('3551', '9007199254740993').replace('R$ 746,00', 'R$ 1.234.567,89') });
  const first = documentFor(message).querySelector('.launch-completion').outerHTML;
  assert.equal(documentFor(message).querySelector('.launch-completion').outerHTML, first);
  assert.match(first, /ID 9007199254740993/);
  assert.match(first, /R\$ 1\.234\.567,89/);
});

for (const [name, message] of [
  ['user text', { role: 'user' }],
  ['multiple launch notice', { text: confirmation.replace('LANÇAMENTO GRAVADO', '2 LANÇAMENTOS GRAVADOS') }],
  ['one-row multiple launch', { launchCompletionMode: 'multiple' }],
  ['unconfirmed write', { text: confirmation.replace('GRAVADO', 'NÃO GRAVADO') }],
  ['provision notice', { text: confirmation.replace('LANÇAMENTO GRAVADO', 'PROVISÃO DE PAGAMENTO GRAVADA') }],
  ['missing launch ID', { text: confirmation.replace('• *LANÇAMENTO:* ID 3551\n', '') }],
  ['several launch IDs', { text: confirmation.replace('ID 3551', 'IDs 3551, 3552') }],
  ['missing amount', { text: confirmation.split('\n').slice(0, -1).join('\n') }],
  ['invalid time', { text: confirmation.replace('17:16', '25:16') }],
  ['extra error must remain visible', { text: confirmation + '\n❌ Não foi possível gravar outro item.' }],
  ['markup in value', { text: confirmation.replace('746,00', '<img src=x onerror=alert(1)>') }],
]) {
  test(`only confirmed single receipts are formatted: ${name}`, () => {
    const doc = documentFor(message);
    assert.equal(doc.querySelector('.launch-completion'), null);
    const original = message.text || confirmation;
    assert.ok(doc.querySelector('.chat-bubble').textContent.includes((message.role === 'user' ? original : original.replaceAll('*', '')).split('\n')[0].trim()));
    assert.equal(doc.querySelector('img[src="x"]'), null);
    if (name === 'extra error must remain visible') assert.match(doc.querySelector('.chat-bubble').textContent, /Não foi possível gravar outro item\./);
  });
}

test('a one-row multiple flow keeps its original confirmation after the flow ends', () => {
  const store = createConversationStore();
  store.ingestRemoteMessages([], { activeFlow: { id: 'launch', title: 'EFETUAR LANÇAMENTO', rows: [{ label: 'MODALIDADE', value: 'LANÇAMENTO MÚLTIPLO' }] } });
  const op = store.beginText('Submeter');
  store.confirmText(op, { activeFlow: null, results: [{ status: 'completed' }], messages: [{ text: confirmation }] });
  const message = store.getState().messages.find(item => item.role === 'assistant');
  assert.equal(documentFor(message).querySelector('.launch-completion'), null);
  assert.equal(store.getState().activeFlow, null);
});

test('a normal single flow formats its confirmation after the flow ends', () => {
  const store = createConversationStore();
  store.ingestRemoteMessages([], { activeFlow: { id: 'launch', title: 'EFETUAR LANÇAMENTO', rows: [{ label: 'MODALIDADE', value: 'LANÇAMENTO ÚNICO' }] } });
  const op = store.beginText('Submeter');
  store.confirmText(op, { activeFlow: null, messages: [{ text: confirmation }] });
  assert.ok(documentFor(store.getState().messages.find(item => item.role === 'assistant')).querySelector('.launch-completion'));
});
