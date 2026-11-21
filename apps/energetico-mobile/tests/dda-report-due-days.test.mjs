import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createDdaReportView} from '../src/ui/dda-report-view.js';

async function setup(t,dates,instant='2026-11-04T22:00:00-03:00'){
 const dom=new JSDOM('<body><main id="app"></main></body>');
 const report=createDdaReportView({document:dom.window.document,now:()=>new Date(instant),
  data:{loadSnapshot:async()=>({rows:dates.map((due,i)=>({id:String(i+1),fields:{Title:'Fornecedor fictício',VENCIMENTO:due,VALOR:10,SITUACAO:'Em aberto'}}))})}});
 t.after(()=>{report.destroy();dom.window.close();});
 await report.open();
 return {report,cell:id=>dom.window.document.querySelector(`[data-dda-id="${id}"] .ddr-due`)};
}

test('report distinguishes overdue, today, tomorrow and later due dates in the day cluster',async t=>{
 const {cell,report}=await setup(t,['2026-11-04','2026-11-05','2026-11-03','2026-11-09','2026-10-23']);
 for(const [id,label,tone,date] of [[1,'0 d','today','04/11/2026(quarta-feira)'],[2,'1 d','tomorrow','05/11/2026(quinta-feira)'],[3,'-1 d','overdue','03/11/2026(terça-feira)'],[4,'5 d','other','09/11/2026(segunda-feira)'],[5,'-12 d','overdue','23/10/2026(sexta-feira)']]){
  const due=cell(id),badge=due.querySelector('.ddr-due-days');
  assert.ok(badge,'days-until-due badge must exist');
  assert.equal(due.dataset.dueTone,tone);
  assert.equal(due.firstElementChild.textContent,date);
  assert.equal(due.firstElementChild.nextElementSibling,badge);
  assert.equal(badge.textContent,label);
 }
 const restore=await report.preparePrint();
 assert.equal(cell(1).querySelector('.ddr-due-date').textContent,'04/11/2026(quarta-feira)');
 assert.equal(cell(1).querySelector('.ddr-due-days').textContent,'0 d');
 assert.equal(cell(3).dataset.dueTone,'overdue');
 restore();
 assert.equal(cell(3).querySelector('.ddr-due-days').textContent,'-1 d');
});

test('missing and invalid due dates do not show a fabricated day count',async t=>{
 const {cell}=await setup(t,[null,'','invalid','2026-02-30']);
 for(let id=1;id<=4;id++){
  assert.equal(cell(id).querySelector('.ddr-due-date').textContent,'Não informado');
  assert.equal(cell(id).dataset.dueTone,'unknown');
  assert.equal(cell(id).querySelector('.ddr-due-days'),null);
 }
});

test('day distance uses the São Paulo calendar across UTC midnight and month/year/leap boundaries',async t=>{
 for(const [instant,dates,expected] of [
  ['2026-11-05T01:59:59Z',['2026-11-04','2026-11-05'],['0 d','1 d']],
  ['2026-11-05T03:00:00Z',['2026-11-04','2026-11-05'],['-1 d','0 d']],
  ['2026-12-31T23:59:00-03:00',['2027-01-01'],['1 d']],
  ['2028-02-28T12:00:00-03:00',['2028-02-29','2028-03-01'],['1 d','2 d']],
  ['2026-10-30T12:00:00-03:00',['2026-10-31T00:00:00Z'],['1 d']],
  ['2026-10-31T12:00:00-03:00',['2026-11-01T00:00:00Z'],['1 d']]
 ]){
  const {cell}=await setup(t,dates,instant);
  for(let i=0;i<dates.length;i++)assert.equal(cell(i+1).querySelector('.ddr-due-days')?.textContent,expected[i],instant);
  if(dates[0]==='2026-10-31T00:00:00Z')assert.equal(cell(1).querySelector('.ddr-due-date').textContent,'31/10/2026(sábado)');
  if(dates[0]==='2026-11-01T00:00:00Z')assert.equal(cell(1).querySelector('.ddr-due-date').textContent,'01/11/2026(domingo)');
 }
});
