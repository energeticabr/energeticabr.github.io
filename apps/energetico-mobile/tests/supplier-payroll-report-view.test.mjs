import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createChatView} from '../src/ui/chat-view.js';
import {getReportNeighbors} from '../src/ui/report-navigation.js';
import {decorateReportPrint} from '../src/ui/report-print.js';
const {createSupplierPayrollReportView}=await import('../src/ui/supplier-payroll-report-view.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const snapshot={complete:true,sheets:[{id:'8',supplier:'Ana',month:'2026-10'},{id:'12',supplier:'Ana',month:'2026-10'},{id:'9',supplier:'Bruno',month:'2026-10'},{id:'7',supplier:'Ana',month:'2026-09'}]};
const rows=[{id:'23',payrollId:'8',supplier:'Ana',type:'DIÁRIA',date:'2026-11-02',launchId:'60',unitValue:100,quantity:2,totalCents:20000}];
const tick=()=>new Promise(r=>setImmediate(r));
function setup(t,options={}){
 assert.equal(typeof createSupplierPayrollReportView,'function','supplier payroll report must exist');
 const dom=new JSDOM('<main id="app"><button>Mascote</button></main>');dom.window.matchMedia=()=>({matches:false});
 const calls=[];const view=createSupplierPayrollReportView({document:dom.window.document,now:()=>new Date('2026-10-07T12:00:00Z'),data:{loadSnapshot:async()=>snapshot,loadPaymentsForPayrollIds:async ids=>{calls.push(ids);return rows;},...options}});
 t.after(()=>{view.destroy();dom.window.close();});return {dom,view,root:view.element,calls};
}
test('fourth pink HOME mascot sits after stages before workforce and stays in its own navigation family',t=>{
 const dom=new JSDOM('<main id="app"></main>');dom.window.HTMLCanvasElement.prototype.getContext=()=>null;
 const view=createChatView(dom.window.document.querySelector('#app'));t.after(()=>{view.destroy();dom.window.close();});
 const state={sessionStatus:'authenticated',account:{name:'Bernardo'},draft:'',pendingFiles:[],messages:[{id:'home',role:'assistant',type:'poll',question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',options:[{id:'group_pending',label:'PENDÊNCIAS'},{id:'group_supplies',label:'SUPRIMENTOS'}]}]};
 let calls=0;view.on('open-supplier-payroll-report',()=>calls++);view.render(state);
 const mascot=dom.window.document.querySelector('[data-action=open-supplier-payroll-report]');assert.ok(mascot);
 assert.equal(mascot.previousElementSibling.dataset.action,'open-stage-progress');assert.equal(mascot.nextElementSibling.dataset.action,'open-supplier-workforce-report');
 mascot.querySelector('img').click();assert.equal(calls,1);
 assert.deepEqual(getReportNeighbors('open-stage-progress'),{previous:'open-attendance-summary',next:'open-supplier-payroll-report'});
 assert.deepEqual(getReportNeighbors('open-supplier-payroll-report'),{previous:'open-stage-progress',next:'open-supplier-workforce-report'});
 view.render({...state,activeFlow:'flow'});assert.equal(dom.window.document.querySelector('[data-action=open-supplier-payroll-report]'),null);
});
test('current reference month defaults with collapsed supplier groups and all their IDFOLHA',async t=>{
 const {view,root,calls}=setup(t);await view.open();
 assert.equal(root.querySelector('[name=month]').value,'2026-10');assert.equal(root.querySelectorAll('.spr-supplier').length,2);
 assert.equal(root.querySelectorAll('details[open]').length,0);assert.deepEqual(calls,[]);
 assert.match(root.querySelector('.spr-supplier summary').textContent,/Ana.*8.*12/);
 root.querySelector('[aria-label="Abrir opções de MÊS DE REFERÊNCIA"]').click();
 assert.equal(root.querySelector('.sfs-popup:not([hidden])').dataset.placement,'expanded');
});
test('expansion queries only selected sheet ids and keeps payment made next month',async t=>{
 const {view,root,calls}=setup(t);await view.open();const detail=root.querySelector('details');detail.open=true;detail.dispatchEvent(new root.ownerDocument.defaultView.Event('toggle'));await tick();
 assert.deepEqual(calls,[['8','12']]);assert.match(detail.textContent,/23.*8.*DIÁRIA.*02\/11\/2026.*60.*100,00.*2.*200,00/s);
 assert.match(detail.querySelector('.spr-total').textContent,/200,00/);
});
test('filters discard details and refresh failure removes stale data',async t=>{
 let loads=0;const {view,root,dom}=setup(t,{loadSnapshot:async()=>{if(loads++)throw Error('network');return snapshot;}});await view.open();
 const month=root.querySelector('[name=month]');month.value='2026-09';month.dispatchEvent(new dom.window.Event('change'));
 assert.equal(root.querySelectorAll('details').length,1);assert.match(root.querySelector('summary').textContent,/7/);assert.equal(root.querySelectorAll('details[open]').length,0);
 root.querySelector('.pl-refresh').click();await tick();assert.equal(root.querySelectorAll('details').length,0);assert.match(root.querySelector('.pl-notice').textContent,/Não foi possível/);
});
test('closing or changing month aborts lazy detail and cannot resurrect its late results',async t=>{
 let resolve,signal;const {view,root,dom}=setup(t,{loadPaymentsForPayrollIds:(ids,o)=>{signal=o.signal;return new Promise(r=>resolve=r);}});
 const trigger=dom.window.document.querySelector('button');trigger.focus();await view.open();const detail=root.querySelector('details');detail.open=true;detail.dispatchEvent(new dom.window.Event('toggle'));await tick();
 root.querySelector('.spr-close').click();assert.equal(signal.aborted,true);resolve(rows);await tick();assert.equal(root.hidden,true);assert.equal(root.querySelectorAll('table').length,0);assert.equal(dom.window.document.activeElement,trigger);
});
test('uncalculated payments are not shown as zero, unsafe labels remain text, detail failure can retry',async t=>{
 let attempts=0;const {view,root,dom}=setup(t,{loadPaymentsForPayrollIds:async()=>{if(!attempts++)throw Error('network');return [{...rows[0],type:'<img onerror=alert(1)>',totalCents:null,unitValue:null}];}});
 await view.open();const detail=root.querySelector('details');detail.open=true;detail.dispatchEvent(new dom.window.Event('toggle'));await tick();
 assert.match(detail.textContent,/Não foi possível/);detail.querySelector('.spr-retry').click();await tick();
 assert.equal(detail.querySelectorAll('img').length,0);assert.match(detail.textContent,/<img onerror=alert\(1\)>/);assert.match(detail.querySelector('.spr-total').textContent,/indisponível/i);
});
test('filtered PDF includes all supplier details without changing accordion state',async t=>{
 const {view,root,calls}=setup(t);let captured,previews=0;
 const printed=decorateReportPrint(view,{action:'open-supplier-payroll-report',loadLogo:async()=>new Uint8Array(),buildPdf:async s=>{captured=s;return new Uint8Array();},previewMedia:async pending=>{await pending;previews++;}});
 t.after(()=>printed.destroy());await printed.open();root.querySelector('.report-print-button').click();await tick();await tick();
 assert.equal(previews,1);assert.ok(captured);assert.deepEqual(calls,[['8','12'],['9']]);assert.equal(root.querySelectorAll('details[open]').length,0);
 assert.match(JSON.stringify(captured),/IDFOLHA|DIÁRIA/);
});
test('PDF preparation freezes supplier disclosures and closing cancels it without exporting',async t=>{
 let resolve,signal;const {view,root}=setup(t,{loadPaymentsForPayrollIds:(ids,o)=>{signal=o.signal;return new Promise(r=>resolve=r);}});await view.open();const task=view.preparePrint(),rejected=assert.rejects(task,{name:'AbortError'});await tick();
 assert.ok([...root.querySelectorAll('details')].every(card=>card.inert));view.close();await rejected;assert.equal(signal.aborted,true);resolve(rows);await tick();assert.equal(root.hidden,true);assert.equal(root.querySelectorAll('table').length,0);
});

test('rotating during decorated PDF preview preserves supplier details filters and scroll on return',async t=>{
 let loads=0,previewOptions;const {view,root,dom}=setup(t,{loadSnapshot:async()=>{loads++;return snapshot;}});
 const printed=decorateReportPrint(view,{action:'open-supplier-payroll-report',loadLogo:async()=>new Uint8Array(),buildPdf:async()=>new Uint8Array(),previewMedia:async(pending,_fileName,options)=>{await pending;previewOptions=options;}});
 t.after(()=>printed.destroy());await printed.open();const cards=[...root.querySelectorAll('details')];cards[0].open=true;cards[0].dispatchEvent(new dom.window.Event('toggle'));await tick();
 const scroll=root.querySelector('.spr-content');scroll.scrollTop=123;root.querySelector('.report-print-button').click();await tick();await tick();assert.equal(typeof previewOptions?.onClose,'function');
 dom.window.matchMedia=()=>({matches:true});dom.window.dispatchEvent(new dom.window.Event('resize'));await tick();
 dom.window.matchMedia=()=>({matches:false});dom.window.dispatchEvent(new dom.window.Event('resize'));await tick();
 previewOptions.onClose();await tick();
 assert.equal(loads,1);assert.equal(root.querySelector('[name=month]').value,'2026-10');assert.equal(root.querySelector('details'),cards[0]);assert.equal(cards[0].open,true);assert.equal(cards[1].open,false);assert.match(cards[0].querySelector('table').textContent,/23/);assert.equal(scroll.scrollTop,123);
});
