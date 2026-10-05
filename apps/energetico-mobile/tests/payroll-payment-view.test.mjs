import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createHrPayrollGallery } from '../src/ui/hr-payroll-gallery-view.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const options={launches:[{id:'10',supplier:'CLEITON',date:'2026-10-04',unitValue:200,quantity:3},{id:'11',supplier:'OUTRO',date:'2026-10-04',unitValue:10,quantity:1}],sheets:[{id:'20',supplier:'CLEITON',label:'09/2026'},{id:'21',supplier:'CLEITON',label:'10/2026'},{id:'22',supplier:'CLEITON',label:'11/2026'},{id:'30',supplier:'OUTRO',label:'10/2026'}],paymentTypes:['SALÁRIO','AJUDA DE CUSTO']};
function setup(t,gallery='FOLHAPGTO',overrides={}) {
  const dom=new JSDOM('<main id="root"></main>'),doc=dom.window.document,saves=[];let reads=0;
  const panel=createHrPayrollGallery({document:doc,root:doc.querySelector('#root'),gallery,request:async()=>({gallery,page:1,rows:[],hasMore:false}),loadPaymentOptions:async()=>{reads++;return options;},savePayment:async(...args)=>{saves.push(args);return {id:'100'};},...overrides});
  t.after(()=>{panel.destroy();dom.window.close();});return {panel,doc,dom,saves,reads:()=>reads};
}
test('white add-payment action opens a full screen with dependent closed selections and locked values',async t=>{
  const f=setup(t);await f.panel.open();const add=f.doc.querySelector('[data-action="add-payroll-payment"]');assert.ok(add);assert.equal(add.getAttribute('aria-label'),'Acrescentar pagamento');
  add.click();await tick();const screen=f.doc.querySelector('[data-payroll-payment-screen]');assert.ok(screen);assert.equal(screen.getAttribute('role'),'region');assert.equal(screen.hasAttribute('aria-modal'),false);
  const launch=screen.querySelector('[name=IDLANCAMENTO]'),sheet=screen.querySelector('[name=IDFOLHA]');
  launch.value='10';launch.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));
  assert.deepEqual([...sheet.options].filter(o=>o.value).map(o=>o.value),['20','21','22']);
  assert.match(screen.querySelector('[data-payment-supplier]').textContent,/CLEITON/);
  assert.equal(screen.querySelector('[name=VALORUNITARIO]'),null);assert.equal(screen.querySelector('[name=QTD]'),null);
  sheet.value='21';screen.querySelector('[name=TIPOPGTO]').value='SALÁRIO';
  screen.querySelector('form').dispatchEvent(new f.dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
  assert.deepEqual(f.saves[0][0],{launchId:'10',sheetId:'21',paymentType:'SALÁRIO'});
  assert.match(f.saves[0][1].operationId,/^[a-zA-Z0-9-]+$/);assert.equal(f.doc.querySelector('[data-payroll-payment-screen]'),null);
});
test('switching launch clears incompatible sheet and cancel performs no writes',async t=>{
  const f=setup(t);await f.panel.open();f.doc.querySelector('[data-action="add-payroll-payment"]').click();await tick();
  const screen=f.doc.querySelector('[data-payroll-payment-screen]');
  const launch=screen.querySelector('[name=IDLANCAMENTO]'),sheet=screen.querySelector('[name=IDFOLHA]');launch.value='10';launch.dispatchEvent(new f.dom.window.Event('change'));sheet.value='21';launch.value='11';launch.dispatchEvent(new f.dom.window.Event('change'));
  assert.equal(sheet.value,'');assert.deepEqual([...sheet.options].filter(o=>o.value).map(o=>o.value),['30']);
  f.doc.querySelector('[data-payment-cancel]').click();assert.equal(f.saves.length,0);assert.equal(f.doc.querySelector('[data-payroll-payment-screen]'),null);
});
test('IDFOLHA gallery has no add-payment action',async t=>{const f=setup(t,'IDFOLHA');await f.panel.open();assert.equal(f.doc.querySelector('[data-action="add-payroll-payment"]'),null);assert.equal(f.reads(),0);});
test('closing gallery ignores late composer loads and never saves',async t=>{
  let resolve;const f=setup(t,'FOLHAPGTO',{loadPaymentOptions:()=>new Promise(done=>{resolve=done;})});await f.panel.open();f.doc.querySelector('[data-action="add-payroll-payment"]').click();await tick();f.panel.close();resolve(options);await tick();assert.equal(f.doc.querySelector('[data-payroll-payment-screen]'),null);assert.equal(f.saves.length,0);
});
