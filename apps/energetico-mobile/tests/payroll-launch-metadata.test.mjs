import test from 'node:test';
import assert from 'node:assert/strict';
import { createHrPayrollGalleryData } from '../src/chat/orders-gallery-data.js';
import { createPayrollLaunchReader } from '../src/chat/payroll-launch-options.js';

// SharePoint's renamed Title is accompanied by computed link mirrors with the same label.
function fixture({ computed = true, launchMirrors = false, extra = [] } = {}) {
  const mirrors = label => ['LinkTitle', 'LinkTitleNoMenu', 'LinkTitle2'].map(name => ({
    name, displayName: label, readOnly: true, hidden: name === 'LinkTitle2', ...(computed ? { computed: true } : {}),
  }));
  const supplierColumns = [{ name: 'Title', displayName: 'CADASTRO', text: {} },
    ...mirrors('CADASTRO'), { name: 'EMPREITEIRO', text: {} }, { name: 'STATUS', text: {} }, ...extra];
  const supplier = { id: '1', fields: { Title: 'FELICIANO', EMPREITEIRO: 'SIM', STATUS: 'ATIVO' } };
  const launch = { id: '3456', fields: { [launchMirrors ? 'Title' : 'field_5']: 'FELICIANO', VALORUNITARIO: 250, QUANTIDADE: 2 } };
  const writes = [];
  const repository = {
    async resolveList(_site, names) { return { status: 'resolved', id: names[0] }; },
    async getColumns(_site, list) {
      if (list === 'FORNECEDORES') return supplierColumns;
      if (list === 'LANCAMENTOS') return [{ name: launchMirrors ? 'Title' : 'field_5', displayName: 'FORNECEDOR', text: {} },
        ...(launchMirrors ? mirrors('FORNECEDOR') : []), { name: 'VALORUNITARIO', number: {} }, { name: 'QUANTIDADE', number: {} }];
      if (list === 'IDFOLHA') return [{ name: 'MESREFERENCIA', text: {} }, { name: 'FORNECEDOR', text: {} }];
      return [{ name: 'FORNECEDOR', text: {} }, { name: 'TIPOPGTO', text: {} }, { name: 'DATA', dateTime: { format: 'dateOnly' } },
        { name: 'IDFOLHA', number: {} }, { name: 'IDLANCAMENTO', number: {} }, { name: 'VALORUNITARIO', number: {} }, { name: 'QTD', number: {} }];
    },
    async getItemsPage(_site, list) { return { items: list === 'FORNECEDORES' ? [supplier] : list === 'LANCAMENTOS' ? [launch]
      : [{ id: '5', fields: { MESREFERENCIA: '09/2026', FORNECEDOR: 'FELICIANO' } }], hasMore: false }; },
    async getItem(_site, list, id) {
      if (list === 'LANCAMENTOS') return id === launch.id ? launch : undefined;
      if (list === 'IDFOLHA') return { id: '5', fields: { MESREFERENCIA: '09/2026', FORNECEDOR: 'FELICIANO' } };
      return { id, eTag: '"v1"', fields: { FORNECEDOR: 'FELICIANO', TIPOPGTO: 'SALÁRIO', DATA: '2026-09-28', IDFOLHA: 5,
        IDLANCAMENTO: 3456, VALORUNITARIO: 250, QTD: 2 } };
    },
    async updateItem(_site, _list, id, values, options) { writes.push({ values, options }); return { id, fields: values }; },
  };
  return { repository, supplier, supplierColumns, writes };
}

for (const computed of [true, false]) {
  test(`payroll launch choices use the real CADASTRO instead of link mirrors (computed ${computed})`, async () => {
    const f = fixture({ computed }), reader = createPayrollLaunchReader(f.repository, 'personal');
    assert.deepEqual(await reader.options(), [{ value: '3456', label: '3456 - FELICIANO' }]);
    await reader.assertLaunch('3456');
    f.supplier.fields.STATUS = 'INATIVO';
    await assert.rejects(reader.assertLaunch('3456'), /ativo|empreiteiro/i);
  });
}

test('payroll editor opens with renamed supplier Title and retains conditional write protection', async () => {
  const f = fixture(), data = createHrPayrollGalleryData({ repository: f.repository, now: () => new Date('2026-10-08T12:00:00Z') });
  const context = await data.loadEditor('FOLHAPGTO', '2');
  const launch = context.columns.find(c => c.name === 'IDLANCAMENTO');
  assert.deepEqual(launch.choices, ['3456']);
  assert.equal(context.item.fields.VALORUNITARIO, 250);
  assert.equal(context.item.fields.QTD, 2);
  assert.deepEqual(f.writes, []);
  await data.saveEditor(context, { DATA: '2026-09-29' });
  assert.deepEqual(f.writes, [{ values: { DATA: '2026-09-29' }, options: { eTag: '"v1"' } }]);
  const reopened = await data.loadEditor('FOLHAPGTO', '2');
  f.supplier.fields.EMPREITEIRO = 'NÃO';
  await assert.rejects(data.saveEditor(reopened, { DATA: '2026-09-30' }), /empreiteiro/i);
  assert.equal(f.writes.length, 1);
});

test('launch supplier matching also ignores computed Title mirrors', async () => {
  const f = fixture({ launchMirrors: true }), reader = createPayrollLaunchReader(f.repository, 'personal');
  assert.deepEqual(await reader.options(), [{ value: '3456', label: '3456 - FELICIANO' }]);
});

test('real duplicate supplier data columns still prevent opening payroll edits', async () => {
  const f = fixture({ extra: [{ name: 'OTHER', displayName: 'CADASTRO', text: {} }] });
  await assert.rejects(createPayrollLaunchReader(f.repository, 'personal').options(), /metadados/i);
});

test('auxiliary mirrors alone cannot establish a supplier identity', async () => {
  const f = fixture();
  f.supplierColumns.splice(0, 1);
  await assert.rejects(createPayrollLaunchReader(f.repository, 'personal').options(), /metadados/i);
});
