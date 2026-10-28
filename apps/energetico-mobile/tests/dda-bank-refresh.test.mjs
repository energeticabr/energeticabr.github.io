import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatClient } from '../src/chat/chat-client.js';
import { refreshDdaBank } from '../src/chat/dda-bank-refresh.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';
const id='a'.repeat(32);
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('bank refresh waits for confirmed completion and rejects offline, partial or mismatched receipts',async()=>{
 const calls=[];
 const client={async refreshDda(){calls.push('start');return {status:'queued',requestId:id};},
 async getDdaRefreshStatus(requestId){calls.push(requestId);return {status:calls.length===2?'running':'succeeded',requestId:id,created:1,verified:2};}};
 const result=await refreshDdaBank(client,{delay:async()=>{},onStatus:()=>{}});
 assert.equal(result.created,1);assert.deepEqual(calls,['start',id,id]);
 for(const status of ['unavailable','busy','failed','partial']){
  await assert.rejects(refreshDdaBank({refreshDda:async()=>({status,requestId:id}),getDdaRefreshStatus:client.getDdaRefreshStatus},{delay:async()=>{}}));
 }
 await assert.rejects(refreshDdaBank({...client,getDdaRefreshStatus:async()=>({status:'succeeded',requestId:'b'.repeat(32)})},{delay:async()=>{}}));
});
test('bank refresh cancellation and deadline stop polling without claiming completion',async()=>{
 const abort=new AbortController();let polls=0;
 const client={refreshDda:async()=>({status:'queued',requestId:id}),getDdaRefreshStatus:async()=>{polls++;return {status:'running',requestId:id};}};
 await assert.rejects(refreshDdaBank(client,{signal:abort.signal,delay:async()=>abort.abort()}),{name:'AbortError'});
 assert.equal(polls,0);
 let now=0;
 await assert.rejects(refreshDdaBank(client,{now:()=>now,timeoutMs:10,delay:async()=>{now=11;}}),/demorou/);
});
test('authenticated bank methods send fixed actions and no bank credentials',async()=>{
 const bodies=[];
 const client=createChatClient({apiBaseUrl:'https://app.example.test',tokenProvider:async scopes=>{assert.deepEqual(scopes,['User.Read']);return 'test-only';},
 fetchImpl:async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer test-only');bodies.push(JSON.parse(options.body));return new Response(JSON.stringify({status:'processed',messages:[],ddaRefresh:{status:'queued',requestId:id}}),{status:200});}});
 await client.refreshDda();await client.getDdaRefreshStatus(id);
 assert.deepEqual(bodies,[{action:'dda_refresh'},{action:'dda_refresh_status',requestId:id}]);
 await assert.rejects(client.getDdaRefreshStatus('invalid'));
});
test('manual DDA button waits for bank before SharePoint, deduplicates clicks, preserves cards on failure',async()=>{
 const dom=new JSDOM('<body></body>');const events=[];let finish;let fail=false;
 const gallery=createRegistrationGallery({document:dom.window.document,kind:'dda',
 data:{async loadSnapshot(){events.push('sharepoint');return {rows:[{id:'1',fields:{Title:'FICTICIO',VENCIMENTO:'2026-10-28'}}]};}},
 refreshBank:async()=>{events.push('bank');if(fail)throw Error('bank');await new Promise(resolve=>{finish=resolve;});return {status:'succeeded',created:1};}});
 await gallery.open();assert.deepEqual(events,['sharepoint']);
 const button=dom.window.document.querySelector('[data-action="registration-refresh"]');
 button.click();button.click();await tick();assert.deepEqual(events,['sharepoint','bank']);assert.equal(button.disabled,true);
 finish();await tick();await tick();assert.deepEqual(events,['sharepoint','bank','sharepoint']);
 assert.match(dom.window.document.body.textContent,/Sicoob.*SharePoint.*atualizados/i);
 fail=true;button.click();await tick();
 assert.match(dom.window.document.body.textContent,/FICTICIO/);
 assert.match(dom.window.document.body.textContent,/não foi possível.*Sicoob/i);
 gallery.destroy();dom.window.close();
});
test('closing gallery aborts bank wait and prevents a late SharePoint refresh',async()=>{
 const dom=new JSDOM('<body></body>');let signal,finish,loads=0;
 const gallery=createRegistrationGallery({document:dom.window.document,kind:'dda',data:{async loadSnapshot(){loads++;return {rows:[]};}},
 refreshBank:async options=>{signal=options.signal;await new Promise(resolve=>{finish=resolve;});return {status:'succeeded'};}});
 await gallery.open();dom.window.document.querySelector('[data-action="registration-refresh"]').click();await tick();
 gallery.close();assert.equal(signal.aborted,true);finish();await tick();assert.equal(loads,1);
 gallery.destroy();dom.window.close();
});
test('successful bank query followed by failed SharePoint read preserves actual cards',async()=>{
 const dom=new JSDOM('<body></body>');let loads=0;
 const gallery=createRegistrationGallery({document:dom.window.document,kind:'dda',
 data:{async loadSnapshot(){if(++loads>1)throw Error('SharePoint unavailable');return {rows:[{id:'1',fields:{Title:'FICTICIO'}}]};}},
 refreshBank:async()=>({status:'succeeded'})});
 await gallery.open();assert.equal(dom.window.document.querySelectorAll('.rg-row--dda').length,1);
 dom.window.document.querySelector('[data-action="registration-refresh"]').click();await tick();await tick();
 assert.equal(dom.window.document.querySelectorAll('.rg-row--dda').length,1);
 assert.match(dom.window.document.body.textContent,/não foi possível recarregar a galeria/i);
 gallery.destroy();dom.window.close();
});
