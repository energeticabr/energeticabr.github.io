import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {captureFilteredReport, decorateReportPrint} from '../src/ui/report-print.js';

const {createContractorControlReportView} = await import('../src/ui/contractor-control-report-view.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('contractor-control-report-view.js')) return {};
  throw error;
});
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve, reject; const promise = new Promise((yes,no) => {resolve=yes;reject=no;});return {promise,resolve,reject};};
const row = (id, extra={}) => ({id:String(id),startDate:'2026-10-01',endDate:'',branch:'BH',supplier:'Ana',
  stage:'Estrutura',activity:'Alvenaria',measurementType:'VALOR GLOBAL',contractDocumentId:'900',estimateDocumentId:'901',
  globalEstimatedValue:1200.5,totalValue:320.25,totalMeasurements:0,status:'ATIVO',...extra});
const snapshot = () => ({rows:[row(1),row(2,{supplier:'Beto',stage:'Acabamento',activity:'Pintura',globalEstimatedValue:50}),
  row(3,{branch:'SP',supplier:'Cris',contractDocumentId:'902',globalEstimatedValue:100}),
  row(4,{supplier:'Davi',status:'INATIVO',contractDocumentId:'903',globalEstimatedValue:999})],
  documentStatuses:{900:'PENDENTE',901:'SUBMETIDO'},warnings:['Conferir documentos.']});
const details = id => ({launches:[{id:'71',date:'2026-10-02',supplier:'Ana',contract:id,total:212.5,paymentStatus:'APROVADO',paymentTone:'success'},
  {id:'70',date:'',supplier:'',contract:id,total:null,paymentStatus:'PENDENTE',paymentTone:'pending'}],
  measurements:[{id:'51',supplier:'Ana',contract:id,status:'ATIVO',statusTone:'success'},
    {id:'50',supplier:'Ana',contract:id,status:'INATIVO',statusTone:'danger'}]});
function setup(t,{loadOverview=async()=>snapshot(),loadDetails=async id=>details(id),onClose=()=>{},onHome=()=>{}}={}) {
  assert.equal(typeof createContractorControlReportView,'function','standalone contractor control export must be a function');
  const dom=new JSDOM('<main id="app"><button id="trigger" data-action="open-contractor-control-report">Abrir</button></main><button id="outside">Fora</button>');
  dom.window.matchMedia=()=>({matches:false});const doc=dom.window.document;
  const view=createContractorControlReportView({document:doc,data:{loadOverview,loadDetails},onClose,onHome});
  t.after(()=>{view.destroy();dom.window.close();});return {view,root:view.element,doc,dom};
}
function change(root,name,value) {const select=root.querySelector(`[name="${name}"]`);select.value=value;select.dispatchEvent(new root.ownerDocument.defaultView.Event('change',{bubbles:true}));}
const rows=root=>[...root.querySelectorAll('.ccr-main-table tbody tr[data-row-id]')];
const ids=root=>rows(root).map(node=>node.dataset.rowId);
const cell=(root,id,name)=>root.querySelector(`.ccr-main-table [data-row-id="${id}"] [data-column="${name}"]`);
const metric=(root,name)=>root.querySelector(`[data-metric="${name}"]`).textContent;

// Break: default ATIVO, complete column order, distinct document count, or literal zero disappears.
test('standalone renders all source columns and filtered source metrics without unselected detail lists',async t=>{
  const {view,root}=setup(t);await view.open();
  assert.equal(root.querySelector('[name=status]').value,'ATIVO');assert.deepEqual(ids(root),['3','2','1']);
  assert.equal(root.querySelector('h1').textContent,'CONTROLE DE EMPREITEIROS');
  assert.deepEqual([...root.querySelectorAll('.ccr-main-table thead th')].map(n=>n.textContent),
    ['ID','DATA INÍCIO','DATA FIM','FILIAL','FORNECEDOR','TIPO MEDIÇÃO','ATIVIDADE EXECUTADA','ID CONTRATO','ID ESTIMATIVA','VALOR GLOBAL ESTIMADO','VALOR TOTAL','TOTAL MEDIÇÕES','STATUS']);
  assert.deepEqual(['active','inactive','contracts'].map(name=>metric(root,name)),['3','0','2']);
  assert.match(metric(root,'activeGlobalValue'),/R\$\s*1\.350,50/);
  assert.match(cell(root,'1','totalMeasurements').textContent,/R\$\s*0,00/);
  assert.equal(cell(root,'1','startDate').textContent,'01/10/2026');
  assert.equal(root.querySelectorAll('table').length,1);assert.equal(root.querySelector('.ccr-detail').hidden,true);
  assert.match(root.querySelector('.ccr-note').textContent,/ID.*EMPREITEIRO.*IDCONTRATO/);
  assert.match(root.querySelector('.ccr-warnings').textContent,/Conferir documentos/);
  assert.ok(root.querySelector('img').src.endsWith('/assets/logo-energetica-oficial.png'));
  change(root,'status','');assert.deepEqual(['active','inactive','contracts'].map(name=>metric(root,name)),['3','1','3']);
});

