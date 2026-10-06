import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const {createOrderValidationReportView}=await import('../src/ui/order-validation-report-view.js').catch(()=>({}));
const order={id:'362',branch:'004 - EDIFÍCIO XAVANTE',supplier:'PETRANET',invoice:'PENDENTE',status:'PENDENTE AUDITORIA',total:99.8,created:'2026-10-05',invalidTotal:false};
const launch={id:'3505',orderId:'362',branch:order.branch,supplier:order.supplier,product:'TARIFA DE INTERNET',description:'<img src=x onerror=alert(1)>',total:99.8,invalidTotal:false};
function setup(t,loader=async()=>({orders:[order],launches:[launch]}),portrait=false){
  assert.equal(typeof createOrderValidationReportView,'function');
  const dom=new JSDOM('<main id="app"><button>Mascote</button></main>');let vertical=portrait;
  dom.window.matchMedia=()=>({get matches(){return vertical;}});
  const view=createOrderValidationReportView({document:dom.window.document,data:{loadOrderValidationSnapshot:loader}});
  t.after(()=>{view.destroy();dom.window.close();});
  return {view,root:view.element,dom,rotate(value){vertical=value;dom.window.dispatchEvent(new dom.window.Event('resize'));}};
}
test('fifth report shows six filtered summary cards and ID-selected full detail without executing baixa',async t=>{
  const {view,root,dom}=setup(t);await view.open();
  assert.equal(root.querySelectorAll('.ov-filters select').length,6);
  assert.equal(root.querySelector('[name=status]').value,'PENDENTE AUDITORIA');
  assert.equal(root.querySelector('[data-metric=orderCount]').textContent,'1');
  assert.match(root.querySelector('[data-metric=total]').textContent,/99,80/);
  assert.equal(root.querySelector('[data-metric=invoicePending]').textContent,'1');
  assert.equal(root.querySelector('[data-metric=withoutLaunch]').textContent,'0');
  assert.equal(root.querySelector('[data-metric=valueDivergent]').textContent,'0');
  assert.equal(root.querySelector('[data-metric=supplierCount]').textContent,'1');
  assert.equal(root.querySelectorAll('[data-section=orders] thead th').length,8);
  assert.equal(root.querySelector('[data-section=detail]'),null);
  const id=root.querySelector('[name=id]');id.value='362';id.dispatchEvent(new dom.window.Event('change'));
  assert.match(root.querySelector('[data-section=detail]').textContent,/DETALHAMENTO DO PEDIDO 362/);
  assert.match(root.querySelector('[data-section=detail]').textContent,/05\/10\/2026/);
  assert.match(root.querySelector('[data-section=alerts]').textContent,/Nota fiscal ausente ou pendente/i);
  assert.match(root.querySelector('[data-section=launches]').textContent,/<img src=x onerror=alert\(1\)>/);
  assert.equal(root.querySelectorAll('tbody img').length,0);
  assert.equal(root.querySelectorAll('.ov-logo img').length,1);
  assert.equal(root.querySelector('.pl-close'),null);
  root.querySelector('[aria-label="Abrir opções de FORNECEDOR"]').click();
  assert.equal(root.querySelector('.sfs-popup:not([hidden])').dataset.placement,'expanded');
  assert.equal(root.querySelectorAll('[data-action=baixa]').length,0);
});
test('report waits for landscape and restores app focus/overflow on outside click',async t=>{
  let calls=0;const {view,root,dom,rotate}=setup(t,async()=>{calls++;return {orders:[order],launches:[launch]};},true);
  const trigger=dom.window.document.querySelector('button');trigger.focus();await view.open();
  assert.equal(calls,0);assert.equal(root.querySelector('.pl-orientation').hidden,false);
  rotate(false);await new Promise(r=>setImmediate(r));assert.equal(calls,1);
  root.querySelector('td').click();assert.equal(root.hidden,false);
  root.click();assert.equal(root.hidden,true);assert.equal(dom.window.document.activeElement,trigger);
  assert.equal(dom.window.document.body.style.overflow,'');
});

test('detail difference under half a cent is displayed as zero without a false red highlight',async t=>{
  const {view,root,dom}=setup(t,async()=>({orders:[{...order,total:99.804}],launches:[launch]}));await view.open();
  const id=root.querySelector('[name=id]');id.value='362';id.dispatchEvent(new dom.window.Event('change'));
  const difference=root.querySelector('[data-section=detail] [data-column=difference]');
  assert.match(difference.textContent,/0,00/);assert.equal(difference.classList.contains('ov-bad'),false);
});
test('refresh preserves absent pending status and failures/stale queries never display partial totals',async t=>{
  const {view,root}=setup(t,async()=>({orders:[{...order,status:'CONCLUÍDO'}],launches:[launch]}));await view.open();
  assert.equal(root.querySelector('[name=status]').value,'PENDENTE AUDITORIA');
  assert.match(root.querySelector('.pl-notice').textContent,/Nenhum pedido/);
  root.querySelector('[aria-label="Atualizar validação de notas"]').click();await new Promise(r=>setImmediate(r));
  assert.equal(root.querySelector('[name=status]').value,'PENDENTE AUDITORIA');
  let finish,signal;const pending=setup(t,options=>{signal=options.signal;return new Promise(r=>finish=r);});
  const request=pending.view.open();pending.view.close();assert.equal(signal.aborted,true);
  finish({orders:[order],launches:[launch]});await request;assert.equal(pending.root.querySelectorAll('.ov-table').length,0);
  const bad=setup(t,async()=>({orders:[order]}));await bad.view.open();assert.equal(bad.root.querySelectorAll('.ov-table').length,0);
});
