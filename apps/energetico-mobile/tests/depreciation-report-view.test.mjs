import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {createChatView,renderChatMarkup} from '../src/ui/chat-view.js';
const {createDepreciationReportView}=await import('../src/ui/depreciation-report-view.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const asset=(id,extra={})=>({id,branch:'004 - EDIFÍCIO XAVANTE',depreciationDate:'2026-11-01',patrimony:String(id),group:'BETONEIRA',asset:'BETONEIRA 400L CSM',estimatedUnit:100,residualUnit:80,quantity:2,rate:3,...extra});
const snapshot={complete:true,assets:[asset(1),asset(2,{depreciationDate:'2026-10-06',residualUnit:20,quantity:1}),asset(3,{depreciationDate:'2026-10-05',residualUnit:0,quantity:1})]};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(t,load=async()=>snapshot,vertical=false,now=()=>new Date('2026-10-06T12:00:00Z')){
 assert.equal(typeof createDepreciationReportView,'function');
 const dom=new JSDOM('<main id="app"><button>Mascote</button></main>');let portrait=vertical;dom.window.matchMedia=()=>({get matches(){return portrait;}});
 const style=dom.window.document.createElement('style');style.textContent=readFileSync(new URL('../src/ui/depreciation-report.css',import.meta.url),'utf8');dom.window.document.head.append(style);
 const view=createDepreciationReportView({document:dom.window.document,data:{loadSnapshot:load},now});t.after(()=>{view.destroy();dom.window.close();});
 return {view,root:view.element,dom,rotate(value){portrait=value;dom.window.dispatchEvent(new dom.window.Event('resize'));}};
}

test('seventh left mascot opens depreciation below quotations and is unavailable during a flow',t=>{
 const dom=new JSDOM('<main id="app"></main>');dom.window.HTMLCanvasElement.prototype.getContext=()=>null;
 const view=createChatView(dom.window.document.querySelector('#app'));t.after(()=>{view.destroy();dom.window.close();});
 const state={sessionStatus:'authenticated',account:{name:'Bernardo'},draft:'',pendingFiles:[],messages:[{id:'home',role:'assistant',type:'poll',question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',options:[{id:'group_pending',label:'PENDÊNCIAS'},{id:'group_supplies',label:'SUPRIMENTOS'}]}]};
 let calls=0;view.on('open-depreciation-report',()=>calls++);view.render(state);
 const button=dom.window.document.querySelector('[data-action=open-depreciation-report]');assert.ok(button);
 assert.equal(button.previousElementSibling.dataset.action,'open-quotation-report');assert.equal(button.nextElementSibling.dataset.action,'open-document-control-report');
 assert.equal(button.closest('.chat-bubble'),null);assert.match(button.querySelector('img').src,/depreciation\.png$/);
 button.querySelector('img').click();assert.equal(calls,1);
 view.render({...state,activeText:{id:'busy'}});assert.equal(dom.window.document.querySelector('[data-action=open-depreciation-report]').disabled,true);
 const busy=new JSDOM(renderChatMarkup({...state,activeFlow:'busy'}));assert.equal(busy.window.document.querySelector('[data-action=open-depreciation-report]'),null);busy.window.close();
});

test('report renders logo, seven indicators, eleven columns, branch totals and date/value tones',async t=>{
 const {view,root,dom}=setup(t);await view.open();
 assert.match(root.querySelector('img').src,/logo-energetica-oficial/);assert.equal(root.querySelector('img').alt,'Energética Construtora');
 assert.equal(root.querySelectorAll('.dr-card').length,7);assert.equal(root.querySelector('[data-metric=records] strong').textContent,'3');assert.equal(root.querySelector('[data-metric=active] strong').textContent,'2');
 assert.match(root.querySelector('[data-metric=total]').textContent,/400,00/);assert.match(root.querySelector('[data-metric=current]').textContent,/180,00/);assert.match(root.querySelector('[data-metric=toDepreciate]').textContent,/5,40/);
 assert.match(root.querySelector('.dr-subtitle').textContent,/ATÉ 05\/11\/2026 \| POSIÇÃO EM 06\/10\/2026/);
 assert.equal(root.querySelectorAll('.dr-table thead th').length,11);assert.equal(root.querySelectorAll('.dr-table tbody tr').length,3);assert.equal(root.querySelector('.dr-table tfoot td').colSpan,6);
 assert.match(root.querySelector('.dr-table tfoot').textContent,/400,00.*220,00.*180,00.*5,40/);
 assert.equal(root.querySelectorAll('.dr-date-overdue,.dr-date-today,.dr-date-future').length,3);
 assert.equal(dom.window.getComputedStyle(root.querySelector('.dr-depreciated')).color,'rgb(156, 0, 0)');assert.equal(dom.window.getComputedStyle(root.querySelector('.dr-current')).color,'rgb(39, 78, 19)');
 assert.equal(root.querySelectorAll('select,input,[aria-label*="Fechar"]').length,0);
});

test('portrait avoids reads and rotation loads; inside stays open, outside and Escape restore focus',async t=>{
 let reads=0;const {view,root,dom,rotate}=setup(t,async()=>{reads++;return snapshot;},true);
 const trigger=dom.window.document.querySelector('button');trigger.focus();await view.open();assert.equal(reads,0);assert.equal(root.querySelector('.dr-orientation').hidden,false);
 rotate(false);await tick();assert.equal(reads,1);root.querySelector('table').click();assert.equal(root.hidden,false);root.click();assert.equal(root.hidden,true);assert.equal(dom.window.document.activeElement,trigger);assert.equal(dom.window.document.getElementById('app').inert,false);
 await view.open();root.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(root.hidden,true);
});

test('refresh clears stale totals, reloads real data and recomputes São Paulo calendar day',async t=>{
 let count=0,finish;let instant=new Date('2026-10-07T02:59:59Z');
 const {view,root}=setup(t,()=>count++===0?Promise.resolve(snapshot):new Promise(resolve=>finish=resolve),false,()=>instant);
 await view.open();assert.match(root.querySelector('.dr-subtitle').textContent,/06\/10\/2026/);
 instant=new Date('2026-10-07T03:00:00Z');root.querySelector('.dr-refresh').click();assert.equal(root.querySelectorAll('.dr-card').length,0);assert.equal(count,2);
 finish(snapshot);await tick();assert.match(root.querySelector('.dr-subtitle').textContent,/ATÉ 06\/11\/2026 \| POSIÇÃO EM 07\/10\/2026/);
 assert.equal(root.querySelectorAll('.dr-date-overdue').length,2);
});

test('closing and rotating abort late reads without showing stale financial data',async t=>{
 let finish,signal;const {view,root,rotate}=setup(t,options=>{signal=options.signal;return new Promise(resolve=>finish=resolve);});
 const opening=view.open();rotate(true);assert.equal(signal.aborted,true);finish(snapshot);await opening;assert.equal(root.querySelectorAll('table').length,0);
 rotate(false);await tick();view.close();assert.equal(signal.aborted,true);finish(snapshot);await tick();assert.equal(root.querySelectorAll('.dr-card').length,0);assert.equal(root.hidden,true);
});

test('failed and incomplete loads display retry instead of zero totals; reopening obtains a fresh snapshot',async t=>{
 let reads=0;const {view,root}=setup(t,async()=>{if(reads++===0)throw Error('network');if(reads===2)return {...snapshot,complete:false};return snapshot;});
 await view.open();assert.equal(root.querySelectorAll('.dr-card').length,0);assert.match(root.textContent,/Não foi possível/);
 root.querySelector('.dr-retry').click();await tick();assert.equal(root.querySelectorAll('.dr-card').length,0);assert.match(root.textContent,/Não foi possível/);
 root.querySelector('.dr-retry').click();await tick();assert.equal(root.querySelectorAll('.dr-card').length,7);
 view.close();await view.open();assert.equal(reads,4);
});

test('no qualifying assets shows explicit dated empty message without cards; names remain safe text',async t=>{
 const empty=setup(t,async()=>({assets:[asset(1,{depreciationDate:'2026-11-06'})]}));await empty.view.open();
 assert.match(empty.root.textContent,/NENHUM ITEM A DEPRECIAR ATÉ 05\/11\/2026/);assert.equal(empty.root.querySelectorAll('.dr-card,table').length,0);
 const safe=setup(t,async()=>({assets:[asset(1,{branch:'<img src=x onerror=alert(1)>',asset:'<script>alert(1)</script>'})]}));await safe.view.open();
 assert.match(safe.root.textContent,/<script>/);assert.equal(safe.root.querySelectorAll('script,img').length,1);
});

test('retry keeps focus inside the persistent panel so Escape closes immediately',async t=>{
 let reads=0;const {view,root,dom}=setup(t,async()=>{if(reads++===0)throw Error('network');return snapshot;});
 await view.open();const retry=root.querySelector('.dr-retry');retry.focus();retry.click();await tick();
 assert.ok(root.contains(dom.window.document.activeElement),'removing the retry button must not move focus to BODY');
 dom.window.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(root.hidden,true);
});

test('focus stays in popup, original body/inert settings survive close and destroyed report cannot reopen',async t=>{
 const {view,root,dom}=setup(t);dom.window.document.body.style.overflow='auto';dom.window.document.getElementById('app').inert=true;
 await view.open();const refresh=root.querySelector('.dr-refresh');refresh.focus();root.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true}));assert.equal(dom.window.document.activeElement,root.querySelector('.dr-content'));
 view.close();assert.equal(dom.window.document.body.style.overflow,'auto');assert.equal(dom.window.document.getElementById('app').inert,true);view.destroy();await assert.rejects(view.open(),/encerrado/);
});