// Break: shared picker omitted, keyboard autofocus, or filter intersection uses union.
test('six shared report pickers avoid autofocus and intersect ID branch supplier stage activity status',async t=>{
  const {view,root,doc}=setup(t);await view.open();
  assert.deepEqual([...root.querySelectorAll('select')].map(n=>[n.name,n.getAttribute('aria-label')]),
    [['id','NÚMERO CONTRATO'],['branch','FILIAL'],['supplier','FORNECEDOR'],['stage','ETAPA'],['activity','ATIVIDADE'],['status','STATUS']]);
  assert.equal(root.querySelectorAll('.sfs--report').length,6);
  root.querySelector('[aria-label="Abrir opções de FILIAL"]').click();
  const popup=root.querySelector('.sfs-popup:not([hidden])');assert.equal(popup.dataset.placement,'expanded');
  assert.notEqual(doc.activeElement,popup.querySelector('input[type=search]'));
  [...popup.querySelectorAll('[role=option]')].find(n=>n.textContent==='BH').click();assert.deepEqual(ids(root),['2','1']);
  change(root,'stage','Estrutura');assert.deepEqual(ids(root),['1']);
  change(root,'supplier','Beto');assert.deepEqual(ids(root),[]);
  change(root,'supplier','Ana');change(root,'activity','Pintura');assert.deepEqual(ids(root),[]);
  change(root,'activity','Alvenaria');change(root,'id','1');await tick();assert.deepEqual(ids(root),['1']);
  change(root,'status','INATIVO');assert.deepEqual(ids(root),[]);assert.equal(root.querySelector('.ccr-detail').hidden,true);
});

// Break: blank/document/payment/status tones collapse into the same color.
test('blank pending document pending submitted and active inactive retain separate source tones',async t=>{
  const {view,root}=setup(t);await view.open();
  assert.equal(cell(root,'1','endDate').dataset.tone,'pending');assert.equal(cell(root,'1','endDate').textContent,'PENDENTE');
  assert.equal(cell(root,'1','contractDocumentId').dataset.tone,'danger');assert.equal(cell(root,'1','contractDocumentId').textContent,'900 (PENDENTE)');
  assert.equal(cell(root,'1','estimateDocumentId').dataset.tone,'success');assert.equal(cell(root,'1','estimateDocumentId').textContent,'901');
  assert.equal(cell(root,'1','status').dataset.tone,'success');change(root,'status','INATIVO');
  assert.equal(cell(root,'4','status').dataset.tone,'danger');
});

// Break: use IDCONTRATO as the query identity or expose unlinked data returned by a provider.
test('row selection loads by EMPREITEIRO ID and renders only its six/four-column details and money',async t=>{
  const requested=[];const {view,root}=setup(t,{loadDetails:async id=>{requested.push(id);const value=details(id);value.launches.push({...value.launches[0],id:'999',contract:'900'});return value;}});
  await view.open();root.querySelector('[data-row-id="1"] [data-action="select-contractor"]').click();await tick();
  assert.deepEqual(requested,['1']);assert.equal(root.querySelector('[name=id]').value,'1');
  assert.equal(root.querySelectorAll('table').length,3);assert.equal(root.querySelector('.ccr-detail').hidden,false);
  assert.deepEqual([...root.querySelectorAll('.ccr-launches thead th')].map(n=>n.textContent),['ID LANÇAMENTO','DATA','FORNECEDOR','CONTRATO','VALOR TOTAL','STATUS']);
  assert.deepEqual([...root.querySelectorAll('.ccr-measurements thead th')].map(n=>n.textContent),['ID MEDIÇÃO','FORNECEDOR','Nº CONTRATO','STATUS']);
  assert.match(root.querySelector('.ccr-launches tbody').textContent,/71.*02\/10\/2026.*Ana.*1.*212,50.*APROVADO/s);
  assert.doesNotMatch(root.querySelector('.ccr-launches tbody').textContent,/999/);
  assert.equal(root.querySelector('.ccr-launches [data-column=paymentStatus]').dataset.tone,'success');
  assert.equal(root.querySelectorAll('.ccr-launches [data-tone=pending]').length,4);
  assert.deepEqual([...root.querySelectorAll('.ccr-measurements [data-column=status]')].map(n=>n.dataset.tone),['success','danger']);
});

