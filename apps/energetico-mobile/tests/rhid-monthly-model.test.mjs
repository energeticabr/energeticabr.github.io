import test from 'node:test';
import assert from 'node:assert/strict';
const supplier={id:'4',name:'MAURÍCIO HONORATO DE SOUZA'};
const row=(day,punches,extra={})=>({Id:day,ID_PESSOA_RHID:'101',NOME_COLABORADOR:'Mauricio Honorato de Souza',DATA_REFERENCIA:day,BATIDAS_RHID:punches,STATUS_RHID:'ATIVO',...extra});
const build=async (rows,month='2026-10')=>{
 const module=await import('../src/chat/rhid-monthly-model.js');
 return module.buildRhidMonthlyReport({month,supplier,snapshot:{month,presentDates:[],rows}});
};
test('monthly calculation separates days and preserves effective corrections',async()=>{
 const report=await build([row('2026-10-01','07:00;12:00;13:00;17:00'),row('2026-10-02','07:00;12:00;13:00',{ADMIN_AJUSTES:{exit2:{time:'16:00',adjustedAt:'2026-10-02T20:00:00Z'}}}),row('2026-10-03','07:00'),row('2026-10-01','07:00;12:00;13:00;18:00',{NOME_COLABORADOR:'Outro fornecedor',ID_PESSOA_RHID:'102'})]);
 assert.equal(report.days.length,31);assert.equal(report.total,'17:00');assert.equal(report.recordedDays,3);assert.equal(report.incompleteDays,1);
 assert.equal(report.days[0].total,'09:00');assert.equal(report.days[1].total,'08:00');assert.equal(report.days[1].adjusted,true);
 assert.equal(report.days[2].total,null);assert.equal(report.days[3].recorded,false);
});
test('monthly report does not merge same-name people with different RHID identities',async()=>{
 await assert.rejects(build([row('2026-10-01','07:00'),row('2026-10-02','12:00',{ID_PESSOA_RHID:'102'})]),/ambígu|identidade/i);
});
test('monthly report refuses missing, wrong-month and truncated snapshots',async()=>{
 const {buildRhidMonthlyReport}=await import('../src/chat/rhid-monthly-model.js');
 for(const snapshot of [{month:'2026-10'},{month:'2026-09',rows:[]},{month:'2026-10',rows:[],partial:true},{month:'2026-10',rows:[row('2026-10-32','07:00')]}])assert.throws(()=>buildRhidMonthlyReport({month:'2026-10',supplier,snapshot}),/inválid|incomplet/i);
});
test('monthly calendar handles leap February and marks no records without inventing absence',async()=>{
 const report=await build([],'2024-02');assert.equal(report.days.length,29);assert.equal(report.total,'00:00');assert.equal(report.recordedDays,0);assert.ok(report.days.every(d=>!d.recorded&&d.total===null));
 await assert.rejects(build([],'2026-13'),/mês|período/i);
});
