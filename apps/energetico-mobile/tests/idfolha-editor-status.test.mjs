import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createHrPayrollGalleryData } from '../src/chat/orders-gallery-data.js';
import { createGalleryRecordActions } from '../src/ui/gallery-record-actions.js';

function fixture({ status = '', column = { name: 'STATUS', text: {} } } = {}) {
  const writes = [];
  const fields = { Title: '', MESREFERENCIA: '09/2026', FORNECEDOR: 'RAFAEL GONTIJO', OBS: 'ANTIGO', [column.name]: status };
  const repository = {
    async listAttachments() { return [{ name: 'recibo-existente.pdf' }]; },
    async resolveList(_site, aliases) { return { status: 'resolved', id: aliases[0] }; },
    async getItemsPage() { return { items: [], hasMore: false }; },
    async getColumns() { return [{ name: 'Title', text: {} }, { name: 'MESREFERENCIA', text: {} }, { name: 'FORNECEDOR', text: {} }, { name: 'OBS', text: {} }, column]; },
    async getItem(_site, _list, id) { return { id, eTag: '"v1"', fields }; },
    async updateItem(site, list, id, values, options) { writes.push({ site, list, id, values, options }); return { id, eTag: '"v2"', fields: { ...fields, ...values } }; },
  };
  return { data: createHrPayrollGalleryData({ repository }), fields, writes };
}

// A text-backed STATUS must become a closed scalar choice without changing its storage name.
for (const column of [{ name: 'STATUS', text: {} }, { name: 'field_7', displayName: 'STATUS', text: {} },
  { name: 'STATUS', choice: { choices: ['ATIVO', 'INATIVO', 'OUTRO'] } }]) {
  test(`IDFOLHA exposes only active/inactive choices for ${column.name} metadata`, async () => {
    const f = fixture({ column }), context = await f.data.loadEditor('IDFOLHA', '1');
    const status = context.columns.find(c => c.name === column.name);
    assert.equal(status.control, 'select');
    assert.deepEqual(status.choices, ['ATIVO', 'INATIVO']);
    assert.equal(status.allowMultipleValues, false);
    assert.equal(status.powerApps.closed, true);
    assert.equal(context.item.fields[column.name], '');
    await assert.rejects(f.data.saveEditor(context, { [column.name]: 'OUTRO' }), /opção/i);
    await assert.rejects(f.data.saveEditor(context, { [column.name]: ['ATIVO', 'INATIVO'] }), /valor/i);
    assert.deepEqual(f.writes, []);
    await f.data.saveEditor(context, { [column.name]: 'INATIVO' });
    assert.deepEqual(f.writes, [{ site: 'personal', list: 'IDFOLHA', id: '1', values: { [column.name]: 'INATIVO' }, options: { eTag: '"v1"' } }]);
  });
}

// Opening or submitting an unchanged record must not invent an active status or erase legacy data.
test('IDFOLHA retains blank and existing status without a write', async () => {
  for (const status of ['', 'ATIVO', 'INATIVO', 'LEGADO']) {
    const f = fixture({ status }), context = await f.data.loadEditor('IDFOLHA', '1');
    assert.equal(context.item.fields.STATUS, status);
    await f.data.saveEditor(context, { STATUS: status });
    assert.deepEqual(f.writes, []);
  }
});

test('IDFOLHA status policy does not restrict another payroll list', async () => {
  const f = fixture(), context = await f.data.loadEditor('FOLHAPGTO', '1');
  assert.equal(context.columns.find(c => c.name === 'STATUS').control, 'text');
  await f.data.saveEditor(context, { STATUS: 'OUTRO' });
  assert.deepEqual(f.writes[0].values, { STATUS: 'OUTRO' });
});

// Exercise the real editor and its selection control through the real IDFOLHA persistence boundary.
async function openEditor(t, f) {
  const dom = new JSDOM('<main id="app"></main>', { url: 'https://example.test' });
  const document = dom.window.document, previousFormData = globalThis.FormData;
  globalThis.FormData = dom.window.FormData;
  const actions = createGalleryRecordActions({ document, host: document.querySelector('main'),
    loadEditor: id => f.data.loadEditor('IDFOLHA', id), saveEditor: f.data.saveEditor });
  t.after(() => { actions.destroy(); dom.window.close(); globalThis.FormData = previousFormData; });
  document.querySelector('main').append(actions.render({ id: '1', fields: f.fields }));
  document.querySelector('[data-gallery-action="edit"]').click();
  for (let n = 0; n < 100 && !document.querySelector('[name=STATUS]'); n++) await new Promise(setImmediate);
  return { document, dom };
}

async function submitEditor(document, dom, f) {
  document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  for (let n = 0; n < 100 && !f.writes.length; n++) await new Promise(setImmediate);
}

test('IDFOLHA editor opens the two status options and submits the selected value only', async t => {
  const f = fixture({ status: 'ATIVO' }), { document, dom } = await openEditor(t, f);
  const select = document.querySelector('[name=STATUS]');
  assert.equal(select?.tagName, 'SELECT');
  assert.equal(select.value, 'ATIVO');
  const input = document.querySelector('[role=combobox]');
  assert.equal(input.value, 'ATIVO');
  input.click();
  const options = [...document.querySelectorAll('[role=option]')];
  assert.deepEqual(options.map(option => option.textContent.trim()), ['ATIVO', 'INATIVO']);
  options[1].click();
  assert.equal(input.value, 'INATIVO');
  await submitEditor(document, dom, f);
  assert.deepEqual(f.writes[0]?.values, { STATUS: 'INATIVO' });
  assert.equal(f.writes[0]?.options.eTag, '"v1"');
  assert.ok(f.writes[0]?.options.signal instanceof AbortSignal);
});

test('unrelated IDFOLHA edits retain whitespace-bearing legacy status', async t => {
  for (const status of [' LEGADO ', ' ATIVO ', '   ']) {
    await t.test(JSON.stringify(status), async t => {
      const f = fixture({ status }), { document, dom } = await openEditor(t, f);
      assert.equal(document.querySelector('[name=STATUS]').value, status);
      assert.equal(document.querySelector('[role=combobox]').value, status.trim() || 'Sem status');
      document.querySelector('[name=OBS]').value = 'NOVO';
      await submitEditor(document, dom, f);
      assert.deepEqual(f.writes[0]?.values, { OBS: 'NOVO' });
    });
  }
});

test('native multiple-choice IDFOLHA statuses are not converted or cleared by unrelated edits', async t => {
  for (const status of [['ATIVO'], ['ATIVO', 'INATIVO']]) {
    await t.test(status.join('/'), async t => {
      const f = fixture({ status, column: { name: 'STATUS', choice: { choices: ['ATIVO', 'INATIVO'], allowMultipleValues: true } } });
      const { document, dom } = await openEditor(t, f);
      document.querySelector('[name=OBS]').value = 'NOVO';
      await submitEditor(document, dom, f);
      assert.deepEqual(f.writes[0]?.values, { OBS: 'NOVO' });
    });
  }
});
