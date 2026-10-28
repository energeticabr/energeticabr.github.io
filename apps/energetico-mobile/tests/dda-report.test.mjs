import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {normalizeDdaReportRows,buildDdaReport} from '../src/chat/dda-report-model.js';
import {createDdaReportView} from '../src/ui/dda-report-view.js';
import {createRegistrationGalleryData} from '../src/chat/registration-gallery-data.js';
import {captureFilteredReport} from '../src/ui/report-print.js';
const now=()=>new Date('2026-10-28T12:00:00Z');
const row=(id,status='Em aberto',due='2026-10-29',amount=12.34)=>({id:String(id),fields:{Title:'Fornecedor '+id,SITUACAO:status,VENCIMENTO:due,VALOR:amount,DOCUMENTO:'DOC-'+id,BANCO:'Banco teste',ULTIMA_CONSULTA:'2026-10-28T10:00:00Z'}});
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
test('open-only default includes overdue and distant bills, sorts dates and sums money precisely',()=>{
 const rows=normalizeDdaReportRows({rows:[row(1,'Pago'),row(2,'Em Aberto','2026-10-20',0.1),row(3,' EM ABERTO ','2027-01-01',0.2),row(4,'Agendado'),row(5,'Não confirmado'),row(6,'Baixado')]});
 const report=buildDdaReport(rows,undefined,now());
 assert.deepEqual(report.rows.map(r=>r.id),['2','3']);assert.equal(report.total,'0.30');assert.equal(report.overdue,1);
 assert.equal(buildDdaReport(rows,{status:''},now()).rows.length,6);
});
test('unknown status and missing amounts never become open or zero; malformed and partial snapshots reject',()=>{
 const rows=normalizeDdaReportRows({rows:[row(1,'','2026-02-30',null),row(2,'Em aberto','invalid','invalid'),row(3,'Em aberto','2026-10-28',20)]});
 const report=buildDdaReport(rows,undefined,now());assert.deepEqual(report.rows.map(r=>r.id),['3','2']);assert.equal(report.total,null);assert.equal(report.missingAmounts,1);assert.equal(report.today,1);
 for(const snapshot of [{},{rows:[],hasMore:true},{rows:[row(1),row(1)]},{rows:[{id:1}]}])assert.throws(()=>normalizeDdaReportRows(snapshot));
});
test('complete authenticated DDA source includes later pages and has no mutations',async()=>{
 let calls=0;const data=createRegistrationGalleryData({kind:'dda',repository:{resolveList:async()=>({status:'resolved',id:'dda'}),getColumns:async()=>[],getItemsPage:async()=>++calls===1?{items:[row(1)],hasMore:true,nextLink:'page2'}:{items:[row(2)],hasMore:false}}});
 const report=buildDdaReport(normalizeDdaReportRows(await data.loadSnapshot()),undefined,now());assert.equal(calls,2);assert.equal(report.rows.length,2);assert.equal(report.total,'24.68');assert.equal(data.saveEditor,undefined);
});

test('DDA source rejects malformed pages before the gallery can discard invalid records',async()=>{
 for(const badPage of [{hasMore:false},{items:[row(1),{id:'bad',fields:{VALOR:200}}],hasMore:false},{items:[{id:'1'}],hasMore:false},{items:[],hasMore:true},{items:[],nextLink:'page3',hasMore:false}]){
  let page=0;const data=createRegistrationGalleryData({kind:'dda',repository:{resolveList:async()=>({status:'resolved',id:'dda'}),getColumns:async()=>[],getItemsPage:async()=>++page===1?{items:[row(2)],hasMore:true,nextLink:'page2'}:badPage}});
  await assert.rejects(data.loadSnapshot());
 }
});
function setup(data,options={}){const dom=new JSDOM('<body><main id="app"><button id="home">DDA</button></main></body>',{url:'https://example.test'});dom.window.document.querySelector('button').focus();const view=createDdaReportView({document:dom.window.document,data,now,...options});return {dom,view,doc:dom.window.document};}
test('status clusters distinguish overdue open bills from paid bills without changing bank filters',async()=>{
 const source=[row(1,'Em aberto','2026-10-27'),row(2,'Em aberto','2026-10-28'),row(3,'Pago','2026-10-20'),row(4,'Não confirmado','2026-10-20'),row(5,'Baixado','2026-10-20')];
 const {dom,view,doc}=setup({loadSnapshot:async()=>({rows:source})});await view.open();
 const cluster=id=>doc.querySelector(`[data-dda-id="${id}"] .ddr-status-cluster`);
 assert.equal(cluster(1)?.dataset.statusTone,'overdue');assert.match(cluster(1).textContent,/Vencido/);
 assert.equal(cluster(2)?.dataset.statusTone,'open');assert.match(cluster(2).textContent,/Em aberto/);
 assert.equal(doc.querySelectorAll('tbody tr').length,2);
 const filter=doc.querySelector('[name=status]');filter.value='';filter.dispatchEvent(new dom.window.Event('change'));
 assert.equal(cluster(3)?.dataset.statusTone,'paid');assert.match(cluster(3).textContent,/Pago/);
 for(const id of [4,5])assert.equal(cluster(id)?.dataset.statusTone,'neutral');
 assert.equal(source[0].fields.SITUACAO,'Em aberto');assert.ok(cluster(1).querySelector('small'));
 view.destroy();dom.window.close();
});
test('report defaults open, can show all, resets on reopen and treats supplier text literally',async()=>{
 const a=row(1);a.fields.Title='<img src=x onerror=alert(1)>';
 const {dom,view,doc}=setup({loadSnapshot:async()=>({rows:[a,row(2,'Pago')]})});
 await view.open();assert.equal(doc.querySelector('[name=status]').value,'Em aberto');assert.equal(doc.querySelectorAll('tbody tr').length,1);assert.match(doc.body.textContent,/<img src=x/);assert.equal(doc.querySelector('td img'),null);
 const status=doc.querySelector('[name=status]');status.value='';status.dispatchEvent(new dom.window.Event('change'));assert.equal(doc.querySelectorAll('tbody tr').length,2);
 view.close();assert.equal(doc.activeElement.id,'home');await view.open();assert.equal(status.value,'Em aberto');assert.equal(doc.querySelectorAll('tbody tr').length,1);
 view.destroy();dom.window.close();
});
test('pagination totals include all filtered rows and print expands them then restores page',async()=>{
 const {dom,view,doc}=setup({loadSnapshot:async()=>({rows:Array.from({length:53},(_,i)=>row(i+1))})});await view.open();
 assert.equal(doc.querySelectorAll('tbody tr').length,50);assert.match(doc.querySelector('[data-dda-summary]').textContent,/53/);
 doc.querySelector('[data-page-next]').click();assert.equal(doc.querySelectorAll('tbody tr').length,3);
 const restore=await view.preparePrint();assert.equal(doc.querySelectorAll('tbody tr').length,53);restore();assert.equal(doc.querySelectorAll('tbody tr').length,3);
 const reset=await view.preparePrint(),snapshot=captureFilteredReport(view.element,{title:'Relatório DDA'});reset();
 assert.equal(snapshot.pages[0].blocks.find(block=>block.type==='table').rows.length,54);
 assert.ok(snapshot.filters.some(filter=>filter.label==='Situação'&&filter.value==='Em aberto'));
 assert.equal(doc.querySelectorAll('tbody tr').length,3);
 view.destroy();dom.window.close();
});

