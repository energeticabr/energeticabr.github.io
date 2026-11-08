import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {normalizeDdaReportRows,buildDdaReport} from '../src/chat/dda-report-model.js';
import {createDdaReportView} from '../src/ui/dda-report-view.js';
import {captureFilteredReport} from '../src/ui/report-print.js';

const now=()=>new Date('2026-11-06T01:30:00Z'); // Still November 5 in Sao Paulo.
const row=(id,due,amount,status='Em aberto',bank='Banco A')=>({id:String(id),fields:{Title:'Fornecedor exemplo '+id,VENCIMENTO:due,VALOR:amount,SITUACAO:status,BANCO:bank}});
const source=[row(1,'2026-11-04',900),row(2,'2026-11-05',0.1),row(3,'2026-11-05',0.2),row(4,'2026-11-06',10),row(5,'2026-11-12',20),row(6,'2026-11-13',800),row(7,null,700),row(8,'2026-11-05',100,'Pago'),row(9,'2026-11-08',40,'Agendado','Banco B')];
const report=(rows,filters)=>buildDdaReport(normalizeDdaReportRows({rows}),filters,now());

test('due metrics include today and day seven, exclude overdue and day eight, and sum cents exactly in Sao Paulo',()=>{
 const result=report(source);
 assert.equal(result.dueWithin7Days,5);
 assert.equal(result.totalDueWithin7Days,'70.30');
 assert.equal(result.totalDueToday,'0.30');
 assert.equal(result.today,2);
 assert.equal(report(source,{status:'Não pagos'}).totalDueWithin7Days,'70.30');
 assert.equal(report(source,{status:'',bank:'Banco B'}).totalDueWithin7Days,'40.00');
 assert.equal(report(source,{search:'exemplo 5'}).totalDueWithin7Days,'20.00');
 assert.equal(report(source,{search:'inexistente'}).totalDueToday,'0.00');
 const monthEnd=buildDdaReport(normalizeDdaReportRows({rows:[row(1,'2027-01-05',12),row(2,'2027-01-06',99)]}),{},new Date('2026-12-29T12:00:00Z'));
 assert.equal(monthEnd.dueWithin7Days,1);assert.equal(monthEnd.totalDueWithin7Days,'12.00');
});

test('a missing amount invalidates only the matching period total and never becomes zero',()=>{
 const outside=report([row(1,'2026-11-05',5),row(2,'2026-11-13',null)]);
 assert.equal(outside.total,null);assert.equal(outside.totalDueWithin7Days,'5.00');assert.equal(outside.totalDueToday,'5.00');
 const upcoming=report([row(1,'2026-11-05',5),row(2,'2026-11-12',null)]);
 assert.equal(upcoming.dueWithin7Days,2);assert.equal(upcoming.totalDueWithin7Days,null);assert.equal(upcoming.totalDueToday,'5.00');
 const today=report([row(1,'2026-11-05',null)]);
 assert.equal(today.totalDueToday,null);assert.equal(today.totalDueWithin7Days,null);
});

test('visible and printed metrics include all filtered pages and recalculate with every filter',async()=>{
 const dom=new JSDOM('<body><main id="app"></main></body>',{url:'https://example.test'}),doc=dom.window.document;
 const data=[...Array.from({length:51},(_,i)=>row(i+1,'2026-11-05',10)),row(52,'2026-11-12',20,'Em aberto','Banco B'),row(53,'2026-11-05',100,'Pago')];
 const view=createDdaReportView({document:doc,now,data:{loadSnapshot:async()=>({rows:data})}});
 const metrics=()=>Object.fromEntries([...doc.querySelectorAll('.ddr-metric')].map(n=>[n.querySelector('span').textContent,n.querySelector('strong').textContent.replace(/\s/g,' ')]));
 const check=(count,week,today)=>{
  assert.equal(metrics()['Qtd DDA vencendo em 7d'],count);
  assert.equal(metrics()['Valor DDA vencendo em 7d'],week);
  assert.equal(metrics()['Valor DDA vencendo hoje'],today);
 };
 const filter=(name,value)=>{const control=doc.querySelector(`[name="${name}"]`);control.value=value;control.dispatchEvent(new dom.window.Event(name==='search'?'input':'change'));};
 try{
  await view.open();check('52','R$ 530,00','R$ 510,00');
  doc.querySelector('[data-page-next]').click();check('52','R$ 530,00','R$ 510,00');
  const restore=await view.preparePrint();
  const snapshot=captureFilteredReport(view.element,{title:'Relatório DDA'});
  assert.match(JSON.stringify(snapshot),/Valor DDA vencendo em 7d/);
  check('52','R$ 530,00','R$ 510,00');restore();
  filter('bank','Banco B');check('1','R$ 20,00','R$ 0,00');
  filter('bank','');filter('status','');check('53','R$ 630,00','R$ 610,00');
  filter('search','inexistente');check('0','R$ 0,00','R$ 0,00');
 }finally{view.destroy();dom.window.close();}
});
