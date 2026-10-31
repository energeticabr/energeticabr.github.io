import test from 'node:test';
import assert from 'node:assert/strict';
const due = await import('../portal/forms/provision-parent-due.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const row = fields => ({ id: '1', fields });

test('minimum is chronological across valid ISO/BR dates, ties and overdue children', () => {
  assert.equal(typeof due.provisionEarliestUnpaidDue, 'function');
  assert.equal(due.provisionEarliestUnpaidDue([
    row({ DATAPREVISTOPGTO: '22/12/2026' }), row({ DATAPREVISTOPGTO: '2020-11-09T00:00:00Z' }),
    row({ DATAPREVISTOPGTO: '09/11/2020' }), row({ DATAPREVISTOPGTO: '2026-11-23' }),
  ]), '2020-11-09T00:00:00Z');
});

test('paid requires both a valid actual payment date and one final payment marker', () => {
  for (const marker of [{ PGTOAGENDADO: 'PAGO' }, { STATUS: 'PAGAMENTO EFETUADO' }]) {
    assert.equal(due.provisionEarliestUnpaidDue([
      row({ DATAPREVISTOPGTO: '2019-01-01', DATAPGTOEFETUADO: '01/01/2019', ...marker }),
      row({ DATAPREVISTOPGTO: '2026-11-23' }),
    ]), '2026-11-23T00:00:00Z');
  }
});

test('date alone, status alone, invalid effective date and future schedule alone remain unpaid', () => {
  for (const markers of [
    { DATAPGTOEFETUADO: '2035-01-01' }, { STATUS: 'PAGAMENTO EFETUADO' },
    { PGTOAGENDADO: 'PAGO', DATAPGTOEFETUADO: '2026-02-30' },
    { PGTOAGENDADO: 'PAGO!!!', DATAPGTOEFETUADO: '2020-01-01' },
    { PGTOAGENDADO: '2035-01-01', DATAPGTOAGENDADO: '2035-01-01', DATAEXECUCAOAGENDAMENTO: '2035-01-01' },
    { STATUS: 'CANCELADO' },
  ]) assert.equal(due.provisionEarliestUnpaidDue([
    row({ DATAPREVISTOPGTO: '2020-01-01', ...markers }), row({ DATAPREVISTOPGTO: '2026-11-23' }),
  ]), '2020-01-01T00:00:00Z');
});

test('one invalid or missing unpaid due date fails closed instead of silently omitting a child', () => {
  for (const value of [null, '', '2026-02-30', '31/04/2026', 'not-a-date']) {
    assert.throws(() => due.provisionEarliestUnpaidDue([
      row({ DATAPREVISTOPGTO: '2026-11-23' }), row({ DATAPREVISTOPGTO: value }),
    ]), /vencimento|data/i);
  }
});

test('all proven paid or no children returns no due patch, preserving historical dates', () => {
  assert.equal(due.provisionEarliestUnpaidDue([]), null);
  assert.equal(due.provisionEarliestUnpaidDue([row({ DATAPGTOEFETUADO: '2026-01-01', PGTOAGENDADO: 'PAGO' })]), null);
});

test('metadata resolves distinct internal names for due date, actual date and payment markers', () => {
  const names = due.provisionDueFields(['DATAPREVISTOPGTO', 'DATAPGTOEFETUADO', 'PGTOAGENDADO', 'STATUS']
    .map(name => ({ name: `internal_${name}`, displayName: name })));
  assert.equal(due.provisionEarliestUnpaidDue([
    row({ internal_DATAPREVISTOPGTO: '2020-01-01', internal_DATAPGTOEFETUADO: '2020-01-01', internal_STATUS: 'PAGAMENTO EFETUADO' }),
    row({ internal_DATAPREVISTOPGTO: '2026-11-23' }),
  ], names), '2026-11-23T00:00:00Z');
});

test('child-set stability includes identity, ETag and fields even when the minimum is unchanged', () => {
  const rows = [{ id: '1', eTag: 'v1', fields: { DATAPREVISTOPGTO: '2020-01-01' } },
    { id: '2', eTag: 'v2', fields: { DATAPREVISTOPGTO: '2026-11-23' } }];
  const stamp = due.provisionChildrenStamp(rows);
  assert.equal(due.provisionChildrenStamp([...rows].reverse()), stamp);
  for (const change of [row => row.id = '3', row => row.eTag = 'v3', row => row.fields.DATAPREVISTOPGTO = '2027-01-01']) {
    const changed = structuredClone(rows); change(changed[1]);
    assert.notEqual(due.provisionChildrenStamp(changed), stamp);
  }
});
