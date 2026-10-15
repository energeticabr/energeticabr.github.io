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

const descriptionSettlement = `✅ *🟢 PAGAMENTO AGENDADO BAIXADO NA BASE DE DADOS DESCRITIVOPROVISAO ÀS 00:09.* 🕒
🆔 *REGISTROS CONFIRMADOS:*
• DESCRITIVO DE PROVISÃO: ID 12
• PROVISÃO DE PAGAMENTO: ID 325
• PEDIDO: ID 406
• LANÇAMENTO: ID 3570`;

const orderAttachments = `✅ 🟢 ANEXOS DO PEDIDO ADICIONADOS NA BASE DE DADOS NOTASPENDENTES ÀS 00:13. 🕒
🆔 REGISTROS CONFIRMADOS:
• PEDIDO: ID 406`;

const diaryCompletion = `✅ 🟢 DIÁRIO DE OBRA PREENCHIDO NA BASE DE DADOS DIÁRIO DE OBRAS ÀS 23:29. 🕒
🆔 REGISTROS CONFIRMADOS:
• DIÁRIO DE OBRAS: ID 214`;

const recurringCompletion = `✅ 🟢 DESPESA RECORRENTE CRIADA NA BASE DE DADOS LOCACOES ÀS 21:18. 🕒
🆔 REGISTROS CONFIRMADOS:
• REGISTRO EM LOCACOES: ID 37`;

test('recurring expense creation uses the shared success receipt instead of old text', () => {
  const doc = documentFor(recurringCompletion);
  const card = doc.querySelector('.launch-completion');
  assert.ok(card);
  assert.equal(card.querySelector('h2').textContent, 'DESPESA RECORRENTE CRIADA!');
  assert.deepEqual([...card.querySelectorAll('dt')].map(el => el.textContent.trim()), ['REGISTRO EM LOCACOES']);
  assert.deepEqual([...card.querySelectorAll('dd')].map(el => el.textContent.trim()), ['ID 37']);
  assert.match(card.textContent, /base de dados LOCACOES às 21:18/);
});

test('batch attendance confirmation uses a compact success card without repeating IDs', () => {
  const doc = documentFor('✅ 8 CADASTROS ALTERADOS COM SUCESSO.\n🆔 REGISTROS CONFIRMADOS:\n• PRESENÇAS: IDS 2246, 2247, 2248');
  const card = doc.querySelector('.launch-completion--attendance-batch');
  assert.ok(card);
  assert.equal(card.querySelector('h2').textContent, '8 CADASTROS ALTERADOS COM SUCESSO');
  assert.doesNotMatch(card.textContent, /2246|2247|2248|REGISTROS CONFIRMADOS/);
});

for (const text of [
  '✅ 8 CADASTROS ALTERADOS COM SUCESSO.\n🆔 REGISTROS CONFIRMADOS:\n• PRESENÇAS: IDS 0, 2247',
  '✅ 8 CADASTROS ALTERADOS COM SUCESSO.\n🆔 REGISTROS CONFIRMADOS:\n• PRESENÇAS: IDS 2246, 2247\n⚠️ Uma presença pendente',
]) {
  test('uncertain attendance batch remains visible instead of claiming compact success', () => {
    const doc = documentFor(text);
    assert.equal(doc.querySelector('.launch-completion'), null);
    assert.match(doc.querySelector('.chat-bubble').textContent, /CADASTROS ALTERADOS COM SUCESSO/);
    if (text.includes('pendente')) assert.match(doc.querySelector('.chat-bubble').textContent, /Uma presença pendente/);
  });
}

for (const text of [
  recurringCompletion.replace('ID 37', 'ID 0'),
  recurringCompletion.replace('21:18', '25:18'),
  recurringCompletion + '\n❌ Falha ao registrar outra despesa.',
]) {
  test('unconfirmed recurring expense stays visible as text', () => {
    const doc = documentFor(text);
    assert.equal(doc.querySelector('.launch-completion'), null);
    assert.match(doc.querySelector('.chat-bubble').textContent, /DESPESA RECORRENTE CRIADA/);
  });
}

