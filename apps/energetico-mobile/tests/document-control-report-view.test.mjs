import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {createChatView,renderChatMarkup} from '../src/ui/chat-view.js';
const {createDocumentControlReportView}=await import('../src/ui/document-control-report-view.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const row=(id,extra={})=>({id,submittedDate:'2026-10-06',issuedDate:'2026-10-04',expirationDate:'2026-10-07',branch:'004 - EDIFÍCIO XAVANTE',homologation:'HOMOLOGAÇÃO FILIAL',documentType:'PONTO ASSINADO',person:'CLEITON CESAR NONATO',stage:'ALVENARIA',property:'TODOS',status:'SUBMETIDO',...extra});
const snapshot={documents:[row(294,{status:'PENDENTE',expirationDate:''}),row(293,{expirationDate:'2026-10-05'}),row(292,{homologation:'HOMOLOGAÇÃO MÃO DE OBRA'}),row(291,{homologation:'HOMOLOGAÇÃO COMERCIAL'}),row(290,{homologation:'HOMOLOGAÇÃO CONTRATO',status:'APROVADO'})]};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(t,load=async()=>snapshot,vertical=false){
 assert.equal(typeof createDocumentControlReportView,'function');const dom=new JSDOM('<main id="app"><button>Mascote</button></main>');let portrait=vertical;
 dom.window.matchMedia=()=>({get matches(){return portrait;}});const style=dom.window.document.createElement('style');style.textContent=readFileSync(new URL('../src/ui/document-control-report.css',import.meta.url),'utf8');dom.window.document.head.append(style);
 const view=createDocumentControlReportView({document:dom.window.document,data:{loadSnapshot:load},now:()=>new Date('2026-10-06T12:00:00Z')});t.after(()=>{view.destroy();dom.window.close();});
 return {view,root:view.element,dom,rotate(value){portrait=value;dom.window.dispatchEvent(new dom.window.Event('resize'));}};
}
test('eighth left home mascot follows depreciation, uses provided detective and works by clicking the image',t=>{
 const dom=new JSDOM('<main id="app"></main>');dom.window.HTMLCanvasElement.prototype.getContext=()=>null;const view=createChatView(dom.window.document.querySelector('#app'));t.after(()=>{view.destroy();dom.window.close();});
 const state={sessionStatus:'authenticated',account:{name:'Bernardo'},draft:'',pendingFiles:[],messages:[{id:'home',role:'assistant',type:'poll',question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',options:[{id:'group_pending',label:'PENDÊNCIAS'},{id:'group_supplies',label:'SUPRIMENTOS'}]}]};
 let calls=0;view.on('open-document-control-report',()=>calls++);view.render(state);const button=dom.window.document.querySelector('[data-action=open-document-control-report]');assert.ok(button);assert.equal(button.previousElementSibling.dataset.action,'open-depreciation-report');assert.equal(button.nextElementSibling.className,'chat-bubble');assert.match(button.querySelector('img').src,/document-control\.png$/);button.querySelector('img').click();assert.equal(calls,1);
 view.render({...state,activeText:{id:'busy'}});assert.equal(dom.window.document.querySelector('[data-action=open-document-control-report]').disabled,true);assert.doesNotMatch(renderChatMarkup({...state,activeFlow:'busy'}),/data-action="open-document-control-report"/);
});
test('matches logo, seven filters, five indicators and all eleven columns with badges and relative dates',async t=>{
 const {view,root,dom}=setup(t);await view.open();assert.match(root.querySelector('img').src,/logo-energetica-oficial/);assert.equal(root.querySelectorAll('.dcr-filter').length,7);assert.equal(root.querySelectorAll('.dcr-card').length,5);
 for(const [key,value] of Object.entries({submitted:3,pending:1,total:5,expired:1,expiring15:3}))assert.equal(root.querySelector(`[data-metric=${key}] strong`).textContent,String(value));
 assert.equal(root.querySelectorAll('thead th').length,11);assert.equal(root.querySelectorAll('tbody tr').length,5);assert.match(root.querySelector('.dcr-heading').textContent,/CONTROLE DE DOCUMENTOS.*MAIOR ID/s);assert.match(root.textContent,/criado hoje.*emitido há 2 d/s);assert.match(root.querySelector('[data-document-id="293"]').textContent,/05\/10\/2026.*vencido há 1 d/s);
 for(const cls of ['filial','labor','commercial','contract'])assert.ok(root.querySelector(`.dcr-homologation-${cls}`));assert.equal(dom.window.getComputedStyle(root.querySelector('.dcr-id')).color,'rgb(151, 0, 0)');assert.equal(dom.window.getComputedStyle(root.querySelector('.dcr-expired')).backgroundColor,'rgb(254, 226, 226)');assert.match(root.querySelector('.dcr-footer').textContent,/TOTAL: 5 DOCUMENTO\(S\)/);assert.equal(root.querySelector('[aria-label*="Fechar"]'),null);
});
test('filters and sort act on actual data, update all counts and open dropdowns downward',async t=>{
 const {view,root,dom}=setup(t);await view.open();const filter=root.querySelector('select[name=status]');filter.value='PENDENTE';filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(root.querySelector('[data-metric=total] strong').textContent,'1');assert.equal(root.querySelector('tbody tr').dataset.documentId,'294');
 filter.value='';filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));const order=root.querySelector('select[name=order]');order.value='id-asc';order.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(root.querySelector('tbody tr').dataset.documentId,'290');assert.match(root.querySelector('.dcr-heading').textContent,/MENOR ID/);
 root.querySelector('.dcr-filter .sfs-arrow').click();assert.equal(root.querySelector('.dcr-filter .sfs-popup').dataset.placement,'below');assert.equal(root.querySelector('.dcr-filter .sfs-search').getAttribute('aria-expanded'),'true');
});
test('portrait avoids reads; rotating reads; outside and Escape close and restore focus',async t=>{
 let reads=0;const {view,root,dom,rotate}=setup(t,async()=>{reads++;return snapshot;},true);const trigger=dom.window.document.querySelector('button');trigger.focus();await view.open();assert.equal(reads,0);assert.equal(root.querySelector('.dcr-orientation').hidden,false);rotate(false);await tick();assert.equal(reads,1);root.querySelector('table').click();assert.equal(root.hidden,false);root.click();assert.equal(root.hidden,true);assert.equal(dom.window.document.activeElement,trigger);assert.equal(dom.window.document.getElementById('app').inert,false);
 await view.open();root.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(root.hidden,true);
});
test('refresh clears stale totals; failures show retry not zero; retry keeps focus in popup',async t=>{
 let reads=0;const {view,root,dom}=setup(t,async()=>{if(reads++===1)throw Error('network');return snapshot;});await view.open();root.querySelector('.dcr-refresh').click();assert.equal(root.querySelectorAll('.dcr-card').length,0);await tick();assert.match(root.textContent,/Não foi possível/);const retry=root.querySelector('.dcr-retry');retry.focus();retry.click();await tick();assert.equal(root.querySelectorAll('.dcr-card').length,5);assert.ok(root.contains(dom.window.document.activeElement));
 dom.window.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(root.hidden,true);
});
test('close and orientation abort stalled reads and discard late snapshots',async t=>{
 let finish,signal;const {view,root,rotate}=setup(t,options=>{signal=options.signal;return new Promise(resolve=>finish=resolve);});const opening=view.open();rotate(true);assert.equal(signal.aborted,true);finish(snapshot);await opening;assert.equal(root.querySelectorAll('.dcr-card').length,0);rotate(false);await tick();view.close();assert.equal(signal.aborted,true);finish(snapshot);await tick();assert.equal(root.hidden,true);assert.equal(root.querySelectorAll('table').length,0);
});
test('empty data has explicit zero indicators and no table; names remain safe plain text',async t=>{
 const empty=setup(t,async()=>({documents:[]}));await empty.view.open();assert.equal(empty.root.querySelectorAll('.dcr-card').length,5);assert.equal(empty.root.querySelector('table'),null);assert.match(empty.root.textContent,/Nenhum documento encontrado/);
 const safe=setup(t,async()=>({documents:[row(1,{person:'<script>alert(1)</script>',homologation:'<img src=x onerror=alert(1)>'})]}));await safe.view.open();assert.match(safe.root.textContent,/<script>/);assert.equal(safe.root.querySelectorAll('img,script').length,1);
});

test('closing restores focus to the current HOME mascot after real chat rerenders',async t=>{
 const dom=new JSDOM('<main id="app"></main>');dom.window.HTMLCanvasElement.prototype.getContext=()=>null;dom.window.matchMedia=()=>({matches:false});
 const chat=createChatView(dom.window.document.querySelector('#app')),state={sessionStatus:'authenticated',account:{name:'Bernardo'},draft:'',pendingFiles:[],messages:[{id:'home',role:'assistant',type:'poll',question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',options:[{id:'group_pending',label:'PENDÊNCIAS'},{id:'group_supplies',label:'SUPRIMENTOS'}]}]};
 const report=createDocumentControlReportView({document:dom.window.document,data:{async loadSnapshot(){return snapshot;}},now:()=>new Date('2026-10-06T12:00:00Z')});
 t.after(()=>{report.destroy();chat.destroy();dom.window.close();});chat.render(state);const old=dom.window.document.querySelector('[data-action=open-document-control-report]');old.focus();await report.open();chat.render({...state,messages:[{...state.messages[0],options:[{id:'group_pending',label:'PENDÊNCIAS (1)'},{id:'group_supplies',label:'SUPRIMENTOS'}]}]});const current=dom.window.document.querySelector('[data-action=open-document-control-report]');assert.notEqual(current,old);assert.equal(old.isConnected,false);report.close();assert.equal(dom.window.document.activeElement,current);
});
