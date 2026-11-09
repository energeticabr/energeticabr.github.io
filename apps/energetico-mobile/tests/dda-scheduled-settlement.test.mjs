import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createSharePointRepository} from '../../../portal/data/sharepoint-repository.js';
import {createChatClient} from '../src/chat/chat-client.js';
import {createDdaProvisionLink} from '../src/chat/dda-provision-link.js';
import {buildDdaReport,normalizeDdaReportRows} from '../src/chat/dda-report-model.js';
import {REGISTRATION_GALLERY_MODELS} from '../src/chat/registration-gallery-data.js';
import {createDdaReportView} from '../src/ui/dda-report-view.js';
import {captureFilteredReport} from '../src/ui/report-print.js';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';
import {createIsolatedViteServer} from './helpers/isolated-vite-server.mjs';

const now=()=>new Date('2026-11-08T12:00:00Z');
const paidAt='2026-11-07T15:00:00Z';
const key='a'.repeat(64);
const row=(id,fields={})=>({id:String(id),fields:{Title:`Fornecedor ${id}`,CHAVE_DDA:key,SITUACAO:'Em aberto',VALOR:10,VENCIMENTO:'2026-11-08',BANCO:'Banco A',...fields}});
const scheduled={STATUS_DDA:'Agendado',STATUS_CONSULTADO_EM:'2026-11-07T12:00:00Z',ULTIMA_CONSULTA:'2026-11-07T12:00:00Z'};
const audited={PGTO_CONFIRMADO:true,PGTO_CONFIRMADO_EM:paidAt,PGTO_CONFIRMADO_POR:'test@example.test'};
const paid={DDA_CICLO_AGENDAMENTO:'PAGO_AGENDADO',DESCRITIVOPROVIS_x00c3_O:'21',VENCIMENTO:'2026-11-07',VALOR:50};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function setup(t,data,options={}){
 const dom=new JSDOM('<body><main id="app"><button id="home">DDA</button></main></body>');
 const doc=dom.window.document,view=createDdaReportView({document:doc,data,now,...options});
 doc.querySelector('#home').focus();
 t.after(()=>{view.destroy();dom.window.close();});
 const filter=(name,value)=>{const control=doc.querySelector(`[name="${name}"]`);control.value=value;control.dispatchEvent(new dom.window.Event(name==='search'?'input':'change'));};
 const ids=()=>[...doc.querySelectorAll('tbody [data-dda-id]')].map(line=>line.dataset.ddaId);
 return {doc,view,filter,ids};
}

test('only proven schedule provenance qualifies a paid DDA for the scheduled payment label',()=>{
 const normalized=normalizeDdaReportRows({rows:[
  row(1,paid),row(2,{...scheduled,...audited}),row(3,{...audited,SITUACAO:'Agendado'}),
  row(4,{...scheduled,...audited,ULTIMA_CONSULTA:'2026-11-08T12:00:00Z'}),
  row(5,{...scheduled,PGTO_CONFIRMADO:true}),row(6,{...scheduled,...audited,STATUS_DDA:'Em aberto',DDA_CICLO_AGENDAMENTO:'AGENDADO'}),
  row(7,{...scheduled,...audited,STATUS_CONSULTADO_EM:'2026-11-08T12:00:00Z'}),
  row(8,{...audited,DDA_CICLO_AGENDAMENTO:'AGENDADO'}),
 ]});
 assert.deepEqual(normalized.map(item=>item.status),Array(8).fill('Pago'));
 assert.deepEqual(normalized.filter(item=>item.paidBySchedule).map(item=>item.id),['1','2','6']);
 assert.ok(REGISTRATION_GALLERY_MODELS.dda.restReadFields.includes('DDA_CICLO_AGENDAMENTO'));
 assert.equal(buildDdaReport(normalized,{status:'Não pagos'},now()).rows.length,0);
});

