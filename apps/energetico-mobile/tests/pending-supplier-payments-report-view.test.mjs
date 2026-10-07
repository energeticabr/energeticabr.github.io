import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {captureFilteredReport,decorateReportPrint} from '../src/ui/report-print.js';
import {decorateReportNavigation} from '../src/ui/report-navigation.js';

const {createPendingSupplierPaymentsReportView} = await import('../src/ui/pending-supplier-payments-report-view.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const tick = () => new Promise(resolve => setImmediate(resolve));
const supplier = (id, name, branch, status = 'ATIVO', dailyValue = 100) => ({id, name, branch, status, contractor:true, hours:8, dailyValue});
const presence = (id, date, name, branch, state, status, dailyValue, extra = {}) => ({
  id, date, supplier:name, branch, presence:state, status, dailyValue,
  property:'Obra 1', activity:'Alvenaria', motivation:'', observation:'', paymentId:'',
  entry1:'08:00', exit1:'12:00', entry2:'13:00', exit2:'17:00', ...extra,
});
const snapshot = {
  complete:true,
  suppliers:[supplier('1','Ana','BH'), supplier('2','Bruno','SP','ATIVO',200), supplier('3','Zeca','BH','INATIVO',75)],
  presences:[
    presence('1','2026-09-01','Ana','BH','PRESENTE','PENDENTE PGTO',100),
    presence('2','2026-10-02','Ana','BH','PENDENTE','PENDENTE PGTO',50),
    presence('3','2026-10-03','Ana','BH','PENDENTE','PAGO',30),
    presence('4','2026-10-04','Ana','BH','PRESENTE','PAGO',100,{paymentId:'91',motivation:'Ajuste',observation:'Conferido'}),
    presence('5','2026-10-05','Ana','BH','AUSENTE','PAGO',null),
    presence('6','2026-10-06','Ana','BH','PRESENTE','PENDENTE PGTO',0),
    presence('7','2026-10-07','Ana','BH','PRESENTE','PENDENTE PGTO',100,{entry1:'12:00',exit1:'08:00'}),
    presence('8','2026-10-03','Bruno','SP','PRESENTE','PENDENTE PGTO',200),
    presence('9','2026-10-03','Zeca','BH','PRESENTE','PENDENTE PGTO',75),
  ],
  launches:[
    {id:'80',supplier:'Ana',branch:'BH',date:'2026-10-04',unitValue:50,quantity:2,total:100,advance:'SIM'},
    {id:'91',supplier:'Pagador diferente',branch:'BH',date:'2026-09-20',unitValue:150,quantity:2,total:300,advance:'NÃO'},
  ],
};
function setup(t, {loadSnapshot = async () => snapshot, onClose = () => {}} = {}) {
  assert.equal(typeof createPendingSupplierPaymentsReportView, 'function', 'standalone pending supplier report view must exist');
  const dom = new JSDOM('<main id="app"><button id="trigger">Abrir</button></main>');
  dom.window.matchMedia = () => ({matches:false});
  const view = createPendingSupplierPaymentsReportView({document:dom.window.document, data:{loadSnapshot},
    onClose, now:() => new Date(2026,9,7,12)});
  t.after(() => {view.destroy(); dom.window.close();});
  return {view, root:view.element, dom, doc:dom.window.document};
}
function change(root, name, value) {
  const input = root.querySelector(`[name="${name}"]`);
  input.value = value;
  input.dispatchEvent(new root.ownerDocument.defaultView.Event('change', {bubbles:true}));
}

// Break caught: a wrong default/filter binding includes inactive suppliers or loses historical debt.
test('local current month and ATIVO defaults keep historical pending debt with two complete tables', async t => {
  const {view,root} = setup(t); await view.open();
  assert.equal(root.querySelector('[name=startDate]').value,'2026-10-01');
  assert.equal(root.querySelector('[name=endDate]').value,'2026-10-07');
  assert.equal(root.querySelector('[name=supplierStatus]').value,'ATIVO');
  assert.equal(root.querySelectorAll('.psp-pending tbody tr').length,2);
  assert.equal(root.querySelectorAll('.psp-pending thead tr:last-child th').length,5);
  assert.equal(root.querySelectorAll('.psp-details thead tr:last-child th').length,4);
  assert.match(root.querySelector('.psp-pending').textContent,/01\/09\/2026/);
  assert.doesNotMatch(root.querySelector('.psp-details').textContent,/01\/09\/2026|Zeca/);
  assert.match(root.querySelector('.psp-pending tfoot').textContent,/TOTAL GERAL PENDENTE \(APROVADO\).*400,00/s);
  assert.match(root.querySelector('.psp-filter-note').textContent,/detalhamento/i);
  assert.equal(root.querySelector('img').src.endsWith('/assets/logo-energetica-oficial.png'),true);
});

// Break caught: using general validationValue in the pending table overstates unpaid validation.
test('pending badges use unpaid validation while general badges include paid pending validation', async t => {
  const {view,root} = setup(t); await view.open();
  const pending = root.querySelector('.psp-pending tbody tr');
  assert.match(pending.querySelector('.psp-approved').textContent,/200,00/);
  assert.match(pending.querySelector('.psp-validation').textContent,/50,00/);
  assert.match(pending.querySelector('.psp-total').textContent,/250,00/);
  const detail = root.querySelector('.psp-details tbody tr');
  assert.match(detail.querySelector('.psp-validation').textContent,/80,00/);
  assert.match(detail.querySelector('.psp-total').textContent,/280,00/);
});

// Break caught: applying period/presence filters to the backlog or omitting linked outside-period payments.
test('period and presence filter only detail with payment ids motivations own advances and other payers', async t => {
  const {view,root} = setup(t); await view.open();
  change(root,'startDate','2026-10-04'); change(root,'endDate','2026-10-05'); change(root,'presence','PRESENTE');
  const pending = root.querySelector('.psp-pending');
  assert.match(pending.textContent,/01\/09\/2026/);
  assert.match(pending.querySelector('tfoot').textContent,/400,00/);
  const detail = root.querySelector('.psp-details');
  assert.equal(detail.querySelectorAll('tbody tr').length,1);
  assert.match(detail.textContent,/04\/10\/2026.*IDPGTO: 91.*MOTIVAÇÃO: Ajuste.*OBS: Conferido/s);
  assert.match(detail.textContent,/IDPGTO: 80.*100,00.*ADIANTAMENTO/s);
  assert.match(detail.textContent,/PAGAMENTO DA DIÁRIA FEITO EM OUTRO NOME.*IDPGTO: 91.*20\/09\/2026.*300,00.*PAGO EM NOME DE: Pagador diferente/s);
});

// Break caught: a native-only or missing filter cannot be searched/selected without editing code.
test('all four categorical filters use the existing searchable picker and filter supplier identities', async t => {
  const {view,root,dom} = setup(t); await view.open();
  for (const name of ['branch','supplierStatus','supplier','presence']) {
    const select = root.querySelector(`[name=${name}]`);
    assert.equal(select.hidden,true);
    assert.ok(select.parentElement.querySelector('.sfs--report'));
  }
  root.querySelector('[aria-label="Abrir opções de FILIAL"]').click();
  const popup = root.querySelector('.sfs-popup:not([hidden])');
  assert.equal(popup.dataset.placement,'expanded');
  assert.notEqual(dom.window.document.activeElement,popup.querySelector('input[type=search]'));
  const search = popup.querySelector('input[type=search]'); search.value='sp'; search.dispatchEvent(new dom.window.Event('input'));
  const option = [...popup.querySelectorAll('[role=option]')].find(node=>node.textContent==='SP'); option.click();
  assert.equal(root.querySelectorAll('.psp-pending tbody tr').length,1);
  assert.match(root.querySelector('.psp-pending tbody').textContent,/Bruno/);
  change(root,'branch',''); change(root,'supplierStatus','INATIVO');
  assert.match(root.querySelector('.psp-pending tbody').textContent,/Zeca/);
  change(root,'supplierStatus',''); change(root,'supplier','Ana');
  assert.equal(root.querySelectorAll('.psp-pending tbody tr').length,1);
  assert.match(root.querySelector('.psp-pending tbody').textContent,/Ana/);
});

// Break caught: null sums displayed as zero or an unknown shift rendered as known hours.
test('incomplete money and invalid hours stay explicit while zero entries say CONFORME MEDIÇÃO', async t => {
  const incomplete = structuredClone(snapshot); incomplete.presences[0].dailyValue = null;
  const {view,root} = setup(t,{loadSnapshot:async()=>incomplete}); await view.open();
  const ana = [...root.querySelectorAll('.psp-pending tbody tr')].find(row=>row.querySelector('.psp-supplier')?.textContent==='Ana');
  assert.match(ana.querySelector('.psp-approved').textContent,/VALOR INCOMPLETO/);
  assert.match(root.querySelector('.psp-pending tfoot').textContent,/VALOR INCOMPLETO/);
  assert.match(root.querySelector('.psp-pending').textContent,/CONFORME MEDIÇÃO/);
  assert.match(root.querySelector('.psp-pending').textContent,/HORAS (?:INCOMPLETAS|DESCONHECIDAS)/);
  assert.match(root.querySelector('.psp-pending').textContent,/CONFERIR JORNADA\/VALOR/);
});

// Break caught: external supplier/activity/observation strings injected as executable HTML.
test('external labels render as literal text and only the official logo creates an image', async t => {
  const unsafe = structuredClone(snapshot), name = '<img src=x onerror=alert(1)>';
  unsafe.suppliers[0].name = name;
  for (const row of unsafe.presences.filter(row=>row.supplier==='Ana')) {row.supplier=name; row.observation='<script>secret()</script>';}
  unsafe.launches[0].supplier=name;
  const {view,root} = setup(t,{loadSnapshot:async()=>unsafe}); await view.open();
  assert.match(root.querySelector('.psp-pending').textContent,/<img src=x onerror=alert\(1\)>/);
  assert.match(root.querySelector('.psp-details').textContent,/<script>secret\(\)<\/script>/);
  assert.equal(root.querySelectorAll('img').length,1); assert.equal(root.querySelectorAll('script').length,0);
});

// Break caught: shared PDF exports obsolete tables after invalid dates or a load failure.
test('invalid period fails closed and recovers without reloading while shared PDF captures both tables', async t => {
  let calls=0; const {view,root} = setup(t,{loadSnapshot:async()=>{calls++;return snapshot;}}); await view.open();
  change(root,'startDate','2026-10-08');
  assert.equal(root.querySelectorAll('table').length,0);
  assert.match(root.querySelector('[role=alert]').textContent,/data|período/i);
  assert.throws(()=>captureFilteredReport(root));
  change(root,'startDate','2026-10-01');
  assert.equal(calls,1);
  const captured = captureFilteredReport(root), tables=captured.pages[0].blocks.filter(block=>block.type==='table');
  assert.equal(tables.length,2);
  assert.match(JSON.stringify(captured),/400,00/);
  assert.equal(captured.filters.find(filter=>filter.label==='STATUS DO FORNECEDOR').value,'ATIVO');
});

test('refresh error clears financial tables and exposes a safe retry alert that blocks PDF', async t => {
  let calls=0; const {view,root} = setup(t,{loadSnapshot:async()=>{if(calls++)throw Error('Bearer private-token https://private/path'); return snapshot;}});
  await view.open(); root.querySelector('.pl-refresh').click(); await tick();
  assert.equal(root.querySelectorAll('table').length,0);
  assert.match(root.querySelector('[role=alert]').textContent,/Não foi possível/);
  assert.doesNotMatch(root.textContent,/private-token|private\/path/);
  assert.equal(root.getAttribute('aria-busy'),'false');
  assert.throws(()=>captureFilteredReport(root));
});

// Break caught: closing a hung request leaves open pending forever or resurrects late financial data.
test('Escape aborts a pending open restores inert overflow and focus and rejects late results', async t => {
  let resolve,signal,closes=0; const {view,root,doc,dom} = setup(t,{onClose:()=>closes++,loadSnapshot:options=>{signal=options.signal;return new Promise(done=>resolve=done);}});
  doc.body.style.overflow='auto'; const trigger=doc.querySelector('#trigger'); trigger.focus();
  const opening=view.open(); await tick(); assert.equal(doc.querySelector('#app').inert,true);
  assert.equal(root.getAttribute('aria-busy'),'true'); assert.throws(()=>captureFilteredReport(root));
  root.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  await opening; assert.equal(signal.aborted,true); assert.equal(closes,1);
  assert.equal(doc.querySelector('#app').inert,false); assert.equal(doc.body.style.overflow,'auto'); assert.equal(doc.activeElement,trigger);
  resolve(snapshot); await tick(); assert.equal(root.hidden,true); assert.equal(root.querySelectorAll('table').length,0);
});

test('portrait opening is lazy and rotation cancels pending requests before a fresh landscape load', async t => {
  const requests=[]; const {view,root,dom} = setup(t,{loadSnapshot:options=>new Promise(resolve=>requests.push({resolve,signal:options.signal}))});
  dom.window.matchMedia=()=>({matches:true}); await view.open(); assert.equal(requests.length,0);
  assert.equal(root.querySelector('.pl-orientation').hidden,false);
  assert.equal(root.querySelector('.psp-close').closest('[hidden]'),null);
  dom.window.matchMedia=()=>({matches:false}); dom.window.dispatchEvent(new dom.window.Event('resize')); await tick();
  assert.equal(requests.length,1);
  dom.window.matchMedia=()=>({matches:true}); dom.window.dispatchEvent(new dom.window.Event('orientationchange')); assert.equal(requests[0].signal.aborted,true);
  requests[0].resolve(snapshot); await tick(); assert.equal(root.querySelectorAll('table').length,0);
  dom.window.matchMedia=()=>({matches:false}); dom.window.dispatchEvent(new dom.window.Event('resize')); await tick();
  requests[1].resolve(snapshot); await tick(); assert.equal(root.querySelectorAll('table').length,2);
});

test('loaded report retains filters and table identity across rotation and closing resets next session', async t => {
  let calls=0; const {view,root,dom} = setup(t,{loadSnapshot:async()=>{calls++;return snapshot;}}); await view.open();
  change(root,'supplier','Ana'); const table=root.querySelector('table'); const content=root.querySelector('.psp-content'); content.scrollTop=88;
  dom.window.matchMedia=()=>({matches:true}); dom.window.dispatchEvent(new dom.window.Event('resize')); assert.throws(()=>captureFilteredReport(root));
  dom.window.matchMedia=()=>({matches:false}); dom.window.dispatchEvent(new dom.window.Event('resize')); await tick();
  assert.equal(root.querySelector('table'),table); assert.equal(content.scrollTop,88); assert.equal(root.querySelector('[name=supplier]').value,'Ana'); assert.equal(calls,1);
  view.close(); await view.open(); assert.equal(root.querySelector('[name=supplier]').value,''); assert.equal(calls,2);
});

test('dialog traps keyboard focus and destroy releases owned UI and cannot reopen', async t => {
  const {view,root,doc,dom} = setup(t); await view.open();
  const panel=root.querySelector('[role=dialog]'); panel.focus(); root.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
  assert.equal(doc.activeElement,root.querySelector('.pl-refresh'));
  panel.focus(); root.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
  assert.equal(doc.activeElement,root.querySelector('.psp-close'));
  view.destroy(); assert.equal(root.isConnected,false); assert.equal(doc.querySelector('#app').inert,false); await assert.rejects(view.open(),/encerrado/);
});

// Break caught: editing a date before blur exports the previous valid report.
test('date input immediately invalidates stale financial tables before the change event', async t => {
  const {view,root,dom} = setup(t); await view.open();
  const start=root.querySelector('[name=startDate]'); start.value='2026-10-08';
  start.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(root.querySelectorAll('table').length,0);
  assert.throws(()=>captureFilteredReport(root));
});

// Break caught: malformed money is described as measurement instead of incomplete data.
test('malformed daily money stays incomplete and zero daily tags say measurement in both blocks', async t => {
  const invalid=structuredClone(snapshot); invalid.presences[6].dailyValue=null; invalid.presences[6].dailyValueBlank=false;
  const {view,root} = setup(t,{loadSnapshot:async()=>invalid}); await view.open();
  const entry=[...root.querySelectorAll('.psp-pending .psp-entry')].find(node=>node.querySelector('.psp-date').textContent.includes('07/10/2026'));
  assert.equal(entry.querySelector('.psp-daily').textContent,'VALOR INCOMPLETO');
  const zero=[...root.querySelectorAll('.psp-details .psp-entry')].find(node=>node.querySelector('.psp-date').textContent.includes('06/10/2026'));
  assert.match(zero.textContent,/CONFORME MEDIÇÃO/);
});

// Break caught: known worked hours hide the model warning about invalid expected hours.
test('model warnings about expected hours and missing referenced payments remain visible literal text', async t => {
  const warned=structuredClone(snapshot); warned.suppliers[0].hoursInvalid=true; warned.presences[3].paymentId='999';
  const {view,root} = setup(t,{loadSnapshot:async()=>warned}); await view.open();
  assert.match(root.textContent,/Horas incompletas ou horário inválido/);
  assert.match(root.textContent,/Pagamento 999.*não encontrado/);
});

test('reopening abandons previous requests without letting their completion replace fresh report data', async t => {
  const requests=[]; const {view,root} = setup(t,{loadSnapshot:options=>new Promise(resolve=>requests.push({resolve,signal:options.signal}))});
  const first=view.open(); await tick(); view.close(); await first;
  const second=view.open(); await tick(); requests[1].resolve(snapshot); await second;
  const table=root.querySelector('table'); requests[0].resolve({complete:true,suppliers:[],presences:[],launches:[]}); await tick();
  assert.equal(requests[0].signal.aborted,true); assert.equal(root.querySelector('table'),table); assert.match(table.textContent,/Ana/);
});

test('incomplete snapshots and ambiguous supplier identities never expose partial totals', async t => {
  const ambiguous=structuredClone(snapshot); ambiguous.suppliers.push({...ambiguous.suppliers[0],id:'99',branch:'Outra filial'});
  for (const value of [{...snapshot,complete:false},ambiguous]) {
    const {view,root}=setup(t,{loadSnapshot:async()=>value}); await view.open();
    assert.equal(root.querySelectorAll('table').length,0); assert.match(root.querySelector('[role=alert]').textContent,/Não foi possível/);
    assert.throws(()=>captureFilteredReport(root));
  }
});

// Break caught: shared decoration misses this view's filters/tables or still prints an invalid period.
test('real navigation and PDF decorators capture both tables and block export after date input', async t => {
  const {view,root,dom}=setup(t); let captured,previewOptions,previews=0,navigation;
  const decorated=decorateReportPrint(decorateReportNavigation(view,{action:'open-pending-supplier-payments-report',onNavigate:action=>{navigation=action;}}),{
    action:'open-pending-supplier-payments-report',loadLogo:async()=>new Uint8Array(),
    buildPdf:async value=>{captured=value;return new Uint8Array();},
    previewMedia:async(pending,_name,options)=>{await pending;previews++;previewOptions=options;},
  });
  t.after(()=>decorated.destroy()); await decorated.open();
  assert.equal(root.querySelectorAll('.report-navigation-arrow').length,2);
  root.querySelector('.report-navigation-arrow--previous').click(); await tick();
  assert.equal(navigation,'open-supplier-payroll-report');
  root.querySelector('.report-navigation-arrow--next').click(); await tick();
  assert.equal(navigation,'open-pending-work-diaries-report');
  const print=root.querySelector('.report-print-button');
  assert.equal(print.parentElement.querySelector('.pl-refresh')!==null,true);
  print.click(); await tick(); await tick();
  assert.equal(previews,1); assert.equal(typeof previewOptions.onClose,'function');
  assert.deepEqual(captured.pages[0].blocks.filter(block=>block.type==='table').map(block=>block.widths.length),[5,4]);
  assert.match(JSON.stringify(captured),/IDPGTO: 91|Pagador diferente/);
  const start=root.querySelector('[name=startDate]'); start.value='2026-10-08'; start.dispatchEvent(new dom.window.Event('input',{bubbles:true})); await tick();
  assert.equal(print.disabled,true); print.click(); await tick(); assert.equal(previews,1);
});

test('case insensitive presence values retain absence labels instead of monetary or measurement tags', async t => {
  const mixed=structuredClone(snapshot); mixed.presences[4].presence=' ausente ';
  const {view,root}=setup(t,{loadSnapshot:async()=>mixed}); await view.open();
  const entry=[...root.querySelectorAll('.psp-pending .psp-entry')].find(node=>node.querySelector('.psp-date').textContent.includes('05/10/2026'));
  assert.equal(entry.dataset.presence,'AUSENTE'); assert.equal(entry.querySelector('.psp-daily').textContent,'AUSENTE');
});

test('unmatched unpaid identities stay visible and never appear as a confirmed empty zero report', async t => {
  const missing={complete:true,suppliers:[],presences:[presence('1','2026-10-03','Cadastro removido','BH','PRESENTE','PENDENTE PGTO',100)],launches:[]};
  const {view,root}=setup(t,{loadSnapshot:async()=>missing}); await view.open();
  assert.match(root.querySelector('.psp-warnings').textContent,/Cadastro removido.*sem cadastro/s);
  assert.match(root.querySelector('.psp-footer-total').textContent,/VALOR INCOMPLETO/);
  assert.match(root.querySelector('.psp-pending .psp-empty').textContent,/registros sem cadastro/i);
  assert.doesNotMatch(root.querySelector('.psp-pending .psp-empty').textContent,/Nenhum pagamento pendente/i);
});
