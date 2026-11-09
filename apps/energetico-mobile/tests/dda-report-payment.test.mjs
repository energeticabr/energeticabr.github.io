import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createDdaReportView} from '../src/ui/dda-report-view.js';

const key='a'.repeat(64), tick=()=>new Promise(resolve=>setImmediate(resolve));
const link='DESCRITIVOPROVIS_x00c3_O';
const row=(id,status,provisionId)=>({id:String(id),fields:{Title:'FORNECEDOR FICTÍCIO',CHAVE_DDA:key,SITUACAO:status,VALOR:58.21,VENCIMENTO:'2026-11-09',[link]:provisionId}});

async function setup(t,{settled=[],onStartSettlement,loadItem}={}){
 const rows=[row(31,'Em aberto','56'),row(32,'Pago','8'),row(33,'Em aberto'),row(34,'Pago','90')];
 const dom=new JSDOM('<body><main id="app"><button>Início</button></main></body>'),doc=dom.window.document;
 const calls={writes:0,reads:[],starts:[]};
 const view=createDdaReportView({document:doc,data:{
  loadSnapshot:async()=>({rows}),
  loadItem:async(id,options)=>{calls.reads.push(id);return loadItem?loadItem(id,options):rows.find(item=>item.id===id);},
  provisionLink:{loadSettledProvisionIds:async ids=>new Set(ids.filter(id=>settled.includes(id)))},
 },confirmPayment:async()=>{calls.writes++;},
 onStartSettlement:async id=>{calls.starts.push(id);return onStartSettlement?onStartSettlement(id):true;},
 now:()=>new Date('2026-11-09T12:00:00Z')});
 t.after(()=>{view.destroy();dom.window.close();});await view.open();
 const filter=doc.querySelector('[name=status]');filter.value='';filter.dispatchEvent(new dom.window.Event('change'));
 const check=id=>doc.querySelector('[data-dda-provision-check="'+id+'"]');
 const dialog=()=>doc.querySelector('[data-dda-settlement-dialog]');
 const yes=()=>dialog().querySelector('[data-dda-settlement-yes]');
 return {check,dialog,yes,calls,doc,dom,view};
}

test('the report check is enabled for linked open or paid DDAs and disabled without a link or after settlement',async t=>{
 const h=await setup(t,{settled:['90']});
 for(const id of [31,32])assert.equal(h.check(id)?.disabled,false);
 for(const id of [33,34]){assert.equal(h.check(id)?.disabled,true);h.check(id).click();}
 assert.equal(h.dialog(),null);
 assert.deepEqual(h.calls,{writes:0,reads:[],starts:[]});
});

test('No and Escape dismiss the confirmation without reading or writing and restore focus to the check',async t=>{
 const h=await setup(t),check=h.check(32);check.focus();check.click();
 assert.match(h.dialog().textContent,/provisão.*ID 8/is);
 assert.equal(h.doc.querySelector('.ddr-dialog').inert,true);
 h.dialog().querySelector('[data-dda-settlement-no]').click();
 assert.equal(h.doc.activeElement,check);
 check.click();h.dialog().dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(h.view.element.hidden,false);assert.equal(h.dialog(),null);
 assert.equal(h.doc.querySelector('.ddr-dialog').inert,false);
 assert.deepEqual(h.calls,{writes:0,reads:[],starts:[]});
});

for(const [ddaId,provisionId,status] of [[31,'56','Em aberto'],[32,'8','Pago']])test('Yes starts the linked provision '+provisionId+' once and leaves the DDA status unchanged',async t=>{
 let resolve;const h=await setup(t,{onStartSettlement:()=>new Promise(r=>resolve=r)});
 h.check(ddaId).click();const yes=h.yes();yes.click();yes.click();await tick();
 assert.deepEqual(h.calls,{writes:0,reads:[String(ddaId)],starts:[provisionId]});
 assert.match(h.doc.querySelector('[data-dda-id="'+ddaId+'"] .ddr-status-cluster').textContent,new RegExp(status));
 resolve(true);await tick();assert.equal(h.dialog(),null);
});

test('a changed SharePoint link does not start settlement for either the stale or the new ID',async t=>{
 const h=await setup(t,{loadItem:async()=>row(31,'Em aberto','80')});
 h.check(31).click();h.yes().click();await tick();
 assert.deepEqual(h.calls,{writes:0,reads:['31'],starts:[]});
 assert.match(h.dialog().querySelector('[role=alert]').textContent,/vínculo mudou/);
});

test('closing the report during the link check aborts the request and ignores a late result',async t=>{
 let resolve,signal;const h=await setup(t,{loadItem:(_id,options)=>{signal=options.signal;return new Promise(r=>resolve=r);}});
 h.check(31).click();h.yes().click();h.view.close();resolve(row(31,'Em aberto','56'));await tick();
 assert.equal(signal.aborted,true);assert.equal(h.dialog(),null);
 assert.deepEqual(h.calls,{writes:0,reads:['31'],starts:[]});
});

test('a stalled SharePoint lookup times out, restores the confirmation controls and ignores late data',async t=>{
 let resolve,signal;const h=await setup(t,{loadItem:(_id,options)=>{signal=options.signal;return new Promise(r=>resolve=r);}});
 t.mock.timers.enable({apis:['setTimeout']});
 h.check(31).click();h.yes().click();
 t.mock.timers.tick(30_000);await tick();
 assert.equal(signal.aborted,true);
 assert.match(h.dialog().querySelector('[role=alert]').textContent,/Não foi possível conferir/);
 assert.equal(h.yes().disabled,false);
 resolve(row(31,'Em aberto','56'));await tick();
 assert.deepEqual(h.calls,{writes:0,reads:['31'],starts:[]});
});
