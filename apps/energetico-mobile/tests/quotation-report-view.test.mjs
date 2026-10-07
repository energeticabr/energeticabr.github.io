import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {createChatView,renderChatMarkup} from '../src/ui/chat-view.js';
const {createQuotationReportView}=await import('../src/ui/quotation-report-view.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const snapshot={complete:true,quotes:[{id:'4',branch:'Obra',stage:'Estrutura',description:'Conferir valores',status:'ATIVA'},{id:'5',branch:'',stage:'',description:'',status:'PENDENTE SOLICITAÇÃO'}],budgets:[{id:'8',quotationId:'4',branch:'Obra',stage:'Estrutura',supplier:'Fornecedor A',finalizedDate:'2026-10-05',total:1234.5,status:'AGUARDANDO ORÇAMENTO',observation:'Teste'},{id:'9',quotationId:'4',branch:'Obra',stage:'Estrutura',supplier:'Fornecedor A',finalizedDate:null,total:0,status:'ORÇAMENTO RECEBIDO',observation:''},{id:'10',quotationId:'99',branch:'',stage:'',supplier:'',finalizedDate:null,total:null,status:'PENDENTE SOLICITAÇÃO',observation:''}]};
function setup(t,load=async()=>snapshot,vertical=false){
 assert.equal(typeof createQuotationReportView,'function');const dom=new JSDOM('<main id="app"><button>Mascote</button></main>');let portrait=vertical;dom.window.matchMedia=()=>({get matches(){return portrait;}});
 const style=dom.window.document.createElement('style');style.textContent=readFileSync(new URL('../src/ui/quotation-report.css',import.meta.url),'utf8');dom.window.document.head.append(style);
 const view=createQuotationReportView({document:dom.window.document,data:{loadSnapshot:load}});t.after(()=>{view.destroy();dom.window.close();});return {view,root:view.element,dom,rotate(value){portrait=value;dom.window.dispatchEvent(new dom.window.Event('resize'));}};
}
test('sixth left mascot follows validation, launches own event and is unavailable during a flow',t=>{
 const dom=new JSDOM('<main id="app"></main>');dom.window.HTMLCanvasElement.prototype.getContext=()=>null;const view=createChatView(dom.window.document.querySelector('#app'));t.after(()=>{view.destroy();dom.window.close();});
 const state={sessionStatus:'authenticated',account:{name:'Bernardo'},draft:'',pendingFiles:[],messages:[{id:'home',role:'assistant',type:'poll',question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',options:[{id:'group_pending',label:'PENDÊNCIAS'},{id:'group_supplies',label:'SUPRIMENTOS'}]}]};let calls=0;view.on('open-quotation-report',()=>calls++);view.render(state);const button=dom.window.document.querySelector('[data-action=open-quotation-report]');assert.ok(button);assert.equal(button.previousElementSibling.dataset.action,'open-order-validation-report');assert.equal(button.closest('.chat-bubble'),null);button.querySelector('img').click();assert.equal(calls,1);view.render({...state,activeText:{id:'busy'}});assert.equal(dom.window.document.querySelector('[data-action=open-quotation-report]').disabled,true);assert.equal(new JSDOM(renderChatMarkup({...state,activeFlow:'busy'})).window.document.querySelector('[data-action=open-quotation-report]'),null);
});
test('source metrics count orphan pending budgets and table retains nine columns, merged groups and missing values',async t=>{
 const {view,root,dom}=setup(t);await view.open();assert.equal(root.querySelectorAll('.qr-card').length,4);assert.equal(root.querySelector('[data-metric=active] strong').textContent,'1');assert.equal(root.querySelector('[data-metric=pending] strong').textContent,'1');assert.deepEqual([...root.querySelectorAll('.qr-quote h3')].map(n=>n.textContent),['COTAÇÃO Nº 5','COTAÇÃO Nº 4']);
 const tables=root.querySelectorAll('.qr-budgets');assert.equal(tables.length,2);assert.equal(tables[0].querySelectorAll('thead th').length,9);assert.equal(tables[0].querySelector('tbody td').colSpan,9);assert.match(tables[0].textContent,/Nenhum orçamento vinculado/);assert.equal(tables[1].querySelectorAll('td[rowspan="2"]').length,3);assert.match(tables[1].textContent,/05\/10\/2026/);assert.match(tables[1].textContent,/1\.234,50/);assert.match(tables[1].textContent,/0,00/);assert.equal(root.querySelectorAll('select,.qr-brand,.qr-close').length,0);assert.equal(root.querySelector('[data-quote-status]').className,'qr-badge qr-neutral');assert.equal(dom.window.getComputedStyle(root.querySelector('.qr-awaiting')).color,'rgb(194, 65, 12)');
});
test('portrait does not query, rotation loads, outside and Escape restore focus and inert state',async t=>{
 let reads=0;const {view,root,dom,rotate}=setup(t,async()=>{reads++;return snapshot;},true);const trigger=dom.window.document.querySelector('button');trigger.focus();await view.open();assert.equal(reads,0);assert.equal(root.querySelector('.qr-orientation').hidden,false);rotate(false);await new Promise(r=>setImmediate(r));assert.equal(reads,1);root.querySelector('table').click();assert.equal(root.hidden,false);root.click();assert.equal(root.hidden,true);assert.equal(dom.window.document.activeElement,trigger);assert.equal(dom.window.document.getElementById('app').inert,false);await view.open();root.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(root.hidden,true);
});
test('closing aborts late reads and failure removes old data, with retry available',async t=>{
 let finish,signal;const {view,root}=setup(t,o=>{signal=o.signal;return new Promise(r=>finish=r);});const loading=view.open();view.close();assert.equal(signal.aborted,true);finish(snapshot);await loading;assert.equal(root.querySelectorAll('table').length,0);
 let count=0;const other=setup(t,async()=>{if(count++===0)throw Error('network');return snapshot;});await other.view.open();assert.equal(other.root.querySelectorAll('.qr-card').length,0);assert.match(other.root.textContent,/Não foi possível/);other.root.querySelector('.qr-retry').click();await new Promise(r=>setImmediate(r));assert.equal(other.root.querySelectorAll('.qr-card').length,4);
});

test('quotation toolbar refresh rereads SharePoint and is disabled while loading',async t=>{
 let reads=0,finish;
 const {view,root}=setup(t,async()=>{reads++;if(reads===2)return new Promise(resolve=>{finish=resolve;});return snapshot;});
 await view.open();
 const refresh=root.querySelector('button[aria-label="Atualizar cotações e orçamentos"]');
 assert.ok(refresh);refresh.click();assert.equal(reads,2);assert.equal(refresh.disabled,true);
 finish({...snapshot,quotes:[]});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(refresh.disabled,false);assert.equal(root.querySelector('[data-metric=total] strong').textContent,'0');
});
test('zero quotes remains explicit and injected descriptions and supplier names are only safe text',async t=>{
 const empty=setup(t,async()=>({complete:true,quotes:[],budgets:[]}));await empty.view.open();assert.match(empty.root.textContent,/Nenhuma cotação/);assert.equal(empty.root.querySelector('[data-metric=total] strong').textContent,'0');
 const {view,root}=setup(t,async()=>({...snapshot,quotes:[{...snapshot.quotes[0],description:'<img src=x onerror=alert(1)>'}],budgets:[{...snapshot.budgets[0],supplier:'<script>alert(1)</script>'}]}));await view.open();assert.match(root.textContent,/<img src=x/);assert.equal(root.querySelectorAll('img,script').length,0);
});
