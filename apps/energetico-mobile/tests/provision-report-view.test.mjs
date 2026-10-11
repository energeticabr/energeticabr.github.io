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

// Break: a status is rendered as plain text (or an OS-dependent emoji) without
// its colored indicator; dates and monetary amounts have no atomic display.
test('provision report restores colored status markers and keeps calendar values atomic',async t=>{
  const provisions=[
    {...row,id:'1',schedule:'PENDENTE',dueDate:'2026-10-04'},
    {...row,id:'2',schedule:'',dueDate:'2026-10-05'},
    {...row,id:'3',schedule:'',dueDate:'2026-10-09'},
    {...row,id:'4',schedule:'PAGO',paidDate:'2026-10-02',status:'PAGAMENTO EFETUADO',total:1234567.89},
  ];
  const {view,root,dom}=setup(t,async()=>({provisions,recurrences:[{...recurrence,startDate:'2026-10-01'}]}));await view.open();
  const filter=root.querySelector('[name=paymentStatus]');filter.value='';filter.dispatchEvent(new dom.window.Event('change'));
  for(const [id,tone,label] of [['1','red','VENCIDO HÁ 1 DIA'],['2','yellow','VENCE HOJE'],['3','green','VENCE EM 4 DIAS']]){
    const status=root.querySelector(`[data-section=provisions] tr[data-id="${id}"] [data-column=status]`);
    assert.equal(status.querySelector(`[data-status-tone="${tone}"]`)?.textContent,label);
    assert.ok(status.querySelector(`[data-status-tone="${tone}"] .pr-status-dot`));
  }
  assert.equal(root.querySelector('[data-id="1"] [data-column=schedule] [data-status-tone=red]')?.textContent,'PENDENTE');
  assert.equal(root.querySelector('[data-id="4"] [data-column=schedule] [data-status-tone=green]')?.textContent,'PAGO');
  assert.equal(root.querySelector('[data-id="4"] [data-column=status] [data-status-tone=green]')?.textContent,'PAGAMENTO EFETUADO');
  assert.equal(root.querySelector('[data-id="1"] [data-column=dueDate] .pr-nowrap')?.textContent,'04/10/2026');
  assert.match(root.querySelector('[data-id="4"] [data-column=total]').textContent,/1\.234\.567,89/);
  const month=root.querySelector('[data-section=annual] [data-month="10"]');
  assert.ok(month.querySelector('[data-status-tone=purple] .pr-status-dot'));
  assert.ok(month.querySelector('[data-status-tone=green] .pr-status-dot'));
  assert.ok(month.querySelector('[data-status-tone=red] .pr-status-dot'));
  assert.ok(month.querySelector('[data-status-tone=orange] .pr-status-dot'));
  assert.deepEqual([...month.querySelectorAll('.pr-date')].map(node=>node.textContent),['01/10/2026','02/10/2026','04/10/2026','05/10/2026','09/10/2026']);
  assert.equal(month.querySelector('.pr-money')?.textContent.replace(/\s/g,''),'R$1.234.567,89');
});

test('provision report keeps blue next-payment and orange inactive indicators with their dates',async t=>{
  const {view,root}=setup(t,async()=>({provisions:[{...row,paidDate:'2026-10-02',status:'PAGAMENTO EFETUADO'},{...row,id:'316',recurrenceId:'8'}],
    recurrences:[recurrence,{...recurrence,id:'8',status:'INATIVO'}]}));await view.open();
  const next=root.querySelector('[data-section=annual] tr[data-recurrence-id="7"] [data-month="11"]');
  assert.ok(next.querySelector('[data-status-tone=blue] .pr-status-dot'));
  assert.equal(next.querySelector('.pr-date')?.textContent,'09/10');
  assert.ok(root.querySelector('[data-recurrence-id="8"] [data-column=supplier] [data-status-tone=orange] .pr-status-dot'));
});

// Break: screen column proportions also squeeze a large total in the exported
// PDF, or touch-only scroll instructions become report content.
test('provision report PDF keeps large annual totals on one line and omits screen guidance',async t=>{
  const {captureFilteredReport}=await import('../src/ui/report-print.js');
  const {buildFilteredReportPdf}=await import('../src/chat/filtered-report-pdf.js');
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const {view,root}=setup(t,async()=>({provisions:[{...row,paidDate:'2026-10-02',status:'PAGAMENTO EFETUADO',total:1234567.89}],recurrences:[recurrence]}));
  await view.open();
  const capture=captureFilteredReport(root,{title:'Provisões de pagamento e despesas recorrentes'});
  const blob=await buildFilteredReportPdf(capture),task=getDocument({data:new Uint8Array(await blob.arrayBuffer()),useSystemFonts:true});
  t.after(()=>task.destroy());const pdf=await task.promise,items=[];
  for(let index=1;index<=pdf.numPages;index++){
    const page=await pdf.getPage(index),content=await page.getTextContent();items.push(...content.items);
    for(const item of content.items.filter(item=>item.str.trim())){
      assert.ok(item.transform[4]>=20&&item.transform[4]+item.width<=page.view[2]-19,`${item.str} exceeds PDF page`);
    }
  }
  assert.ok(items.some(item=>item.str==='R$ 1.234.567,89'),'annual total must fit on one PDF line');
  assert.doesNotMatch(items.map(item=>item.str).join(' '),/Deslize para os lados/);
});
