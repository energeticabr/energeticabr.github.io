import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const { createProvisionReportView } = await import('../src/ui/provision-report-view.js').catch(() => ({}));
const row = {id:'314',recurrenceId:'7',branch:'004 - EDIFÍCIO XAVANTE',supplier:'TRANSPIO',product:'MOVIMENTAÇÃO DE TERRA',observation:'Conferir quantidade',property:'Obra',dueDate:'2026-10-09',paidDate:'',schedule:'PAGAMENTO AGENDADO',scheduledDate:'2026-10-06',executionDate:'2026-10-07',status:'PAGAMENTO PREVISTO',total:100};
const recurrence = {id:'7',branch:row.branch,supplier:row.supplier,product:row.product,property:'Obra',status:'ATIVO',startDate:'2026-01-05',modified:'2026-10-01T12:00:00Z'};
function setup(t, loadProvisionReportSnapshot = async () => ({provisions:[row],recurrences:[recurrence]}), portrait=false) {
  assert.equal(typeof createProvisionReportView, 'function');
  const dom=new JSDOM('<main id="app"><button>Mascote</button></main>');let vertical=portrait;
  dom.window.matchMedia=()=>({get matches(){return vertical;}});
  const view=createProvisionReportView({document:dom.window.document,data:{loadProvisionReportSnapshot},now:()=>new Date('2026-10-05T12:00:00Z')});
  t.after(()=>{view.destroy();dom.window.close();});
  return {view,root:view.element,dom,rotate(v){vertical=v;dom.window.dispatchEvent(new dom.window.Event('resize'));}};
}
test('provision report waits for landscape, restores focus outside, and reloads after rotation',async t=>{
  let calls=0;const {view,root,dom,rotate}=setup(t,async()=>{calls++;return {provisions:[row],recurrences:[recurrence]};},true);
  const trigger=dom.window.document.querySelector('button');trigger.focus();await view.open();
  assert.equal(calls,0);assert.equal(root.querySelector('.pl-orientation').hidden,false);
  rotate(false);await new Promise(r=>setImmediate(r));assert.equal(calls,1);
  assert.equal(root.querySelectorAll('.pr-table').length,3);
  root.querySelector('td').click();assert.equal(root.hidden,false);
  rotate(true);assert.equal(root.querySelector('.pl-report').hidden,true);
  rotate(false);await new Promise(r=>setImmediate(r));assert.equal(calls,2);
  root.click();assert.equal(root.hidden,true);assert.equal(dom.window.document.activeElement,trigger);
  assert.equal(dom.window.document.body.style.overflow,'');
});
test('provision report displays all PowerApps sections, safe observations, calendar and pending totals',async t=>{
  const {view,root,dom}=setup(t,async()=>({provisions:[{...row,observation:'<img src=x onerror=alert(1)>'},{...row,id:'315',paidDate:'2026-10-02',status:'PAGAMENTO EFETUADO',total:50}],recurrences:[recurrence]}));await view.open();
  assert.equal(root.querySelector('[name=paymentStatus]').value,'PAGAMENTO PREVISTO');
  assert.equal(root.querySelector('[name=recurrenceStatus]').value,'ATIVO');
  assert.equal(root.querySelectorAll('[data-section=provisions] tbody tr[data-id]').length,1);
  assert.match(root.querySelector('[data-section=provisions]').textContent,/09\/10\/2026/);
  assert.match(root.querySelector('[data-section=provisions]').textContent,/AGENDADO.*06\/10\/2026.*07\/10\/2026/s);
  assert.match(root.querySelector('[data-metric=pendingTotal]').textContent,/100,00/);
  assert.equal(root.querySelector('[data-metric=pendingCount]').textContent,'1 pendência(s)');
  assert.equal(root.querySelectorAll('tbody img').length,0);
  assert.match(root.textContent,/<img src=x onerror=alert\(1\)>/);
  assert.equal(root.querySelectorAll('.pr-logo img').length,1);
  assert.equal(root.querySelectorAll('[data-section=annual] thead tr:last-child th').length,14);
  assert.match(root.querySelector('[data-section=annual] [data-month="10"]').textContent,/50,00.*02\/10\/2026.*09\/10\/2026/s);
  assert.equal(root.querySelector('.pl-close'),null);
  const filter=root.querySelector('[name=paymentStatus]');filter.value='';filter.dispatchEvent(new dom.window.Event('change'));
  assert.equal(root.querySelectorAll('[data-section=provisions] tbody tr[data-id]').length,2);
  const branch=root.querySelector('.sfs-trigger[aria-label=FILIAL]');branch.click();
  assert.equal(branch.closest('.sfs').querySelector('.sfs-popup').dataset.placement,'expanded');
});
test('provision report preserves pending status when only paid provisions exist, including refresh',async t=>{
  const {view,root}=setup(t,async()=>({provisions:[{...row,paidDate:'2026-10-02',status:'PAGAMENTO EFETUADO'}],recurrences:[recurrence]}));
  await view.open();
  for(let attempt=0;attempt<2;attempt++){
    assert.equal(root.querySelector('[name=paymentStatus]').value,'PAGAMENTO PREVISTO');
    assert.equal(root.querySelectorAll('[data-section=provisions] tbody tr[data-id]').length,0);
    assert.match(root.querySelector('[data-metric=pendingTotal]').textContent,/0,00/);
    root.querySelector('[aria-label="Atualizar relatório de provisões"]').click();
    await new Promise(r=>setImmediate(r));
  }
});
test('provision report aborts closed requests and never renders partial or stale results',async t=>{
  let finish,signal;const {view,root}=setup(t,options=>{signal=options.signal;return new Promise(r=>finish=r);});
  const pending=view.open();view.close();assert.equal(signal.aborted,true);finish({provisions:[row],recurrences:[recurrence]});await pending;
  assert.equal(root.querySelectorAll('.pr-table').length,0);
  const error=setup(t,async()=>{throw new Error('Falha https://tenant/private Bearer segredo');});await error.view.open();
  assert.equal(error.root.querySelectorAll('.pr-table').length,0);assert.match(error.root.querySelector('.pl-notice').textContent,/Atualizar/);
  assert.doesNotMatch(error.root.textContent,/tenant\/private|segredo/);
  const invalid=setup(t,async()=>({provisions:[row]}));await invalid.view.open();assert.equal(invalid.root.querySelectorAll('.pr-table').length,0);
});
