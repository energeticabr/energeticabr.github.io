import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderChatMarkup } from '../src/ui/chat-view.js';

function documentFor(text, metadata = {}) {
  return new JSDOM(renderChatMarkup({ sessionStatus: 'authenticated', account: { name: 'Bernardo' },
    draft: '', pendingFiles: [], attachments: [], activeFlow: null,
    messages: [{ role: 'assistant', type: 'text', text, ...metadata }],
  })).window.document;
}

const multiple = `✅ *🟢 2 LANÇAMENTOS GRAVADOS NA BASE DE DADOS LANCAMENTOS ÀS 17:16.* 🕒
🆔 *REGISTROS CONFIRMADOS:*
• LANÇAMENTOS: IDS 3551, 3552
• PEDIDO: ID 390
💰 *VALOR TOTAL DOS LANÇAMENTOS: R$ 1.492,00*`;

const settlement = `✅ *🟢 PAGAMENTO AGENDADO BAIXADO NA BASE DE DADOS PROVISÃO PGTOS ÀS 06:18.* 🕒
🆔 *REGISTROS CONFIRMADOS:*
• PROVISÃO DE PAGAMENTO: ID 308
• PEDIDO: ID 403
• LANÇAMENTO: ID 3567`;

test('provision settlement uses the new confirmation layout with all three source IDs and time', () => {
  const doc = documentFor(settlement);
  const card = doc.querySelector('.launch-completion');
  assert.ok(card, 'the confirmed settlement must not fall back to a plain paragraph');
  assert.equal(card.querySelector('h2').textContent, 'PAGAMENTO AGENDADO');
  assert.equal(card.querySelector('.launch-completion__success p').textContent, 'Baixado na base de dados');
  assert.match(card.querySelector('.launch-completion__operation').textContent, /PROVISÃO PGTOS\s+ÀS 06:18/);
  assert.deepEqual([...card.querySelectorAll('dt')].map(el => el.textContent.trim()), ['PROVISÃO DE PAGAMENTO', 'PEDIDO', 'LANÇAMENTO']);
  assert.deepEqual([...card.querySelectorAll('dd')].map(el => el.textContent.trim()), ['ID 308', 'ID 403', 'ID 3567']);
  assert.equal(card.querySelector('footer').textContent.trim(), 'Processo concluído com sucesso!');
  assert.doesNotMatch(card.textContent, /R\$|\d{2}\/\d{2}\/\d{4}/);
  assert.equal(card.querySelectorAll('button, input, [data-action]').length, 0);
});

test('settlement receipt is independent of an ended flow and preserves notes, attachments and large IDs', () => {
  const text = settlement.replace('PROVISÃO PGTOS', 'PROVISAO PGTOS').replace('ID 308', 'ID 9007199254740993') + '\n📎 Comprovante: recibo.pdf\n⚠️ Anexo adicional pendente de envio.';
  const attachments = Object.freeze([Object.freeze({ id: 'receipt', name: 'recibo.pdf' })]);
  const metadata = Object.freeze({ attachments });
  const card = documentFor(text, metadata).querySelector('.launch-completion');
  assert.ok(card);
  assert.deepEqual([...card.querySelectorAll('dd')].map(el => el.textContent.trim()), ['ID 9007199254740993', 'ID 403', 'ID 3567']);
  assert.match(card.querySelector('.launch-completion__details').textContent, /Comprovante: recibo.pdf/);
  assert.match(card.querySelector('.launch-completion__details').textContent, /Anexo adicional pendente de envio/);
  assert.deepEqual(metadata.attachments, attachments);
});