// Break: unmatched selected ID keeps details visible or exports the old contract.
test('cross-filters immediately remove unmatched details and late responses cannot leak into PDF',async t=>{
  const pending=deferred();let signal;const {view,root}=setup(t,{loadDetails:(_id,options)=>{signal=options.signal;return pending.promise;}});
  await view.open();change(root,'id','1');await tick();change(root,'branch','SP');assert.equal(signal.aborted,true);
  assert.equal(root.querySelector('.ccr-detail').hidden,true);assert.equal(root.querySelectorAll('table').length,1);
  pending.resolve(details('1'));await tick();assert.equal(root.querySelectorAll('table').length,1);
  const restore=await view.preparePrint();const capture=captureFilteredReport(root);restore();
  assert.equal(capture.pages[0].blocks.filter(b=>b.type==='table').length,1);assert.doesNotMatch(JSON.stringify(capture),/LANÇAMENTOS VINCULADOS/);
});

// Break: failed overview keeps cached rows printable or cannot be retried.
test('overview errors and malformed replies clear printable data and retry recovers',async t=>{
  let calls=0;const {view,root}=setup(t,{loadOverview:async()=>{if(++calls===1)throw Error('Bearer secret https://private.invalid');return snapshot();}});
  await view.open();assert.deepEqual(ids(root),[]);assert.match(root.querySelector('[role=alert]').textContent,/Não foi possível/);
  assert.doesNotMatch(root.textContent,/secret|private/);await assert.rejects(view.preparePrint());assert.throws(()=>captureFilteredReport(root));
  root.querySelector('.ccr-retry').click();await tick();assert.equal(rows(root).length,3);
  for(const value of [{rows:null},{rows:[],documentStatuses:null},{rows:[],documentStatuses:{},warnings:null}]) {
    const broken=setup(t,{loadOverview:async()=>value});await broken.view.open();await assert.rejects(broken.view.preparePrint());assert.equal(rows(broken.root).length,0);
  }
});

// Break: failed details are silently omitted from PDF or retry queries a document ID.
test('detail errors refuse print and retry rebuilds both linked tables',async t=>{
  let calls=0;const {view,root}=setup(t,{loadDetails:async id=>{if(++calls===1)throw Error('offline');return details(id);}});
  await view.open();change(root,'id','1');await tick();assert.equal(root.querySelector('.ccr-detail').hidden,false);
  assert.match(root.querySelector('.ccr-detail [role=alert]').textContent,/Não foi possível/);
  await assert.rejects(view.preparePrint());assert.throws(()=>captureFilteredReport(root));
  root.querySelector('.ccr-detail-retry').click();await tick();assert.equal(root.querySelectorAll('.ccr-detail table').length,2);
  const restore=await view.preparePrint();assert.equal(captureFilteredReport(root).pages[0].blocks.filter(b=>b.type==='table').length,3);restore();
});

// Break: printing uses the screen's 25 row slice or restore resets filters/page/scroll.
test('preparePrint expands ALL filtered pages and restores pagination filters and both scroll axes',async t=>{
  const all={...snapshot(),rows:Array.from({length:61},(_,i)=>row(i+1,{branch:i===60?'SP':'BH',globalEstimatedValue:1}))};
  const {view,root}=setup(t,{loadOverview:async()=>all});await view.open();change(root,'branch','BH');
  root.querySelector('.ccr-next').click();const before=ids(root);assert.equal(before.length,25);
  const content=root.querySelector('.ccr-content');content.scrollTop=88;content.scrollLeft=9;
  const scroll=root.querySelector('.ccr-table-scroll');scroll.scrollLeft=123;
  const restore=await view.preparePrint();assert.equal(rows(root).length,60);assert.equal(root.querySelector('.ccr-pager').hidden,true);
  const tables=captureFilteredReport(root).pages[0].blocks.filter(b=>b.type==='table');assert.equal(tables[0].rows.length,61);
  restore();restore();assert.deepEqual(ids(root),before);assert.equal(root.querySelector('[name=branch]').value,'BH');
  assert.equal(root.querySelector('.ccr-pager').hidden,false);assert.equal(content.scrollTop,88);assert.equal(content.scrollLeft,9);assert.equal(scroll.scrollLeft,123);
});