test('scheduled payments bypass only situation and remain outside the selected status totals',async t=>{
 const {doc,view,filter,ids}=setup(t,{loadSnapshot:async()=>({rows:[row(1),row(2,paid),row(3,{SITUACAO:'Pago',BANCO:'Banco B'}),row(4,{...paid,BANCO:'Banco B'})]})});
 await view.open();
 assert.deepEqual(ids(),['2','4','1']);
 assert.match(doc.querySelector('[data-dda-id="2"] .ddr-status').textContent,/PAGO POR AGENDAMENTO.*Baixa pendente/s);
 const metrics=Object.fromEntries([...doc.querySelectorAll('.ddr-metric')].map(metric=>[metric.firstChild.textContent,metric.lastChild.textContent]));
 assert.equal(metrics['DDAs encontrados'],'3');
 assert.match(metrics['Valor nominal total'],/10,00/);
 assert.equal(metrics['Vencidos no filtro'],'0');
 assert.equal(metrics['Vencem hoje'],'1');
 filter('bank','Banco A');assert.deepEqual(ids(),['2','1']);
 filter('search','Fornecedor 2');assert.deepEqual(ids(),['2']);
 filter('status','Pago');assert.deepEqual(ids(),['2']);
 assert.match(doc.querySelector('[data-dda-summary]').textContent,/50,00/);
});

test('bank-paid and manually confirmed linked DDAs offer the exact provision until settlement',async t=>{
 let settled=false,liveLink='90',verify;
 const starts=[];
 const manuallyPaid=row(34,{...audited,STATUS_DDA:'Em aberto',DESCRITIVOPROVIS_x00c3_O:'56'});
 const {doc,view,filter,ids}=setup(t,{
  loadSnapshot:async()=>({rows:[
   row(1),row(10,{SITUACAO:'Pago',STATUS_DDA:'Pago',DESCRITIVOPROVIS_x00c3_O:'8'}),
   manuallyPaid,row(50,{SITUACAO:'Pago'}),row(51,{SITUACAO:'Baixado',DESCRITIVOPROVIS_x00c3_O:'70'}),
  ]}),
  async loadItem(id){assert.equal(id,'34');return {...manuallyPaid,fields:{...manuallyPaid.fields,DESCRITIVOPROVIS_x00c3_O:liveLink}};},
  provisionLink:{async loadSettledProvisionIds(ids){
   assert.deepEqual(ids,['8','56']);
   if(!settled)await new Promise(resolve=>{verify=resolve;});
   return new Set(settled?['56']:[]);
  }},
 },{onStartSettlement:async id=>{starts.push(id);return false;}});
 const opening=view.open({automatic:true});await tick();
 const button=()=>doc.querySelector('[data-dda-settle-provision="34"]');
 assert.deepEqual(ids(),['1','10','34']);
 assert.equal(button().disabled,true);
 verify();await opening;
 const action=button();
 assert.equal(action.textContent,'Dar baixa');
 assert.match(doc.querySelector('[data-dda-id="34"] .ddr-status-cluster').textContent,/Pago.*Baixa pendente/s);
 action.click();await tick();
 assert.deepEqual(starts,[]);
 assert.match(doc.querySelector('.ddr-notice').textContent,/vínculo mudou/);
 liveLink='56';
 action.click();action.click();await tick();
 assert.deepEqual(starts,['56']);
 assert.deepEqual(ids(),['1','10','34']);
 settled=true;
 doc.querySelector('[aria-label="Atualizar DDAs"]').click();await tick();
 assert.deepEqual(ids(),['1','10']);
 filter('status','Pago');
 assert.deepEqual(ids(),['10','34','50']);
 assert.equal(doc.querySelector('[data-dda-settle-provision="34"]'),null);
});

test('the pending row participates in pagination and filtered print, and disappears only after verified settlement',async t=>{
 let settled=false,lookups=0;
 const data={loadSnapshot:async()=>({rows:[...Array.from({length:51},(_,i)=>row(i+1)),row(52,{...paid,VENCIMENTO:'2026-11-10'})]}),
  provisionLink:{async loadSettledProvisionIds(ids){assert.deepEqual(ids,['21']);lookups++;if(lookups===1)throw new Error('private detail');return new Set(settled?['21']:[]);}}};
 const {doc,view,filter,ids}=setup(t,data);
 await view.open();assert.equal(lookups,1);assert.equal(ids().length,50);assert.doesNotMatch(doc.body.textContent,/private detail/);
 doc.querySelector('[data-page-next]').click();assert.deepEqual(ids(),['51','52']);
 const restore=await view.preparePrint(),snapshot=captureFilteredReport(view.element,{title:'Relatório DDA'});
 const table=snapshot.pages[0].blocks.find(block=>block.type==='table');
 assert.equal(table.rows.length,53);
 assert.match(table.rows.at(-1).cells[6].runs.map(run=>run.text).join(' '),/PAGO POR AGENDAMENTO.*Baixa pendente/s);
 restore();assert.deepEqual(ids(),['51','52']);
 settled=true;doc.querySelector('[aria-label="Atualizar DDAs"]').click();await tick();
 assert.equal(lookups,2);assert.deepEqual(ids(),['51']);
 filter('status','Pago');assert.deepEqual(ids(),['52']);assert.doesNotMatch(doc.querySelector('[data-dda-id="52"] .ddr-status').textContent,/Baixa pendente/);
 view.close();await view.open();assert.equal(lookups,3);assert.equal(ids().includes('52'),false);
});

