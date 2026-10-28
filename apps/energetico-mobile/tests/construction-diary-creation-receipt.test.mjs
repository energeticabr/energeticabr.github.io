import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { postingCompletion } from '../src/chat/posting-completion.js';
import { renderChatMarkup } from '../src/ui/chat-view.js';

const visit = `✅ *🟢 VISITA EM OBRA APONTADA NA BASE DE DADOS LANCAMENTOS ÀS 23:02.* 🕒
🆔 *REGISTROS CONFIRMADOS:*
• LANÇAMENTO: ID 7001
• PEDIDO: ID 801
• DIÁRIO DE OBRAS: ID 901`;
const creation = `✅ 🟢 DIÁRIO DE OBRAS GRAVADO NA BASE DE DADOS DIARIO DE OBRAS ÀS 09:42. 🕒
🆔 REGISTROS CONFIRMADOS:
• DIÁRIO DE OBRAS: ID 701`;
const images = `✅ 🟢 IMAGENS DO DIÁRIO DE OBRA ADICIONADAS NA BASE DE DADOS DIÁRIO DE OBRAS ÀS 22:36. 🕒
🆔 REGISTROS CONFIRMADOS:
• DIÁRIO DE OBRAS: ID 228`;

function documentFor(t, text, metadata = {}) {
  const dom = new JSDOM(renderChatMarkup({ sessionStatus: 'authenticated', account: { name: 'Teste' },
    draft: '', pendingFiles: [], attachments: [], activeFlow: null,
    messages: [{ role: 'assistant', type: 'text', text, ...metadata }],
  }));
  t.after(() => dom.window.close());
  return dom.window.document;
}

function brandedReceipt(doc, title, time, database, labels, ids, subtitle = 'Registrado na base de dados') {
  const card = doc.querySelector('.launch-completion--diary');
  assert.ok(card, 'a confirmação deve usar o mesmo cartão novo dos diários');
  assert.equal(card.querySelector('h2').textContent, title);
  assert.equal(card.querySelector('.launch-completion-sender strong').textContent, 'Energético');
  assert.equal(card.querySelector('.launch-completion-sender time').textContent, time);
  assert.equal(card.querySelector('.launch-completion-sender img').alt, 'Mascote Energético');
  assert.equal(doc.querySelector('.chat-message--launch-completion > .chat-avatar'), null);
  assert.equal(card.querySelector('.launch-completion__success p').textContent, subtitle);
  assert.equal(card.querySelector('.launch-completion__operation strong').textContent, database);
  assert.equal(card.querySelector('.launch-completion__operation span').textContent, `ÀS ${time}`);
  assert.deepEqual([...card.querySelectorAll('dt')].map(el => el.textContent.trim()), labels);
  assert.deepEqual([...card.querySelectorAll('dd')].map(el => el.textContent.trim()), ids);
  assert.equal(card.querySelector('footer').textContent.trim(), 'Processo concluído com sucesso!');
  assert.equal(card.querySelectorAll('button,input,form,[data-action]').length, 0);
  assert.doesNotMatch(card.textContent, /R\$|\d{2}\/\d{2}\/\d{4}/);
  return card;
}

for (const text of [images, images.replace('DADOS DIÁRIO', 'DADOS DIARIO').replaceAll('\n', '\r\n')
  .replace('✅ 🟢 ', '✅ *🟢 ').replace('. 🕒', '.* 🕒')]) {
  test('imagens confirmadas usam o cartão novo com horário e ID reais do diário', t => {
    const receipt = postingCompletion({ text });
    assert.equal(receipt?.kind, 'diary-images');
    brandedReceipt(documentFor(t, text), 'IMAGENS DO DIÁRIO DE OBRA ADICIONADAS', '22:36',
      text.includes('DADOS DIARIO') ? 'DIARIO DE OBRAS' : 'DIÁRIO DE OBRAS',
      ['DIÁRIO DE OBRAS'], ['ID 228'], 'Adicionadas na base de dados');
  });
}

test('imagens preservam ID grande, notas escapadas e anexos sem reenviar nem alterar metadados', t => {
  const metadata = Object.freeze({ attachments: Object.freeze([Object.freeze({ id: 'qa-photo', name: 'foto-ficticia.jpg' })]) });
  const text = images.replace('ID 228', 'ID 9007199254740993')
    + '\n📎 Arquivo: foto-ficticia.jpg\nObservação: A & B <img src=x onerror=alert(1)>';
  const doc = documentFor(t, text, metadata);
  const card = doc.querySelector('.launch-completion--diary');
  assert.ok(card);
  assert.equal(card.querySelector('dd').textContent, 'ID 9007199254740993');
  assert.match(card.querySelector('.launch-completion__details').textContent, /foto-ficticia\.jpg/);
  assert.ok(card.querySelector('.launch-completion__details').textContent.includes('A & B <img src=x onerror=alert(1)>'));
  assert.equal(doc.querySelector('img[src="x"]'), null);
  assert.equal(card.querySelectorAll('button,input,form,[data-action]').length, 0);
  assert.deepEqual(metadata.attachments, [{ id: 'qa-photo', name: 'foto-ficticia.jpg' }]);
});

