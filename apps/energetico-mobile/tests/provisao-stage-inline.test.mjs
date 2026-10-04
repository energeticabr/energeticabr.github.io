import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderDynamicForm } from '../../../portal/ui/dynamic-form.js';

function fixture(t) {
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
  return { dom, root, field, native, input };
}

test('payment stage is typed in the same field and applies dates only after a real selection', t => {
  const { dom, root, field, native, input } = fixture(t);
  assert.ok(input, 'stage display must itself accept typing');
  assert.equal(field.querySelectorAll('input').length, 1);
  input.focus();
  assert.equal(input.value, '', 'Selecione must be a prompt, never part of the typed query');
  input.value += 'liquidado hoje'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
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

test('reset clears stage proof and reselecting the same stage reapplies its date defaults', async t => {
  const { dom, root, field, native, input } = fixture(t);
  const choose = () => {
    input.focus(); input.value = 'LIQUIDADO HOJE'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    [...field.querySelectorAll('[role=option]')].find(n => n.textContent === 'LIQUIDADO HOJE').click();
  };
  choose();
  root.querySelector('[data-form-clear]').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(native.value, '');
  assert.equal(input.value, 'Selecione');
  assert.equal(root.querySelector('[name=DATAPREVISTOPGTO]').value, '');
  choose();
  assert.equal(native.value, 'LIQUIDADO HOJE');
  assert.match(root.querySelector('[name=DATAPREVISTOPGTO]').value, /^\d{4}-\d{2}-\d{2}$/);
});

test('stage Enter used by IME never chooses a stage or applies its dates', t => {
  const { dom, root, field, native, input } = fixture(t);
  input.focus(); input.value = 'LIQUIDADO HOJE'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
  assert.equal(native.value, '');
  assert.equal(root.querySelector('[name=DATAPREVISTOPGTO]').value, '');
  assert.equal(field.querySelector('[role=listbox]').hidden, false);
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(native.value, 'EMPENHADO E LIQUIDADO HOJE');
});
