import test from 'node:test';
import assert from 'node:assert/strict';
import { createHrPayrollGalleryData } from '../src/chat/orders-gallery-data.js';

function fixture() {
  let amount = 200, quantity = 4;
  const writes = [];
  const columns = [
    { name: 'Title', text: {} }, { name: 'FORNECEDOR', text: {} },
    { name: 'TIPOPGTO', text: {} }, { name: 'VALORUNITARIO', number: {} },
    { name: 'QTD', number: {} }, { name: 'IDLANCAMENTO', number: {} },
    { name: 'DATA', dateTime: { format: 'dateOnly' } },
  ];
  const fields = { Title: 'interno', FORNECEDOR: 'CLEITON', TIPOPGTO: 'SALÁRIO', VALORUNITARIO: 168.8, QTD: 3, IDLANCAMENTO: 3457, DATA: '2026-09-28' };
  const repository = {
    async resolveList(_site, names) { return { status: 'resolved', id: names[0] }; },
    async getColumns(_site, list) { return list === 'LANCAMENTOS' ? [
      { name: 'VALOR_x0020_UNIT_x00c1_RIO', displayName: 'VALOR UNITÁRIO', number: {} },
      { name: 'QUANTIDADE', number: {} },
    ] : columns; },
    async getItem(_site, list, id) { return { id, eTag: '"v1"', fields: list === 'LANCAMENTOS' ? { VALOR_x0020_UNIT_x00c1_RIO: amount, QUANTIDADE: quantity } : fields }; },
    async getItemsPage() { return { items: [{ id: '3', eTag: '"v1"', fields }], hasMore: false }; },
    async searchPowerAppsOptions() { return [{ value: 'CLEITON', label: 'CLEITON' }]; },
    async updateItem(_site, _list, _id, values) { writes.push(values); return { id: '3', fields: values }; },
  };
  return { data: createHrPayrollGalleryData({ repository }), writes, change: () => { amount = 300; quantity = 5; } };
}

test('payroll editor hides title, locks source values and restricts supplier and payment type', async () => {
  const { data, writes } = fixture();
  const context = await data.loadEditor('FOLHAPGTO', '3');
  assert.equal(context.columns.some(c => c.name === 'Title'), false);
  for (const name of ['VALORUNITARIO', 'QTD']) assert.equal(context.columns.find(c => c.name === name).readOnly, true);
  for (const name of ['FORNECEDOR', 'TIPOPGTO']) assert.equal(context.columns.find(c => c.name === name).control, 'select');
  assert.equal(context.item.fields.VALORUNITARIO, 200);
  assert.equal(context.item.fields.QTD, 4);
  for (const fields of [{ VALORUNITARIO: 1 }, { QTD: 99 }, { Title: 'x' }, { FORNECEDOR: 'INVENTADO' }, { TIPOPGTO: 'INVENTADO' }]) {
    await assert.rejects(data.saveEditor(context, fields), /editável|opção/i);
  }
  await data.saveEditor(context, { TIPOPGTO: 'VALE TRANSPORTE' });
  assert.deepEqual(writes, [{ TIPOPGTO: 'VALE TRANSPORTE' }]);
});

test('payroll gallery and open editor refresh derived values after source changes', async () => {
  const { data, change } = fixture();
  const context = await data.loadEditor('FOLHAPGTO', '3');
  const first = await data.loadPage('FOLHAPGTO');
  assert.equal(first.rows[0].VALORUNITARIO, 200);
  change();
  const next = await data.loadPage('FOLHAPGTO');
  assert.equal(next.rows[0].VALORUNITARIO, 300);
  assert.equal(next.rows[0].QTD, 5);
  assert.deepEqual(await context.refreshDerivedValues(), { VALORUNITARIO: 300, QTD: 5 });
  await data.saveEditor(context, { DATA: '2026-09-29' });
});

test('payroll save rejects invalid linked launch IDs even if submission bypasses the button', async () => {
  const { data, writes } = fixture();
  const context = await data.loadEditor('FOLHAPGTO', '3');
  await assert.rejects(data.saveEditor(context, { IDLANCAMENTO: -1 }), /vínculo.*inválido/i);
  assert.deepEqual(writes, []);
});