test('diary completion uses the branded success receipt with the confirmed ID and source time', () => {
  const doc = documentFor(diaryCompletion);
  const card = doc.querySelector('.launch-completion--diary');
  assert.ok(card, 'the diary notice must use the shared branded receipt');
  assert.equal(card.querySelector('.launch-completion-sender strong').textContent, 'Energético');
  assert.equal(card.querySelector('.launch-completion-sender time').textContent, '23:29');
  assert.equal(card.querySelector('.launch-completion-sender img').getAttribute('alt'), 'Mascote Energético');
  assert.equal(doc.querySelector('.chat-message--launch-completion > .chat-avatar'), null);
  assert.equal(card.querySelector('h2').textContent, 'DIÁRIO DE OBRA PREENCHIDO');
  assert.equal(card.querySelector('.launch-completion__success p').textContent, 'Registrado na base de dados');
  assert.match(card.querySelector('.launch-completion__operation').textContent, /DIÁRIO DE OBRAS\s+ÀS 23:29/);
  assert.deepEqual([...card.querySelectorAll('dt')].map(el => el.textContent.trim()), ['DIÁRIO DE OBRAS']);
  assert.deepEqual([...card.querySelectorAll('dd')].map(el => el.textContent.trim()), ['ID 214']);
  assert.equal(card.querySelector('footer').textContent.trim(), 'Processo concluído com sucesso!');
  assert.equal(card.querySelectorAll('button, input, [data-action]').length, 0);
});

for (const text of [
  diaryCompletion.replace('ID 214', 'ID 0'),
  diaryCompletion.replace('23:29', '25:29'),
  diaryCompletion.replace('NA BASE DE DADOS DIÁRIO DE OBRAS', 'NA BASE DE DADOS OUTRA BASE'),
  diaryCompletion.replace('DIÁRIO DE OBRAS: ID 214', 'DOCUMENTO: ID 214'),
  diaryCompletion + '\n❌ Falha ao gravar outro diário.',
]) {
  test(`unconfirmed diary completion remains plain text: ${text.split('\n').at(-1)}`, () => {
    const doc = documentFor(text);
    assert.equal(doc.querySelector('.launch-completion'), null);
    assert.match(doc.querySelector('.chat-bubble').textContent, /DIÁRIO DE OBRA PREENCHIDO/);
  });
}

test('order attachments confirmation uses the branded success card with the actual order and source time', () => {
  const doc = documentFor(orderAttachments);
  const card = doc.querySelector('.launch-completion--order-attachments');
  assert.ok(card, 'the attachment notice must use the shared receipt, not a plain paragraph');
  assert.equal(card.querySelector('h2').textContent, 'ANEXOS DO PEDIDO');
  assert.equal(card.querySelector('.launch-completion__success p').textContent, 'Adicionados na base de dados');
  assert.match(card.querySelector('.launch-completion__operation').textContent, /NOTASPENDENTES\s+ÀS 00:13/);
  assert.equal(card.querySelector('.launch-completion-sender strong').textContent, 'Energético');
  assert.equal(card.querySelector('.launch-completion-sender time').textContent, '00:13');
  assert.equal(card.querySelector('.launch-completion-sender img').getAttribute('alt'), 'Mascote Energético');
  assert.equal(doc.querySelector('.chat-message--launch-completion > .chat-avatar'), null);
  assert.equal(doc.querySelectorAll('.launch-completion-sender').length, 1);
  assert.deepEqual([...card.querySelectorAll('dt')].map(el => el.textContent.trim()), ['PEDIDO']);
  assert.deepEqual([...card.querySelectorAll('dd')].map(el => el.textContent.trim()), ['ID 406']);
  assert.equal(card.querySelector('footer').textContent.trim(), 'Processo concluído com sucesso!');
  assert.doesNotMatch(card.textContent, /R\$|\d{2}\/\d{2}\/\d{4}|\d+ anexos/i);
  assert.equal(card.querySelectorAll('button, input, [data-action]').length, 0);
});

