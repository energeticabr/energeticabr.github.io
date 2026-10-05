import test from 'node:test';
import assert from 'node:assert/strict';

const model = await import('../src/chat/order-validation-report-model.js').catch(() => ({}));
function call(name, ...args) {
  assert.equal(typeof model[name], 'function', `${name} is available`);
  return model[name](...args);
}
const order = (id, extra = {}) => ({ id: String(id), branch: 'A', supplier: 'Alfa', invoice: '123',
  status: 'PENDENTE AUDITORIA', total: 10, created: '', invalidTotal: false, ...extra });
const launch = (id, orderId, extra = {}) => ({ id: String(id), orderId: String(orderId), branch: 'A',
  supplier: 'Alfa', product: 'Cimento', description: '', total: 10, invalidTotal: false, ...extra });
const build = (orders, launches = [], filters = {}) => call('buildOrderValidationReport', { orders, launches }, filters);

test('normalizes metadata aliases, encoded names, lookup values and Brazilian report dates', () => {
  const row = call('normalizeOrderValidationOrder', { id: '12', fields: {
    b: { LookupValue: 'Obra A' }, s: { Value: 'Alfa' }, nf: 77, price: 'R$ 1.234,56',
    STATUS: 'PENDENTE AUDITORIA', Created: '2026-10-05T01:00:00Z',
  } }, [{ name: 'b', displayName: 'FILIAL' }, { name: 's', displayName: 'FORNECEDOR' },
    { name: 'nf', displayName: 'NOTA_x0020_FISCAL' }, { name: 'price', displayName: 'VALOR TOTAL' }]);
  assert.deepEqual(row, { id: '12', branch: 'Obra A', supplier: 'Alfa', invoice: '77', total: 1234.56,
    status: 'PENDENTE AUDITORIA', created: '2026-10-04', invalidTotal: false });
  assert.equal(call('normalizeOrderValidationOrder', { fields: { ID: 5, Criado: '05/10/2026' } }).created, '2026-10-05');
});

test('blank order totals remain distinct from malformed nonblank totals', () => {
  assert.equal(call('normalizeOrderValidationOrder',{id:'1',fields:{}}).created,'');
  for (const [raw, invalid] of [[null, false], ['  ', false], ['bad', true], ['1,2,3', true], [Infinity, true]]) {
    const row = call('normalizeOrderValidationOrder', { id: '1', fields: { VALORTOTAL: raw } });
    assert.equal(row.total, null); assert.equal(row.invalidTotal, invalid);
  }
  assert.equal(call('normalizeOrderValidationOrder', { fields: { VALORTOTAL: 0 } }).total, 0);
});

test('launch totals multiply and add exact decimals, coalescing each blank operand to zero', () => {
  const row = call('normalizeOrderValidationLaunch', { id: '4', fields: { AGRUPAR: '12',
    FILIAL: 'A', FORNECEDOR: 'Alfa', PRODUTO: 'Cimento', DESCRI_x00c7__x00c3_O: 'Entrega',
    VALOR_x0020_UNIT_x00c1_RIO: '0,1', QUANTIDADE: 3, FRETE: '0,2' } });
  assert.deepEqual(row, { id: '4', orderId: '12', branch: 'A', supplier: 'Alfa', product: 'Cimento',
    description: 'Entrega', total: 0.5, invalidTotal: false });
  assert.equal(call('normalizeOrderValidationLaunch', { fields: { 'VALOR UNITÁRIO': 10, FRETE: 2 } }).total, 2);
  for (const field of ['VALOR UNITÁRIO', 'QUANTIDADE', 'FRETE']) {
    const invalid = call('normalizeOrderValidationLaunch', { fields: { [field]: 'oops' } });
    assert.equal(invalid.total, null); assert.equal(invalid.invalidTotal, true);
  }
});

test('defaults blank status filter to audit pending and applies all six exact filters', () => {
  const orders = [order(2), order(10, { status: 'BAIXADO' }), order(3, { status: '' })];
  assert.deepEqual(build(orders, [], { status: ' ' }).rows.map(r => r.id), ['2']);
  assert.deepEqual(build(orders, [], { status: 'BAIXADO' }).rows.map(r => r.id), ['10']);
  for (const [key, value] of [['id', '20'], ['branch', 'AB'], ['supplier', 'Al'], ['invoice', '12'], ['product', 'Areia']]) {
    assert.equal(build(orders, [launch(1, 2)], { [key]: value }).rows.length, 0);
  }
  assert.equal(build(orders, [launch(1, 2)], { id: '2', branch: 'A', supplier: 'Alfa', invoice: '123', product: 'Cimento' }).detail.id, '2');
  assert.equal(build(orders, [], { id: '2', supplier: 'Outro' }).detail, null);
  assert.equal(build(orders).detail, null);
});

test('joins AGRUPAR by exact text ID without coercing leading zeros, spaces or substring matches', () => {
  const launches = ['12', '012', '112', '12,13', '12 '].map((id, i) =>
    call('normalizeOrderValidationLaunch', { id: String(i + 1), fields: { AGRUPAR: id, QUANTIDADE: 1, 'VALOR UNITÁRIO': 10 } }));
  const row = build([order(12)], launches).rows[0];
  assert.deepEqual(row.launches.map(r => r.id), ['1']); assert.equal(row.launchTotal, 10);
});