// Break: preparePrint resolves before selected details finish, or loading overview can be captured.
test('preparePrint waits for current details and refuses overview loading',async t=>{
  const pending=deferred();const {view,root}=setup(t,{loadDetails:()=>pending.promise});await view.open();change(root,'id','1');await tick();
  let resolved=false;const printing=view.preparePrint().then(restore=>{resolved=true;return restore;});await tick();assert.equal(resolved,false);
  pending.resolve(details('1'));const restore=await printing;assert.equal(root.querySelectorAll('table').length,3);restore();
  const loading=deferred();const other=setup(t,{loadOverview:()=>loading.promise});const opening=other.view.open();await tick();
  await assert.rejects(other.view.preparePrint());other.view.close();await opening;
});

// Break: obsolete restore undoes a newer filter or preparePrint prints a detail selected before filter change.
test('print cancellation cannot restore obsolete pages filters or contract details',async t=>{
  const pending=deferred();const {view,root}=setup(t,{loadDetails:()=>pending.promise});await view.open();change(root,'id','1');await tick();
  const printing=view.preparePrint();change(root,'supplier','Beto');await assert.rejects(printing);pending.resolve(details('1'));await tick();
  assert.deepEqual(ids(root),[]);assert.equal(root.querySelector('.ccr-detail').hidden,true);
  change(root,'id','');const restore=await view.preparePrint();change(root,'branch','SP');restore();
  assert.equal(root.querySelector('[name=branch]').value,'SP');assert.deepEqual(ids(root),[]);
});

// Break: refresh resets filters/page or retains old linked detail and misses document status updates.
test('refresh preserves filters page and scroll but refreshes overview and selected details',async t=>{
  let loads=0,detailLoads=0;const all={...snapshot(),rows:Array.from({length:60},(_,i)=>row(i+1))};
  const {view,root}=setup(t,{loadOverview:async()=>{loads++;return {...all,documentStatuses:{900:loads===1?'PENDENTE':'SUBMETIDO'}};},loadDetails:async id=>{detailLoads++;return details(id);}});
  await view.open();change(root,'branch','BH');root.querySelector('.ccr-next').click();const before=ids(root),content=root.querySelector('.ccr-content');content.scrollTop=65;
  root.querySelector('[aria-label^="Atualizar"]').click();await tick();assert.deepEqual(ids(root),before);
  assert.equal(root.querySelector('[name=branch]').value,'BH');assert.equal(content.scrollTop,65);assert.equal(cell(root,before[0],'contractDocumentId').dataset.tone,'success');
  change(root,'id','1');await tick();root.querySelector('[aria-label^="Atualizar"]').click();await tick();
  assert.equal(detailLoads,2);assert.equal(root.querySelector('[name=id]').value,'1');assert.equal(root.querySelectorAll('table').length,3);
});

// Break: stale overview replaces a newer generation, promises never settle on abort, or close paints late rows.
test('refresh change close destroy cancel overview and late replies never repaint',async t=>{
  const requests=[];const {view,root}=setup(t,{loadOverview:({signal})=>{const value=deferred();requests.push({...value,signal});return value.promise;}});
  const opening=view.open();await tick();root.querySelector('[aria-label^="Atualizar"]').click();await tick();
  assert.equal(requests[0].signal.aborted,true);await opening;requests[1].resolve(snapshot());await tick();const before=ids(root);
  requests[0].resolve({...snapshot(),rows:[]});await tick();assert.deepEqual(ids(root),before);
  root.querySelector('[aria-label^="Atualizar"]').click();await tick();change(root,'branch','BH');await tick();
  assert.equal(requests[2].signal.aborted,true);assert.equal(requests.length,4);view.close();assert.equal(requests[3].signal.aborted,true);
  requests[3].resolve(snapshot());await tick();assert.deepEqual(ids(root),[]);
  const reopening=view.open();await tick();assert.equal(root.querySelector('[name=branch]').value,'');view.destroy();await reopening;
  assert.equal(requests[4].signal.aborted,true);requests[4].resolve(snapshot());await tick();assert.equal(root.isConnected,false);assert.deepEqual(ids(root),[]);
  await assert.rejects(view.open(),/encerrado/);
});

