import test from 'node:test';
import assert from 'node:assert/strict';
import { payrollProvisionDates, validatePayrollBreakdown, isPayrollBreakdownMenu } from '../src/chat/payroll-breakdown.js';

const supplier = { id: '4', label: 'Ana', branch: 'OBRA A', profession: 'PEDREIRO' };
const draft = lines => ({ supplier, month: '2026-10', lines });

test('datas incluem todas as sextas e fim de mês sem duplicar sexta no último dia', () => {
  assert.deepEqual(payrollProvisionDates('2026-10').map(day => day.date), ['2026-10-02','2026-10-09','2026-10-16','2026-10-23','2026-10-30','2026-10-31']);
  assert.deepEqual(payrollProvisionDates('2026-02').map(day => day.date), ['2026-02-06','2026-02-13','2026-02-20','2026-02-27','2026-02-28']);
  assert.equal(payrollProvisionDates('2024-02').at(-1).date, '2024-02-29');
  const august = payrollProvisionDates('2026-07');
  assert.equal(august.filter(day => day.date === '2026-07-31').length, 1);
  assert.deepEqual(august.at(-1), { date: '2026-07-31', friday: true, monthEnd: true });
  assert.throws(() => payrollProvisionDates('2026-13'));
});

test('resume por rubrica com centavos exatos, ignora valores vazios e gera observação por data', () => {
  const result = validatePayrollBreakdown(draft([
    { date: '2026-10-02', rubric: 'salary', quantity: '3', unitValue: '0,10' },
    { date: '2026-10-09', rubric: 'salary', quantity: '2', unitValue: '10,35' },
    { date: '2026-10-31', rubric: 'vacation', quantity: '1', unitValue: '1.234,56' },
    { date: '2026-10-09', rubric: 'meal', quantity: '', unitValue: '' },
  ]));
  assert.equal(result.total, 1255.56);
  assert.equal(result.rubrics.find(row => row.rubric === 'salary').total, 21);
  assert.equal(result.lines.length, 3);
  assert.equal(result.lines[0].observation, 'Pagamento de Salário referente à semana anterior à data 02/10/2026');
});

test('recusa datas fora do calendário, duplicação, fornecedor incompleto e quantidades inválidas', () => {
  const line = { date: '2026-10-02', rubric: 'salary', quantity: '1', unitValue: '10' };
  for (const change of [{ date: '2026-10-03' }, { date: '2026-11-06' }, { rubric: 'unknown' }, { quantity: '' }, { quantity: '0' }, { unitValue: '-10' }])
    assert.throws(() => validatePayrollBreakdown(draft([{ ...line, ...change }])));
  assert.throws(() => validatePayrollBreakdown(draft([line, line])), /repetida/);
  assert.throws(() => validatePayrollBreakdown({ ...draft([line]), supplier: { ...supplier, profession: '' } }), /profissão/);
  assert.throws(() => validatePayrollBreakdown(draft([])), /pelo menos/);
});

test('atalho pertence ao menu de provisão e despesas recorrentes', () => {
  assert.equal(isPayrollBreakdownMenu({ options: [{ id: 'action_payment' }, { reply: 'action_recurring_expense' }] }), true);
  assert.equal(isPayrollBreakdownMenu({ options: [{ id: 'action_payment' }] }), false);
});
