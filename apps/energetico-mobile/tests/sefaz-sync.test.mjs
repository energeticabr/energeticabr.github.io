import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createChatClient} from '../src/chat/chat-client.js';
import {createRegistrationGallery} from '../src/ui/registration-gallery-view.js';
const id='a'.repeat(32), tick=()=>new Promise(r=>setImmediate(r));
export const receipt=(status='running')=>({requestId:id,status,startedUtc:'2026-10-29T10:00:00Z',
 ...(status==='succeeded'?{completedUtc:'2026-10-29T10:01:00Z'}:{}),
 sources:Object.fromEntries(['NFE','CTE','NFSE'].map(key=>[key,{status:status==='succeeded'?'succeeded':'queued',documents:0}]))});

test('fiscal client sends only fixed authenticated actions, validates complete sources and strips unexpected data',async()=>{
 const bodies=[];let value=receipt();
 const client=createChatClient({apiBaseUrl:'https://app.example.test',tokenProvider:async()=> 'fake',fetchImpl:async(url,options)=>{
  assert.equal(options.headers.Authorization,'Bearer fake');const body=JSON.parse(options.body);bodies.push(body);
  const result=body.mode==='pending'?{status:'pending',requests:[value]}:body.acknowledge?{status:'acknowledged',requestId:id}:value;
  return new Response(JSON.stringify({status:'processed',messages:[],sefazRefresh:result}),{status:200});
 }});
 assert.equal(typeof client.refreshSefaz,'function');
 await client.refreshSefaz({requestId:id,command:'never'});await client.getSefazRefreshStatus(id);await client.getSefazRefreshPending();await client.acknowledgeSefazRefresh(id);
 assert.deepEqual(bodies,[{action:'sefaz_refresh',requestId:id},{action:'sefaz_refresh_status',requestId:id},{action:'sefaz_refresh_status',mode:'pending'},{action:'sefaz_refresh_status',requestId:id,acknowledge:true}]);
 value={...receipt('succeeded'),sources:{...receipt().sources}};await assert.rejects(client.getSefazRefreshStatus(id));
 value=receipt('succeeded');value.sources.NFE.code='DELIVERY_PENDING';await assert.rejects(client.getSefazRefreshStatus(id));
 value={...receipt(),sources:{NFE:{status:'running'}}};await assert.rejects(client.getSefazRefreshPending());
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
