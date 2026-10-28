import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createDdaSyncSession} from '../src/ui/dda-sync-session.js';
import {createDdaReportView} from '../src/ui/dda-report-view.js';
const id='a'.repeat(32),tick=()=>new Promise(r=>setImmediate(r));
test('a late report open and close cannot leave the main app inert after the global result closes',async t=>{
 const dom=new JSDOM('<body><main id="app">Home</main></body>',{url:'https://fixture.test',pretendToBeVisual:true});t.after(()=>dom.window.close());
 const doc=dom.window.document;
 const session=createDdaSyncSession({document:doc,storage:dom.window.localStorage,accountKey:'a',client:{getDdaRefreshPending:async()=>({status:'pending',requests:[{status:'succeeded',requestId:id,created:0}]})}});
 t.after(()=>session.destroy());await session.resume();
 const report=createDdaReportView({document:doc,data:{loadSnapshot:async()=>({complete:true,rows:[]})}});t.after(()=>report.destroy());
 await report.open();session.suspend();report.close();
 assert.notEqual(doc.querySelector('#app').inert,true);
});
test('restored result appears over unrelated screen with new IDs; closing app is not an ACK',async t=>{
 const dom=new JSDOM('<body><main>OUTRA TELA</main></body>',{url:'https://fixture.test',pretendToBeVisual:true});let ack=0;
 t.after(()=>dom.window.close());
 const client={getDdaRefreshPending:async()=>({status:'pending',requests:ack?[]:[{status:'succeeded',requestId:id,created:1,createdItemIds:[42]}]}),acknowledgeDdaRefresh:async()=>{ack++;return{status:'acknowledged',requestId:id};}};
 const create=()=>createDdaSyncSession({document:dom.window.document,storage:dom.window.localStorage,client,accountKey:'a',loadRows:async()=>[{id:'42',fields:{Title:'FICTICIO',VALOR:45.12,VENCIMENTO:'2026-11-01'}}]});
 const first=create();await first.resume();const doc=dom.window.document;
 assert.match(doc.querySelector('[data-dda-sync-result]').textContent,/FICTICIO/);assert.match(doc.querySelector('[data-dda-sync-result]').textContent,/ID 42/);
 first.destroy();assert.equal(ack,0);assert.notEqual(doc.querySelector('main').inert,true);
 const second=create();t.after(()=>second.destroy());await second.resume();assert.ok(doc.querySelector('[data-dda-sync-result]'));
 doc.querySelector('[data-dda-sync-result] button').click();await tick();await second.resume();assert.equal(ack,1);
 assert.equal(doc.querySelector('[data-dda-sync-result]'),null);
});

test('multiple restored outcomes are acknowledged one at a time without closing the next popup',async t=>{
 const dom=new JSDOM('<body/>',{url:'https://fixture.test',pretendToBeVisual:true});t.after(()=>dom.window.close());
 const receipts=[{requestId:id,status:'succeeded',created:0},{requestId:'b'.repeat(32),status:'failed'}],acks=new Set();
 const session=createDdaSyncSession({document:dom.window.document,storage:dom.window.localStorage,accountKey:'a',client:{
  getDdaRefreshPending:async()=>({status:'pending',requests:receipts.filter(r=>!acks.has(r.requestId))}),
  acknowledgeDdaRefresh:async key=>{acks.add(key);return {status:'acknowledged',requestId:key};}}});
 t.after(()=>session.destroy());await session.resume();dom.window.document.querySelector('[data-dda-sync-result] button').click();await tick();await tick();
 assert.equal(dom.window.document.querySelector('[data-dda-sync-result]')?.dataset.ddaSyncResult,'failed');assert.equal(acks.size,1);
});
test('failed optional detail read still shows confirmed new record ID and result',async t=>{
 const dom=new JSDOM('<body/>',{url:'https://fixture.test',pretendToBeVisual:true});t.after(()=>dom.window.close());
 const session=createDdaSyncSession({document:dom.window.document,storage:dom.window.localStorage,accountKey:'a',loadRows:async()=>{throw Error('offline');},client:{getDdaRefreshPending:async()=>({status:'pending',requests:[{status:'succeeded',requestId:id,created:1,createdItemIds:[88]}]})}});
 t.after(()=>session.destroy());await session.resume();const popup=dom.window.document.querySelector('[data-dda-sync-result]');
 assert.equal(popup.dataset.ddaSyncResult,'succeeded');assert.match(popup.textContent,/ID 88/);
});
