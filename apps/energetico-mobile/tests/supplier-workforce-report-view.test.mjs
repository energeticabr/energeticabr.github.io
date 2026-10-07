import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {captureFilteredReport, decorateReportPrint} from '../src/ui/report-print.js';
import {createAttachmentPreview} from '../src/web/attachment-preview.js';

const {createSupplierWorkforceReportView} = await import('../src/ui/supplier-workforce-report-view.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const tick = () => new Promise(resolve => setImmediate(resolve));
const snapshot = {
  complete:true, warnings:['Conferir cadastro de terceiros.'],
  suppliers:[
    {id:'1',name:'Ana',branch:'BH',property:'Obra 1',profession:'PEDREIRO',status:'ATIVO',contractor:true,paymentMethod:'DIÁRIA',dailyValue:100,dailyValueBlank:false,stage:'Estrutura',activity:'Alvenaria',measurement:''},
    {id:'2',name:'Beto',branch:'BH',property:'Obra 1',profession:'ELETRICISTA',status:'ATIVO',contractor:true,paymentMethod:'MEDIÇÃO',dailyValue:null,dailyValueBlank:true,stage:'Acabamento',activity:'Instalação',measurement:'20 metros'},
    {id:'3',name:'Cris',branch:'SP',property:'Obra 2',profession:'PEDREIRO',status:'ATIVO',contractor:true,paymentMethod:'VALOR GLOBAL',dailyValue:null,dailyValueBlank:true,stage:'',activity:'',measurement:''},
    {id:'4',name:'Davi',branch:'BH',property:'Obra 3',profession:'SERVENTE',status:'INATIVO',contractor:true,paymentMethod:'DIÁRIA',dailyValue:75,dailyValueBlank:false,stage:'Estrutura',activity:'Apoio',measurement:''},
    {id:'5',name:'Equipe própria',branch:'RJ',property:'Escritório',profession:'ADMINISTRATIVO',status:'ATIVO',contractor:false,paymentMethod:'DIÁRIA',dailyValue:90,dailyValueBlank:false,stage:'Escritório',activity:'Administrativo',measurement:''},
  ],
  presences:[
    {id:'1',date:'2026-09-01',branch:'BH',property:'Obra 1',supplier:'Ana',stage:'Estrutura',presence:'PRESENTE'},
    {id:'2',date:'2026-10-01',branch:'BH',property:'Obra 1',supplier:'Ana',stage:'Estrutura',presence:'AUSENTE'},
    {id:'3',date:'2026-10-04',branch:'BH',property:'Obra 1',supplier:'Ana',stage:'Estrutura',presence:'PRESENTE'},
    {id:'4',date:'2026-10-07',branch:'BH',property:'Obra 1',supplier:'Ana',stage:'Estrutura',presence:'PENDENTE'},
    {id:'5',date:'2026-10-02',branch:'BH',property:'Obra 1',supplier:'Beto',stage:'Acabamento',presence:'PRESENTE'},
    {id:'6',date:'2026-10-03',branch:'SP',property:'Obra 2',supplier:'Cris',stage:'Acabamento',presence:'PRESENTE'},
    {id:'7',date:'2026-09-02',branch:'BH',property:'Obra 3',supplier:'Davi',stage:'Estrutura',presence:'PRESENTE'},
    {id:'8',date:'2026-10-01',branch:'BH',property:'Obra 3',supplier:'Davi',stage:'Estrutura',presence:'PRESENTE'},
  ],
};
function setup(t,{loadSnapshot=async()=>structuredClone(snapshot),onClose=()=>{}}={}) {
  assert.equal(typeof createSupplierWorkforceReportView,'function','supplier workforce view must exist');
  const dom=new JSDOM('<main id="app"><button id="trigger">Abrir</button></main><button id="outside">Fora</button>');
  dom.window.matchMedia=()=>({matches:false});
  const doc=dom.window.document;
  const view=createSupplierWorkforceReportView({document:doc,data:{loadSnapshot},onClose,now:()=>new Date(2026,9,7,12)});
  t.after(()=>{view.destroy();dom.window.close();});
  return {view,root:view.element,dom,doc};
}
function change(root,name,value,type='change') {
  const control=root.querySelector(`[name="${name}"]`); control.value=value;
  control.dispatchEvent(new root.ownerDocument.defaultView.Event(type,{bubbles:true}));
}
const rows=root=>[...root.querySelectorAll('tbody tr')];
const named=(root,name)=>rows(root).find(row=>row.querySelector('.swr-supplier-name')?.textContent===name);

// Break caught: the monthly default excludes old presences or inactive suppliers leak into ATIVO.
test('blank initial date and local today show active contractors in complete nested seven-column tables',async t=>{
  const {view,root}=setup(t); await view.open();
  assert.equal(root.querySelector('[name=startDate]').value,'');
  assert.equal(root.querySelector('[name=endDate]').value,'2026-10-07');
  assert.equal(root.querySelector('[name=supplierStatus]').value,'ATIVO');
  assert.deepEqual([...root.querySelectorAll('.swr-branch-heading')].map(node=>node.textContent),['🏢 FILIAL: BH','🏢 FILIAL: SP']);
  assert.deepEqual([...root.querySelectorAll('.swr-property-heading')].map(node=>node.textContent),['🏠 IMÓVEL: Obra 1','🏠 IMÓVEL: Obra 2']);
  assert.equal(root.querySelectorAll('.swr-profession').length,3);
  assert.deepEqual(rows(root).map(row=>row.querySelector('.swr-supplier-name').textContent).sort(),['Ana','Beto','Cris']);
  for (const table of root.querySelectorAll('table')) assert.deepEqual([...table.querySelectorAll('thead th')].map(node=>node.textContent),
    ['FORNECEDOR','PROFISSÃO','FORMA PGTO','VLR DIÁRIO','FREQUÊNCIA','DESCRITIVO / ATIVIDADE','MEDIÇÃO']);
  const summary=root.querySelector('.swr-property > .swr-summary');
  assert.match(summary.textContent,/2 FORNECEDORES.*1 DIÁRIA.*1 MEDIÇÃO.*0 VALOR GLOBAL.*100,00.*DIA/s);
  assert.match(root.querySelector('.swr-warnings').textContent,/Conferir cadastro/);
  assert.match(root.querySelector('.swr-filter-note').textContent,/presenças filtradas/);
  assert.match(root.querySelector('.swr-filter-note').textContent,/sem limite de 2\.000/);
});

// Break caught: frequency uses unfiltered rows, pending counts as present, or history is truncated.
test('frequency and first dates visibly track filtered presences with the full historical caption',async t=>{
  const {view,root}=setup(t);await view.open();
  const ana=named(root,'Ana');
  assert.match(ana.querySelector('.swr-first-date').textContent,/01\/09\/2026.*36 dias/);
  assert.equal(ana.querySelector('.swr-frequency-30').textContent,'1 / 3 — 33,3%');
  assert.equal(ana.querySelector('.swr-frequency-history').textContent,'2 / 4 — 50,0%');
  assert.match(ana.querySelector('.swr-frequency').textContent,/Histórico completo/);
  change(root,'startDate','2026-10-01');
  assert.equal(named(root,'Ana').querySelector('.swr-frequency-history').textContent,'1 / 3 — 33,3%');
  assert.match(named(root,'Ana').querySelector('.swr-first-date').textContent,/01\/10\/2026.*6 dias/);
  change(root,'supplierStatus','INATIVO');
  assert.match(named(root,'Davi').querySelector('.swr-first-date').textContent,/Período ativo.*01\/10\/2026.*01\/10\/2026.*0 dias/s);
});

// Break caught: categorical controls stay native-only, auto-open the keyboard, or ignore selection.
test('all five categorical filters use the searchable report picker and their user bindings work',async t=>{
  const {view,root,dom}=setup(t);await view.open();
  for(const name of ['branch','property','supplier','supplierStatus','stage']) {
    const select=root.querySelector(`[name=${name}]`);
    assert.equal(select.hidden,true);assert.ok(select.parentElement.querySelector('.sfs--report'));
  }
  assert.deepEqual([...root.querySelector('[name=branch]').options].map(option=>option.value),['','BH','SP']);
  root.querySelector('[aria-label="Abrir opções de FILIAL"]').click();
  const popup=root.querySelector('.sfs-popup:not([hidden])'),search=popup.querySelector('input[type=search]');
  assert.equal(popup.dataset.placement,'expanded');assert.notEqual(dom.window.document.activeElement,search);
  search.value='sp';search.dispatchEvent(new dom.window.Event('input'));
  [...popup.querySelectorAll('[role=option]')].find(node=>node.textContent==='SP').click();
  assert.deepEqual(rows(root).map(row=>row.querySelector('.swr-supplier-name').textContent),['Cris']);
  change(root,'branch','');change(root,'property','Obra 1');assert.equal(rows(root).length,2);
  change(root,'stage','Estrutura');assert.deepEqual(rows(root).map(row=>row.querySelector('.swr-supplier-name').textContent),['Ana']);
  change(root,'stage','');change(root,'supplier','Beto');assert.deepEqual(rows(root).map(row=>row.querySelector('.swr-supplier-name').textContent),['Beto']);
  change(root,'supplier','');change(root,'property','');change(root,'supplierStatus','INATIVO');assert.ok(named(root,'Davi'));
});

// Break caught: a presence property absent from registrations cannot be selected despite valid frequency data.
test('property picker includes presence locations and keeps grouping by the supplier registration',async t=>{
  const value=structuredClone(snapshot);
  for(const presence of value.presences.filter(row=>row.supplier==='Ana'))presence.property='Canteiro visitado';
  const {view,root}=setup(t,{loadSnapshot:async()=>value});await view.open();
  const property=root.querySelector('[name=property]');
  assert.ok([...property.options].some(option=>option.value==='Canteiro visitado'));
  root.querySelector('[aria-label="Abrir opções de IMÓVEL"]').click();
  const popup=root.querySelector('.sfs-popup:not([hidden])');
  [...popup.querySelectorAll('[role=option]')].find(node=>node.textContent==='Canteiro visitado').click();
  assert.deepEqual(rows(root).map(row=>row.querySelector('.swr-supplier-name').textContent),['Ana']);
  assert.match(root.querySelector('.swr-property-heading').textContent,/Obra 1/);
  assert.equal(named(root,'Ana').querySelector('.swr-frequency-history').textContent,'2 / 4 — 50,0%');
  const captured=captureFilteredReport(root);
  assert.ok(captured.filters.some(filter=>filter.label==='IMÓVEL'&&filter.value==='Canteiro visitado'));
});

// Break caught: missing daily money is hidden as zero or non-daily blank amounts become errors.
test('daily measurement statuses and missing descriptive fields keep their source meanings',async t=>{
  const value=structuredClone(snapshot);value.suppliers[0].dailyValue=null;value.suppliers[0].dailyValueBlank=true;
  const {view,root}=setup(t,{loadSnapshot:async()=>value});await view.open();
  assert.match(named(root,'Ana').querySelector('.swr-daily-value').textContent,/PREENCHER/);
  assert.match(root.querySelector('.swr-property > .swr-summary').textContent,/R\$\s*0,00/);
  assert.match(root.querySelector('.swr-warnings').textContent,/PREENCHER/);
  assert.equal(named(root,'Ana').querySelector('.swr-measurement').textContent,'✅');
  assert.equal(named(root,'Beto').querySelector('.swr-daily-value').textContent,'CONFORME MEDIÇÃO');
  assert.equal(named(root,'Beto').querySelector('.swr-measurement').textContent,'20 metros');
  assert.equal(named(root,'Cris').querySelector('.swr-daily-value').textContent,'CONFORME MEDIÇÃO');
  assert.match(named(root,'Cris').querySelector('.swr-description').textContent,/ETAPA ATUAL.*PREENCHER.*ATIVIDADE EXECUTADA.*PREENCHER/s);
  assert.match(named(root,'Cris').querySelector('.swr-measurement').getAttribute('aria-label'),/não informada/i);
});

// Break caught: malformed nonblank money is mislabeled as blank measurement or loses a literal zero.
test('nonblank invalid daily amounts stay incomplete while zero is a real currency value',async t=>{
  const value=structuredClone(snapshot);value.suppliers[0].dailyValue=null;value.suppliers[1].dailyValueBlank=false;value.suppliers[2].dailyValue=0;value.suppliers[2].dailyValueBlank=false;
  const {view,root}=setup(t,{loadSnapshot:async()=>value});await view.open();
  assert.equal(named(root,'Beto').querySelector('.swr-daily-value').textContent,'VALOR INCOMPLETO');
  assert.match(root.querySelector('.swr-property > .swr-summary').textContent,/VALOR INCOMPLETO/);
  assert.match(named(root,'Cris').querySelector('.swr-daily-value').textContent,/R\$\s*0,00/);
});

// Break caught: user text becomes executable markup in headers, badges, rows, warnings, or options.
test('every external string renders literally and only the fixed official logo creates an image',async t=>{
  const value=structuredClone(snapshot),unsafe='<img src=x onerror=alert(1)>';
  const row=value.suppliers[0];for(const key of ['name','branch','property','profession','stage','activity','measurement'])row[key]=unsafe;
  row.paymentMethod='<script>money()</script>';
  for(const presence of value.presences.filter(p=>p.supplier==='Ana'))Object.assign(presence,{supplier:unsafe,branch:unsafe,property:unsafe,stage:unsafe});
  value.warnings=['<script>secret()</script>'];
  const {view,root}=setup(t,{loadSnapshot:async()=>value});await view.open();
  assert.ok(named(root,unsafe));assert.match(root.textContent,/<img src=x onerror=alert\(1\)>/);
  assert.match(root.textContent,/<script>secret\(\)<\/script>/);assert.match(root.textContent,/<script>money\(\)<\/script>/);
  assert.equal(root.querySelectorAll('img').length,1);assert.equal(root.querySelectorAll('script').length,0);
  assert.ok(root.querySelector('img').src.endsWith('/assets/logo-energetica-oficial.png'));
});

// Break caught: exporting captures only the visible/first profession or loses hierarchy and filter captions.
test('shared PDF captures every branch property profession and full table then keeps filters and scroll',async t=>{
  const {view,root}=setup(t);await view.open();
  const captured=captureFilteredReport(root),tables=captured.pages[0].blocks.filter(block=>block.type==='table');
  assert.deepEqual(tables.map(table=>[table.widths.length,table.rows.length]),[[7,2],[7,2],[7,2]]);
  assert.match(JSON.stringify(captured),/FILIAL: BH/);assert.match(JSON.stringify(captured),/IMÓVEL: Obra 2/);
  assert.match(JSON.stringify(captured),/ELETRICISTA/);assert.match(JSON.stringify(captured),/Medição não informada/);
  assert.ok(captured.filters.some(filter=>filter.label==='DATA INICIAL'&&filter.value==='Todos'));
  assert.ok(captured.filters.some(filter=>filter.label==='DATA FINAL'&&filter.value==='07/10/2026'));
  assert.ok(captured.filters.some(filter=>filter.label==='STATUS DO FORNECEDOR'&&filter.value==='ATIVO'));
  change(root,'branch','BH');const content=root.querySelector('.swr-content');content.scrollTop=88;
  let printSnapshot,returnOptions;
  const decorated=decorateReportPrint(view,{action:'open-supplier-workforce-report',loadLogo:async()=>new Uint8Array(),
    buildPdf:async value=>{printSnapshot=value;return new Blob(['%PDF-test'],{type:'application/pdf'});},previewMedia:async(pending,_name,options)=>{await pending;returnOptions=options;}});
  t.after(()=>decorated.destroy());
  const print=root.querySelector('.report-print-button');assert.ok(print.parentElement.querySelector('.pl-refresh'));
  print.click();await tick();await tick();
  assert.equal(printSnapshot.pages[0].blocks.filter(block=>block.type==='table').length,2);
  returnOptions.onClose();assert.equal(root.querySelector('[name=branch]').value,'BH');assert.equal(content.scrollTop,88);
});

// Break caught: a date edited before blur leaves the old report printable.
test('date input fails closed immediately and recovers from reversed dates without a reload',async t=>{
  let loads=0;const {view,root}=setup(t,{loadSnapshot:async()=>{loads++;return structuredClone(snapshot);}});await view.open();
  change(root,'startDate','2026-10-08','input');assert.equal(rows(root).length,0);
  assert.match(root.querySelector('[role=alert]').textContent,/data inicial/i);assert.throws(()=>captureFilteredReport(root));
  change(root,'startDate','','input');assert.equal(rows(root).length,3);assert.equal(loads,1);
});

// Break caught: incomplete snapshots/errors show cached partial totals or remain printable.
test('load failure and incomplete or malformed snapshots clear tables and prevent PDF capture',async t=>{
  for(const loadSnapshot of [async()=>{throw Error('offline');},async()=>({...snapshot,complete:false}),async()=>({complete:true,suppliers:[],warnings:[]})]) {
    const {view,root}=setup(t,{loadSnapshot});await view.open();assert.equal(rows(root).length,0);
    assert.match(root.querySelector('[role=alert]').textContent,/Não foi possível/);assert.throws(()=>captureFilteredReport(root));
  }
});

// Break caught: clicking refresh during loading doesn't abort, or the old reply replaces a new generation.
test('refresh cancels the previous generation and late completion never replaces fresh tables',async t=>{
  const requests=[];const {view,root}=setup(t,{loadSnapshot:({signal})=>new Promise(resolve=>requests.push({signal,resolve}))});
  const opening=view.open();await tick();root.querySelector('.pl-refresh').click();await tick();
  assert.equal(requests.length,2);assert.equal(requests[0].signal.aborted,true);
  requests[1].resolve(structuredClone(snapshot));await tick();await opening;
  const table=root.querySelector('table');requests[0].resolve({complete:true,suppliers:[],presences:[],warnings:[]});await tick();
  assert.equal(root.querySelector('table'),table);assert.equal(rows(root).length,3);
});

// Break caught: late loads paint a closed/destroyed view or a reopened session uses old filters.
test('close and destroy abort requests and reopening ignores late replies and resets defaults',async t=>{
  const requests=[];const {view,root}=setup(t,{loadSnapshot:({signal})=>new Promise(resolve=>requests.push({signal,resolve}))});
  const first=view.open();await tick();view.close();await first;assert.equal(requests[0].signal.aborted,true);
  const second=view.open();await tick();requests[1].resolve(structuredClone(snapshot));await second;
  change(root,'branch','BH');const table=root.querySelector('table');requests[0].resolve({complete:true,suppliers:[],presences:[]});await tick();
  assert.equal(root.querySelector('table'),table);view.close();const third=view.open();await tick();
  assert.equal(root.querySelector('[name=branch]').value,'');view.destroy();await third;assert.equal(requests[2].signal.aborted,true);
  requests[2].resolve(snapshot);await tick();assert.equal(root.isConnected,false);assert.equal(rows(root).length,0);await assert.rejects(view.open(),/encerrado/);
});

// Break caught: portrait loads data or rotation discards the filtered table/scroll.
test('portrait blocks loading and rotation cancels pending loads but retains an already loaded report',async t=>{
  let loads=0;const {view,root,dom}=setup(t,{loadSnapshot:async()=>{loads++;return structuredClone(snapshot);}});
  dom.window.matchMedia=()=>({matches:true});await view.open();assert.equal(loads,0);assert.equal(root.querySelector('.pl-orientation').hidden,false);
  assert.equal(root.querySelector('.swr-close').closest('[hidden]'),null);assert.throws(()=>captureFilteredReport(root));
  dom.window.matchMedia=()=>({matches:false});dom.window.dispatchEvent(new dom.window.Event('resize'));await tick();
  change(root,'branch','BH');const table=root.querySelector('table'),content=root.querySelector('.swr-content');content.scrollTop=66;
  dom.window.matchMedia=()=>({matches:true});dom.window.dispatchEvent(new dom.window.Event('orientationchange'));assert.throws(()=>captureFilteredReport(root));
  dom.window.matchMedia=()=>({matches:false});dom.window.dispatchEvent(new dom.window.Event('resize'));await tick();
  assert.equal(root.querySelector('table'),table);assert.equal(content.scrollTop,66);assert.equal(loads,1);assert.equal(root.querySelector('[name=branch]').value,'BH');
});

// Break caught: focus escapes the modal or close leaves the application inert/scroll-locked.
test('keyboard trap outside focus escape and backdrop close restore the original UI',async t=>{
  let closes=0;const {view,root,doc,dom}=setup(t,{onClose:()=>closes++});doc.body.style.overflow='auto';doc.getElementById('trigger').focus();await view.open();
  assert.equal(doc.getElementById('app').inert,true);const panel=root.querySelector('[role=dialog]');panel.focus();
  root.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));assert.equal(doc.activeElement,root.querySelector('.pl-refresh'));
  panel.focus();root.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));assert.equal(doc.activeElement,root.querySelector('.swr-close'));
  doc.getElementById('outside').focus();assert.ok(root.contains(doc.activeElement));
  root.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(root.hidden,true);assert.equal(closes,1);assert.equal(doc.getElementById('app').inert,false);assert.equal(doc.body.style.overflow,'auto');assert.equal(doc.activeElement.id,'trigger');
  await view.open();root.click();assert.equal(root.hidden,true);assert.equal(closes,2);
});

