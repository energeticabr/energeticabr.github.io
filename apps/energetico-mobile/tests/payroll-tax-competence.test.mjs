import test from 'node:test';
import assert from 'node:assert/strict';
import * as payroll from '../src/chat/supplier-payroll.js';

const taxDraft = () => ({
  date: '2026-10-20', supplier: {id:'1',label:'PESSOA TESTE',branch:'OBRA A'},
  product:{id:'2',label:'PEDREIRO'},stage:{id:'3',label:'ETAPA'},
  sheet:null,taxCompetence:'2026-09',taxSheet:{id:'8',label:'09/2026'},
  lines:[{rubric:'inss',quantity:'1',unitValue:'120,50',account:{id:'4',label:'PIX'}}],
});

test('INSS and FGTS are literal canonical rubrics and a tax-only draft needs no normal sheet',()=>{
  assert.deepEqual(payroll.PAYROLL_RUBRICS.slice(-2).map(r=>[r.id,r.payrollType]),[['inss','INSS'],['fgts','FGTS']]);
  assert.equal(payroll.validatePayrollDraft(taxDraft()).total,120.5);
});

test('tax draft rejects absent, wrong-month and ambiguous-looking competence before posting',()=>{
  for(const patch of [{taxCompetence:''},{taxCompetence:'2026-13'},{taxSheet:null},{taxSheet:{id:'8',label:'10/2026'}}]) {
    assert.throws(()=>payroll.validatePayrollDraft({...taxDraft(),...patch}),/competência|IDFOLHA/i);
  }
});

test('competence policy crosses January and validates dates instead of using the current clock',()=>{
  assert.equal(payroll.previousPayrollCompetence('2027-01-01'),'2026-12');
  assert.equal(payroll.previousPayrollCompetence('2026-10-20'),'2026-09');
  assert.equal(payroll.previousPayrollCompetence('2026-02-30'),'');
  assert.equal(payroll.payrollCompetenceMonth('09/2026'),'2026-09');
  assert.equal(payroll.payrollCompetenceMonth('2026-09-01T00:00:00Z'),'2026-09');
  for(const invalid of ['2026-13','2026-09-anything','2026-02-30','']) assert.equal(payroll.payrollCompetenceMonth(invalid),'');
  assert.equal(payroll.payrollTaxType('FGTS'),true);
  assert.equal(payroll.payrollTaxType('SALÁRIO'),false);
});
