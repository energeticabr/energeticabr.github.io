import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatView } from '../src/ui/chat-view.js';

function setup(t, overrides = {}) {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root);
  const state = {
    sessionStatus: 'authenticated', account: { name: 'Bernardo' }, draft: '',
    messages: [{ role: 'assistant', type: 'poll', question: 'DIGITE AS ATIVIDADES EXECUTADAS:',
      options: [{ id: 'abandon_construction_diary', label: 'ABANDONAR DIÁRIO DE OBRAS' }] }],
    activeFlow: { id: 'construction_diary_fill' }, pendingFiles: [], ...overrides,
  };
  const events = [];
  view.on('draft-changed', event => { events.push(event); state.draft = event.value; view.render(state); });
  view.on('send-text', event => events.push(event));
  view.render(state);
  t.after(() => { view.destroy(); dom.window.close(); });
  const draft = root.querySelector('[data-role="draft"]');
  function input(value, type = 'insertText', caret = value.length) {
    draft.value = value;
    draft.setSelectionRange(caret, caret);
    draft.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType: type }));
  }
  function enter(type = 'insertLineBreak') {
    const before = new dom.window.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: type });
    if (draft.dispatchEvent(before)) {
      draft.setRangeText('\n', draft.selectionStart, draft.selectionEnd, 'end');
      draft.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType: type }));
    }
  }
  return { dom, root, view, state, events, draft, input, enter };
}

