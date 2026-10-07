import test from 'node:test';
import assert from 'node:assert/strict';

const model = await import('../src/chat/supplier-payroll-report-model.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const call = (name, ...args) => {
  assert.equal(typeof model[name], 'function', `${name} must be implemented`);
  return model[name](...args);
};

test('current month uses Brazil calendar at UTC month boundary', () => {
  assert.equal(call('currentPayrollMonth', new Date('2026-10-01T02:59:59Z')), '2026-09');
  assert.equal(call('currentPayrollMonth', new Date('2026-10-01T03:00:00Z')), '2026-10');
  assert.throws(() => call('currentPayrollMonth', new Date('bad')), TypeError);
});

test('reference month accepts scalar SharePoint and calendar formats without moving date-only periods', () => {
  for (const [value, expected] of [
    ['1/2026', '2026-01'], ['10/2026', '2026-10'], ['2026-10', '2026-10'],
    ['2026-10-01', '2026-10'], ['2026-10-01T00:00:00Z', '2026-10'],
    ['29/02/2024', '2024-02'], [{ LookupValue: '10/2026' }, '2026-10'],
    [{ Value: '2026-10' }, '2026-10'], [{ value: '01/10/2026' }, '2026-10'],
    ['', ''], [null, ''], [undefined, ''], ['  ', ''],
  ]) assert.equal(call('normalizePayrollMonth', value), expected);
});

test('populated malformed reference values never invent a period', () => {
  for (const value of ['13/2026', '0/2026', '2026-1', '31/04/2026', '29/02/2025',
    '2026-02-30', '2026-10-01Tgarbage', '2026-10-01T25:00:00Z', 'abc', 202610,
    {}, [], { Value: 'garbage' }, '0000-10', '2026-10-01suffix']) {
    assert.throws(() => call('normalizePayrollMonth', value), TypeError, JSON.stringify(value));
  }
});

const sheets = [
  { id: '10', supplier: ' Ana ', month: '10/2026' },
  { id: '2', supplier: 'ANA', month: '2026-10' },
  { id: '1', supplier: 'Ana', month: '2026-09' },
  { id: '3', supplier: 'Ána', month: '2026-11' },
  { id: '4', supplier: '', month: '' },
  { id: '5', supplier: 'Ana Maria', month: '2026-10' },
];
test('overview filters reference period, groups exact case-insensitive names and keeps global options', () => {
  const input = structuredClone({ complete: true, sheets });
  const before = structuredClone(input);
  const result = call('buildSupplierPayrollOverview', input, { month: '2026-10', supplier: 'ana' });
  assert.equal(result.sheetCount, 2);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].supplier, 'Ana');
  assert.equal(result.groups[0].key, 'ana');
  assert.deepEqual(result.groups[0].ids, ['2', '10']);
  assert.deepEqual(result.groups[0].sheets.map(s => [s.id, s.month, s.referenceLabel]),
    [['2', '2026-10', '10/2026'], ['10', '2026-10', '10/2026']]);
  assert.deepEqual(result.months, ['2026-11', '2026-10', '2026-09']);
  assert.deepEqual(result.suppliers, ['Ana', 'Ána', 'Ana Maria', 'Fornecedor não informado']);
  assert.deepEqual(input, before);
  result.groups[0].sheets[0].supplier = 'changed';
  assert.deepEqual(input, before);
});

test('all-month overview exposes missing supplier/reference but default month excludes them', () => {
  const source = { complete: true, sheets };
  const all = call('buildSupplierPayrollOverview', source);
  assert.equal(all.sheetCount, 6);
  assert.deepEqual(all.groups.find(g => g.supplier === 'Fornecedor não informado').sheets,
    [{ id: '4', supplier: 'Fornecedor não informado', month: '', referenceLabel: 'Sem referência' }]);
  assert.equal(call('buildSupplierPayrollOverview', source, { month: '2026-10' }).sheetCount, 3);
  assert.deepEqual(call('buildSupplierPayrollOverview', { complete: true, sheets: [] }),
    { groups: [], months: [], suppliers: [], sheetCount: 0 });
});

test('overview rejects incomplete snapshots and invalid or duplicate sheet IDs', () => {
  for (const source of [{ sheets: [] }, { complete: false, sheets: [] }, { complete: true },
    { complete: true, sheets: [{ id: '0', month: '' }] },
    { complete: true, sheets: [{ id: '2', month: '' }, { id: '2', month: '' }] },
    { complete: true, sheets: new Array(1) }]) {
    assert.throws(() => call('buildSupplierPayrollOverview', source), TypeError);
  }
});

test('totals use decimal quantities and exact safe cents including rounding', () => {
  assert.deepEqual(call('summarizePayrollPayments', [
    { unitValue: 10.01, quantity: 1.5 }, { unitValue: 'R$ 1.234,56', quantity: '0,25' },
    { unitValue: 0.1, quantity: 0.2 }, { unitValue: 1.005, quantity: 1 },
  ]), { totalCents: 32469, uncalculated: 0 });
  assert.deepEqual(call('summarizePayrollPayments', []), { totalCents: 0, uncalculated: 0 });
});

test('any missing invalid or unsafe amount makes the total unknown rather than a partial zero', () => {
  for (const row of [{ unitValue: null, quantity: 2 }, { unitValue: '', quantity: 1 },
    { unitValue: 1, quantity: false }, { totalCents: null }, { totalCents: 1.5 },
    { unitValue: Infinity, quantity: 1 }, { unitValue: Number.MAX_SAFE_INTEGER, quantity: 100 }]) {
    assert.deepEqual(call('summarizePayrollPayments', [{ totalCents: 123 }, row]),
      { totalCents: null, uncalculated: 1 });
  }
  assert.deepEqual(call('summarizePayrollPayments', [{ totalCents: Number.MAX_SAFE_INTEGER }, { totalCents: 1 }]),
    { totalCents: null, uncalculated: 0 });
});
