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
  assert.equal(result.groups[0].profession, 'Profissão não informada');
  assert.deepEqual(result.professions, ['Profissão não informada']);
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
    { groups: [], months: [], suppliers: [], professions: [], sheetCount: 0 });
});

test('overview rejects incomplete snapshots and invalid or duplicate sheet IDs', () => {
  for (const source of [{ sheets: [] }, { complete: false, sheets: [] }, { complete: true },
    { complete: true, sheets: [{ id: '0', month: '' }] },
    { complete: true, sheets: [{ id: '2', month: '' }, { id: '2', month: '' }] },
    { complete: true, sheets: new Array(1) }]) {
    assert.throws(() => call('buildSupplierPayrollOverview', source), TypeError);
  }
});

const professionSheets = [
  { id: '10', supplier: ' Ana ', month: '10/2026', profession: ' Pedreira ' },
  { id: '2', supplier: 'ANA', month: '2026-10', profession: 'pedreira' },
  { id: '1', supplier: 'Ana', month: '2026-09', profession: 'Pedreira' },
  { id: '3', supplier: 'Bia', month: '2026-10', profession: 'Eletricista' },
  { id: '4', supplier: 'Carlos', month: '2026-09', profession: '' },
  { id: '5', supplier: 'Dora', month: '2026-10' },
  { id: '6', supplier: 'Ána', month: '2026-10', profession: 'Pedreira' },
];

test('overview composes month supplier and profession filters with global sorted profession options', () => {
  const input = { complete: true, sheets: structuredClone(professionSheets) }, before = structuredClone(input);
  const overview = call('buildSupplierPayrollOverview', input, {
    month: '2026-10', supplier: ' ana ', profession: ' PEDREIRA ',
  });
  assert.equal(overview.sheetCount, 2);
  assert.deepEqual(overview.groups.map(g => [g.supplier, g.profession, g.ids]), [['Ana', 'Pedreira', ['2', '10']]]);
  assert.deepEqual(overview.professions, ['Eletricista', 'Pedreira', 'Profissão não informada']);
  assert.deepEqual(overview.months, ['2026-10', '2026-09']);
  assert.deepEqual(overview.suppliers, ['Ana', 'Ána', 'Bia', 'Carlos', 'Dora']);
  assert.deepEqual(input, before);
  overview.groups[0].sheets[0].supplier = 'changed';
  assert.deepEqual(input, before);
  assert.equal(call('buildSupplierPayrollOverview', input, { month: '2026-10', profession: 'Eletricista' }).sheetCount, 1);
  assert.equal(call('buildSupplierPayrollOverview', input, { supplier: 'Ana', profession: 'Eletricista' }).sheetCount, 0);
  assert.deepEqual(call('buildSupplierPayrollOverview', input, { profession: 'Pedreira' }).groups.map(g => g.ids),
    [['1', '2', '10'], ['6']]);
});

test('blank and legacy professions display the same filterable not-informed option', () => {
  const input = { complete: true, sheets: professionSheets };
  assert.equal(call('buildSupplierPayrollOverview', input, { profession: '  ' }).sheetCount, 7);
  const result = call('buildSupplierPayrollOverview', input, { profession: 'profissão não informada' });
  assert.deepEqual(result.groups.map(g => [g.supplier, g.profession, g.ids]), [
    ['Carlos', 'Profissão não informada', ['4']], ['Dora', 'Profissão não informada', ['5']],
  ]);
  assert.deepEqual(call('buildSupplierPayrollOverview', input, {
    month: '2026-10', profession: 'Profissão não informada',
  }).groups.map(g => g.ids), [['5']]);
});

test('profession filters are exact case-insensitive labels without accent or fuzzy inference', () => {
  const input = { complete: true, sheets: professionSheets };
  for (const profession of ['Pedr', 'Pédreira', 'Profissao nao informada', 'Médica']) {
    const result = call('buildSupplierPayrollOverview', input, { profession });
    assert.equal(result.sheetCount, 0); assert.deepEqual(result.groups, []);
    assert.deepEqual(result.professions, ['Eletricista', 'Pedreira', 'Profissão não informada']);
  }
});

test('conflicting snapshot professions resolve to not informed before any month filter', () => {
  for (const professions of [['Pedreira', 'Eletricista', 'Pedreira'],
    ['Eletricista', 'Pedreira', 'Eletricista'], ['Pedreira', undefined, 'Pedreira']]) {
    const input = { complete: true, sheets: professions.map((profession, index) => ({
      id: String(index + 1), supplier: index ? 'ANA' : 'Ana',
      month: index ? '2026-10' : '2026-09', profession,
    })) };
    const result = call('buildSupplierPayrollOverview', input, { month: '2026-10', profession: 'Profissão não informada' });
    assert.deepEqual(result.groups.map(g => [g.profession, g.ids]), [['Profissão não informada', ['2', '3']]]);
    assert.deepEqual(result.professions, ['Profissão não informada']);
    assert.equal(call('buildSupplierPayrollOverview', input, { month: '2026-10', profession: professions[0] }).sheetCount, 0);
  }
});

test('malformed populated snapshot professions and profession filter types fail explicitly', () => {
  for (const profession of [false, 1, [], {}, { Value: 'Pedreira' }]) {
    assert.throws(() => call('buildSupplierPayrollOverview', { complete: true,
      sheets: [{ id: '1', supplier: 'Ana', month: '', profession }] }), TypeError);
    assert.throws(() => call('buildSupplierPayrollOverview', { complete: true, sheets: [] }, { profession }), TypeError);
  }
  assert.throws(() => call('buildSupplierPayrollOverview', { complete: true, sheets: [] }, { profession: null }), TypeError);
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