// Break: old ID's details win a race or a finished promise paints into a closed session.
test('detail selection refresh close and destroy abort old IDs including non-cooperating providers',async t=>{
  const requests=[];const {view,root}=setup(t,{loadDetails:(id,{signal})=>{const value=deferred();requests.push({...value,id,signal});return value.promise;}});
  await view.open();change(root,'id','1');await tick();change(root,'id','2');await tick();assert.equal(requests[0].signal.aborted,true);
  requests[1].resolve(details('2'));await tick();requests[0].resolve(details('1'));await tick();assert.match(root.querySelector('.ccr-detail').textContent,/CONTRATO ID 2/);
  assert.doesNotMatch(root.querySelector('.ccr-detail').textContent,/CONTRATO ID 1/);
  root.querySelector('[aria-label^="Atualizar"]').click();await tick();view.close();assert.equal(requests[2].signal.aborted,true);
  requests[2].resolve(details('2'));await tick();assert.equal(root.querySelector('.ccr-detail').hidden,true);
  await view.open();change(root,'id','1');await tick();view.destroy();assert.equal(requests[3].signal.aborted,true);
});

// Break: untrusted SharePoint text runs as HTML in any table, option, caption, or warning.
test('external text is literal in overview details options and warnings',async t=>{
  const unsafe='<img src=x onerror=alert(1)>',value=snapshot();Object.assign(value.rows[0],{supplier:unsafe,branch:unsafe,activity:unsafe,contractDocumentId:unsafe});value.warnings=['<script>secret()</script>'];
  const {view,root}=setup(t,{loadOverview:async()=>value,loadDetails:async id=>{const value=details(id);value.launches[0].supplier=unsafe;return value;}});
  await view.open();change(root,'id','1');await tick();assert.match(root.textContent,/<img src=x onerror=alert\(1\)>/);assert.match(root.textContent,/<script>secret\(\)<\/script>/);
  assert.equal(root.querySelectorAll('img').length,1);assert.equal(root.querySelectorAll('script,[onerror]').length,0);
  assert.equal(root.querySelector('.ccr-launches [data-column=supplier]').textContent,unsafe);
});

// Break: portrait starts queries or rotation leaves a cancelled detail permanently loading.
test('portrait shows landscape notice with no query and rotation resumes current filters safely',async t=>{
  let loads=0;const requests=[];const {view,root,dom}=setup(t,{loadOverview:async()=>{loads++;return snapshot();},loadDetails:(id,{signal})=>{const value=deferred();requests.push({...value,id,signal});return value.promise;}});
  dom.window.matchMedia=()=>({matches:true});await view.open();assert.equal(loads,0);assert.equal(root.querySelector('.pl-orientation').hidden,false);
  assert.equal(root.querySelector('.ccr-close').closest('[hidden]'),null);await assert.rejects(view.preparePrint());
  dom.window.matchMedia=()=>({matches:false});dom.window.dispatchEvent(new dom.window.Event('resize'));await tick();assert.equal(loads,1);
  change(root,'id','1');await tick();dom.window.matchMedia=()=>({matches:true});dom.window.dispatchEvent(new dom.window.Event('orientationchange'));
  assert.equal(requests[0].signal.aborted,true);requests[0].resolve(details('1'));await tick();
  dom.window.matchMedia=()=>({matches:false});dom.window.dispatchEvent(new dom.window.Event('resize'));await tick();assert.equal(requests.length,2);
  requests[1].resolve(details('1'));await tick();assert.equal(root.querySelector('[name=id]').value,'1');assert.equal(root.querySelectorAll('table').length,3);assert.equal(loads,1);
});

