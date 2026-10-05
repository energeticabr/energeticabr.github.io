import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createChatView,renderChatMarkup} from '../src/ui/chat-view.js';
const {createAttendanceSummaryReportView}=await import('../src/ui/attendance-summary-view.js').catch(()=>({}));
const rows=[
 {id:'1',date:'2026-10-05',branch:'004 - XAVANTE',supplier:'Alfa',profession:'PEDREIRO',presence:'PENDENTE',status:'PENDENTE',dailyValue:100,paymentId:''},
 {id:'2',date:'2026-10-05',branch:'004 - XAVANTE',supplier:'Alfa',profession:'PEDREIRO',presence:'PRESENTE',status:'PAGO',dailyValue:50,paymentId:'3500'},
 {id:'3',date:'2026-10-05',branch:'004 - XAVANTE',supplier:'Alfa',profession:'PEDREIRO',presence:'PRESENTE',status:'PENDENTE',dailyValue:30,paymentId:''},
 {id:'4',date:'2026-10-05',branch:'004 - XAVANTE',supplier:'Beta',profession:'SERVENTE',presence:'AUSENTE',status:'PENDENTE',dailyValue:20,paymentId:''},
];
const snapshot={complete:true,presences:rows,suppliers:[{id:'1',name:'Alfa',status:'ATIVO'},{id:'2',name:'Beta',status:'ATIVO'}]};
function setup(t,loader=async()=>snapshot,vertical=false){
 assert.equal(typeof createAttendanceSummaryReportView,'function','attendance report is implemented');
 const dom=new JSDOM('<main id="app"><button>Mascote</button></main>');let portrait=vertical;
 dom.window.matchMedia=()=>({get matches(){return portrait;}});
 const view=createAttendanceSummaryReportView({document:dom.window.document,data:{loadSnapshot:loader},now:()=>new Date('2026-10-05T12:00:00Z')});
 t.after(()=>{view.destroy();dom.window.close();});
 return {view,root:view.element,dom,rotate(v){portrait=v;dom.window.dispatchEvent(new dom.window.Event('resize'));}};
}
test('second right mascot preserves cargos and five left shortcuts and dispatches its own action',t=>{
 const dom=new JSDOM('<main id="app"></main>');dom.window.HTMLCanvasElement.prototype.getContext=()=>null;
 const view=createChatView(dom.window.document.querySelector('#app'));t.after(()=>{view.destroy();dom.window.close();});
 const state={sessionStatus:'authenticated',account:{name:'Bernardo'},draft:'',pendingFiles:[],messages:[{id:'home',role:'assistant',type:'poll',question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',options:[{id:'group_pending',label:'PENDÊNCIAS'},{id:'group_supplies',label:'SUPRIMENTOS'}]}]};
 let calls=0;view.on('open-attendance-summary',()=>calls++);view.render(state);
 const root=dom.window.document.querySelector('#app'),shortcut=root.querySelector('[data-action=open-attendance-summary]');
 assert.ok(shortcut);assert.equal(shortcut.previousElementSibling.dataset.action,'open-cargos-table');
 assert.equal(shortcut.closest('.chat-bubble'),null);shortcut.querySelector('img').click();assert.equal(calls,1);
 assert.equal(root.querySelectorAll('.chat-main-payment-ledger-shortcut').length,4);
 view.render({...state,activeText:{id:'busy'}});assert.equal(root.querySelector('[data-action=open-attendance-summary]').disabled,true);
 assert.equal(new JSDOM(renderChatMarkup({...state,activeFlow:'flow'})).window.document.querySelector('[data-action=open-attendance-summary]'),null);
});
test('attendance summary uses four indicators, profession financial cards and seven daily columns',async t=>{
 const {view,root}=setup(t);await view.open();
 assert.equal(root.querySelector('[name=supplierStatus]').value,'ATIVO');
 assert.equal(root.querySelector('[data-date-display=startDate]').value,'21/09/2026');
 assert.equal(root.querySelector('[data-date-display=endDate]').value,'05/10/2026');
 assert.equal(root.querySelector('[data-metric=pending]').textContent,'1');
 assert.equal(root.querySelector('[data-metric=present]').textContent,'2');
 assert.equal(root.querySelector('[data-metric=absent]').textContent,'1');
 assert.match(root.querySelector('[data-metric=total]').textContent,/80,00/);
 assert.equal(root.querySelectorAll('.as-profession').length,1);
 assert.match(root.querySelector('.as-financial').textContent,/100,00.*30,00.*50,00.*180,00/s);
 assert.equal(root.querySelectorAll('.as-daily thead th').length,7);
 assert.match(root.querySelector('.as-daily').textContent,/IDPGTO: 3500/);
 assert.match(root.querySelector('.as-daily').textContent,/PENDENTE PGTO/);
 assert.ok(root.querySelector('.as-duplicate'));
 assert.equal(root.querySelector('.pl-close'),null);
 root.querySelector('[aria-label="Abrir opções de FORNECEDOR"]').click();
 assert.equal(root.querySelector('.sfs-popup:not([hidden])').dataset.placement,'below');
});
test('portrait waits for rotation, outside closes, Escape and focus restore work',async t=>{
 let calls=0;const {view,root,dom,rotate}=setup(t,async()=>{calls++;return snapshot;},true);
 const trigger=dom.window.document.querySelector('button');trigger.focus();await view.open();assert.equal(calls,0);
 assert.equal(root.querySelector('.pl-orientation').hidden,false);rotate(false);await new Promise(r=>setImmediate(r));assert.equal(calls,1);
 root.querySelector('.as-profession').click();assert.equal(root.hidden,false);
 root.click();assert.equal(root.hidden,true);assert.equal(dom.window.document.activeElement,trigger);
 await view.open();root.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(root.hidden,true);assert.equal(dom.window.document.body.style.overflow,'');
});
test('invalid typed/reversed dates suppress totals until corrected and permit cleared boundaries',async t=>{
 const {view,root,dom}=setup(t);await view.open();
 const start=root.querySelector('[data-date-display=startDate]'),end=root.querySelector('[data-date-display=endDate]');
 start.value='31/02/2026';start.dispatchEvent(new dom.window.Event('change'));
 assert.equal(root.querySelectorAll('[data-metric]').length,0);assert.match(root.querySelector('.pl-notice').textContent,/inválida/i);
 start.value='06/10/2026';start.dispatchEvent(new dom.window.Event('change'));
 assert.equal(root.querySelectorAll('[data-metric]').length,0);assert.match(root.querySelector('.pl-notice').textContent,/posterior/i);
 start.value='';start.dispatchEvent(new dom.window.Event('change'));end.value='';end.dispatchEvent(new dom.window.Event('change'));
 assert.equal(root.querySelector('[data-metric=present]').textContent,'2');
});
test('untrusted labels stay text and failed/closed loads cannot show stale results',async t=>{
 const unsafe=setup(t,async()=>({complete:true,presences:[{...rows[0],supplier:'<img onerror=alert(1)>'}],suppliers:[{id:'1',name:'<img onerror=alert(1)>',status:'ATIVO'}]}));
 await unsafe.view.open();assert.match(unsafe.root.querySelector('.as-provider').textContent,/<img onerror=alert\(1\)>/);
 assert.equal(unsafe.root.querySelectorAll('.as-provider img').length,0);
 const failed=setup(t,async()=>{throw Error('network');});await failed.view.open();assert.equal(failed.root.querySelectorAll('[data-metric]').length,0);
 let finish,signal;const pending=setup(t,o=>{signal=o.signal;return new Promise(r=>finish=r);});const p=pending.view.open();pending.view.close();
 assert.equal(signal.aborted,true);finish(snapshot);await p;assert.equal(pending.root.querySelectorAll('[data-metric]').length,0);
});
