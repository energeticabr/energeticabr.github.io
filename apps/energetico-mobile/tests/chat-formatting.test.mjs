import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { renderChatMarkup, commandFromTarget } from "../src/ui/chat-view.js";

function render(t, messages) {
  const dom = new JSDOM(renderChatMarkup({ sessionStatus: 'authenticated', account: { name: 'Teste' }, messages }));
  t.after(() => dom.window.close());
  return dom;
}

test('perguntas interpretam negrito do WhatsApp e Markdown sem exibir os asteriscos', t => {
  const dom = render(t, [
    { type: 'text', text: 'Informe a *data* e o **valor**.' },
    { type: 'poll', question: '*QUAL É A OBRA?*', options: [{ id: '1', label: '**Obra A**', reply: 'obra_a' }] },
  ]);
  const document = dom.window.document;
  const paragraphs = [...document.querySelectorAll('.chat-bubble p')];
  assert.equal(paragraphs[0].textContent, 'Informe a data e o valor.');
  assert.deepEqual([...paragraphs[0].querySelectorAll('strong')].map(el => el.textContent), ['data', 'valor']);
  assert.equal(paragraphs[1].textContent, 'QUAL É A OBRA?');
  assert.equal(paragraphs[1].querySelector('strong').textContent, 'QUAL É A OBRA?');
  const button = document.querySelector('[data-action="select-reply"]');
  assert.equal(button.textContent, 'Obra A');
  assert.deepEqual(commandFromTarget(button.querySelector('strong')), { type: 'select-reply', replyId: 'obra_a', label: '**Obra A**' });
});

test('negrito nunca transforma HTML da VM em elementos executáveis', t => {
  const dom = render(t, [{ type: 'text', text: '*<img src=x onerror=alert(1)>* e **<script>alert(2)</script>**' }]);
  const paragraph = dom.window.document.querySelector('.chat-bubble p');
  assert.equal(paragraph.querySelectorAll('img, script').length, 0);
  assert.equal(paragraph.querySelectorAll('strong').length, 2);
  assert.equal(paragraph.textContent, '<img src=x onerror=alert(1)> e <script>alert(2)</script>');
});

test('preserva asteriscos literais, marcadores incompletos e mensagens do usuário', t => {
  const dom = render(t, [
    { type: 'text', text: '2 * 3 * 4\n* item da lista\n*incompleto\n**' },
    { type: 'text', role: 'user', text: 'Minha resposta com *asteriscos* e **texto**' },
  ]);
  const paragraphs = [...dom.window.document.querySelectorAll('.chat-bubble p')];
  assert.equal(paragraphs[0].textContent, '2 * 3 * 4\n* item da lista\n*incompleto\n**');
  assert.equal(paragraphs[0].querySelector('strong'), null);
  assert.equal(paragraphs[1].textContent, 'Minha resposta com *asteriscos* e **texto**');
  assert.equal(paragraphs[1].querySelector('strong'), null);
});

test('formata legendas da VM sem mudar o nome literal de um arquivo', t => {
  const dom = render(t, [
    { type: 'image', caption: '*Confira* a imagem.', fileName: 'imagem.png' },
    { type: 'document', fileName: 'arquivo *original*.pdf' },
  ]);
  const paragraphs = [...dom.window.document.querySelectorAll('.chat-bubble p')];
  assert.equal(paragraphs[0].querySelector('strong')?.textContent, 'Confira');
  assert.equal(paragraphs[1].textContent, 'arquivo *original*.pdf');
});

test('perguntas simples e enquetes ficam em seminegrito, com destaques na mesma linha', async t => {
  const dom = render(t, [
    { type: 'text', text: 'Qual é a data?' },
    { type: 'poll', question: 'Escolha a **obra**:', options: [] },
  ]);
  const style = dom.window.document.createElement('style');
  style.textContent = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  dom.window.document.head.append(style);
  for (const paragraph of dom.window.document.querySelectorAll('.chat-bubble p')) {
    assert.equal(dom.window.getComputedStyle(paragraph).fontWeight, '600');
  }
  const emphasis = dom.window.document.querySelector('.chat-choice-card p strong');
  assert.ok(emphasis);
  const emphasisStyle = dom.window.getComputedStyle(emphasis);
  assert.equal(emphasisStyle.fontWeight, '700');
  assert.notEqual(emphasisStyle.display, 'block', 'negrito dentro da pergunta não é o cabeçalho do remetente');
});

test('destaca o identificador principal da pergunta em uma enquete', async t => {
  const dom = render(t, [
    { type: 'poll', question: '🏭 QUAL É A FILIAL? A opção com ⭐ é a filial padrão.', options: [] },
  ]);
  const style = dom.window.document.createElement('style');
  style.textContent = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  dom.window.document.head.append(style);
  const field = dom.window.document.querySelector('.chat-question-field');
  assert.ok(field);
  assert.equal(field.textContent, 'FILIAL');
  assert.equal(dom.window.getComputedStyle(field).color, 'rgb(180, 35, 24)');
  assert.equal(dom.window.document.querySelector('.chat-choice-card p').textContent,
    '🏭 QUAL É A FILIAL? A opção com ⭐ é a filial padrão.');
});

test('destaca identificadores compostos também em perguntas digitadas', t => {
  const dom = render(t, [
    { type: 'poll', question: 'QUAL O TIPO DE HOMOLOGAÇÃO?', options: [] },
    { type: 'text', text: '📧 DIGITE O E-MAIL DO FORNECEDOR OU DIGITE EM BRANCO.' },
  ]);
  assert.equal(dom.window.document.querySelectorAll('.chat-question-field').length, 2);
  assert.equal(dom.window.document.querySelectorAll('.chat-question-field')[0].textContent,
    'TIPO DE HOMOLOGAÇÃO');
  assert.equal(dom.window.document.querySelectorAll('.chat-question-field')[1].textContent,
    'E-MAIL');
});

test('mantém identificadores de datas de pagamento inteiros', t => {
  const dom = render(t, [
    { type: 'poll', question: '📅 QUAL É A DATA DE PAGAMENTO PREVISTO?', options: [] },
    { type: 'text', text: '📅 QUAL É A DATA DE PAGAMENTO EFETUADO?' },
  ]);
  assert.deepEqual(
    [...dom.window.document.querySelectorAll('.chat-question-field')].map(field => field.textContent),
    ['DATA DE PAGAMENTO PREVISTO', 'DATA DE PAGAMENTO EFETUADO'],
  );
});

test('não adiciona destaque em mensagens sem identificador de campo nem em respostas', t => {
  const dom = render(t, [
    { type: 'text', text: 'Escolha como deseja continuar.' },
    { type: 'text', role: 'user', text: 'FILIAL' },
  ]);
  assert.equal(dom.window.document.querySelectorAll('.chat-question-field').length, 0);
});

test('cobre identificadores de operações e registros além dos campos de lançamento', t => {
  const dom = render(t, [
    { type: 'poll', question: 'QUAL OPERAÇÃO DE LANÇAMENTO VOCÊ DESEJA EFETUAR?', options: [] },
    { type: 'poll', question: 'QUAL É O CLIENTE?', options: [] },
  ]);
  assert.deepEqual(
    [...dom.window.document.querySelectorAll('.chat-question-field')].map(field => field.textContent),
    ['OPERAÇÃO', 'CLIENTE'],
  );
});