for (const [name, text] of [
  ['negative result', settlement.replace('BAIXADO', 'NÃO BAIXADO')],
  ['partial failure', settlement + '\n❌ Falha ao gravar o lançamento.'],
  ['missing identifiers', settlement.split('\n').slice(0, 2).join('\n')],
  ['invalid identifier', settlement.replace('ID 308', 'ID 0')],
  ['invalid time', settlement.replace('06:18', '26:18')],
  ['missing provision record', settlement.replace('\n• PROVISÃO DE PAGAMENTO: ID 308', '')],
  ['missing order record', settlement.replace('\n• PEDIDO: ID 403', '')],
  ['missing launch record', settlement.replace('\n• LANÇAMENTO: ID 3567', '')],
  ['unrelated confirmed record', settlement.split('\n').slice(0, 2).join('\n') + '\n• DOCUMENTO: ID 601'],
]) {
  test(`unconfirmed provision settlement stays plain and visible: ${name}`, () => {
    const doc = documentFor(text);
    assert.equal(doc.querySelector('.launch-completion'), null);
    assert.ok(doc.querySelector('.chat-bubble').textContent.includes(text.replaceAll('*', '').split('\n')[0]));
  });
}

test('multiple posting displays every confirmed ID and the source total in the shared success card', () => {
  const doc = documentFor(multiple, { launchCompletionMode: 'multiple' });
  const card = doc.querySelector('.launch-completion');
  assert.ok(card);
  assert.equal(card.querySelector('h2').textContent, '2 LANÇAMENTOS GRAVADOS!');
  assert.deepEqual([...card.querySelectorAll('dd')].map(el => el.textContent.trim()), ['IDS 3551, 3552', 'ID 390', 'R$ 1.492,00']);
  assert.match(card.textContent, /base de dados LANCAMENTOS às 17:16/);
  assert.equal(card.querySelectorAll('button, input, [data-action]').length, 0);
});

for (const [subject, database, label, value] of [
  ['PROVISÃO DE PAGAMENTO COM 2 LINHAS GRAVADA', 'PROVISAO PGTOS', 'PROVISÕES DE PAGAMENTO', 'IDS 501, 502'],
  ['CADASTRO GRAVADO', 'CADASTRO', 'REGISTRO EM CADASTRO', 'ID 201'],
  ['DOCUMENTO ASSINADO CADASTRADO', 'DOCUMENTOS', 'DOCUMENTO', 'ID 601'],
  ['DIÁRIO DE OBRAS GRAVADO', 'DIARIO DE OBRAS', 'DIÁRIO DE OBRAS', 'ID 701'],
  ['LANÇAMENTO DE RECEITA GRAVADO', 'LANCAMENTORECEITA', 'LANÇAMENTO DE RECEITA', 'ID 801'],
  ['2 PRESENÇAS VINCULADAS', 'DESCRITIVO DE PRESENCA', 'REGISTROS EM DESCRITIVO DE PRESENCA', 'IDS 901, 902'],
  ['ITEM ATUALIZADO', 'IDFOLHA', 'REGISTRO EM IDFOLHA', 'ID 19'],
  ['REGISTRO DE PRESENÇA ELIMINADO', 'DESCRITIVO DE PRESENCA', 'REGISTRO EM DESCRITIVO DE PRESENCA', 'ID 903'],
]) {
  test(`post-save ${database} uses its own subject and database without inventing an amount`, () => {
    const doc = documentFor(`✅ *🟢 ${subject} NA BASE DE DADOS ${database} ÀS 09:42.* 🕒\n🆔 *REGISTROS CONFIRMADOS:*\n• ${label}: ${value}`);
    const card = doc.querySelector('.launch-completion');
    assert.ok(card);
    assert.equal(card.querySelector('h2').textContent, `${subject}!`);
    assert.equal(card.querySelector('dt').textContent.trim(), label);
    assert.equal(card.querySelector('dd').textContent, value);
    assert.match(card.textContent, new RegExp(`base de dados ${database} às 09:42`));
    assert.equal(card.querySelector('footer').textContent.trim(), 'Registrado às 09:42');
    assert.doesNotMatch(card.textContent, /R\$|\d{2}\/\d{2}\/\d{4}/);
  });
}

