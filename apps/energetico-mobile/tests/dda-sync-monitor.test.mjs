import test from 'node:test';
import assert from 'node:assert/strict';
import { createDdaSyncMonitor } from '../src/chat/dda-sync-monitor.js';
const id='a'.repeat(32), second='b'.repeat(32);
function storage(){const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),map};}
function setup(t,options={}){
 const saved=options.storage||storage(),shown=[],calls=[];let state={status:'running',requestId:id};
 const client={refreshDda:async p=>{calls.push(['start',p.requestId]);return state;},
  getDdaRefreshPending:async()=>({status:'pending',requests:[]}),getDdaRefreshStatus:async key=>{calls.push(['status',key]);return state;},
  acknowledgeDdaRefresh:async key=>{calls.push(['ack',key]);return {status:'acknowledged',requestId:key};},...options.client};
 const monitor=createDdaSyncMonitor({client,accountKey:'account-a',storage:saved,randomId:()=>id,schedule:()=>0,cancel:()=>{},
  present:async(result,ack)=>{shown.push({result,ack});return true;},...options,client});
 t.after(()=>monitor.destroy());return {monitor,saved,shown,calls,client,setState:v=>{state=v;}};
}
test('manual intent persists before start; terminal result waits for explicit acknowledgement',async t=>{
 const h=setup(t);await h.monitor.start();assert.equal(h.monitor.running,true);
 assert.match([...h.saved.map.values()][0],new RegExp(id));
 h.setState({status:'succeeded',requestId:id,created:1,createdItemIds:[42]});await h.monitor.resume();
 assert.equal(h.shown.length,1);assert.deepEqual(h.shown[0].result.createdItemIds,[42]);
 assert.equal(h.calls.filter(x=>x[0]==='ack').length,0);
 await h.shown[0].ack();await h.monitor.resume();assert.equal(h.calls.filter(x=>x[0]==='ack').length,1);
 assert.equal(h.monitor.pendingCount,0);
});
test('closing/recreating app resumes same request and does not start the bank query again',async t=>{
 const h=setup(t);await h.monitor.start();h.monitor.destroy();
 const restored=setup(t,{storage:h.saved,client:{refreshDda:async()=>assert.fail('must not start again'),getDdaRefreshStatus:async()=>({status:'succeeded',requestId:id,created:0})}});
 await restored.monitor.resume();assert.equal(restored.shown.length,1);assert.equal(restored.shown[0].result.status,'succeeded');
});
test('server pending results recover without local storage and remain until acknowledged after reopening',async t=>{
 const pending={status:'failed',requestId:id,code:'SYNC_FAILED'};
 const client={getDdaRefreshPending:async()=>({status:'pending',requests:[pending]})};
 const first=setup(t,{client});await first.monitor.resume();assert.equal(first.shown.length,1);first.monitor.destroy();
 const again=setup(t,{storage:first.saved,client});await again.monitor.resume();assert.equal(again.shown.length,1);
 assert.equal(again.shown[0].result.status,'failed');
});
test('background completion remains pending and shows on foreground, never acknowledged by hiding',async t=>{
 let visible=false;const h=setup(t,{isVisible:()=>visible});await h.monitor.start();
 h.setState({status:'succeeded',requestId:id,created:0});await h.monitor.resume();assert.equal(h.shown.length,0);
 visible=true;await h.monitor.resume();assert.equal(h.shown.length,1);
 h.monitor.suspend();await h.monitor.resume();assert.equal(h.shown.length,2);assert.equal(h.calls.filter(x=>x[0]==='ack').length,0);
});
test('lost start response retries same durable identity; network error is not bank failure',async t=>{
 let starts=0;const h=setup(t,{client:{refreshDda:async p=>{assert.equal(p.requestId,id);if(++starts===1)throw Error('offline');return {status:'succeeded',requestId:id,created:0};}}});
 await h.monitor.start();assert.equal(h.shown.length,0);assert.equal(h.monitor.running,true);
 await h.monitor.resume();assert.equal(starts,2);assert.equal(h.shown.length,1);
});
test('ACK failure is retried after restart without showing acknowledged result again',async t=>{
 const h=setup(t,{client:{acknowledgeDdaRefresh:async()=>{throw Error('offline');}}});
 h.setState({status:'succeeded',requestId:id,created:0});await h.monitor.start();await h.shown[0].ack();h.monitor.destroy();
 const again=setup(t,{storage:h.saved,client:{getDdaRefreshPending:async()=>({status:'pending',requests:[{status:'succeeded',requestId:id,created:0}]})}});
 await again.monitor.resume();assert.equal(again.shown.length,0);assert.deepEqual(again.calls,[['ack',id]]);
});
test('account isolation, coalesced clicks, stale responses after destroy, and sanitized persistence',async t=>{
 let resolve;const h=setup(t,{client:{refreshDda:async()=>new Promise(r=>resolve=r)}});
 const one=h.monitor.start(),two=h.monitor.start();await Promise.resolve();assert.equal(h.monitor.pendingCount,1);
 h.monitor.destroy();resolve({status:'succeeded',requestId:id,created:0,supplier:'SECRET',barcode:'SECRET'});await Promise.all([one,two]);assert.equal(h.shown.length,0);
 const other=setup(t,{accountKey:'account-b',storage:h.saved,randomId:()=>second});await other.monitor.resume();assert.equal(other.monitor.pendingCount,0);
 assert.doesNotMatch([...h.saved.map.values()].join(''),/SECRET|supplier|barcode/);
});
test('storage failure refuses a new start rather than silently losing the request',async t=>{
 const h=setup(t,{storage:{getItem:()=>null,setItem:()=>{throw Error('quota');}}});
 await assert.rejects(h.monitor.start(),/salvar|registrar/i);assert.equal(h.calls.length,0);
});