test('changing filters while printing cancels the expansion and stale restoration',async()=>{
 const {dom,view,doc}=setup({loadSnapshot:async()=>({rows:Array.from({length:53},(_,i)=>row(i+1))})});await view.open();
 const restore=await view.preparePrint();assert.equal(doc.querySelectorAll('tbody tr').length,53);
 doc.querySelector('[name=status]').dispatchEvent(new dom.window.Event('change'));assert.equal(doc.querySelectorAll('tbody tr').length,50);
 doc.querySelector('[data-page-next]').click();restore();assert.equal(doc.querySelectorAll('tbody tr').length,3);
 view.destroy();dom.window.close();
});
test('mirror opens only on click and late attachment replies after close are ignored',async()=>{
 let resolve,reads=0;const opened=[];const data={loadSnapshot:async()=>({rows:[row(1)]}),listAttachments:async()=>{reads++;return [{fileName:'espelho.pdf'}];},downloadAttachment:async()=>new Blob(['%PDF'],{type:'application/pdf'})};
 const {dom,view,doc}=setup(data,{openMediaCollection:items=>opened.push(items)});await view.open();assert.equal(reads,0);doc.querySelector('[data-dda-mirror]').click();await settle();assert.equal(opened[0][0].fileName,'espelho.pdf');assert.equal((await opened[0][0].source({})).type,'application/pdf');
 data.listAttachments=()=>new Promise(r=>resolve=r);doc.querySelector('[data-dda-mirror]').click();await settle();view.close();resolve([{fileName:'late.pdf'}]);await settle();assert.equal(opened.length,1);
 view.destroy();dom.window.close();
});
test('closed loads and failed refresh cannot show stale rows or print stale totals',async()=>{
 let resolve;const data={loadSnapshot:async()=>({rows:[row(1)]})};const {dom,view,doc}=setup(data);await view.open();
 data.loadSnapshot=async()=>{throw new Error('private detail');};doc.querySelector('[aria-label="Atualizar DDAs"]').click();await settle();assert.equal(doc.querySelectorAll('tbody tr').length,0);assert.doesNotMatch(doc.body.textContent,/private detail/);await assert.rejects(view.preparePrint());
 view.close();data.loadSnapshot=()=>new Promise(r=>resolve=r);const pending=view.open();await settle();view.close();resolve({rows:[row(2)]});await pending;assert.equal(doc.querySelectorAll('tbody tr').length,0);
 view.destroy();dom.window.close();
});

test('automatic opening shows unpaid scheduled titles while manual reopening remains open-only',async()=>{
 const {dom,view,doc}=setup({loadSnapshot:async()=>({rows:[row(1),row(2,'Agendado'),row(3,'Pago')]})});
 await view.open({automatic:true,initialSnapshot:{rows:[row(1),row(2,'Agendado'),row(3,'Pago')]}});
 assert.equal(doc.querySelector('[name=status]').value,'Não pagos');assert.equal(doc.querySelectorAll('tbody tr').length,2);
 view.close();await view.open();assert.equal(doc.querySelector('[name=status]').value,'Em aberto');assert.equal(doc.querySelectorAll('tbody tr').length,1);
 view.destroy();dom.window.close();
});
