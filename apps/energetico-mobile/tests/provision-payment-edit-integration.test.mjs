import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentProgrammingGalleryData, createPendingProvisionAttachmentsData } from '../src/chat/orders-gallery-data.js';
import { createProvisionPaymentEditor } from '../../../portal/forms/provision-payment-edit.js';

function fixture({ single = false, parentDates = {} } = {}) {
  const records = {
    parents: new Map([['42', { id: '42', eTag: 'p1', fields: {
      FILIAL: '004', FORNECEDOR: 'A', VALORTOTAL: '30', DATAPREVISTOPGTO: null,
      DATAPGTOEFETUADO: null, DATAPGTOAGENDADO: null, DATAEXECUCAOAGENDAMENTO: null, PGTOAGENDADO: null,
      ...parentDates,
    } }]]),
    children: new Map([
      ['2', { id: '2', eTag: 'c2', fields: { DESCRITIVOPROVISAO: '42', FILIAL: '004', FORNECEDOR: 'A', QTD: '1', VALORTOTAL: '10', FRETE: '0', DATAPGTOEFETUADO: null } }],
      ...single ? [] : [['3', { id: '3', eTag: 'c3', fields: { DESCRITIVOPROVISAO: '42', FILIAL: '004', FORNECEDOR: 'A', QTD: '1', VALORTOTAL: '20', FRETE: '0', DATAPGTOEFETUADO: null } }]],
    ]),
  };
  if (single) records.parents.get('42').fields.VALORTOTAL = '10';
  const columns = {
    parents: [...['FILIAL', 'FORNECEDOR', 'VALORTOTAL'].map(name => ({ name, text: {} })),
      ...['DATAPREVISTOPGTO', 'DATAPGTOEFETUADO', 'DATAPGTOAGENDADO', 'DATAEXECUCAOAGENDAMENTO', 'PGTOAGENDADO'].map(name => ({ name, dateTime: {} }))],
    children: [...['DESCRITIVOPROVISAO', 'FILIAL', 'FORNECEDOR', 'QTD', 'VALORTOTAL', 'FRETE'].map(name => ({ name, text: {} })),
      ...['DATAPREVISTOPGTO', 'DATAPGTOEFETUADO', 'DATAPGTOAGENDADO', 'DATAEXECUCAOAGENDAMENTO'].map(name => ({ name, dateTime: {} }))],
  };
  const writes = [];
  const repository = {
    async resolveList(_site, aliases) { return { status: 'resolved', id: aliases.includes('DESCRITIVOPROVISAO') ? 'parents' : 'children' }; },
    async getColumns(_site, list) { return structuredClone(columns[list]); },
    async getItemsPage(_site, list) { return { items: [...records[list].values()].map(row => structuredClone(row)), hasMore: false }; },
    async getItem(_site, list, id) { return structuredClone(records[list].get(String(id))); },
    async updateItem(_site, list, id, fields, { eTag }) {
      const row = records[list].get(String(id));
      assert.equal(eTag, row.eTag);
      writes.push({ list, id: String(id), fields: structuredClone(fields) });
      Object.assign(row.fields, fields);
      row.eTag += 'n';
      return structuredClone(row);
    },
  };
  return { data: createPaymentProgrammingGalleryData({ repository }), records, writes, repository };
}

test('editing one child amount recalculates the parent from all linked provision lines', async () => {
  const f = fixture();
  const context = await f.data.loadEditor('2');
  await f.data.saveEditor(context, { VALORTOTAL: '5' });
  assert.equal(f.records.children.get('2').fields.VALORTOTAL, '5');
  assert.equal(f.records.children.get('3').fields.VALORTOTAL, '20');
  assert.equal(f.records.parents.get('42').fields.VALORTOTAL, '25');
});

test('payment editor displays FILIAL and FORNECEDOR as locked and rejects direct edits', async () => {
  const f = fixture();
  const context = await f.data.loadEditor('2');
  for (const name of ['FILIAL', 'FORNECEDOR']) {
    const column = context.columns.find(candidate => candidate.name === name);
    assert.equal(column?.readOnly, true, name);
    assert.equal(column?.disabled, true, name);
    await assert.rejects(f.data.saveEditor(context, { [name]: 'OUTRO' }), /não é editável|descritivo/i);
  }
  assert.deepEqual(f.writes, []);
});

test('payment editor cannot relink a child to another provision description', async () => {
  const f = fixture();
  const context = await f.data.loadEditor('2');
  await assert.rejects(f.data.saveEditor(context, { DESCRITIVOPROVISAO: '99' }), /v[ií]nculo|descritivo/i);
  await assert.rejects(createProvisionPaymentEditor({ repository: f.repository }).save({
    list: { id: 'children' }, item: context.item, fields: { DESCRITIVOPROVISAO: '99' },
  }), /v[ií]nculo|descritivo/i);
  assert.deepEqual(f.writes, []);
});

test('a changed payment date reaches the parent only when this is its sole child and payment dates are blank', async () => {
  const single = fixture({ single: true });
  const context = await single.data.loadEditor('2');
  await single.data.saveEditor(context, { DATAPGTOEFETUADO: '2026-10-16' });
  assert.match(single.records.parents.get('42').fields.DATAPGTOEFETUADO, /^2026-10-16/);

  const multiple = fixture();
  await multiple.data.saveEditor(await multiple.data.loadEditor('2'), { DATAPGTOEFETUADO: '2026-10-16' });
  assert.equal(multiple.records.parents.get('42').fields.DATAPGTOEFETUADO, null);

  const alreadyDated = fixture({ single: true, parentDates: { DATAPGTOAGENDADO: '2026-10-20T00:00:00Z' } });
  await alreadyDated.data.saveEditor(await alreadyDated.data.loadEditor('2'), { DATAPGTOEFETUADO: '2026-10-16' });
  assert.equal(alreadyDated.records.parents.get('42').fields.DATAPGTOEFETUADO, null);
});

