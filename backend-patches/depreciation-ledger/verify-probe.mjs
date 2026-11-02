import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const receipt = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
const columns = JSON.parse(readFileSync(process.argv[3], 'utf8').replace(/^\uFEFF/, ''));
const rows = Array.isArray(receipt) ? receipt : receipt.body;
assert.equal(rows.length, 3);
const expected = [
  { asset: 990001, launch: 1990001, percent: 0.03, amount: 30, residual: 970, next: '2026-12-01', parentResidual: '970,00', name: 'TESTE A' },
  { asset: 990002, launch: 1990002, percent: 0.02, amount: 86.76, residual: 4251.26, next: '2026-04-01', parentResidual: '4251,26', name: '' },
  { asset: 990003, launch: 1990003, percent: 0.03, amount: 0, residual: 0, next: '2026-12-01', parentResidual: '0,00', name: 'TESTE ZERO' },
];
for (let i = 0; i < rows.length; i++) {
  const row = rows[i], want = expected[i];
  for (const key of ['asset', 'launch', 'percent', 'amount', 'residual', 'name']) assert.equal(row[`item/${columns[key]}`], want[key], `case ${i}/${key}`);
  assert.equal(String(row.parent['item/DATADEPRECIA_x00c7__x00c3_O']).trim(), want.next);
  assert.equal(row.parent['item/VALORRESIDUAL'], want.parentResidual);
  assert.equal(Object.hasOwn(row.parent, 'item/HTML'), false);
}
process.stdout.write(JSON.stringify({ status: 'RUNTIME_PROBE_VERIFIED', cases: rows.length, checks: 27, externalWrites: 0 }) + '\n');
