import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import * as model from '../src/chat/dda-report-model.js';
import {createDdaReportView} from '../src/ui/dda-report-view.js';

const flag='DDA_x0020_sem_x0020_vincula_x00e', link='DESCRITIVOPROVIS_x00c3_O';
const now=()=>new Date('2026-11-12T01:00:00Z'); // still Nov 11 in Sao Paulo
const row=(id=5,fields={})=>({id:String(id),eTag:'"7"',fields:{Title:'Fornecedor teste',SITUACAO:'Em aberto',CHAVE_DDA:'boleto-'+id,VENCIMENTO:'2026-11-11',...fields}});
const snapshot=(...rows)=>({rows});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const {normalizeDdaReportRows,hasUpcomingUnlinkedDda}=model;

test('menu alert requires an unresolved upcoming open DDA in the complete snapshot',()=>{
 const withoutAlert=normalizeDdaReportRows(snapshot(
  row(1,{VENCIMENTO:'2026-11-10'}),row(2,{VENCIMENTO:null}),row(3,{SITUACAO:'Pago'}),
  row(4,{SITUACAO:'Agendado',DDA_CICLO_AGENDAMENTO:'PAGO_AGENDADO'}),
  row(5,{PGTO_CONFIRMADO:true}),row(6,{[link]:'58'}),row(7,{[flag]:true})
 ));
 assert.equal(hasUpcomingUnlinkedDda(withoutAlert,now()),false);
 for(const fields of [{},{SITUACAO:'Agendado',VENCIMENTO:'2026-12-01'}]){
  assert.equal(hasUpcomingUnlinkedDda([...withoutAlert,...normalizeDdaReportRows(snapshot(row(8,fields)))],now()),true);
 }
});

test('writes only the review flag on the verified SharePoint version and rejects changed items',async()=>{
 const {createDdaUnlinkedReview}=await import('../src/chat/dda-unlinked-review.js');
 let current=row(5,{[flag]:false});const writes=[];
 const review=createDdaUnlinkedReview({repository:{
  resolveList:async()=>({id:'dda-list',status:'resolved'}),
  getItem:async()=>current,
  updateItem:async(site,list,id,fields,{eTag})=>{
   writes.push({site,list,id,fields,eTag});
   current={...current,fields:{...current.fields,...fields}};
   return current;
  },
 }});
 const change=(reviewed)=>review.save({row:normalizeDdaReportRows(snapshot(row(5,{[flag]:!reviewed})))[0],reviewed});
 await change(true);await change(false);
 assert.deepEqual(writes.map(({fields,eTag})=>[fields,eTag]),[[{[flag]:true},'"7"'],[{[flag]:false},'"7"']]);
 for(const fields of [{SITUACAO:'Pago'},{[link]:'58'},{CHAVE_DDA:'outro'},{[flag]:true}]){
  current=row(5,{[flag]:false,...fields});await assert.rejects(change(true));
 }
 assert.equal(writes.length,2);
});

test('report confirms both directions, cancels without writing and preserves the row position',async t=>{
 const dom=new JSDOM('<body><div id="app"></div></body>');
 const doc=dom.window.document,calls=[],updates=[];
 const report=createDdaReportView({document:doc,now,onRowsChange:rows=>updates.push(hasUpcomingUnlinkedDda(rows,now())),data:{
  loadSnapshot:async()=>snapshot(row(5),row(6,{[link]:'58'}),row(7,{SITUACAO:'Pago'})),
  unlinkedReview:{async save({row,reviewed}){calls.push([row.id,reviewed]);return {id:row.id,reviewed};}},
 }});
 t.after(()=>{report.destroy();dom.window.close();});
 await report.open();
 const cluster=()=>doc.querySelector('[data-dda-unlinked-review="5"]');
 const dialog=()=>doc.querySelector('[data-dda-unlinked-dialog]');
 const choose=answer=>Array.from(dialog().querySelectorAll('button')).find(button=>button.textContent===answer).click();
 const content=doc.querySelector('.ddr-content');content.scrollTop=145;content.scrollLeft=60;
 assert.ok(cluster(),'o cluster N/A de um DDA em aberto deve ser clicável');
 cluster().click();
 assert.match(dialog().textContent,/Deseja tornar a não vinculação regular\?/);
 choose('Não');assert.deepEqual(calls,[]);assert.equal(cluster().textContent,'N/A');
 cluster().click();choose('Sim');await tick();
 assert.deepEqual(calls,[['5',true]]);assert.equal(cluster().textContent,'SEM VINCULAÇÃO');
 assert.equal(cluster().dataset.linkState,'regularized');assert.equal(doc.activeElement,cluster());
 assert.deepEqual([content.scrollTop,content.scrollLeft],[145,60]);
 cluster().click();assert.match(dialog().textContent,/Deseja reverter a não vinculação\?/);
 choose('Não');assert.equal(cluster().textContent,'SEM VINCULAÇÃO');assert.equal(calls.length,1);
 cluster().click();choose('Sim');await tick();assert.equal(cluster().textContent,'N/A');
 assert.deepEqual(calls,[['5',true],['5',false]]);assert.deepEqual(updates,[true,false,true]);
 doc.querySelector('select[name="status"]').value='';
 doc.querySelector('select[name="status"]').dispatchEvent(new dom.window.Event('change'));
 assert.equal(doc.querySelector('[data-dda-unlinked-review="7"]'),null);
 assert.equal(doc.querySelector('[data-dda-unlinked-review="6"]'),null);
});