test('atividades começam em 1 e o índice vazio não pode ser enviado', t => {
  const ctx = setup(t);
  assert.equal(ctx.draft.value, '1. ');
  assert.equal(ctx.draft.selectionStart, 3, 'o cursor começa após o índice');
  assert.equal(ctx.root.querySelector('[data-action="send-text"]').disabled, true);
  ctx.input('1. ');
  ctx.root.querySelector('[data-chat-form]').dispatchEvent(new ctx.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(ctx.events.some(event => event.type === 'send-text'), false);
});

const occurrencesQuestion = '💬 ⚠️ HOUVE OCORRÊNCIAS OU IMPREVISTOS? SE NÃO HOUVE, SELECIONE NADA APONTADO. CASO CONTRÁRIO, DIGITE O QUE OCORREU.\nDIGITE DIRETAMENTE A OBSERVAÇÃO OU DESCRIÇÃO, OU SELECIONE UMA DAS OPÇÕES ABAIXO.';
function occurrencesMessages() {
  return [{ id: 'diary-occurrences', role: 'assistant', type: 'poll', question: occurrencesQuestion,
    options: [
      { id: 'choice:ocorrencias:1', reply: '1', label: '1 - ✅ NADA APONTADO' },
      { id: 'abandon_construction_diary', label: 'ABANDONAR DIÁRIO DE OBRAS' },
    ],
  }];
}

test('ocorrências começam em 1 e continuam com Enter e quebra de linha do celular', t => {
  const ctx = setup(t, { messages: occurrencesMessages() });
  assert.equal(ctx.draft.value, '1. ');
  assert.equal(ctx.draft.selectionStart, 3);
  assert.equal(ctx.root.querySelector('[data-action="send-text"]').disabled, true);
  ctx.input('Chuva interrompeu a concretagem');
  ctx.enter();
  ctx.input(ctx.draft.value + 'Atraso na entrega de cimento');
  ctx.enter('insertParagraph');
  assert.equal(ctx.draft.value, '1. Chuva interrompeu a concretagem;\n2. Atraso na entrega de cimento;\n3. ');
  assert.equal(ctx.events.some(event => event.type === 'send-text'), false);
});

test('ocorrências mantêm Nada apontado enviando a opção da VM sem índices de texto', t => {
  const ctx = setup(t, { messages: occurrencesMessages() });
  ctx.view.on('select-reply', event => ctx.events.push(event));
  assert.equal(ctx.draft.value, '1. ');
  const option = ctx.root.querySelector('[data-reply-id="choice:ocorrencias:1"]');
  assert.ok(option);
  option.click();
  assert.equal(ctx.events.at(-1).type, 'select-reply');
  assert.equal(ctx.events.at(-1).replyId, 'choice:ocorrencias:1');
  assert.equal(ctx.events.some(event => event.type === 'send-text'), false);
});

test('colar e enviar ocorrências renumera os itens e remove o índice vazio', t => {
  const ctx = setup(t, { messages: occurrencesMessages() });
  ctx.input('7. Chuva intensa\n9. Atraso de 1.5 h\n10. ', 'insertFromPaste');
  assert.equal(ctx.draft.value, '1. Chuva intensa\n2. Atraso de 1.5 h\n3. ');
  ctx.root.querySelector('[data-chat-form]').dispatchEvent(new ctx.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(ctx.state.draft, '1. Chuva intensa\n2. Atraso de 1.5 h');
  assert.equal(ctx.events.at(-1).type, 'send-text');
});

test('ocorrências deixam de numerar ao avançar para outra pergunta', t => {
  const ctx = setup(t, { messages: occurrencesMessages() });
  assert.equal(ctx.draft.value, '1. ');
  ctx.state.messages = [{ role: 'assistant', type: 'poll', question: 'ENVIE UMA FOTO OU UM PDF.',
    options: [{ id: 'attachment_upload_continue', label: 'ENVIAR ANEXO' }],
  }];
  ctx.view.render(ctx.state);
  ctx.input('Primeira linha\nSegunda linha');
  assert.equal(ctx.root.querySelector('[data-role="draft"]').value, 'Primeira linha\nSegunda linha');
});

test('ocorrências em outro fluxo ou em pergunta com escolhas estruturadas mantêm texto livre', t => {
  for (const overrides of [
    { activeFlow: { id: 'task' }, messages: occurrencesMessages() },
    { messages: [{ ...occurrencesMessages()[0], options: [{ id: 'severity', label: 'ESCOLHA A GRAVIDADE' }] }] },
  ]) {
    const ctx = setup(t, overrides);
    assert.equal(ctx.draft.value, '');
    ctx.input('Linha um\nLinha dois');
    assert.equal(ctx.draft.value, 'Linha um\nLinha dois');
  }
});

test('apagar todo o texto reinicia em 1 com o cursor após o índice', t => {
  const ctx = setup(t, { draft: '1. Concretagem\n2. Cura' });
  ctx.input('', 'deleteContentBackward', 0);
  assert.equal(ctx.draft.value, '1. ');
  assert.equal(ctx.draft.selectionStart, 3);
  assert.equal(ctx.root.querySelector('[data-action="send-text"]').disabled, true);
});

test('Enter e quebra de linha do celular continuam 2, 3 e 4 sem enviar', t => {
  const ctx = setup(t);
  ctx.input('Concretagem de vigas e pilares');
  assert.equal(ctx.draft.value, '1. Concretagem de vigas e pilares');
  ctx.enter();
  assert.equal(ctx.draft.value, '1. Concretagem de vigas e pilares;\n2. ');
  ctx.input(ctx.draft.value + 'Instalação de formas');
  ctx.enter('insertParagraph');
  ctx.input(ctx.draft.value + 'Cura do concreto');
  ctx.enter();
  assert.equal(ctx.draft.value, '1. Concretagem de vigas e pilares;\n2. Instalação de formas;\n3. Cura do concreto;\n4. ');
  assert.equal(ctx.draft.selectionStart, ctx.draft.value.length);
  assert.equal(ctx.events.some(event => event.type === 'send-text'), false);
});

test('colar atividades renumera índices existentes e preserva medidas decimais', t => {
  const ctx = setup(t);
  ctx.input('9. Aplicação de 1.5 m³ de concreto\n10. Medição de 2,75 m', 'insertFromPaste');
  assert.equal(ctx.draft.value, '1. Aplicação de 1.5 m³ de concreto\n2. Medição de 2,75 m');
  assert.equal(ctx.state.draft, ctx.draft.value);
  assert.equal(ctx.draft.selectionStart, ctx.draft.value.length);
});

test('colar uma lista após o índice inicial não duplica índices nem envia marcadores vazios', t => {
  const ctx = setup(t);
  ctx.draft.setRangeText('9. Concretagem\n10. Cura', 3, 3, 'end');
  ctx.input(ctx.draft.value, 'insertFromPaste');
  assert.equal(ctx.draft.value, '1. Concretagem\n2. Cura');
  ctx.input('1. ', 'deleteContentBackward');
  ctx.draft.setRangeText('9. \n10. ', 3, 3, 'end');
  ctx.input(ctx.draft.value, 'insertFromPaste');
  assert.equal(ctx.root.querySelector('[data-action="send-text"]').disabled, true);
  ctx.root.querySelector('[data-chat-form]').dispatchEvent(new ctx.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(ctx.events.some(event => event.type === 'send-text'), false);
});

test('apagar parcialmente o prefixo não transforma o índice em conteúdo', t => {
  const ctx = setup(t, { draft: '1. Concretagem\n2. Cura' });
  ctx.draft.setSelectionRange(3, 3);
  const before = new ctx.dom.window.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' });
  assert.equal(ctx.draft.dispatchEvent(before), false, 'o índice gerado não deve ser apagado parcialmente');
  assert.equal(ctx.draft.value, '1. Concretagem\n2. Cura');
  assert.equal(ctx.draft.selectionStart, 3);
  ctx.input('1.Concretagem\n2. Cura', 'deleteContentBackward', 2);
  assert.equal(ctx.draft.value, '1. Concretagem\n2. Cura', 'o fallback também recompõe o espaço do índice');
  assert.equal(ctx.draft.selectionStart, 3);
});

test('Backspace no início do próximo item remove a quebra e o índice juntos', t => {
  const ctx = setup(t, { draft: '1. Concretagem\n2. ' });
  ctx.draft.setSelectionRange(ctx.draft.value.length, ctx.draft.value.length);
  ctx.draft.dispatchEvent(new ctx.dom.window.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
  assert.equal(ctx.draft.value, '1. Concretagem');
  assert.equal(ctx.draft.selectionStart, ctx.draft.value.length);
  ctx.input('1. Concretagem\n2. Cura');
  ctx.draft.setSelectionRange('1. Concretagem\n2. '.length, '1. Concretagem\n2. '.length);
  ctx.draft.dispatchEvent(new ctx.dom.window.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
  assert.equal(ctx.draft.value, '1. Concretagem Cura');
});

test('inserir e excluir um item no meio mantém sequência e posição do cursor', t => {
  const ctx = setup(t, { draft: '1. Concretagem\n2. Cura' });
  ctx.draft.setSelectionRange('1. Concretagem'.length, '1. Concretagem'.length);
  ctx.enter();
  assert.equal(ctx.draft.value, '1. Concretagem;\n2. \n3. Cura');
  assert.equal(ctx.draft.selectionStart, '1. Concretagem;\n2. '.length);
  ctx.input('1. Concretagem\n3. Cura', 'deleteContentBackward', '1. Concretagem\n'.length);
  assert.equal(ctx.draft.value, '1. Concretagem\n2. Cura');
});

test('enviar remove itens vazios e mantém as quebras dos itens preenchidos', t => {
  const ctx = setup(t);
  ctx.input('1. Concretagem\n2. \n3. Cura\n4. ');
  ctx.root.querySelector('[data-chat-form]').dispatchEvent(new ctx.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(ctx.state.draft, '1. Concretagem\n2. Cura');
  assert.equal(ctx.events.at(-1).type, 'send-text');
});

test('outras perguntas e outros fluxos preservam o texto livre', t => {
  for (const overrides of [
    { messages: [{ role: 'assistant', type: 'poll', question: 'INFORME AS OBSERVAÇÕES', options: [] }] },
    { activeFlow: { id: 'construction_task' } },
  ]) {
    const ctx = setup(t, overrides);
    assert.equal(ctx.draft.value, '');
    ctx.input('Primeira linha\nSegunda linha', 'insertFromPaste');
    assert.equal(ctx.draft.value, 'Primeira linha\nSegunda linha');
  }
});

test('ditado complementa o item atual sem achatar a lista ou separar o índice da atividade', t => {
  const ctx = setup(t, { draft: '1. Inspeção das formas\n2. ' });
  class Recognition {
    constructor() { Recognition.instance = this; }
    start() { this.onstart?.(); }
    stop() { this.onend?.(); }
  }
  ctx.dom.window.SpeechRecognition = Recognition;
  const voice = ctx.root.querySelector('[data-role="voice-input"]');
  voice.dispatchEvent(new ctx.dom.window.Event('pointerdown', { bubbles: true, cancelable: true }));
  Recognition.instance.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'Eu fiz a concretagem de 1.5 m³.' }], { isFinal: true })] });
  voice.dispatchEvent(new ctx.dom.window.Event('pointerup', { bubbles: true, cancelable: true }));
  assert.equal(ctx.draft.value, '1. Inspeção das formas.\n2. Execução de concretagem de 1.5 m³.');
});
test('quebra de linha mantém ponto e vírgula único e índices vazios nas duas etapas', t => {
  for (const overrides of [{}, { messages: occurrencesMessages() }]) {
    const ctx = setup(t, overrides);
    ctx.input('1. Registro concluído;   ');
    ctx.enter();
    assert.equal(ctx.draft.value, '1. Registro concluído;\n2. ');
    ctx.enter('insertParagraph');
    assert.equal(ctx.draft.value, '1. Registro concluído;\n2. \n3. ');
    assert.equal(ctx.draft.selectionStart, ctx.draft.value.length);
    assert.equal(ctx.draft.selectionEnd, ctx.draft.value.length);
    ctx.root.querySelector('[data-chat-form]').dispatchEvent(new ctx.dom.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(ctx.state.draft, '1. Registro concluído;');
    assert.equal(ctx.events.at(-1).type, 'send-text');
  }
});

test('quebra de linha no meio do texto acrescenta ponto e vírgula sem perder o restante', t => {
  const ctx = setup(t);
  ctx.input('1. Concretagem Cura');
  ctx.draft.setSelectionRange('1. Concretagem'.length, '1. Concretagem'.length);
  ctx.enter();
  assert.equal(ctx.draft.value, '1. Concretagem;\n2. Cura');
  assert.equal(ctx.draft.selectionStart, '1. Concretagem;\n2. '.length);
  ctx.input(ctx.draft.value.slice(0, ctx.draft.selectionStart) + 'Continuação ' + ctx.draft.value.slice(ctx.draft.selectionStart));
  assert.equal(ctx.draft.value, '1. Concretagem;\n2. Continuação Cura');
});
