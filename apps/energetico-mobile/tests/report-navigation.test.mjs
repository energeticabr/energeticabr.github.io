import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {renderChatMarkup,commandFromTarget} from '../src/ui/chat-view.js';
import {createPaymentLedgerView} from '../src/ui/payment-ledger-view.js';
import {createCargosView} from '../src/ui/cargos-view.js';
const {getReportNeighbors,decorateReportNavigation}=await import('../src/ui/report-navigation.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});

for(const [action,previous,next] of [
 ['open-pending-provisions',null,'open-provision-report'],
 ['open-provision-report','open-pending-provisions','open-payment-ledger'],
 ['open-payment-ledger','open-provision-report','open-management-report'],
 ['open-management-report','open-payment-ledger','open-order-validation-report'],
 ['open-order-validation-report','open-management-report','open-document-control-report'],
 ['open-document-control-report','open-order-validation-report',null],
 ['open-cargos-table',null,'open-attendance-summary'],
 ['open-attendance-summary','open-cargos-table','open-stage-progress'],
 ['open-stage-progress','open-attendance-summary','open-supplier-payroll-report'],
 ['open-supplier-payroll-report','open-stage-progress','open-supplier-workforce-report'],
 ['open-supplier-workforce-report','open-supplier-payroll-report','open-pending-supplier-payments-report'],
 ['open-pending-supplier-payments-report','open-supplier-workforce-report','open-pending-work-diaries-report'],
 ['open-pending-work-diaries-report','open-pending-supplier-payments-report',null],
 ['open-commercial-receipts',null,'open-commercial-milestones'],
 ['open-commercial-milestones','open-commercial-receipts','open-commercial-documents'],
 ['open-commercial-documents','open-commercial-milestones','open-sac-pathologies'],
 ['open-sac-pathologies','open-commercial-documents',null],
 ['open-task-association-report',null,'open-delegated-deadline-report'],
 ['open-delegated-deadline-report','open-task-association-report',null],
 ...['open-quotation-report','open-depreciation-report','invalid'].map(action=>[action,null,null]),
])test(`${action} advances only within its visible mascot color, without wrapping`,()=>{
 assert.equal(typeof getReportNeighbors,'function');assert.deepEqual(getReportNeighbors(action),{previous,next});
});

function setup(t,action,onNavigate){
 assert.equal(typeof decorateReportNavigation,'function');
 const dom=new JSDOM('<main id="app"><button id="mascot">Mascote</button></main>');dom.window.matchMedia=()=>({matches:false});
 const style=dom.window.document.createElement('style');style.textContent=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');dom.window.document.head.append(style);
 const source=createPaymentLedgerView({document:dom.window.document,data:{loadPaymentsSnapshot:async()=>({rows:[]})}});
 const view=decorateReportNavigation(source,{action,onNavigate});t.after(()=>{view.destroy();dom.window.close();});return {dom,view,root:view.element};
}
test('first report has only next, intermediate both, last only previous, and singleton none',async t=>{
 for(const [action,expected] of [['open-pending-provisions',['next']],['open-payment-ledger',['previous','next']],['open-document-control-report',['previous']],['open-task-association-report',['next']],['open-delegated-deadline-report',['previous']],['open-depreciation-report',[]]]){
  const {view,root}=setup(t,action,async()=>true);await view.open();assert.deepEqual([...root.querySelectorAll('[data-report-direction]')].map(node=>node.dataset.reportDirection),expected);
  for(const arrow of root.querySelectorAll('[data-report-direction]'))assert.ok(arrow.getAttribute('aria-label').includes('relatório'));
 }
});
test('a double tap dispatches only one adjacent report and buttons recover after rejection',async t=>{
 let finish,calls=[];const {view,root}=setup(t,'open-payment-ledger',target=>{calls.push(target);return new Promise(resolve=>finish=resolve);});await view.open();
 const next=root.querySelector('[data-report-direction=next]');next.click();next.click();assert.deepEqual(calls,['open-management-report']);assert.equal(next.disabled,true);finish(false);await new Promise(resolve=>setImmediate(resolve));assert.equal(next.disabled,false);
 root.querySelector('[data-report-direction=previous]').click();assert.deepEqual(calls,['open-management-report','open-provision-report']);finish(true);
});
test('closed or destroyed report arrows cannot open another report',async t=>{
 let calls=0;const {view,root}=setup(t,'open-payment-ledger',()=>calls++);await view.open();const arrow=root.querySelector('[data-report-direction=next]');view.close();arrow.click();assert.equal(calls,0);await view.open();view.destroy();arrow.click();assert.equal(calls,0);
});
test('arrow navigation preserves outside close and original focus restoration',async t=>{
 const {dom,view,root}=setup(t,'open-payment-ledger',async()=>true);dom.window.document.querySelector('#mascot').focus();await view.open();root.querySelector('[data-report-direction=next]').focus();root.click();assert.equal(root.hidden,true);assert.equal(dom.window.document.activeElement.id,'mascot');assert.equal(dom.window.document.getElementById('app').inert,false);
});
test('pending provisions popup exposes only next as a navigation command, not a reminder action',()=>{
 const markup=renderChatMarkup({sessionStatus:'authenticated',account:{name:'Bernardo'},messages:[],pendingFiles:[],pendingProvisions:{due:true,rows:[]}});const dom=new JSDOM(markup);const arrows=dom.window.document.querySelectorAll('[data-report-direction]');assert.equal(arrows.length,1);assert.equal(arrows[0].dataset.reportDirection,'next');assert.equal(arrows[0].dataset.action,'navigate-mascot-report');assert.equal(arrows[0].dataset.from,'open-pending-provisions');dom.window.close();
});
test('clicking the pending arrow SVG preserves origin and direction in the emitted command',()=>{
 const dom=new JSDOM(renderChatMarkup({sessionStatus:'authenticated',account:{name:'Bernardo'},messages:[],pendingFiles:[],pendingProvisions:{due:true,rows:[]}}));assert.deepEqual(commandFromTarget(dom.window.document.querySelector('.report-navigation path')),{type:'navigate-mascot-report',from:'open-pending-provisions',direction:'next'});dom.window.close();
});
test('cargos keyboard trap includes the injected arrow in both traversal directions',async t=>{
 const dom=new JSDOM('<main id="app"><button>Mascote</button></main>');const view=decorateReportNavigation(createCargosView({document:dom.window.document,data:{loadSnapshot:async()=>({rows:[]})}}),{action:'open-cargos-table',onNavigate:async()=>true});t.after(()=>{view.destroy();dom.window.close();});await view.open();
 const content=view.element.querySelector('.cargos-scroll'),arrow=view.element.querySelector('[data-report-direction=next]'),back=view.element.querySelector('.cargos-header button');content.focus();const tab=new dom.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});content.dispatchEvent(tab);assert.equal(tab.defaultPrevented,false,'normal forward Tab must reach the following arrow');
 arrow.focus();arrow.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));assert.equal(dom.window.document.activeElement,back);
 back.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));assert.equal(dom.window.document.activeElement,arrow);
});