test('other record types, amounts and ancillary notes remain visible without rounding or HTML injection', () => {
  const text = multiple.replace('• PEDIDO: ID 390', '• PEDIDOS: IDS 390, 391\n• DOCUMENTO: ID 9007199254740993')
    + '\n💰 TOTAL PAGO: R$ 0,00\n📎 Anexos: 2\nFornecedor: A & B <img src=x onerror=alert(1)>\nConsulte https://example.com/documento/601';
  const doc = documentFor(text);
  const card = doc.querySelector('.launch-completion');
  assert.ok(card);
  assert.deepEqual([...card.querySelectorAll('dd')].map(el => el.textContent.trim()), ['IDS 3551, 3552', 'IDS 390, 391', 'ID 9007199254740993', 'R$ 1.492,00', 'R$ 0,00']);
  assert.match(card.textContent, /Anexos: 2/);
  assert.ok(card.textContent.includes('Fornecedor: A & B <img src=x onerror=alert(1)>'));
  assert.ok(card.textContent.includes('https://example.com/documento/601'));
  assert.equal(doc.querySelector('img[src="x"]'), null);
});

test('a heading without confirmed IDs does not turn a progress message into a receipt', () => {
  const doc = documentFor('✅ CADASTRO GRAVADO NA BASE DE DADOS CADASTRO ÀS 09:42.');
  assert.equal(doc.querySelector('.launch-completion'), null);
  assert.match(doc.querySelector('.chat-bubble').textContent, /CADASTRO GRAVADO/);
});

test('warning IDs and amounts stay notes rather than being presented as confirmed records', () => {
  const doc = documentFor(multiple + '\n⚠️ Anexo pendente: ID 88\n⚠️ Valor não confirmado: R$ 99,00\nArquivo em análise: ID 89\n• ⚠️ Anexo pendente: ID 90\nValor em análise: R$ 98,00');
  const card = doc.querySelector('.launch-completion');
  assert.deepEqual([...card.querySelectorAll('dd')].map(el => el.textContent.trim()), ['IDS 3551, 3552', 'ID 390', 'R$ 1.492,00']);
  assert.match(card.querySelector('.launch-completion__details').textContent, /⚠️ Anexo pendente: ID 88/);
  assert.match(card.querySelector('.launch-completion__details').textContent, /⚠️ Valor não confirmado: R\$ 99,00/);
  assert.match(card.querySelector('.launch-completion__details').textContent, /Arquivo em análise: ID 89/);
  assert.match(card.querySelector('.launch-completion__details').textContent, /• ⚠️ Anexo pendente: ID 90/);
  assert.match(card.querySelector('.launch-completion__details').textContent, /Valor em análise: R\$ 98,00/);
});

for (const text of [
  multiple.replace('GRAVADOS', 'NÃO GRAVADOS'),
  multiple.replace('GRAVADOS', 'NÃO ATUALIZADOS'),
  multiple.replace('GRAVADOS', 'NÃO VINCULADOS'),
  multiple + '\n❌ Falha ao enviar o comprovante.',
  multiple.replace('IDS 3551, 3552', 'IDS 3551, inválido'),
  multiple.replace('R$ 1.492,00', 'R$ inválido'),
]) {
  test(`malformed or partial confirmation stays visible as original text: ${text.split('\n').at(-1)}`, () => {
    const doc = documentFor(text);
    assert.equal(doc.querySelector('.launch-completion'), null);
    assert.ok(doc.querySelector('.chat-bubble').textContent.includes(text.replaceAll('*', '').split('\n')[0]));
  });
}

test('success card projection never mutates the source message or attachments', () => {
  const attachment = Object.freeze({ id: 'receipt', name: 'recibo.pdf' });
  const message = Object.freeze({ attachments: Object.freeze([attachment]) });
  const first = documentFor(multiple, message).querySelector('.chat-bubble').outerHTML;
  assert.equal(documentFor(multiple, message).querySelector('.chat-bubble').outerHTML, first);
  assert.deepEqual(message.attachments, [attachment]);
});