// Break caught: no-match filters leave old rows on screen or omit an understandable empty state.
test('empty results remain explicit and safe to capture with their current filter captions',async t=>{
  const {view,root}=setup(t);await view.open();change(root,'startDate','2026-10-06');change(root,'supplier','Beto');
  assert.equal(rows(root).length,0);assert.match(root.querySelector('.swr-empty').textContent,/Nenhum fornecedor/i);
  const captured=captureFilteredReport(root);assert.equal(captured.pages[0].blocks.filter(block=>block.type==='table').length,0);
  assert.ok(captured.filters.some(filter=>filter.label==='FORNECEDOR'&&filter.value==='Beto'));
});

// Break caught: the report's outside-focus guard steals focus from the real native PDF dialog.
test('the real PDF preview owns focus and closing it returns to the same filtered report',async t=>{
  const {view,root,doc,dom}=setup(t);const preview=createAttachmentPreview({documentRef:doc,exportMedia:async()=>{},
    loadPdfPreview:async()=>({createPdfPreview:()=>({element:doc.createElement('canvas'),render:async()=>{},destroy(){}})})});
  const decorated=decorateReportPrint(view,{action:'open-supplier-workforce-report',previewMedia:preview.open,closePreview:preview.close,
    loadLogo:async()=>undefined,buildPdf:async()=>new Blob(['%PDF-test'],{type:'application/pdf'})});
  t.after(()=>{decorated.destroy();preview.destroy();});await decorated.open();change(root,'branch','BH');
  const print=root.querySelector('.report-print-button'),table=root.querySelector('table'),content=root.querySelector('.swr-content');content.scrollTop=73;
  print.click();await tick();await tick();
  const dialog=doc.querySelector('.attachment-preview-dialog'),close=doc.querySelector('.attachment-preview-close');
  assert.equal(dialog.open,true);assert.equal(doc.activeElement,close);
  close.click();assert.equal(root.hidden,false);assert.equal(root.querySelector('table'),table);
  assert.equal(root.querySelector('[name=branch]').value,'BH');assert.equal(content.scrollTop,73);assert.equal(doc.activeElement,print);
  assert.equal(root.querySelectorAll('table').length,2);assert.equal(dom.window.document.querySelectorAll('dialog[open]').length,0);
});
