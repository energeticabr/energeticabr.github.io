import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createPaymentLedgerView } from '../src/ui/payment-ledger-view.js';
import { captureFilteredReport } from '../src/ui/report-print.js';
import { reportLayoutViewport } from '../src/ui/report-landscape.js';

const row = {id:'1',paymentDate:'2026-10-01',supplier:'Fornecedor',branch:'Filial',product:'Produto',order:'1',account:'Caixa',unit:10,quantity:1,freight:0,total:10};
function setup(t, load) {
  const dom = new JSDOM('<main id="app"></main>');
  Object.defineProperties(dom.window,{innerWidth:{value:390,writable:true},innerHeight:{value:844,writable:true}});
  dom.window.matchMedia = () => ({get matches(){return dom.window.innerHeight > dom.window.innerWidth;}});
  const view=createPaymentLedgerView({document:dom.window.document,data:{loadPaymentsSnapshot:load}});
  t.after(()=>{view.destroy();dom.window.close();});
  const rotate=()=>{[dom.window.innerWidth,dom.window.innerHeight]=[dom.window.innerHeight,dom.window.innerWidth];dom.window.dispatchEvent(new dom.window.Event('resize'));};
  return {view,dom,root:view.element,rotate};
}
test('portrait immediately opens the real report on a logical landscape surface',async t=>{
  let reads=0;
  const {view,root,rotate}=setup(t,async()=>{reads++;return {launches:[row]};});
  await view.open();
  assert.equal(reads,1);
  assert.equal(root.querySelector('.pl-report').hidden,false);
  assert.equal(root.dataset.reportPortrait,'true');
  assert.equal(root.style.getPropertyValue('--report-width'),'844px');
  assert.equal(root.style.getPropertyValue('--report-height'),'390px');
  assert.equal(root.dataset.reportWidthMode,'compact');
  assert.equal(root.dataset.reportCompactHeight,'true');
  assert.equal(root.style.getPropertyValue('--report-navigation-size'),'46px');
  const cell=root.querySelector('tbody td');
  rotate();rotate();
  assert.equal(reads,1);
  assert.equal(root.querySelector('tbody td'),cell,'rotation must retain the exact DOM/data');
  assert.equal(root.dataset.reportWidthMode,'compact');
  assert.equal(root.style.getPropertyValue('--report-navigation-size'),'46px');
  assert.equal(root.querySelector('.pl-orientation')?.hidden??true,true);
});
test('rotating during the first query does not abort or start another query',async t=>{
  let reads=0,resolve,signal;
  const {view,root,rotate}=setup(t,options=>{reads++;signal=options.signal;return new Promise(r=>resolve=r);});
  const pending=view.open();
  assert.equal(reads,1);rotate();rotate();
  assert.equal(signal.aborted,false);
  assert.equal(reads,1);resolve({launches:[row]});await pending;
  assert.equal(root.querySelectorAll('tbody tr').length,1);
});
test('expanded filters use the logical landscape bounds rather than physical portrait bounds',async t=>{
  const {view,root}=setup(t,async()=>({launches:[row]}));await view.open();
  root.querySelector('.sfs-trigger').click();
  const popup=root.querySelector('.sfs-popup');
  assert.equal(popup.hidden,false);
  assert.equal(popup.style.width,'480px');
  assert.equal(popup.style.height,'366px');
  assert.equal(popup.style.left,'182px');
  assert.equal(popup.style.top,'12px');
});

test('a full-height rotated report keeps top and bottom safe areas inside its opaque dialog for pickers',async t=>{
  const {view,root}=setup(t,async()=>({launches:[row]}));await view.open();
  root.style.padding='23px 0px 16px';
  root.querySelector('[role=dialog]').style.padding='3px 34px 3px 59px';
  const viewport=reportLayoutViewport(root.querySelector('.sfs-trigger'));
  assert.deepEqual(viewport,{rotated:true,top:23,left:59,width:751,height:351});
});
test('PDF measures unrotated column widths, preserving report proportions',async t=>{
  const {view,root}=setup(t,async()=>({launches:[row]}));await view.open();
  const table=root.querySelector('table');table.querySelector('colgroup').remove();
  [...table.rows[0].cells].forEach((cell,index)=>{
    Object.defineProperty(cell,'offsetWidth',{value:30+index});
    cell.getBoundingClientRect=()=>({width:12,height:30+index});
  });
  const snapshot=captureFilteredReport(root);
  const block=snapshot.pages[0].blocks.find(block=>block.type==='table');
  assert.deepEqual(block.widths,Array.from({length:12},(_,i)=>30+i));
});
test('Android keyboard shrinking height does not change orientation or collapse the report',async t=>{
  const {view,root,dom}=setup(t,async()=>({launches:[row]}));await view.open();
  const input=root.querySelector('.pl-date-display');input.focus();
  dom.window.innerHeight=350;dom.window.dispatchEvent(new dom.window.Event('resize'));
  assert.equal(root.dataset.reportPortrait,'true');
  assert.equal(root.style.getPropertyValue('--report-width'),'844px');
  assert.equal(root.style.getPropertyValue('--report-height'),'390px');
});
