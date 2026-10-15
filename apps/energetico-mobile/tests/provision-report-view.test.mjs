import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const { createProvisionReportView } = await import('../src/ui/provision-report-view.js').catch(() => ({}));
const row = {id:'314',recurrenceId:'7',branch:'004 - EDIFÍCIO XAVANTE',supplier:'TRANSPIO',product:'MOVIMENTAÇÃO DE TERRA',observation:'Conferir quantidade',property:'Obra',dueDate:'2026-10-09',paidDate:'',schedule:'PAGAMENTO AGENDADO',scheduledDate:'2026-10-06',executionDate:'2026-10-07',status:'PAGAMENTO PREVISTO',total:100};
const recurrence = {id:'7',branch:row.branch,supplier:row.supplier,product:row.product,property:'Obra',status:'ATIVO',startDate:'2026-01-05',modified:'2026-10-01T12:00:00Z'};

// Break: fitting 14 columns leaves tiny values with no readable local zoom
// while the app-wide gesture guard prevents page magnification.
test('annual table can be enlarged locally without changing data or PDF capture',async t=>{
  const {view,root}=setup(t);await view.open();
  const more=root.querySelector('[aria-label="Ampliar tabela anual"]');
  const less=root.querySelector('[aria-label="Reduzir tabela anual"]');
  const fit=root.querySelector('[aria-label="Ajustar tabela anual à tela"]');
  assert.ok(more&&less&&fit,'annual table needs readable local magnification');
  const annual=root.querySelector('.pr-table--annual'),wrapper=annual.closest('.pr-section-scroll');
  const {captureFilteredReport}=await import('../src/ui/report-print.js');
  const before=captureFilteredReport(root,{title:'Provisões'});
  assert.equal(less.disabled,true);
  for(let count=0;count<6;count++)more.click();
  assert.equal(wrapper.style.getPropertyValue('--pr-annual-zoom'),'4');
  assert.equal(root.querySelector('[aria-label="Ampliação da tabela anual"]').textContent,'400%');
  assert.deepEqual(captureFilteredReport(root,{title:'Provisões'}),before);
  less.click();assert.equal(wrapper.style.getPropertyValue('--pr-annual-zoom'),'3.5');
  fit.click();assert.equal(wrapper.style.getPropertyValue('--pr-annual-zoom'),'1');
  assert.equal(less.disabled,true);
  for(let count=0;count<20;count++)more.click();
  assert.equal(wrapper.style.getPropertyValue('--pr-annual-zoom'),'5');assert.equal(more.disabled,true);
});

