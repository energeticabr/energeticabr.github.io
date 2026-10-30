import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createChatClient} from '../src/chat/chat-client.js';
import {createRegistrationGallery} from '../src/ui/registration-gallery-view.js';
import {validateSefazReceipt} from '../src/chat/sefaz-sync-receipt.js';
const id='a'.repeat(32), tick=()=>new Promise(r=>setImmediate(r));
export const receipt=(status='running')=>({requestId:id,status,startedUtc:'2026-10-29T10:00:00Z',
 ...(status==='succeeded'?{completedUtc:'2026-10-29T10:01:00Z'}:{}),
 sources:Object.fromEntries(['NFE','CTE','NFSE'].map(key=>[key,{status:status==='succeeded'?'succeeded':'queued',documents:0}]))});

test('fiscal receipt preserves distinct created row IDs without retaining other fiscal data',()=>{
 const value=receipt('succeeded');
 value.sources.NFE={status:'succeeded',documents:4,createdItemIds:[71,72,71],accessKey:'not persisted'};
 value.sources.CTE={status:'succeeded',documents:2,createdItemIds:[8]};
 value.sources.NFSE={status:'succeeded',documents:1,createdItemIds:[]};
 const validated=validateSefazReceipt(value);
 assert.deepEqual(validated.sources.NFE,{status:'succeeded',documents:4,createdItemIds:[71,72]});
 assert.deepEqual(validated.sources.CTE.createdItemIds,[8]);
 assert.deepEqual(validated.sources.NFSE.createdItemIds,[]);
 assert.notEqual(validated.sources.NFE.createdItemIds,value.sources.NFE.createdItemIds);
});

for(const invalid of [null,'12',{},[0],[-1],[1.5],[true],['12'],[Number.MAX_SAFE_INTEGER+1]]) test(`fiscal receipt rejects malformed created row IDs ${JSON.stringify(invalid)}`,()=>{
 const value=receipt('succeeded');value.sources.NFE.createdItemIds=invalid;
 assert.throws(()=>validateSefazReceipt(value));
});

test('fiscal client sends only fixed authenticated actions, validates complete sources and strips unexpected data',async()=>{
 const bodies=[];let value=receipt(),lastSuccessfulUtc='2026-10-29T10:01:00Z',lastSuccessfulCreatedItemIds=[71,72,71];
 const client=createChatClient({apiBaseUrl:'https://app.example.test',tokenProvider:async()=> 'fake',fetchImpl:async(url,options)=>{
  assert.equal(options.headers.Authorization,'Bearer fake');const body=JSON.parse(options.body);bodies.push(body);
  const result=body.mode==='pending'?{status:'pending',requests:[value],lastSuccessfulUtc,lastSuccessfulCreatedItemIds}:body.acknowledge?{status:'acknowledged',requestId:id}:value;
  return new Response(JSON.stringify({status:'processed',messages:[],sefazRefresh:result}),{status:200});
 }});
 assert.equal(typeof client.refreshSefaz,'function');
 await client.refreshSefaz({requestId:id,command:'never'});await client.getSefazRefreshStatus(id);
 assert.deepEqual(await client.getSefazRefreshPending(),{status:'pending',requests:[value],lastSuccessfulUtc,lastSuccessfulCreatedItemIds:[71,72]});
 await client.acknowledgeSefazRefresh(id);
 assert.deepEqual(bodies,[{action:'sefaz_refresh',requestId:id},{action:'sefaz_refresh_status',requestId:id},{action:'sefaz_refresh_status',mode:'pending'},{action:'sefaz_refresh_status',requestId:id,acknowledge:true}]);
 value={...receipt('succeeded'),sources:{...receipt().sources}};await assert.rejects(client.getSefazRefreshStatus(id));
 value=receipt('succeeded');value.sources.NFE.code='DELIVERY_PENDING';await assert.rejects(client.getSefazRefreshStatus(id));
 value={...receipt(),sources:{NFE:{status:'running'}}};await assert.rejects(client.getSefazRefreshPending());
 value=receipt();lastSuccessfulUtc='not-a-date';await assert.rejects(client.getSefazRefreshPending());
 lastSuccessfulUtc='2026-10-29T10:01:00Z';lastSuccessfulCreatedItemIds=['71'];await assert.rejects(client.getSefazRefreshPending());
 value=receipt();value.sources.NFE.documents=-1;await assert.rejects(client.refreshSefaz({requestId:id}));
 await assert.rejects(client.refreshSefaz({requestId:'invalid'}));
});