test('a SharePoint-normalized date is confirmed without mistaking its ISO representation for a failed save', async () => {
  const f = fixture({ single: true });
  const update = f.repository.updateItem;
  f.repository.updateItem = (site, list, id, fields, options) => update(site, list, id,
    list === 'children' && fields.DATAPGTOEFETUADO
      ? { ...fields, DATAPGTOEFETUADO: `${fields.DATAPGTOEFETUADO}T00:00:00Z` }
      : fields, options);
  await f.data.saveEditor(await f.data.loadEditor('2'), { DATAPGTOEFETUADO: '2026-10-16' });
  assert.equal(f.records.parents.get('42').fields.DATAPGTOEFETUADO, '2026-10-16T00:00:00Z');
});

test('parent date readback accepts equivalent SharePoint ISO precision', async () => {
  const f = fixture({ single: true });
  const update = f.repository.updateItem;
  f.repository.updateItem = (site, list, id, fields, options) => update(site, list, id,
    fields.DATAPGTOEFETUADO
      ? { ...fields, DATAPGTOEFETUADO: list === 'children'
        ? `${fields.DATAPGTOEFETUADO}T00:00:00Z`
        : fields.DATAPGTOEFETUADO.replace(/Z$/, '.000Z') }
      : fields, options);
  await f.data.saveEditor(await f.data.loadEditor('2'), { DATAPGTOEFETUADO: '2026-10-16' });
  assert.match(f.records.parents.get('42').fields.DATAPGTOEFETUADO, /^2026-10-16/);
});

test('changing the due date updates an existing parent due date when payment dates remain blank', async () => {
  const f = fixture({ single: true, parentDates: { DATAPREVISTOPGTO: '2026-10-20T00:00:00Z' } });
  await f.data.saveEditor(await f.data.loadEditor('2'), { DATAPREVISTOPGTO: '2026-10-25' });
  assert.match(f.records.parents.get('42').fields.DATAPREVISTOPGTO, /^2026-10-25/);
});

test('missing payment-date metadata cannot be treated as proof that every parent date is blank', async () => {
  const f = fixture({ single: true });
  const getColumns = f.repository.getColumns;
  f.repository.getColumns = async (site, list) => (await getColumns(site, list))
    .filter(column => list !== 'parents' || column.name !== 'PGTOAGENDADO');
  await f.data.saveEditor(await f.data.loadEditor('2'), { DATAPGTOEFETUADO: '2026-10-16' });
  assert.equal(f.records.parents.get('42').fields.DATAPGTOEFETUADO, null);
});

test('a parent write failure leaves the child saved and a retry completes only the missing total', async () => {
  const f = fixture();
  const update = f.repository.updateItem;
  let once = true;
  f.repository.updateItem = (...args) => {
    if (args[1] === 'parents' && once) { once = false; throw new Error('offline'); }
    return update(...args);
  };
  const context = await f.data.loadEditor('2');
  await assert.rejects(f.data.saveEditor(context, { VALORTOTAL: '5' }), /offline/);
  assert.equal(f.records.children.get('2').fields.VALORTOTAL, '5');
  assert.equal(f.records.parents.get('42').fields.VALORTOTAL, '30');
  await f.data.saveEditor(context, { VALORTOTAL: '5' });
  assert.equal(f.records.parents.get('42').fields.VALORTOTAL, '25');
  assert.equal(f.writes.filter(write => write.list === 'children').length, 1);
});

test('quantity and freight preserve exact decimal totals when a provision amount changes', async () => {
  const f = fixture();
  Object.assign(f.records.children.get('2').fields, { QTD: '2.5', VALORTOTAL: '0.10', FRETE: '0.05' });
  Object.assign(f.records.children.get('3').fields, { QTD: '1', VALORTOTAL: '20', FRETE: '0' });
  f.records.parents.get('42').fields.VALORTOTAL = '20.3';
  await f.data.saveEditor(await f.data.loadEditor('2'), { VALORTOTAL: '0.20' });
  assert.equal(f.records.parents.get('42').fields.VALORTOTAL, '20.55');
});

test('a sibling changed during the parent write is included before synchronization reports success', async () => {
  const f = fixture();
  const update = f.repository.updateItem;
  let raced = false;
  f.repository.updateItem = async (...args) => {
    const saved = await update(...args);
    if (args[1] === 'parents' && !raced) {
      raced = true;
      f.records.children.get('3').fields.VALORTOTAL = '30';
      f.records.children.get('3').eTag += 'n';
    }
    return saved;
  };
  await f.data.saveEditor(await f.data.loadEditor('2'), { VALORTOTAL: '5' });
  assert.equal(f.records.parents.get('42').fields.VALORTOTAL, '35');
});

test('the pending-payment due-date pencil uses the same child-to-parent date rule', async () => {
  const f = fixture({ single: true });
  const popup = createPendingProvisionAttachmentsData({ repository: f.repository });
  await popup.updateDueDate('2', '2026-10-25');
  assert.match(f.records.parents.get('42').fields.DATAPREVISTOPGTO, /^2026-10-25/);
});

test('an invalid edited amount is rejected before writing the child or the parent', async () => {
  const f = fixture();
  await assert.rejects(f.data.saveEditor(await f.data.loadEditor('2'), { VALORTOTAL: 'NÃO É NÚMERO' }), /decimal|valor/i);
  assert.deepEqual(f.writes, []);
});
