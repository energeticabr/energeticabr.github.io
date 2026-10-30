import test from 'node:test';
import assert from 'node:assert/strict';
import {createSefazSyncMonitor} from '../src/chat/sefaz-sync-monitor.js';
const id='a'.repeat(32),other='b'.repeat(32);
const receipt=(status='running')=>({requestId:id,status,startedUtc:'2026-10-29T10:00:00Z',
 ...(['succeeded','partial','failed'].includes(status)?{completedUtc:'2026-10-29T10:01:00Z'}:{}),
 sources:Object.fromEntries(['NFE','CTE','NFSE'].map(key=>[key,{status:status==='succeeded'?'succeeded':'queued',documents:0}]))});
function setup(t,options={}) {
 assert.equal(typeof createSefazSyncMonitor,'function');
 const map=new Map(),storage=options.storage||{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)},shown=[],calls=[];let state=receipt();
 const client={refreshSefaz:async p=>{calls.push(['start',p.requestId]);return state;},getSefazRefreshPending:async()=>({status:'pending',requests:[]}),
 getSefazRefreshStatus:async key=>{calls.push(['status',key]);return state;},acknowledgeSefazRefresh:async key=>{calls.push(['ack',key]);return {status:'acknowledged',requestId:key};},...options.client};
 const monitor=createSefazSyncMonitor({accountKey:'account-a',storage,randomId:()=>id,schedule:()=>0,cancel:()=>{},
 present:async(result,ack)=>{shown.push({result,ack});return true;},...options,client});t.after(()=>monitor.destroy());
 return {monitor,storage,map,shown,calls,setState:value=>{state=value;}};
}
test('intent persists before POST and empty success remains unacknowledged through restart',async t=>{
 let saved;const h=setup(t,{client:{refreshSefaz:async()=>{assert.match([...saved.map.values()].join(''),new RegExp(id));return receipt();}}});saved=h;
 await h.monitor.start();h.setState(receipt('succeeded'));await h.monitor.resume();assert.equal(h.shown.length,1);assert.equal(h.calls.some(c=>c[0]==='ack'),false);
 h.monitor.destroy();const restored=setup(t,{storage:h.storage});await restored.monitor.resume();assert.equal(restored.shown.length,1);
 await restored.shown[0].ack();await restored.monitor.resume();assert.equal(restored.monitor.pendingCount,0);assert.equal(restored.calls.filter(c=>c[0]==='ack').length,1);
});
test('lost create response retries same ID, parallel taps coalesce and server canonical ID is adopted',async t=>{
 let starts=0;const h=setup(t,{client:{refreshSefaz:async p=>{assert.equal(p.requestId,id);if(++starts===1)throw Error('lost');return {...receipt(),requestId:other};},
 getSefazRefreshStatus:async key=>{assert.equal(key,other);return {...receipt('succeeded'),requestId:other};}}});
 await Promise.all([h.monitor.start(),h.monitor.start()]);assert.equal(starts,1);assert.equal(h.monitor.running,true);assert.equal(h.shown.length,0);
 await h.monitor.resume();assert.equal(starts,2);assert.equal(h.monitor.pendingCount,1);await h.monitor.resume();assert.equal(h.shown[0].result.requestId,other);
});
test('cooldown remains active and source progress never claims new documents',async t=>{
 const h=setup(t);const states=[];h.monitor.subscribe(s=>states.push(s));let pending=receipt('waiting');
 pending.sources.NFE={status:'waiting',code:'COOLDOWN',nextAllowedAt:'2026-10-29T11:00:00Z'};pending.sources.CTE={status:'succeeded',documents:8};pending.sources.NFSE={status:'queued',code:'WORKER_UNAVAILABLE'};
 h.setState(pending);await h.monitor.start();assert.equal(h.monitor.running,true);assert.equal(h.shown.length,0);
 assert.match(states.at(-1).notice,/intervalo obrigatório/);assert.match(states.at(-1).notice,/8 documento\(s\) processado/);assert.match(states.at(-1).notice,/computador/);assert.doesNotMatch(states.at(-1).notice,/nova/i);
});
test('hidden app completion is shown only on resume and suspend never ACKs',async t=>{
 let visible=false;const h=setup(t,{isVisible:()=>visible});h.setState(receipt('partial'));await h.monitor.start();assert.equal(h.shown.length,0);
 visible=true;await h.monitor.resume();assert.equal(h.shown[0].result.status,'partial');h.monitor.suspend();await h.monitor.resume();assert.equal(h.shown.length,2);assert.equal(h.calls.some(c=>c[0]==='ack'),false);
});
test('lost ACK retries after restart without showing explicitly acknowledged result again',async t=>{
 const h=setup(t,{client:{acknowledgeSefazRefresh:async()=>{throw Error('lost');}}});h.setState(receipt('succeeded'));await h.monitor.start();await h.shown[0].ack();h.monitor.destroy();
 const recovered=setup(t,{storage:h.storage,client:{getSefazRefreshPending:async()=>({status:'pending',requests:[receipt('succeeded')]})}});await recovered.monitor.resume();assert.equal(recovered.shown.length,0);assert.deepEqual(recovered.calls,[['ack',id]]);
});
test('late response after account switch is cancelled and storage is partitioned',async t=>{
 let resolve,signal;const h=setup(t,{client:{refreshSefaz:args=>{signal=args.signal;return new Promise(r=>resolve=r);}}});const start=h.monitor.start();await Promise.resolve();h.monitor.destroy();assert.equal(signal.aborted,true);
 resolve(receipt('succeeded'));await start;assert.equal(h.shown.length,0);const next=setup(t,{storage:h.storage,accountKey:'account-b'});await next.monitor.resume();assert.equal(next.monitor.pendingCount,0);
});
test('storage failure blocks new collection but authenticated server outcomes can still be shown',async t=>{
 const h=setup(t,{storage:{getItem:()=>null,setItem:()=>{throw Error('quota');}},client:{getSefazRefreshPending:async()=>({status:'pending',requests:[receipt('failed')],lastSuccessfulUtc:'2026-10-29T09:01:00Z'})}});let latest;
 h.monitor.subscribe(state=>{latest=state;});
 await assert.rejects(h.monitor.start(),/salvar|registrar/);assert.equal(h.calls.length,0);await h.monitor.resume();assert.equal(h.shown.length,1);
 assert.equal(latest.lastSuccessfulAt,Date.parse('2026-10-29T09:01:00Z'));
 assert.equal(await h.shown[0].ack(),false,'cannot silently lose an unpersisted ACK');
});
test('corrupt server batch cannot overwrite saved request and sensitive data is not persisted',async t=>{
 const h=setup(t,{client:{getSefazRefreshPending:async()=>({status:'pending',requests:[receipt('succeeded'),{...receipt(),requestId:'bad'}]})}});await h.monitor.resume();assert.equal(h.monitor.pendingCount,0);assert.equal(h.shown.length,0);
 h.setState({...receipt('succeeded'),xml:'SECRET'});await h.monitor.start();assert.equal(h.shown.length,1);assert.doesNotMatch([...h.map.values()].join(''),/SECRET|xml/);
});
test('last successful completion survives acknowledgement and restart while partial results cannot replace it',async t=>{
 const completed=Date.parse('2026-10-29T10:01:00Z'),h=setup(t);let latest;
 const success=receipt('succeeded');success.sources.NFE.createdItemIds=[71,72];success.sources.CTE.createdItemIds=[72,73];
 h.monitor.subscribe(state=>{latest=state;});h.setState(success);await h.monitor.start();
 assert.equal(latest.lastSuccessfulAt,completed);
 assert.equal(latest.lastSuccessfulCreatedCount,3);
 await h.shown[0].ack();await h.monitor.resume();assert.equal(h.monitor.pendingCount,0);
 h.monitor.destroy();const restored=setup(t,{storage:h.storage});restored.monitor.subscribe(state=>{latest=state;});
 await restored.monitor.resume();assert.equal(latest.lastSuccessfulAt,completed);assert.equal(latest.lastSuccessfulCreatedCount,3);
 restored.monitor.destroy();const partial=setup(t,{storage:h.storage,client:{getSefazRefreshPending:async()=>({status:'pending',requests:[{
  ...receipt('partial'),completedUtc:'2026-10-29T11:01:00Z'}]})}});partial.monitor.subscribe(state=>{latest=state;});
 await partial.monitor.resume();assert.equal(latest.lastSuccessfulAt,completed);
 assert.equal(latest.lastSuccessfulCreatedCount,3);
});
test('server restores the last created count and monitor exposes the latest full-source cooldown',async t=>{
 const waiting=receipt('waiting');waiting.sources.NFE={status:'waiting',code:'COOLDOWN',nextAllowedAt:'2026-10-29T11:00:00Z'};
 waiting.sources.CTE={status:'waiting',code:'COOLDOWN',nextAllowedAt:'2026-10-29T11:15:00Z'};
 const h=setup(t,{client:{getSefazRefreshPending:async()=>({status:'pending',requests:[waiting],lastSuccessfulUtc:'2026-10-29T09:01:00Z',lastSuccessfulCreatedItemIds:[80,81,80]}),getSefazRefreshStatus:async()=>waiting}});let latest;
 h.monitor.subscribe(state=>{latest=state;});await h.monitor.resume();
 assert.equal(latest.lastSuccessfulCreatedCount,2);
 assert.equal(latest.nextAllowedAt,Date.parse('2026-10-29T11:15:00Z'));
});
test('invalid server last-success timestamp preserves the valid local measurement',async t=>{
 const completed=Date.parse('2026-10-29T10:01:00Z'),map=new Map([['energetico.sefaz-sync.v1:account-a',JSON.stringify({version:1,records:[],lastSuccessfulAt:completed})]]);
 const h=setup(t,{storage:{getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)},client:{getSefazRefreshPending:async()=>({status:'pending',requests:[],lastSuccessfulUtc:'not-a-date'})}});let latest;
 h.monitor.subscribe(state=>{latest=state;});await h.monitor.resume();assert.equal(latest.lastSuccessfulAt,completed);assert.match(latest.notice,/conexão/i);
});
