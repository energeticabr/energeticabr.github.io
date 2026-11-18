import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGanttCostDetail } from '../src/chat/stage-gantt-cost-model.js';

const selection = { branch: 'Obra A', stage: 'Fundação' };
const paid = (id, paymentDate, total, extra = {}) => ({ id, branch: 'Obra A', stage: 'Fundação', product: 'Concreto', date: '2020-01-01', paymentDate, total, ...extra });
const forecast = (id, dueDate, total, extra = {}) => ({ id, branch: 'Obra A', stage: 'Fundação', product: 'Concreto', dueDate, total, ...extra });
const snapshot = () => ({ launches: [
  paid('1', '2025-01-10', 100), paid('2', '2026-02-10', 200),
  paid('3', '2026-03-10', 0), paid('4', '2027-04-10', 999, { branch: 'Obra B' }),
  paid('5', '2027-05-10', 999, { stage: 'Pintura' }), paid('6', '', 999),
], provisions: [forecast('7', '2026-02-12', 50), forecast('8', '2026-01-10', 30),
  forecast('9', '2028-06-10', 999, { paidDate: '2028-06-10' }),
  forecast('10', '2028-07-10', 999, { schedule: 'PAGO' }),
  forecast('11', '2028-08-10', 999, { status: 'PAGAMENTO EFETUADO' }),
], productTypes: [{ product: 'Concreto', expenseType: 'MATERIAL' }] });

test('custo isola etapa/filial, oferece apenas períodos com valores e inicia no mais recente', () => {
  const source = snapshot(), original = structuredClone(source);
  const result = buildGanttCostDetail(source, selection);
  assert.deepEqual(result.years, ['2026', '2025']);
  assert.deepEqual(result.months, ['1', '2']);
  assert.equal(result.year, '2026'); assert.equal(result.month, '2');
  const { change, ...totals } = result.report.summary;
  assert.deepEqual(totals, { paid: 200, forecast: 50, total: 250, previousTotal: 30 });
  assert.equal(change.toFixed(2), '733.33');
  assert.equal(result.report.expenseBranches[0].expenseTypes[0].name, 'MATERIAL');
  assert.deepEqual(source, original);
});

test('mudar ano ajusta meses, mês vazio soma ano, e identificação aceita normalização das etapas', () => {
  const source = snapshot(); source.launches[0].stage = ' FUNDACAO ';
  const result = buildGanttCostDetail(source, selection, { year: '2025', month: '2' });
  assert.deepEqual(result.months, ['1']); assert.equal(result.month, '1');
  assert.equal(result.report.summary.total, 100);
  const annual = buildGanttCostDetail(source, selection, { year: '2026', month: '' });
  assert.equal(annual.month, ''); assert.equal(annual.report.summary.total, 280);
});

test('sem custo não inventa períodos; valor desconhecido não vira zero e snapshot parcial é rejeitado', () => {
  const empty = buildGanttCostDetail({ launches: [], provisions: [], productTypes: [] }, selection);
  assert.deepEqual(empty.years, []); assert.deepEqual(empty.months, []);
  const source = snapshot(); source.launches.push(paid('12', '2029-09-10', null));
  const detail = buildGanttCostDetail(source, selection);
  assert.equal(detail.year, '2029'); assert.equal(detail.report.summary.total, null);
  for (const invalid of [{}, { ...source, partial: true }, { ...source, truncated: true }, { ...source, error: 'network' }]) {
    assert.throws(() => buildGanttCostDetail(invalid, selection), /complet/i);
  }
  assert.throws(() => buildGanttCostDetail(source, { branch: '', stage: 'Fundação' }), /etapa/i);
});