test('confirmed scheduled DDA remains visible immediately and retains the manual audit label',async t=>{
 const data={loadSnapshot:async()=>({rows:[row(1,{...scheduled,DDA_CICLO_AGENDAMENTO:'AGENDADO'}),row(2)]})};
 const {doc,view,ids}=setup(t,data,{confirmPayment:async()=>({status:'confirmed',itemId:1,key,confirmedAt:paidAt,confirmedBy:'test@example.test'})});
 await view.open();
 doc.querySelector('[data-dda-confirm-payment="1"]').click();doc.querySelector('[data-dda-payment-yes]').click();await tick();
 assert.deepEqual(ids(),['1','2']);
 assert.match(doc.querySelector('[data-dda-id="1"] .ddr-status').textContent,/PAGO POR AGENDAMENTO.*Baixa pendente.*Confirmado pelo usuário/s);
 assert.ok(doc.querySelector('[data-dda-confirm-payment="1"]').disabled);
});

for(const paidBySchedule of [true,false])test(`manual confirmation uses authoritative schedule value ${paidBySchedule} over a stale report`,async t=>{
 const staleFields=paidBySchedule?{}:{...scheduled,DDA_CICLO_AGENDAMENTO:'AGENDADO'};
 const data={loadSnapshot:async()=>({rows:[row(1,staleFields),row(2)]})};
 const receipt={status:'confirmed',itemId:1,key,confirmedAt:paidAt,confirmedBy:'test@example.test',paidBySchedule};
 const client=createChatClient({apiBaseUrl:'https://example.test',tokenProvider:async()=>'test-only',
  fetchImpl:async()=>Response.json({status:'processed',messages:[],ddaPaymentConfirmation:receipt})});
 const {doc,view,ids}=setup(t,data,{confirmPayment:client.confirmDdaPayment});
 await view.open();
 doc.querySelector('[data-dda-confirm-payment="1"]').click();doc.querySelector('[data-dda-payment-yes]').click();await tick();
 assert.equal(doc.querySelector('[data-dda-payment-dialog]').dataset.state,'success');
 assert.deepEqual(ids(),paidBySchedule?['1','2']:['2']);
 if(paidBySchedule)assert.match(doc.querySelector('[data-dda-id="1"] .ddr-status').textContent,/PAGO POR AGENDAMENTO.*Baixa pendente/s);
});

test('relink aborts proof for the old parent and preserves report position and row focus',async t=>{
 const checks=[];
 const provisionLink={
  async loadOptions(){return [{id:'23',supplier:'Fornecedor 1',amount:50,label:'#23 · Fornecedor 1'}];},
  async save({ddaId,provisionId}){return {ddaId,provisionId};},
  loadSettledProvisionIds(ids,{signal}){return new Promise(resolve=>checks.push({ids,signal,resolve}));},
 };
 const {doc,view,ids}=setup(t,{loadSnapshot:async()=>({rows:[row(1,paid),row(2)]}),provisionLink});
 const opening=view.open();await tick();
 const position=doc.querySelector('.ddr-content');position.scrollTop=42;position.scrollLeft=10;
 const pencil=()=>doc.querySelector('[data-dda-provision-pencil="1"]');
 pencil().focus();pencil().click();await tick();
 doc.querySelector('input[value="23"]').click();doc.querySelector('.dda-provision-save').click();await tick();
 doc.querySelector('[data-edit-review-submit]').click();await tick();
 assert.deepEqual(checks.map(check=>check.ids),[['21'],['23']]);
 assert.equal(checks[0].signal.aborted,true);
 checks[0].resolve(new Set(['21']));await opening;
 assert.deepEqual(ids(),['1','2']);
 assert.match(doc.querySelector('[data-dda-id="1"] .ddr-link').textContent,/ID 23/);
 [...doc.querySelectorAll('.dda-provision-dialog button')].find(node=>node.textContent==='Concluir').click();
 assert.equal(doc.activeElement,pencil());
 doc.querySelector('[data-dda-toggle-barcode="2"]').focus();
 checks[1].resolve(new Set(['23']));await tick();
 assert.deepEqual(ids(),['2']);
 assert.equal(doc.activeElement,doc.querySelector('[data-dda-toggle-barcode="2"]'));
 assert.equal(position.scrollTop,42);assert.equal(position.scrollLeft,10);
});

