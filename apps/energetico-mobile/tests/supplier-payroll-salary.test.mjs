import test from 'node:test';
import assert from 'node:assert/strict';
import * as overview from '../src/chat/supplier-payroll-report-model.js';
const model=await import('../src/chat/supplier-payroll-salary.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const source=()=>({sheets:[{id:'8',supplier:'Ana',month:'2026-10'},{id:'9',supplier:'Ana',month:'2026-10'},
  {id:'7',supplier:'Ana',month:'2026-09'}],suppliers:[{id:'17',supplier:'Ana'}],
  employees:[{id:'3',supplierId:'17',cargo:'PEDREIRO I'}],
  salaries:[{id:'1',cargo:'PEDREIRO I',salary:'3.000,00',effectiveDate:'2026-01-01'},
    {id:'2',cargo:'PEDREIRO I',salary:'3.200,50',effectiveDate:'2026-10-01'},
    {id:'4',cargo:'PEDREIRO I',salary:'9999',effectiveDate:'2026-11-01'}]});
function build(input){assert.equal(typeof model.buildPayrollSalaryExpectations,'function');return model.buildPayrollSalaryExpectations(input);}

test('salary uses exact supplier origin ID and cargo effective in the reference month',()=>{
 const input=source(),before=structuredClone(input),values=build(input);
 assert.deepEqual(values,{'8':320050,'9':320050,'7':300000});assert.deepEqual(input,before);
 assert.ok(Object.isFrozen(values));
});
test('overview counts salary once per distinct selected competence, not per payroll ID',()=>{
 const input=source(),snapshot={complete:true,sheets:input.sheets,salaryExpectations:build(input)};
 assert.equal(overview.buildSupplierPayrollOverview(snapshot,{month:'2026-10'}).groups[0].expectedSalaryCents,320050);
 assert.equal(overview.buildSupplierPayrollOverview(snapshot).groups[0].expectedSalaryCents,620050);
});
test('no fuzzy name profession fallback, missing RH cargo or ambiguous identities never invent expected salary',()=>{
 const cases=[input=>input.suppliers.push({id:'18',supplier:'ANA'}),
  input=>input.employees.push({...input.employees[0],id:'4'}),
  input=>input.employees[0].supplierId='18',input=>input.employees[0].cargo='',
  input=>input.suppliers[0].supplier='Ána',input=>input.employees=[],input=>input.salaries=[],
  input=>input.salaries.push({...input.salaries[1],id:'5'}),
  input=>input.salaries[1].effectiveDate='invalid'];
 for(const mutate of cases){const input=source();mutate(input);assert.equal(build(input)['8'],null);}
});
test('invalid, blank, negative, zero and unsafe salary values remain unknown instead of zero',()=>{
 for(const salary of [null,'','R$','abc','1.234',NaN,Infinity,-1,0,'999999999999999999999999',{},true]){
  const input=source();input.salaries[1].salary=salary;assert.equal(build(input)['8'],null,String(salary));
 }
});
test('stored Brazilian salary currency preserves thousands and rounds exact cents',()=>{
 for(const [salary,cents] of [['R$ 3.000',300000],['1.234.567',123456700],['3200.50',320050],['3.200,50',320050],[3200.505,320051],[123.456,12346]]){
  const input=source();input.salaries[1].salary=salary;assert.equal(build(input)['8'],cents);
 }
});
test('legacy month, malformed date, missing reference and incomplete multi-month salary do not fabricate totals',()=>{
 const input=source();input.sheets.push({id:'6',supplier:'Ana',month:''});const values=build(input);
 assert.equal(values['6'],null);
 const snapshot={complete:true,sheets:input.sheets,salaryExpectations:values};
 assert.equal(overview.buildSupplierPayrollOverview(snapshot).groups[0].expectedSalaryCents,null);
 input.salaries[1].effectiveDate='2026-10-31T00:00:00Z';assert.equal(build(input)['8'],320050);
 input.salaries[1].effectiveDate='2026-02-30';assert.equal(build(input)['8'],null);
});