for (const [name, text] of [
  ['base errada', images.replace('DADOS DIÁRIO DE OBRAS', 'DADOS DOCUMENTOS')],
  ['sem diário', images.replace('\n• DIÁRIO DE OBRAS: ID 228', '')],
  ['ID inválido', images.replace('ID 228', 'ID inválido')],
  ['ID zero', images.replace('ID 228', 'ID 0')],
  ['ID duplicado', images + '\n• DIÁRIO DE OBRAS: ID 229'],
  ['lista de IDs', images.replace('ID 228', 'IDS 228, 229')],
  ['registro alheio', images + '\n• PEDIDO: ID 229'],
  ['ID vazio', images + '\n• DIÁRIO DE OBRAS:'],
  ['falha parcial', images + '\nImagens parcialmente adicionadas.'],
  ['pendente', images + '\nAs imagens estão pendentes.'],
  ['negativa', images.replace('ADICIONADAS', 'NÃO ADICIONADAS')],
  ['negativa posterior', images + '\nImagens não adicionadas.'],
  ['aviso', images + '\n⚠️ Confira as imagens pendentes.'],
  ['falha', images + '\n❌ Falha ao enviar imagem.'],
  ['adição desconhecida', images.replace('IMAGENS DO DIÁRIO DE OBRA', 'OUTRAS IMAGENS')],
]) {
  test(`imagens sem confirmação integral permanecem em texto: ${name}`, t => {
    assert.equal(postingCompletion({ text }), null);
    const doc = documentFor(t, text);
    assert.equal(doc.querySelector('.launch-completion'), null);
    assert.ok(doc.querySelector('.chat-bubble').textContent.includes(text));
  });
}

for (const text of [visit, visit.replaceAll('*', '').replaceAll('\n', '\r\n')]) {
  test('visita confirmada usa faixa de sucesso, horário e os três registros sem inventar valores', t => {
    assert.equal(postingCompletion({ text }).kind, 'construction-visit');
    brandedReceipt(documentFor(t, text), 'VISITA EM OBRA APONTADA', '23:02', 'LANCAMENTOS',
      ['LANÇAMENTO', 'PEDIDO', 'DIÁRIO DE OBRAS'], ['ID 7001', 'ID 801', 'ID 901']);
  });
}

for (const [text, title, database] of [
  [creation, 'DIÁRIO DE OBRAS GRAVADO', 'DIARIO DE OBRAS'],
  [creation.replace('GRAVADO', 'CRIADO').replace('DADOS DIARIO', 'DADOS DIÁRIO'), 'DIÁRIO DE OBRAS CRIADO', 'DIÁRIO DE OBRAS'],
]) {
  test(`${title} mantém o título real no cartão, sem afirmar preenchimento`, t => {
    assert.equal(postingCompletion({ text }).kind, 'diary-creation');
    const card = brandedReceipt(documentFor(t, text), title, '09:42', database, ['DIÁRIO DE OBRAS'], ['ID 701']);
    assert.doesNotMatch(card.textContent, /PREENCHIDO/);
  });
}

test('IDs grandes ficam literais e IDs iguais em listas distintas não são duplicidade', t => {
  const large = documentFor(t, visit.replace('ID 7001', 'ID 9007199254740993')).querySelector('.launch-completion--diary');
  assert.ok(large); assert.equal(large.querySelector('dd').textContent, 'ID 9007199254740993');
  const same = documentFor(t, visit.replace(/ID (?:7001|801|901)/g, 'ID 42')).querySelector('.launch-completion--diary');
  assert.ok(same); assert.deepEqual([...same.querySelectorAll('dd')].map(el => el.textContent), ['ID 42', 'ID 42', 'ID 42']);
});