test('all child pages are considered once for every exact parent; legacy parent status cannot defeat confirmed closure',async()=>{
 const child=(id,parent,fields={})=>({id:String(id),fields:{DESCRITIVOPROVISAO:String(parent),DATAPGTOEFETUADO:'2026-11-07',PGTOAGENDADO:'PAGO',...fields}});
 const children=[child(1,21),child(2,22),child(3,24),child(4,25),child(5,26),child(6,27),child(7,28)];
 const later=[child(8,21,{PGTOAGENDADO:'Agendado'}),child(9,22,{PGTOAGENDADO:'',STATUS:'PAGAMENTO EFETUADO'}),child(10,27,{DATAPGTOEFETUADO:'2026-02-30'})];
 const parent=id=>({id,fields:{ID:id,DATAPGTOEFETUADO:id==='24'?'':id==='25'?'2026-02-30':'2026-11-07',STATUS:'PAGAMENTO PREVISTO'}});
 const cursor='https://graph.microsoft.com/v1.0/sites/site/lists/children/items?$skiptoken=page2';
 let inventories=0,pages=0;
 const repository=createSharePointRepository({async request(path,{method}={}){
  assert.equal(method,'GET');
  if(path.startsWith('/sites/tenant.sharepoint.com:'))return {id:'site'};
  if(path.startsWith('/sites/site/lists?'))return {value:[{id:'parents',displayName:'DESCRITIVOPROVISAO'},{id:'children',displayName:'PROVISÃO PGTOS'}].map(item=>({...item,list:{template:'genericList'}}))};
  if(path==='/sites/site/lists/children/columns')return {value:[{name:'DESCRITIVOPROVISAO',text:{}}]};
  if(path.startsWith('/sites/site/lists/children/items?')&&!path.includes('skiptoken')){inventories++;pages++;return {value:children,'@odata.nextLink':cursor};}
  if(path.includes('skiptoken=page2')){pages++;return {value:later};}
  const id=path.match(/\/parents\/items\/(\d+)\?/)?.[1];
  if(id==='28')throw new Error('unreadable');
  if(id)return parent(id==='26'?'999':id);
  throw new Error(path);
 }},{personal:{host:'tenant.sharepoint.com',path:'/sites/test'}});
 const service=createDdaProvisionLink({repository});
 assert.deepEqual([...await service.loadSettledProvisionIds(['21','22','23','24','25','26','27','28','22'])],['22']);
 assert.equal(inventories,1);assert.equal(pages,2);
});

test('the pending payment badge and settlement button fit on phones and desktop',{timeout:60000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
 if(!browser)return t.skip('Chrome unavailable');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 const server=await createIsolatedViteServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
 try{
  await server.listen();
  for(const [width,height] of [[320,740],[390,844],[1365,900]]){
   const result=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/dda-report.html?report=1&layout=1&settlement=1`});
   const dom=new JSDOM(result.stdout);
   try{
    const layout=JSON.parse(dom.window.document.documentElement.dataset.settlement);
    assert.deepEqual(layout,{label:'PAGO POR AGENDAMENTO',pending:'Baixa pendente',fits:true,aligned:true,actionFits:true,selected:'56'},JSON.stringify({width,layout}));
   }finally{dom.window.close();}
  }
 }finally{await server.close();}
});