test('product filters select orders but retain all linked launches for validation and detail', () => {
  const snapshot = { orders: [order(12, { total: 30 })], launches: [launch(10, 12),
    launch(2, 12, { total: 20, product: 'Areia', branch: 'B', supplier: 'Beta' })] };
  const frozen = JSON.stringify(snapshot);
  const result = call('buildOrderValidationReport', snapshot, { product: 'Cimento', id: '12' });
  assert.deepEqual(result.detail.launches.map(r => r.id), ['2', '10']);
  assert.equal(result.detail.launchTotal, 30); assert.equal(result.detail.difference, 0);
  assert.equal(result.detail.branchProblem, true); assert.equal(result.detail.supplierProblem, true);
  assert.equal(result.detail.apto, false); assert.equal(result.summary.valueDivergent, 0);
  assert.equal(JSON.stringify(snapshot), frozen);
});

test('ten PowerFx conditions produce separate issues even when types repeat', () => {
  const row = build([order(1, { branch: '', supplier: '', invoice: ' pEnDeNtE ', total: 1 })],
    [launch(1, 1), launch(2, 1, { branch: 'B', supplier: 'Beta' })]).rows[0];
  assert.equal(row.issues.length, 8);
  assert.deepEqual(row.issues.map(r => r.type), ['FILIAL', 'FILIAL', 'FILIAL', 'FORNECEDOR', 'FORNECEDOR', 'FORNECEDOR', 'NOTA FISCAL', 'VALOR']);
  assert.ok(row.issues.every(r => r.title && r.detail));
  const missing = build([order(2, { total: null, invoice: '-' })]).rows[0];
  assert.equal(missing.missingLaunch, true); assert.equal(missing.nfPending, true);
  assert.equal(missing.valueProblem, true); assert.equal(missing.issues.length, 3);
  assert.equal(missing.difference, 0);
  for (const invoice of ['', '  ', '-', 'pendente']) assert.equal(build([order(1, { invoice })], [launch(1, 1)]).rows[0].nfPending, true);
  assert.equal(build([order(1)], [launch(1, 1)]).rows[0].apto, true);
});

test('separately rounds totals before testing a strict one-cent divergence, including half-cent ties', () => {
  for (const [price, sum, problem] of [[10, 10.01, false], [10, 9.99, false], [10, 10.02, true],
    [10.004, 10.014, false], [10.004, 10.015, true], [-10.004, -10.015, true], [0.3, 0.3, false]]) {
    const row = build([order(1, { total: price })], [launch(1, 1, { total: sum })]).rows[0];
    assert.equal(row.valueProblem, problem, `${price} / ${sum}`);
  }
});

test('malformed amounts poison affected sums while blank order amounts coalesce to zero in summary', () => {
  const blanks = build([order(1, { total: null }), order(2)], [launch(1, 2)]);
  assert.deepEqual(blanks.summary, { orderCount: 2, total: 10, invoicePending: 0, withoutLaunch: 1, valueDivergent: 1, supplierCount: 1 });
  const invalidOrder = build([order(1, { total: null, invalidTotal: true }), order(2)]);
  assert.equal(invalidOrder.summary.total, null); assert.equal(invalidOrder.summary.valueDivergent, 1);
  const invalidLaunch = build([order(1)], [launch(1, 1, { total: null, invalidTotal: true })]).rows[0];
  assert.equal(invalidLaunch.launchTotal, null); assert.equal(invalidLaunch.difference, null);
  assert.equal(invalidLaunch.valueProblem, true); assert.equal(invalidLaunch.apto, false);
  assert.equal(build([order(1, { total: 0.1 }), order(2, { total: 0.2 })]).summary.total, 0.3);
});

test('descending numeric IDs produce independent contiguous rowspans and group flags', () => {
  const result = build([order(2, { branch: 'A', supplier: 'X' }), order(10, { branch: 'A', supplier: 'X' }),
    order(9, { branch: 'A', supplier: 'X' }), order(8, { branch: 'B', supplier: 'X' }), order(3, { branch: 'A', supplier: 'Y' })],
    [launch(1, 9, { branch: 'Z', supplier: 'Other' })]);
  assert.deepEqual(result.rows.map(r => r.id), ['10', '9', '8', '3', '2']);
  assert.deepEqual(result.rows.map(r => r.branchRowSpan), [2, 0, 1, 2, 0]);
  assert.deepEqual(result.rows.map(r => r.supplierRowSpan), [3, 0, 0, 1, 1]);
  assert.deepEqual(result.rows.map(r => r.branchGroupProblem), [true, false, false, false, false]);
  assert.deepEqual(result.rows.map(r => r.supplierGroupProblem), [true, false, false, false, false]);
  assert.equal(result.summary.supplierCount, 2);
});

test('empty report and more than 2000 orders have complete summaries without truncation', () => {
  assert.deepEqual(build([]), { summary: { orderCount: 0, total: 0, invoicePending: 0, withoutLaunch: 0, valueDivergent: 0, supplierCount: 0 }, rows: [], detail: null });
  const result = build(Array.from({ length: 2005 }, (_, i) => order(i + 1, { total: 0.1 })));
  assert.equal(result.rows.length, 2005); assert.equal(result.summary.total, 200.5);
  assert.equal(result.summary.withoutLaunch, 2005); assert.equal(result.rows[0].branchRowSpan, 2005);
});
