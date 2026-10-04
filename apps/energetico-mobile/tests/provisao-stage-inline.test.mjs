import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderDynamicForm } from '../../../portal/ui/dynamic-form.js';

test('payment stage is typed in the same field and applies dates only after a real selection', t => {
  const dom = new JSDOM('<main></main>');
  const root = dom.window.document.querySelector('main');
  const controller = renderDynamicForm(root, {
    entity: { id: 'provisoes-de-pagamento', title: 'Provisões' }, mode: 'create',
    columns: [{ name: 'DATAPREVISTOPGTO', label: 'Previsão', control: 'date', editable: true }],
  });
  t.after(() => { controller.cleanup(); dom.window.close(); });
  const field = root.querySelector('.dynamic-payment-stage');
  const native = field.querySelector('[data-provisao-payment-stage]');
  const input = field.querySelector('[role=combobox]');
  assert.ok(input, 'stage display must itself accept typing');
  assert.equal(field.querySelectorAll('input').length, 1);
  input.focus(); input.value = 'liquidado hoje'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(native.value, '');
  const option = [...field.querySelectorAll('[role=option]')].find(n => n.textContent === 'LIQUIDADO HOJE');
  assert.ok(option); option.click();
  assert.equal(native.value, 'LIQUIDADO HOJE');
  assert.equal(input.value, native.value);
  assert.match(root.querySelector('[name=DATAPREVISTOPGTO]').value, /^\d{4}-\d{2}-\d{2}$/);
  native.disabled = true;
  native.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(input.disabled, true);
});