test('order attachments receipt keeps each order ID, filename notes and immutable metadata without losing precision', () => {
  const text = orderAttachments.replace('• PEDIDO: ID 406', '• PEDIDOS: IDS 406, 9007199254740993')
    + '\n📎 Comprovante: comprovante-pendente.pdf\n📎 Anexos enviados: 2\nArquivo: A & B <img src=x onerror=alert(1)>';
  const attachment = Object.freeze({ id: 'receipt', name: 'comprovante-pendente.pdf' });
  const metadata = Object.freeze({ attachments: Object.freeze([attachment]) });
  const card = documentFor(text, metadata).querySelector('.launch-completion--order-attachments');
  assert.ok(card);
  assert.deepEqual([...card.querySelectorAll('dt')].map(el => el.textContent.trim()), ['PEDIDO', 'PEDIDO']);
  assert.deepEqual([...card.querySelectorAll('dd')].map(el => el.textContent.trim()), ['ID 406', 'ID 9007199254740993']);
  assert.match(card.querySelector('.launch-completion__details').textContent, /comprovante-pendente\.pdf/);
  assert.match(card.querySelector('.launch-completion__details').textContent, /Anexos enviados: 2/);
  assert.ok(card.textContent.includes('Arquivo: A & B <img src=x onerror=alert(1)>'));
  assert.equal(card.querySelector('img[src="x"]'), null);
  assert.equal(documentFor(text, metadata).querySelector('.launch-completion').outerHTML, card.outerHTML);
  assert.deepEqual(metadata.attachments, [attachment]);
});

for (const filename of ['pedido-pendente.pdf', 'pedido-incompleto.pdf', 'provisao-parcial.pdf', 'pedido pendente de aprovação.pdf', 'comprovante parcial assinado.pdf', 'pedido não enviado.pdf']) {
  test(`a filename is an opaque attachment note, not an incomplete posting status: ${filename}`, () => {
    const card = documentFor(orderAttachments + '\n📎 Comprovante: ' + filename).querySelector('.launch-completion--order-attachments');
    assert.ok(card);
    assert.equal(card.querySelector('.launch-completion__details').textContent, '📎 Comprovante: ' + filename);
  });
}

for (const [name, text] of [
  ['missing order', orderAttachments.split('\n').slice(0, 2).join('\n')],
  ['unrelated confirmed document', orderAttachments.replace('• PEDIDO: ID 406', '• DOCUMENTO: ID 406')],
  ['invalid order ID', orderAttachments.replace('ID 406', 'ID 0')],
  ['invalid hour', orderAttachments.replace('00:13', '24:13')],
  ['unrelated database', orderAttachments.replace('NOTASPENDENTES', 'DOCUMENTOS')],
  ['unrelated added subject', orderAttachments.replace('ANEXOS DO PEDIDO', 'DOCUMENTOS')],
  ['empty additional order', orderAttachments + '\n• PEDIDO:'],
  ['failed attachment', orderAttachments + '\n❌ Falha ao enviar um anexo.'],
  ['partial confirmation', orderAttachments + '\n⚠️ CONFIRMAÇÃO PARCIAL: um anexo permanece pendente.'],
  ['unconfirmed attachment', orderAttachments + '\n⚠️ Anexo do pedido ID 406 não confirmado.'],
  ['pending attachment', orderAttachments + '\nAnexo adicional pendente de envio.'],
  ['attachment not added', orderAttachments + '\nArquivo não adicionado.'],
  ['attachment not sent', orderAttachments + '\nComprovante não enviado.'],
  ['attachment not linked', orderAttachments + '\nDocumento não anexado.'],
  ['qualified attachment not added', orderAttachments + '\n⚠️ Anexo do pedido ID 406 não adicionado.'],
  ['qualified attachment not sent', orderAttachments + '\n⚠️ Anexo do pedido ID 406 não enviado.'],
  ['qualified attachment not linked', orderAttachments + '\n⚠️ Anexo do pedido ID 406 não anexado.'],
  ['pending attachment with article', orderAttachments + '\n⚠️ O anexo adicional está pendente de envio.'],
  ['incomplete files with plural article', orderAttachments + '\nOs arquivos do pedido ID 406 estão incompletos.'],
  ['unconfirmed proof with indefinite article', orderAttachments + '\nUm comprovante do pedido ID 406 não confirmado.'],
  ['partially completed attachment upload', orderAttachments + '\n⚠️ Envio dos anexos parcialmente concluído.'],
  ['only part of the attachments added', orderAttachments + '\n⚠️ Apenas parte dos anexos foi adicionada.'],
  ['partial upload without warning icon', orderAttachments + '\nEnvio dos anexos parcialmente concluído.'],
  ['only part added without warning icon', orderAttachments + '\nApenas parte dos anexos foi adicionada.'],
  ['warning without a recognized status verb', orderAttachments + '\n⚠️ Existem documentos aguardando processamento.'],
  ['incomplete attachments', orderAttachments + '\nAnexos incompletos.'],
  ['partially added files', orderAttachments + '\nArquivos parcialmente adicionados.'],
  ['negative continuation after filename', orderAttachments + '\n📎 Comprovante: recibo.pdf, não confirmado.'],
  ['pending order after received attachment', orderAttachments + '\n⚠️ Anexo recebido; pedido ID 407 pendente de confirmação.'],
]) {
  test(`incomplete order attachments confirmation stays plain and visible: ${name}`, () => {
    const doc = documentFor(text);
    assert.equal(doc.querySelector('.launch-completion'), null);
    for (const line of text.replaceAll('*', '').split('\n')) assert.ok(doc.querySelector('.chat-bubble').textContent.includes(line), line);
  });
}

