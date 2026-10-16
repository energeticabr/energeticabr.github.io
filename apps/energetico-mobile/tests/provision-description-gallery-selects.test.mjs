import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRegistrationGalleryData } from '../src/chat/registration-gallery-data.js';
import { formMarkup, renderDynamicForm } from '../../../portal/ui/dynamic-form.js';

function fixture() {
  const catalogs = {
    filiais: { field: 'FILIAL', values: ['004 - EDIFÍCIO XAVANTE', '000 - ESCRITÓRIO CENTRAL'] },
    fornecedores: { field: 'CADASTRO', values: ['SÓ ANDAIMES', 'DIBRITA'] },
    contas: { field: 'CONTA', values: ['PIX', 'TRANSFERÊNCIA'] },
  };
  const parent = { id: '32', eTag: 'v1', fields: {
    FILIAL: '004 - EDIFÍCIO XAVANTE', FORNECEDOR: 'SÓ ANDAIMES', FORMAPGTO: 'PIX ANTIGO',
    STATUS: 'PAGAMENTO PREVISTO',
  } };
  const reads = [];
  const repository = {
    async resolveList(_site, aliases) {
      const names = { FILIAIS: 'filiais', FORNECEDORES: 'fornecedores', CADASTROCONTA: 'contas', DESCRITIVOPROVISAO: 'parents' };
      const id = names[aliases[0]];
      return id ? { status: 'resolved', id } : null;
    },
    async getColumns(_site, list) {
      if (list === 'parents') return [
        ...['FILIAL', 'FORNECEDOR', 'FORMAPGTO'].map(name => ({ name, text: {} })),
        { name: 'STATUS', choice: { choices: ['PAGAMENTO PREVISTO'], allowMultipleValues: false } },
      ];
      const field = catalogs[list]?.field;
      return field ? [{ name: field, text: {} }] : [];
    },
    async getItem() { return structuredClone(parent); },
    async getItemsPage(_site, list, query) {
      reads.push({ list, query });
      const catalog = catalogs[list];
      return { items: (catalog?.values || []).map((value, index) => ({ id: String(index + 1), fields: { [catalog.field]: value } })), hasMore: false };
    },
  };
  return { data: createRegistrationGalleryData({ kind: 'provisionDescription', repository }), reads, parent };
}

test('FILIAL, FORNECEDOR and FORMAPGTO use searchable closed catalog selectors in provision description editing', async () => {
  const { data, reads, parent } = fixture();
  const context = await data.loadEditor('32');
  for (const [field, expected] of Object.entries({
    FILIAL: ['004 - EDIFÍCIO XAVANTE', '000 - ESCRITÓRIO CENTRAL'],
    FORNECEDOR: ['SÓ ANDAIMES', 'DIBRITA'],
    FORMAPGTO: ['PIX', 'TRANSFERÊNCIA'],
  })) {
    const column = context.columns.find(candidate => candidate.name === field);
    assert.equal(column?.control, 'select', field);
    assert.deepEqual([...column.choices], expected, field);
    assert.equal(column.allowMultipleValues, false, field);
    assert.equal(column.powerApps?.preserveCurrentValue, true, field);
    assert.equal(column.filterableInEdit, true, field);
  }
  const dom = new JSDOM(formMarkup({ entity: context.entity, columns: context.columns, mode: 'edit', values: parent.fields }));
  for (const field of ['FILIAL', 'FORNECEDOR', 'FORMAPGTO']) {
    const select = dom.window.document.querySelector(`select[name="${field}"]`);
    assert.ok(select?.closest('[data-searchable-field]'), `${field} must expose a filterable selector`);
    assert.equal(select.value, parent.fields[field], `${field} must retain the saved value`);
  }
  assert.ok([...dom.window.document.querySelector('select[name="FORMAPGTO"]').options]
    .some(option => option.value === 'PIX ANTIGO'), 'a historical value must remain visible while editing other fields');
  assert.deepEqual(reads.map(read => read.list).sort(), ['contas', 'filiais', 'fornecedores']);
  dom.window.close();
});

test('a provision description edit selector filters typed text and applies only the chosen catalog value', async () => {
  const { data } = fixture();
  const context = await data.loadEditor('32');
  const dom = new JSDOM('<!doctype html><div id="editor"></div>');
  const root = dom.window.document.querySelector('#editor');
  const controller = renderDynamicForm(root, {
    entity: context.entity, columns: context.columns, mode: 'edit', values: context.item.fields,
  });
  for (const name of ['FILIAL', 'FORNECEDOR', 'FORMAPGTO']) {
    assert.equal(root.querySelector(`[data-searchable-field="${name}"] .searchable-select-input`).readOnly, false, name);
  }
  const field = root.querySelector('[data-searchable-field="FORNECEDOR"]');
  const input = field.querySelector('.searchable-select-input');
  assert.equal(input.readOnly, false, 'the user must be able to type a filter in edit mode');
  input.value = 'dibr';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const options = [...field.querySelectorAll('[role="option"]')];
  assert.deepEqual(options.map(option => option.textContent), ['DIBRITA']);
  options[0].click();
  assert.equal(field.querySelector('select[name="FORNECEDOR"]').value, 'DIBRITA');
  controller.cleanup();
  dom.window.close();
});

test('a typed value outside the confirmed payment-method catalog cannot be submitted', async () => {
  const { data } = fixture();
  const context = await data.loadEditor('32');
  await assert.rejects(data.saveEditor(context, { FORMAPGTO: 'CONTA INVENTADA' }), /opção válida/i);
});