test('SEFAZ top-right button routes to durable collector and stays disabled through waiting, then reloads',async t=>{
 const dom=new JSDOM('<body/>'),doc=dom.window.document;let listener,starts=0,loads=0,running=false;
 const monitor={get running(){return running;},subscribe(fn){listener=fn;fn({running:false});return()=>{};},async start(){starts++;running=true;listener({running,notice:'NF-e: aguardando limite fiscal',latest:receipt()});}};
 const gallery=createRegistrationGallery({document:doc,kind:'notas_fiscais_sefaz',syncMonitor:monitor,data:{loadSnapshot:async()=>{loads++;return {rows:[]};}}});
 t.after(()=>{gallery.destroy();dom.window.close();});await gallery.open();
 const button=doc.querySelector('[data-gallery-refresh]');button.click();await tick();assert.equal(starts,1);assert.equal(loads,1);assert.equal(button.disabled,true);
 assert.match(doc.querySelector('[data-sefaz-sync-progress]').textContent,/aguardando/);
 running=false;listener({running:false,notice:'',latest:receipt('succeeded')});await tick();assert.equal(loads,2);
 gallery.close();assert.equal(starts,1);
});

test('unsupported fiscal client shows error rather than pretending that a gallery read consulted SEFAZ',async t=>{
 const dom=new JSDOM('<body/>');let loads=0;
 const gallery=createRegistrationGallery({document:dom.window.document,kind:'notas_fiscais_sefaz',data:{loadSnapshot:async()=>{loads++;return {rows:[]};}}});
 t.after(()=>{gallery.destroy();dom.window.close();});await gallery.open();dom.window.document.querySelector('[data-gallery-refresh]').click();await tick();
 assert.equal(loads,1);assert.match(dom.window.document.querySelector('[data-sefaz-sync-progress]').textContent,/indisponível/);
});

test('fiscal gallery shows a persistent neutral cluster with the last successful update',async t=>{
 const dom=new JSDOM('<body/>'),doc=dom.window.document;let listener;
 const monitor={running:false,subscribe(fn){listener=fn;fn({running:false,notice:'',lastSuccessfulAt:null});return()=>{};},async start(){}};
 const gallery=createRegistrationGallery({document:doc,kind:'notas_fiscais_sefaz',syncMonitor:monitor,data:{loadSnapshot:async()=>({rows:[]})}});
 t.after(()=>{gallery.destroy();dom.window.close();});await gallery.open();
 const cluster=doc.querySelector('[data-sefaz-last-success]'),value=doc.querySelector('[data-sefaz-last-success-value]');
 assert.ok(cluster);assert.match(cluster.textContent,/Última atualização bem-sucedida/);assert.equal(value.textContent,'—');
 listener({running:false,notice:'',lastSuccessfulAt:Date.parse('2026-10-29T10:01:00Z')});
 assert.match(value.textContent,/29\/10\/2026.*07:01/);assert.equal(cluster.hidden,false);
 listener({running:true,notice:'NF-e: aguardando intervalo obrigatório',lastSuccessfulAt:Date.parse('2026-10-29T10:01:00Z')});
 assert.match(value.textContent,/29\/10\/2026.*07:01/);
});

test('fiscal gallery uses the requested concise source and synchronization summaries',async t=>{
 const dom=new JSDOM('<body/>'),doc=dom.window.document;let listener;
 const monitor={running:false,subscribe(fn){listener=fn;fn({running:false,notice:''});return()=>{};},async start(){}};
 const gallery=createRegistrationGallery({document:doc,kind:'notas_fiscais_sefaz',syncMonitor:monitor,data:{loadSnapshot:async()=>({rows:[]})}});
 t.after(()=>{gallery.destroy();dom.window.close();});await gallery.open();
 assert.equal(doc.querySelector('[data-sefaz-coverage]').textContent,'Fontes: SEFAZ para NF-e e CT-e; ADN nacional para NFS-e.');
 listener({running:true,notice:'NF-e: aguardando o intervalo obrigatório da fonte fiscal',lastSuccessfulAt:Date.parse('2026-10-29T10:01:00Z'),lastSuccessfulCreatedCount:3,nextAllowedAt:Date.parse('2026-10-29T11:15:00Z')});
 assert.equal(doc.querySelector('[data-sefaz-sync-progress]').textContent,'ÚLTIMA ATUALIZAÇÃO EM 29/10/2026 no horário 07:01 com 3 novos cadastros. Próxima atualização permitida no horário 08:15');
 listener({running:false,notice:'',lastSuccessfulAt:Date.parse('2026-10-29T10:01:00Z'),lastSuccessfulCreatedCount:1,nextAllowedAt:null});
 assert.equal(doc.querySelector('[data-sefaz-sync-progress]').textContent,'ÚLTIMA ATUALIZAÇÃO EM 29/10/2026 no horário 07:01 com 1 novo cadastro.');
});