test('order attachment wording in a user message or structured response is not a write receipt', () => {
  for (const metadata of [{ role: 'user' }, { presence_confirmation: { rows: [] } }]) {
    assert.equal(documentFor(orderAttachments, metadata).querySelector('.launch-completion'), null);
  }
});

test('description settlement renders the shared green receipt with its parent and every confirmed child', () => {
  const card = documentFor(descriptionSettlement).querySelector('.launch-completion--provision-settlement');
  assert.ok(card, 'the parent-model notice must use the same receipt as provision settlements');
  assert.equal(card.querySelector('h2').textContent, 'PAGAMENTO AGENDADO');
  assert.equal(card.querySelector('.launch-completion__success p').textContent, 'Baixado na base de dados');
  assert.match(card.querySelector('.launch-completion__operation').textContent, /DESCRITIVOPROVISAO\s+ÀS 00:09/);
  assert.deepEqual([...card.querySelectorAll('dt')].map(el => el.textContent.trim()), ['DESCRITIVO DE PROVISÃO', 'PROVISÃO DE PAGAMENTO', 'PEDIDO', 'LANÇAMENTO']);
  assert.deepEqual([...card.querySelectorAll('dd')].map(el => el.textContent.trim()), ['ID 12', 'ID 325', 'ID 406', 'ID 3570']);
  assert.equal(card.querySelector('footer').textContent.trim(), 'Processo concluído com sucesso!');
  assert.doesNotMatch(card.textContent, /R\$|\d{2}\/\d{2}\/\d{4}/);
  assert.equal(card.querySelectorAll('button, input, [data-action]').length, 0);
});

test('description settlement presents each ID separately when several provisions, orders and launches were confirmed', () => {
  const text = descriptionSettlement.replace('• PROVISÃO DE PAGAMENTO: ID 325', '• PROVISÕES DE PAGAMENTO: IDS 325, 326')
    .replace('• PEDIDO: ID 406', '• PEDIDOS: IDS 406, 407')
    .replace('• LANÇAMENTO: ID 3570', '• LANÇAMENTOS: IDS 3570, 9007199254740993');
  const card = documentFor(text).querySelector('.launch-completion');
  assert.ok(card);
  assert.deepEqual([...card.querySelectorAll('dt')].map(el => el.textContent.trim()), ['DESCRITIVO DE PROVISÃO', 'PROVISÃO DE PAGAMENTO', 'PROVISÃO DE PAGAMENTO', 'PEDIDO', 'PEDIDO', 'LANÇAMENTO', 'LANÇAMENTO']);
  assert.deepEqual([...card.querySelectorAll('dd')].map(el => el.textContent.trim()), ['ID 12', 'ID 325', 'ID 326', 'ID 406', 'ID 407', 'ID 3570', 'ID 9007199254740993']);
});

test('description settlement without optional orders or launches does not invent those records', () => {
  const text = descriptionSettlement.split('\n').slice(0, 4).join('\n');
  const card = documentFor(text).querySelector('.launch-completion');
  assert.ok(card, 'a confirmed parent and provision is valid when no order or launch was requested');
  assert.deepEqual([...card.querySelectorAll('dd')].map(el => el.textContent.trim()), ['ID 12', 'ID 325']);
  assert.equal(card.querySelectorAll('.launch-completion__row').length, 2);
});

test('description receipt preserves supplementary notes and immutable attachment metadata on re-render', () => {
  const metadata = Object.freeze({ attachments: Object.freeze([Object.freeze({ id: 'receipt', name: 'recibo.pdf' })]) });
  const text = descriptionSettlement + '\n📎 Comprovante: recibo.pdf\n⚠️ Anexo adicional pendente: ID 88';
  const first = documentFor(text, metadata).querySelector('.launch-completion');
  assert.ok(first);
  assert.deepEqual([...first.querySelectorAll('dd')].map(el => el.textContent.trim()), ['ID 12', 'ID 325', 'ID 406', 'ID 3570']);
  assert.match(first.querySelector('.launch-completion__details').textContent, /Anexo adicional pendente: ID 88/);
  assert.equal(documentFor(text, metadata).querySelector('.launch-completion').outerHTML, first.outerHTML);
  assert.equal(metadata.attachments[0].id, 'receipt');
});