// Break: stacked cells lose their column names or the PDF loses month headers.
test('responsive provision cells retain every field and month label without adding duplicate PDF text',async t=>{
  const {view,root}=setup(t);await view.open();
  const main=root.querySelector('table[data-section=provisions]');
  assert.deepEqual([...main.querySelectorAll('tbody tr[data-id] td')].map(cell=>cell.dataset.label),
    ['FILIAL','FORNECEDOR','PRODUTO','DATA VENCIMENTO','AGENDAMENTO','VALOR','STATUS']);
  const annual=root.querySelector('table[data-section=annual]');
  const labels=[...annual.querySelector('tbody tr[data-recurrence-id]').cells].map(cell=>cell.dataset.label);
  assert.deepEqual(labels,['FORNECEDOR','JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ','TOTAL']);
  assert.equal(root.querySelector('.pr-scroll-hint'),null);
  assert.equal(main.getAttribute('role'),'table');
  assert.equal(main.querySelector('tbody tr[data-id]').getAttribute('role'),'row');
  assert.equal(main.querySelector('tbody tr[data-id] td').getAttribute('role'),'cell');
  const {captureFilteredReport}=await import('../src/ui/report-print.js');
  const capture=captureFilteredReport(root,{title:'Provisões'}),tables=capture.pages[0].blocks.filter(b=>b.type==='table');
  assert.deepEqual(tables.map(table=>table.rows.filter(row=>row.header).at(-1).cells.length),[7,14,8]);
  assert.equal(tables[0].rows[2].cells[0].runs.map(run=>run.text).join('').trim(),row.branch);
});
function setup(t, loadProvisionReportSnapshot = async () => ({provisions:[row],recurrences:[recurrence]}), portrait=false, syncRecurringProvisions=async()=>{}) {
  assert.equal(typeof createProvisionReportView, 'function');
  const dom=new JSDOM('<main id="app"><button>Mascote</button></main>');let vertical=portrait;
  dom.window.matchMedia=()=>({get matches(){return vertical;}});
  const view=createProvisionReportView({document:dom.window.document,data:{loadProvisionReportSnapshot,syncRecurringProvisions},now:()=>new Date('2026-10-05T12:00:00Z')});
  t.after(()=>{view.destroy();dom.window.close();});
  return {view,root:view.element,dom,rotate(v){vertical=v;dom.window.dispatchEvent(new dom.window.Event('resize'));}};
}
test('refresh waits for recurring-expense flow completion before fetching and showing new provisions',async t=>{
  let release,fetches=0,syncs=0;
  const completed=new Promise(resolve=>{release=resolve;});
  const {view,root}=setup(t,async()=>({provisions:fetches++?[row,{...row,id:'315'}]:[row],recurrences:[recurrence]}),false,
    async()=>{syncs++;await completed;});
  await view.open();
  assert.equal(syncs,0,'opening the report must not start the financial flow');
  const refresh=root.querySelector('button[aria-label="Atualizar relatório de provisões"]');
  assert.ok(refresh);
  refresh.click();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(syncs,1);assert.equal(fetches,1);
  assert.equal(refresh.disabled,true);assert.equal(root.querySelector('[aria-busy="true"]')!==null,true);
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(fetches,2);assert.equal(refresh.disabled,false);
  assert.ok(root.querySelector('[data-section=provisions] tr[data-id="315"]'));
});
test('failed recurring-expense flow does not falsely finish with a SharePoint-only reload',async t=>{
  let fetches=0;
  const {view,root}=setup(t,async()=>{fetches++;return {provisions:[row],recurrences:[recurrence]};},false,
    async()=>{throw new Error('O fluxo de provisões falhou.');});
  await view.open();const refresh=root.querySelector('button[aria-label="Atualizar relatório de provisões"]');
  refresh.click();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(fetches,1);assert.match(root.querySelector('.pl-notice').textContent,/falhou/);
  assert.ok(root.querySelector('[data-section=provisions] tr[data-id="314"]'),'the old report stays visible with an error notice');
  assert.equal(refresh.disabled,false);
});
test('closing and reopening during recurring sync rejoins the same flow before refreshing rows',async t=>{
  let release,fetches=0,syncs=0;
  const completion=new Promise(resolve=>{release=resolve;});
  const {view,root}=setup(t,async()=>({provisions:fetches++?[row,{...row,id:'315'}]:[row],recurrences:[recurrence]}),false,
    async()=>{syncs++;await completion;});
  await view.open();root.querySelector('[aria-label="Atualizar relatório de provisões"]').click();
  await new Promise(resolve=>setImmediate(resolve));view.close();
  const reopened=view.open();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(syncs,1);assert.equal(fetches,1);
  release();await reopened;
  assert.equal(syncs,1);assert.equal(fetches,2);
  assert.ok(root.querySelector('[data-section=provisions] tr[data-id="315"]'));
});
test('provision report waits for landscape, restores focus outside, and reloads after rotation',async t=>{
  let calls=0;const {view,root,dom,rotate}=setup(t,async()=>{calls++;return {provisions:[row],recurrences:[recurrence]};},true);
  const trigger=dom.window.document.querySelector('button');trigger.focus();await view.open();
  assert.equal(calls,1);assert.equal(root.querySelector('.pl-orientation').hidden,true);
  rotate(false);await new Promise(r=>setImmediate(r));assert.equal(calls,1);
  assert.equal(root.querySelectorAll('.pr-table').length,3);
  root.querySelector('td').click();assert.equal(root.hidden,false);
  rotate(true);assert.equal(root.querySelector('.pl-report').hidden,false);
  rotate(false);await new Promise(r=>setImmediate(r));assert.equal(calls,1);
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

// Break: dots inside narrow recurring-expense month cells force status text
// onto extra lines, while provision statuses still need their own markers.
test('provision statuses keep markers and annual recurrence statuses use colored text without dots',async t=>{
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
  assert.equal(root.querySelectorAll('.pr-table--annual .pr-status-dot').length,0);
  assert.equal(month.querySelector('[data-status-tone=purple]')?.textContent,'INICIADO:');
  assert.equal(month.querySelector('[data-status-tone=green]')?.textContent,'02/10/2026');
  assert.equal(month.querySelector('[data-status-tone=red]')?.textContent,'ATR. 1d');
  assert.equal(month.querySelector('[data-status-tone=orange]')?.textContent,'EM 0d');
  assert.equal(month.querySelector('[data-status-tone=green]')?.classList.contains('pr-green'),false,'paid dates keep their original black text');
  assert.deepEqual([...month.querySelectorAll('.pr-date')].map(node=>node.textContent),['01/10/2026','02/10/2026','04/10/2026','05/10/2026','09/10/2026']);
  assert.equal(month.querySelector('.pr-money')?.textContent.replace(/\s/g,''),'R$1.234.567,89');
});

test('provision report keeps blue next-payment and orange inactive indicators with their dates',async t=>{
  const {view,root}=setup(t,async()=>({provisions:[{...row,paidDate:'2026-10-02',status:'PAGAMENTO EFETUADO'},{...row,id:'316',recurrenceId:'8'}],
    recurrences:[recurrence,{...recurrence,id:'8',status:'INATIVO'}]}));await view.open();
  const next=root.querySelector('[data-section=annual] tr[data-recurrence-id="7"] [data-month="11"]');
  assert.equal(next.querySelector('[data-status-tone=blue]')?.textContent,'PRÓX');
  assert.equal(next.querySelector('.pr-date')?.textContent,'09/10');
  assert.equal(root.querySelector('[data-recurrence-id="8"] [data-column=supplier] [data-status-tone=orange]')?.textContent,'INATIVO COM PROVISÃO PENDENTE');
  assert.equal(root.querySelectorAll('.pr-table--annual .pr-status-dot').length,0);
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

// Break: the summary renders child metadata, loses a product, changes the
// annual section, or expansion adds summary amounts to the pending footer.
test('multi-item description starts collapsed and expands original linked rows without counting the summary',async t=>{
  const first={...row,id:'301',descriptionId:'42',total:0.1,product:'Água',observation:'<b>Original</b>'};
  const second={...row,id:'302',descriptionId:'42',total:0.2,branch:'Filial diferente',supplier:'Outro fornecedor',product:'Internet',observation:'',dueDate:'2026-10-12'};
  const single={...row,id:'303',descriptionId:'43',total:7};
  const descriptions=[{id:'42',branch:'Filial do pai',supplier:'Referência',dueDate:'2026-10-20'},
    {id:'43',branch:'Filial do pai',supplier:'Referência',dueDate:'2026-10-20'}];
  const {view,root,dom}=setup(t,async()=>({provisions:[first,second,single],recurrences:[recurrence],descriptions}));await view.open();
  const main=root.querySelector('.pr-table--provisions'),annual=root.querySelector('.pr-table--annual');
  const annualBefore=annual.outerHTML;
  const group=main.querySelector('tr[data-description-id="42"]'),toggle=group?.querySelector('button');
  assert.ok(toggle,'multi-item parent needs an accessible expand/collapse button');
  assert.equal(toggle.type,'button');assert.equal(toggle.getAttribute('aria-expanded'),'false');
  assert.match(toggle.getAttribute('aria-label'),/Expandir.*42/);
  assert.match(toggle.textContent,/↓/);
  assert.equal(group.querySelector('[data-column=branch]').textContent.replace('↓','').trim(),'Filial do pai');
  assert.equal(group.querySelector('[data-column=supplier]').textContent,'Referência');
  assert.equal(group.querySelector('[data-column=dueDate]').textContent,'20/10/2026');
  assert.equal(group.querySelector('[data-column=total]').textContent.replace(/\s/g,''),'R$0,30');
  assert.deepEqual([...group.querySelector('[data-column=product]').children].map(node=>node.textContent),['Água (<b>Original</b>)','Internet']);
  assert.equal(group.querySelector('b'),null);
  assert.equal(main.querySelectorAll('tr[data-id]:not([hidden])').length,1);assert.equal(main.querySelector('tr[data-id="303"] button'),null);
  const controlled=toggle.getAttribute('aria-controls').split(' ').map(id=>dom.window.document.getElementById(id));
  assert.ok(controlled.every(Boolean),'aria-controls must reference existing rows even when collapsed');
  assert.deepEqual(controlled.map(node=>node.dataset.id),['301','302']);assert.ok(controlled.every(node=>node.hidden));
  const before=root.querySelector('[data-metric=pendingTotal]').textContent;
  toggle.focus();toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'),'true');assert.match(toggle.getAttribute('aria-label'),/Recolher.*42/);
  assert.equal(main.querySelectorAll('tr[data-id]:not([hidden])').length,3);assert.ok(controlled.every(node=>!node.hidden));
  assert.equal(dom.window.document.activeElement,toggle);
  const child=main.querySelector('tr[data-id="302"]');
  assert.equal(child.querySelector('[data-column=branch]').textContent,'Filial diferente');
  assert.equal(child.querySelector('[data-column=supplier]').textContent,'Outro fornecedor');
  assert.equal(child.querySelector('[data-column=dueDate]').textContent,'12/10/2026');
  assert.equal(child.querySelector('[data-column=total]').textContent.replace(/\s/g,''),'R$0,20');
  assert.equal(child.querySelector('[data-column=product]').dataset.label,'PRODUTO');
  assert.equal(root.querySelector('[data-metric=pendingTotal]').textContent,before);
  assert.equal(root.querySelector('[data-metric=pendingCount]').textContent,'3 pendência(s)');
  assert.equal(annual.outerHTML,annualBefore);
  toggle.click();assert.equal(toggle.getAttribute('aria-expanded'),'false');assert.equal(main.querySelectorAll('tr[data-id]:not([hidden])').length,1);
  toggle.click();const product=root.querySelector('[name=product]');product.value='Água';product.dispatchEvent(new dom.window.Event('change'));
  assert.equal(root.querySelector('.pr-table--provisions button'),null);
  assert.deepEqual([...root.querySelectorAll('.pr-table--provisions tr[data-id]')].map(node=>node.dataset.id),['301']);
  assert.equal(root.querySelector('[data-metric=pendingTotal]').textContent.replace(/\s/g,''),'R$0,10');
});

// Break: expanded items repeat the summary's branch, supplier, date and status
// instead of reserving their cells for differences and each item's own value.
test('expanded description omits only equal parent fields while preserving item details',async t=>{
  const first={...row,id:'501',descriptionId:'42',branch:'Filial do pai',supplier:'Fornecedor do pai',
    product:'Areia',dueDate:'2026-10-20',schedule:'PENDENTE',status:'PAGAMENTO PREVISTO',total:120};
  const second={...first,id:'502',branch:'Outra filial',supplier:'Outro fornecedor',product:'Cimento',
    dueDate:'2026-10-21',total:80};
  const descriptions=[{id:'42',branch:'Filial do pai',supplier:'Fornecedor do pai',dueDate:'2026-10-20'}];
  const {view,root}=setup(t,async()=>({provisions:[first,second],recurrences:[recurrence],descriptions}));
  await view.open();
  const summary=root.querySelector('tr[data-description-id="42"]');
  const branch=summary.querySelector('[data-column=branch]');
  assert.deepEqual([...branch.firstElementChild.children].map(node=>node.localName),['span','button']);
  const toggle=branch.querySelector('button');toggle.click();
  const equal=root.querySelector('tr[data-id="501"]'),different=root.querySelector('tr[data-id="502"]');
  for(const name of ['branch','supplier','dueDate','schedule','status']){
    assert.equal(equal.querySelector(`[data-column="${name}"]`).textContent,'',`${name} repeats the parent`);
  }
  assert.match(equal.querySelector('[data-column=status]').getAttribute('aria-label'),/PAGAMENTO PREVISTO · VENCE EM 15 DIAS/);
  const {captureFilteredReport}=await import('../src/ui/report-print.js');
  const exported=captureFilteredReport(root,{title:'Provisões'}).pages[0].blocks.find(block=>block.type==='table');
  for(const column of [0,1,3,4,6]){
    assert.deepEqual(exported.rows[3].cells[column].runs,[],`PDF repeats parent column ${column}`);
  }
  assert.match(equal.querySelector('[data-column=product]').textContent,/^Areia \(Conferir quantidade\)$/);
  assert.match(equal.querySelector('[data-column=total]').textContent,/120,00/);
  assert.equal(different.querySelector('[data-column=branch]').textContent,'Outra filial');
  assert.equal(different.querySelector('[data-column=supplier]').textContent,'Outro fornecedor');
  assert.equal(different.querySelector('[data-column=dueDate]').textContent,'21/10/2026');
  assert.match(different.querySelector('[data-column=product]').textContent,/^Cimento \(Conferir quantidade\)$/);
  assert.match(different.querySelector('[data-column=total]').textContent,/80,00/);
});