test('notas escapadas e metadados congelados são preservados sem alterar os anexos', t => {
  const attachment = Object.freeze({ id: 'qa-document', name: 'recibo-ficticio.pdf' });
  const metadata = Object.freeze({ attachments: Object.freeze([attachment]) });
  const text = visit + '\n📎 Comprovante: recibo-ficticio.pdf\nObservação: A & B <img src=x onerror=alert(1)>';
  const card = documentFor(t, text, metadata).querySelector('.launch-completion--diary');
  assert.ok(card);
  assert.ok(card.querySelector('.launch-completion__details').textContent.includes('A & B <img src=x onerror=alert(1)>'));
  assert.match(card.querySelector('.launch-completion__details').textContent, /recibo-ficticio\.pdf/);
  assert.equal(card.querySelector('img[src="x"]'), null);
  assert.equal(documentFor(t, text, metadata).querySelector('.launch-completion--diary').outerHTML, card.outerHTML);
  assert.deepEqual(metadata.attachments, [attachment]);
});

test('observação negativa sem relação com a gravação e nome de arquivo não anulam sucesso confirmado', t => {
  const card = documentFor(t, visit + '\nObservação: não houve chuva.\n📎 Comprovante: diario-cancelado.pdf')
    .querySelector('.launch-completion--diary');
  assert.ok(card);
  assert.match(card.querySelector('.launch-completion__details').textContent, /não houve chuva/);
  assert.match(card.querySelector('.launch-completion__details').textContent, /diario-cancelado\.pdf/);
});

for (const [name, text] of [
  ['sem diário', visit.replace('\n• DIÁRIO DE OBRAS: ID 901', '')],
  ['sem pedido', visit.replace('\n• PEDIDO: ID 801', '')],
  ['sem lançamento', visit.replace('\n• LANÇAMENTO: ID 7001', '')],
  ['diário duplicado', visit + '\n• DIÁRIO DE OBRAS: ID 902'],
  ['registro alheio', visit + '\n• DOCUMENTO: ID 903'],
  ['pedido vazio adicional', visit + '\n• PEDIDO:'],
  ['zero', visit.replace('ID 901', 'ID 0')],
  ['lista de IDs', visit.replace('ID 901', 'IDS 901, 902')],
  ['ID malformado', visit.replace('ID 801', 'ID inválido')],
  ['hora inválida', visit.replace('23:02', '25:02')],
  ['base errada', visit.replace('DADOS LANCAMENTOS', 'DADOS DOCUMENTOS')],
  ['negação', visit.replace('APONTADA', 'NÃO APONTADA')],
  ['falha explícita', visit + '\n❌ Falha ao criar diário.'],
  ['pedido não confirmado', visit + '\nPedido não confirmado.'],
  ['diário pendente', visit + '\nDiário de obras pendente.'],
  ['diário aguardando', visit + '\nDiário de obras aguardando confirmação.'],
  ['visita parcial', visit + '\nVisita em obra parcialmente registrada.'],
  ['operação apontada desconhecida', visit.replace('VISITA EM OBRA APONTADA', 'ITEM APONTADO')],
  ['criação na base errada', creation.replace('DADOS DIARIO DE OBRAS', 'DADOS DOCUMENTOS')],
  ['criação com registro alheio', creation.replace('DIÁRIO DE OBRAS: ID 701', 'DOCUMENTO: ID 701')],
  ['criação duplicada', creation + '\n• DIÁRIO DE OBRAS: ID 702'],
  ['criação pendente', creation + '\nDiário de obras pendente.'],
  ['criação negada sem acento', creation.replace('GRAVADO', 'NAO GRAVADO')],
  ['diário não criado', visit + '\nDiário de obras não criado.'],
  ['visita não apontada', visit + '\nVisita em obra não apontada.'],
  ['diário cancelado', visit + '\nDiário de obras cancelado.'],
  ['aguardando confirmação', visit + '\nAguardando confirmação.'],
  ['cancelamento sem sujeito', visit + '\nCancelado.'],
  ['processamento sem sujeito', visit + '\nEm processamento.'],
  ['criação não concluída', creation + '\nDiário de obras não concluído.'],
  ['criação aguardando confirmação', creation + '\nAguardando confirmação.'],
  ['criação com operação cancelada', creation + '\nA operação foi cancelada.'],
  ['pendência sem sujeito', creation + '\nPendente.'],
  ['negação sem sujeito', creation + '\nNão criado.'],
]) {
  test(`confirmação incompleta permanece integralmente em texto: ${name}`, t => {
    const doc = documentFor(t, text);
    assert.equal(doc.querySelector('.launch-completion'), null);
    assert.ok(doc.querySelector('.chat-bubble').textContent.includes(text.replaceAll('*', '').split('\n')[0]));
    assert.equal(postingCompletion({ text }), null);
  });
}

test('mensagens de usuário e dados estruturados não viram comprovante de criação', () => {
  for (const metadata of [{ role: 'user' }, { type: 'menu' }, { detail_table: { rows: [] } }, { presenceConfirmation: {} }]) {
    assert.equal(postingCompletion({ role: 'assistant', type: 'text', text: visit, ...metadata }), null);
  }
});