for (const [name, text] of [
  ['missing parent', descriptionSettlement.replace('\n• DESCRITIVO DE PROVISÃO: ID 12', '')],
  ['missing child', descriptionSettlement.replace('\n• PROVISÃO DE PAGAMENTO: ID 325', '')],
  ['invalid parent ID', descriptionSettlement.replace('ID 12', 'ID 0')],
  ['partial child failure', descriptionSettlement + '\n❌ Falha ao baixar uma provisão vinculada.'],
  ['unconfirmed settlement', descriptionSettlement.replace('BAIXADO', 'NÃO BAIXADO')],
  ['unrelated database', descriptionSettlement.replace('DESCRITIVOPROVISAO', 'DOCUMENTOS')],
  ['explicit partial confirmation', descriptionSettlement + '\n⚠️ CONFIRMAÇÃO PARCIAL: uma provisão vinculada permanece pendente.'],
  ['unconfirmed additional provision', descriptionSettlement + '\n⚠️ Provisão ID 327 não confirmada.'],
  ['pending provision without failure emoji', descriptionSettlement + '\nProvisão ID 327 ainda pendente de baixa.'],
  ['empty optional order', descriptionSettlement.split('\n').slice(0, 4).join('\n') + '\n• PEDIDO:'],
  ['empty optional launch', descriptionSettlement.split('\n').slice(0, 4).join('\n') + '\n• LANÇAMENTO:'],
  ['unconfirmed optional launch', descriptionSettlement.split('\n').slice(0, 4).join('\n') + '\n• LANÇAMENTO: NÃO CONFIRMADO'],
  ['mixed attachment and pending provision', descriptionSettlement + '\n⚠️ Anexo pendente; provisão ID 327 ainda pendente de baixa.'],
  ['mixed attachment and pending provision in separate sentences', descriptionSettlement + '\n⚠️ Anexo recebido. Provisão ID 327 pendente de baixa.'],
  ['mixed attachment and pending provision after comma', descriptionSettlement + '\n⚠️ Anexo recebido, provisão ID 327 pendente de baixa.'],
  ['mixed attachment and pending provision after conjunction', descriptionSettlement + '\n⚠️ Anexo pendente e a provisão ID 327 ainda pendente de baixa.'],
  ['plural failures', descriptionSettlement + '\nOcorreram falhas ao baixar outras provisões.'],
]) {
  test(`unconfirmed description settlement stays plain and visible: ${name}`, () => {
    const doc = documentFor(text);
    assert.equal(doc.querySelector('.launch-completion'), null);
    assert.ok(doc.querySelector('.chat-bubble').textContent.includes(text.replaceAll('*', '').split('\n')[0]));
  });
}

for (const notice of [
  '📎 Anexo da provisão ID 308 não confirmado.',
  'AVISO: Anexo da provisão ID 308 pendente de envio.',
  '⚠️ Anexo da provisão ID 308 pendente de envio.',
]) {
  test(`attachment-only notice stays supplementary without changing confirmed financial records: ${notice}`, () => {
    for (const text of [settlement, descriptionSettlement]) {
      const card = documentFor(text + '\n' + notice).querySelector('.launch-completion');
      assert.ok(card, 'an attachment warning must not negate the confirmed settlement');
      assert.ok(card.querySelector('.launch-completion__details').textContent.includes(notice));
      assert.equal(card.querySelector('footer').textContent.trim(), 'Processo concluído com sucesso!');
    }
  });
}

test('settlement receipt keeps its sender and mascot inside the white card as in the posting reference', () => {
  const card = documentFor(settlement).querySelector('.launch-completion');
  const sender = card.querySelector('.launch-completion-sender');
  assert.ok(sender, 'the sender header must belong to the success card');
  assert.equal(sender.querySelector('strong').textContent, 'Energético');
  assert.equal(sender.querySelector('time').textContent, '06:18');
  assert.equal(sender.querySelector('img').getAttribute('alt'), 'Mascote Energético');
});

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
