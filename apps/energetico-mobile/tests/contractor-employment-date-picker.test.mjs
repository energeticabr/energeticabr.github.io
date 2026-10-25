import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isActiveDateQuestion, isDateQuestion } from '../src/chat/date-input.js';
import { createChatView } from '../src/ui/chat-view.js';

const question = '📅 QUAL É A DATA DE ADMISSÃO? INFORME NO FORMATO dd/mm/yyyy.';
for (const type of ['text', 'poll']) test('contractor admission ' + type + ' prompt opens the existing date picker and emits the selected date', () => {
  const dom = new JSDOM('<main id="app"></main>'), root = dom.window.document.querySelector('#app');
  const message = { id: 'synthetic-admission', role: 'assistant', type, question, text: question,
    stepKey: 'admissao_fornecedor_suprimentos', kind: 'date', target: 'DATAADMISSAO', options: [] };
  const view = createChatView(root), selected = [];
  try {
    assert.equal(isDateQuestion(message), true);
    assert.equal(isActiveDateQuestion([message]), true);
    view.on('date-selected', event => selected.push(event.value));
    view.render({ sessionStatus: 'authenticated', account: { name: 'Teste' }, draft: '', pendingFiles: [],
      messages: [message], activeFlow: { type: 'supplier_registration' } });
    const trigger = root.querySelector('[data-action="open-date-picker"]');
    assert.ok(trigger, 'exact admission prompt must expose the calendar without relying on backend metadata');
    trigger.click();
    const input = root.querySelector('[data-role="date-picker"]');
    assert.ok(input);
    input.value = '2026-01-20';
    root.querySelector('[data-action="confirm-date-picker"]').click();
    assert.deepEqual(selected, ['2026-01-20']);
    assert.equal(root.querySelector('[data-date-picker-dialog]'), null);
  } finally { view.destroy(); dom.window.close(); }
});