// Break: modal lets focus escape, traps a PDF dialog, or leaves HOME inert after any dismissal path.
test('modal contains focus allows PDF dialogs and Escape outside back restore HOME focus and inert state',async t=>{
  for(const dismissal of ['escape','outside','back','close']) {
    let closes=0,homes=0;const {view,root,doc,dom}=setup(t,{onClose:()=>closes++,onHome:()=>homes++});const trigger=doc.getElementById('trigger');trigger.focus();doc.body.style.overflow='auto';
    await view.open();assert.equal(doc.getElementById('app').inert,true);assert.equal(doc.body.style.overflow,'hidden');
    doc.getElementById('outside').focus();assert.equal(doc.activeElement,root.querySelector('[role=dialog]'));
    const pdf=doc.createElement('section');pdf.setAttribute('role','dialog');pdf.setAttribute('aria-modal','true');const pdfButton=doc.createElement('button');pdf.append(pdfButton);doc.body.append(pdf);
    pdfButton.focus();assert.equal(doc.activeElement,pdfButton);pdf.remove();
    const nativePdf=doc.createElement('dialog');nativePdf.setAttribute('open','');nativePdf.append(pdfButton);doc.body.append(nativePdf);pdfButton.focus();assert.equal(doc.activeElement,pdfButton);nativePdf.remove();
    const panel=root.querySelector('[role=dialog]');panel.focus();panel.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));assert.notEqual(doc.activeElement,panel);
    if(dismissal==='escape')root.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    else if(dismissal==='outside')root.click();else root.querySelector(`.ccr-${dismissal}`).click();
    assert.equal(root.hidden,true);assert.equal(doc.activeElement,trigger);assert.equal(doc.getElementById('app').inert,false);assert.equal(doc.body.style.overflow,'auto');
    assert.equal(closes,1);assert.equal(homes,dismissal==='back'?1:0);
  }
});

// Break: shared printer cannot find refresh host or captures only current page.
test('shared print decorator pairs printer with refresh and captures all pages with current filters',async t=>{
  const all={...snapshot(),rows:Array.from({length:31},(_,i)=>row(i+1))};const {view,root}=setup(t,{loadOverview:async()=>all});await view.open();
  let captured,filename;const decorated=decorateReportPrint(view,{action:'open-contractor-control-report',loadLogo:async()=>new Uint8Array(),buildPdf:async value=>{captured=value;return new Blob(['%PDF-test']);},previewMedia:async(value,name)=>{filename=name;await value;}});t.after(()=>decorated.destroy());
  const print=root.querySelector('.report-print-button');assert.ok(print.parentElement.querySelector('[aria-label^="Atualizar"]'));
  print.click();await tick();await tick();assert.equal(captured.pages[0].blocks.filter(b=>b.type==='table')[0].rows.length,32);
  assert.equal(rows(root).length,25);assert.ok(captured.filters.some(f=>f.label==='STATUS'&&f.value==='ATIVO'));
  assert.equal(captured.title,'Controle de empreiteiros');assert.equal(filename,'Controle-de-empreiteiros.pdf');
});

// Break: failed refresh forgets the user's page, even though the filters survived for retry.
test('refresh failure and retry retain the requested page and scroll',async t=>{
  let loads=0;const all={...snapshot(),rows:Array.from({length:61},(_,i)=>row(i+1))};
  const {view,root}=setup(t,{loadOverview:async()=>{if(++loads===2)throw Error('offline');return all;}});
  await view.open();change(root,'branch','BH');root.querySelector('.ccr-next').click();const before=ids(root),content=root.querySelector('.ccr-content');content.scrollTop=77;
  root.querySelector('[aria-label^="Atualizar"]').click();await tick();assert.deepEqual(ids(root),[]);
  root.querySelector('.ccr-retry').click();await tick();assert.deepEqual(ids(root),before);assert.equal(content.scrollTop,77);
});

// Break: generic status palette treats ATIVO in a launch or PAGO in a measurement as approved source status.
test('launch and measurement status colors keep each source vocabulary',async t=>{
  const {view,root}=setup(t,{loadDetails:async id=>({launches:[{id:'5',date:'2026-10-02',supplier:'Ana',contract:id,total:0,paymentStatus:'ATIVO',paymentTone:'neutral'}],
    measurements:[{id:'6',supplier:'Ana',contract:id,status:'PAGO',statusTone:'neutral'}]})});
  await view.open();change(root,'id','1');await tick();assert.equal(root.querySelector('.ccr-launches [data-column=paymentStatus]').dataset.tone,'neutral');
  assert.equal(root.querySelector('.ccr-measurements [data-column=status]').dataset.tone,'neutral');
});
