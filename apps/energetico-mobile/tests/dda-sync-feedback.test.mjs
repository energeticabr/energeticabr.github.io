import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';
import { refreshDdaBank } from '../src/chat/dda-bank-refresh.js';
import { createDdaSyncReceipt } from '../src/ui/dda-sync-receipt.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const id='a'.repeat(32);

test('global receipt covers another screen and only Entendi acknowledges; teardown does not',async t=>{
 const dom=new JSDOM('<body><main>OUTRA TELA</main></body>');t.after(()=>dom.window.close());
 const doc=dom.window.document;let acknowledged=0;
 const receipt=createDdaSyncReceipt({document:doc,host:doc.body,global:true,requireAcknowledgement:true,onAcknowledge:async()=>{acknowledged++;return true;},format:()=>''});
 t.after(()=>receipt.destroy());
 assert.equal(receipt.show({status:'succeeded',created:0},[]),true);
 assert.notEqual(doc.querySelector('main').inert,true);
 const popup=doc.querySelector('[data-dda-sync-result]');
 popup.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.ok(doc.querySelector('[data-dda-sync-result]'));assert.equal(acknowledged,0);
 receipt.close();assert.equal(acknowledged,0);assert.notEqual(doc.querySelector('main').inert,true);
 receipt.show({status:'failed'},[]);doc.querySelector('[data-dda-sync-result] button').click();await tick();
 assert.equal(acknowledged,1);assert.equal(doc.querySelector('[data-dda-sync-result]'),null);
});

test('managed gallery closes without cancelling the global manual operation or duplicating its popup',async t=>{
 const dom=new JSDOM('<body></body>');let starts=0,listener;const doc=dom.window.document;
 const monitor={running:false,async start(){starts++;this.running=true;listener?.({running:true,notice:'Consultando'});},subscribe(fn){listener=fn;return()=>{listener=null;};}};
 const gallery=createRegistrationGallery({document:doc,kind:'dda',data:{loadSnapshot:async()=>({rows:[]})},syncMonitor:monitor});
 t.after(()=>{gallery.destroy();dom.window.close();});await gallery.open();doc.querySelector('[data-action="registration-refresh"]').click();await tick();
 assert.equal(starts,1);assert.equal(doc.querySelector('[data-action="registration-refresh"]').disabled,true);
 gallery.close();assert.equal(monitor.running,true);assert.equal(doc.querySelector('[data-dda-sync-result]'),null);
});

for(const outcome of ['empty','failed','reload-failed']) test(`DDA synchronization announces ${outcome} in a dismissible result and preserves cards`,async t=>{
 const dom=new JSDOM('<body></body>');const doc=dom.window.document;let loads=0;
 const gallery=createRegistrationGallery({document:doc,kind:'dda',
  data:{async loadSnapshot(){if(++loads>1&&outcome==='reload-failed')throw Error('offline');return {rows:[{id:'1',fields:{Title:'FICTICIO'}}]};}},
  refreshBank:async()=>{if(outcome==='failed')throw Error('Consulta indisponível');return {status:'succeeded',created:0,updated:1,elapsedMs:670000};}});
 t.after(()=>{gallery.destroy();dom.window.close();});await gallery.open();
 const button=doc.querySelector('[data-action="registration-refresh"]');button.click();await tick();await tick();
 const popup=doc.querySelector('[data-dda-sync-result]');assert.ok(popup,'terminal outcome must open a result popup');
 assert.equal(doc.querySelectorAll('.rg-row--dda').length,1);
 assert.equal(popup.dataset.ddaSyncResult,outcome==='empty'?'succeeded':outcome==='failed'?'failed':'partial');
 if(outcome==='empty'){assert.match(popup.textContent,/nenhum novo/i);assert.match(popup.textContent,/11:10/);}
 else assert.doesNotMatch(popup.textContent,/Sicoob e SharePoint atualizados/);
 popup.querySelector('button').click();await tick();assert.equal(doc.querySelector('[data-dda-sync-result]'),null);assert.equal(button.disabled,false);
});

test('bank polling reports elapsed time while pending and never reports completion before the receipt',async()=>{
 let now=0,polls=0;const notices=[];
 const result=await refreshDdaBank({refreshDda:async()=>({status:'running',requestId:id}),getDdaRefreshStatus:async()=>({status:++polls===2?'succeeded':'running',requestId:id,created:0})},
 {now:()=>now,delay:async()=>{now+=3000;},onStatus:text=>notices.push(text)});
 assert.match(notices[0],/10 a 15 minutos/);assert.match(notices[1],/00:03/);assert.equal(result.elapsedMs,6000);
 assert.ok(notices.every(text=>!text.includes('concluída')));
});

test('an unresponsive bank status request settles on its deadline even if it ignores abort',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let outcome;
 const pending=refreshDdaBank({refreshDda:()=>new Promise(()=>{}),getDdaRefreshStatus:async()=>{}},{onStatus:()=>{}})
  .then(()=>{outcome='success';},error=>{outcome=error.message;});
 t.mock.timers.tick(35001);await tick();
 assert.match(outcome||'',/tempo|conexão|resposta/i);
 await pending;
});
