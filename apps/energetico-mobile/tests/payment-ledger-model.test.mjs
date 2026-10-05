import test from 'node:test';
import assert from 'node:assert/strict';
const { buildPaymentLedger } = await import('../src/chat/payment-ledger-model.js').catch(() => ({}));
const row = (id, changes = {}) => ({ id: String(id), paymentDate: '2026-10-02', date: '2026-09-01', supplier: 'Alfa', branch: 'Xavante', product: 'Servente', order: '358', disbursement: 'SIM', account: 'Caixa', unit: 181, quantity: 5, freight: 0, total: 905, ...changes });

test('groups payments by payment day and supplier, sums freight once, retains distinct orders', () => {
  assert.equal(typeof buildPaymentLedger, 'function');
  const result = buildPaymentLedger([row(1), row(2, { order: '359', total: 33 }), row(3, { paymentDate: '2026-10-05', total: 99.8 }), row(4, { paymentDate: '' })]);
  assert.equal(result.count, 3);
  assert.equal(result.total, 1037.8);
  assert.deepEqual(result.groups.map(g => [g.date, g.supplier, g.total, g.rows.map(r => r.id)]), [['2026-10-05', 'Alfa', 99.8, ['3']], ['2026-10-02', 'Alfa', 938, ['1', '2']]]);
});
test('date filters use payment date inclusively, plus all five reference dimensions', () => {
  assert.equal(typeof buildPaymentLedger, 'function');
  const rows = [row(1), row(2, { paymentDate: '2026-10-05' }), row(3, { supplier: 'Beta' }), row(4, { order: '1' }), row(5, { branch: 'Outra' }), row(6, { product: 'Água' }), row(7, { disbursement: 'NÃO' })];
  assert.deepEqual(buildPaymentLedger(rows, { startDate: '2026-10-02', endDate: '2026-10-02', supplier: 'Alfa', order: '358', branch: 'Xavante', product: 'Servente', disbursement: 'SIM' }).groups.flatMap(g => g.rows.map(r => r.id)), ['1']);
});
test('all matching rows and full supplier totals remain available beyond 2000 records', () => {
  assert.equal(typeof buildPaymentLedger, 'function');
  const rows = Array.from({ length: 2001 }, (_, i) => row(i, { supplier: i === 2000 ? 'Beta' : 'Alfa', total: 0.1 }));
  const result = buildPaymentLedger(rows);
  assert.equal(result.total, 200.1); assert.equal(result.count, 2001);
  assert.equal(result.groups.reduce((n, g) => n + g.rows.length, 0), 2001);
  assert.equal(result.groups[0].total, 200);
  const filtered = buildPaymentLedger(rows, { supplier: 'Beta' });
  assert.equal(filtered.total, 0.1);
  assert.equal(buildPaymentLedger([row(1, { total: null })]).total, null);
});

test('supplier totals round each displayed payment with exact decimal cents', () => {
  const result = buildPaymentLedger([row(1, { total: 1.005 }), row(2, { total: 10.075 })]);
  assert.equal(result.total, 11.09);
  assert.equal(result.groups[0].total, 11.09);
});
