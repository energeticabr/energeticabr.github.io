import test from 'node:test';
import assert from 'node:assert/strict';
import { payrollBreakdownPeriods, payrollCombinedTotal } from '../src/chat/payroll-breakdown-history.js';

test('total combina pago e previsto com centavos exatos', () => {
  assert.equal(payrollCombinedTotal(0,3883.61),3883.61);
  assert.equal(payrollCombinedTotal(100,3883.61),3983.61);
  assert.equal(payrollCombinedTotal(0.1,0.2),0.3);
});

test('segunda a domingo agrupa inclusive final de semana na sexta correspondente', () => {
  const rows=[{id:'1',date:'2026-10-12'},{id:'2',date:'2026-10-18'},{id:'3',date:'2026-10-19'}];
  const periods=payrollBreakdownPeriods('2026-10',rows,'2026-10-19');
  assert.deepEqual(periods.find(p=>p.date==='2026-10-16').payments.map(p=>p.id),['1','2']);
  assert.deepEqual(periods.find(p=>p.date==='2026-10-23').payments.map(p=>p.id),['3']);
  assert.equal(periods.find(p=>p.date==='2026-10-16').past,true);
  assert.equal(periods.find(p=>p.date==='2026-10-23').past,false);
  assert.equal(periods.find(p=>p.date==='2026-10-16').weekStart,'2026-10-12');
  assert.equal(periods.find(p=>p.date==='2026-10-16').weekEnd,'2026-10-18');
});

test('sexta e último dia na mesma semana não duplicam pagamentos', () => {
  const periods=payrollBreakdownPeriods('2026-10',[{id:'8',date:'2026-10-31'}],'2026-11-02');
  assert.equal(periods.flatMap(p=>p.payments).length,1);
  assert.deepEqual(periods.find(p=>p.date==='2026-10-30').payments.map(p=>p.id),['8']);
  assert.equal(periods.find(p=>p.date==='2026-10-31').payments.length,0);
});

test('mantém pagamentos fora do mês da folha sem atribuir a semana errada', () => {
  const periods=payrollBreakdownPeriods('2026-10',[{id:'9',date:'2026-09-27'},{id:'10',date:'2026-11-02'}],'2026-10-19');
  assert.deepEqual(periods.find(p=>p.date==='2026-09-25').payments.map(p=>p.id),['9']);
  assert.deepEqual(periods.find(p=>p.date==='2026-11-06').payments.map(p=>p.id),['10']);
  assert.equal(periods.find(p=>p.date==='2026-11-06').editable,false);
});
