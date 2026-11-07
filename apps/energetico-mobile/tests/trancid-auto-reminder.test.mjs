import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrancidAutoReminder} from '../src/chat/trancid-auto-reminder.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(options={}) {
 let safe=true,amount=3999,reads=0; const opened=[];
 const reminder=createTrancidAutoReminder({loadReport:async()=>{reads++;return {cards:[{card:'123',balanceCents:amount}]};},canOpen:()=>safe,
   open:async value=>{opened.push(value);return true;},...options});
 return {reminder,opened,setSafe:v=>safe=v,setAmount:v=>amount=v,get reads(){return reads;}};
}
test('strict R$40 threshold preserves real zero and ignores unavailable or malformed amounts',async()=>{
 for(const [value,expected] of [[3999,1],[4000,0],[4001,0],[0,1],[null,0],[undefined,0],[NaN,0],['5,50',0]]) {
  const h=harness();h.setAmount(value);await h.reminder.refresh();assert.equal(h.opened.length,expected,String(value));
 }
});
test('counts only a successful opening and checks again on the next day',async()=>{
 let day='2026-11-07',allowOpening=false;
 const h=harness({today:()=>day,open:async value=>{if(!allowOpening)return false;h.opened.push(value);return true;}});
 await h.reminder.refresh();assert.equal(h.opened.length,0);
 allowOpening=true;
 await h.reminder.foreground();assert.equal(h.opened.length,1);
 h.reminder.dismiss();await h.reminder.refresh();await h.reminder.drain();assert.equal(h.opened.length,1);
 await h.reminder.foreground();assert.equal(h.opened.length,1);
 day='2026-11-08';
 await h.reminder.foreground();assert.equal(h.opened.length,2);
});
test('deferred alert rechecks current source before display and never replaces another dialog',async()=>{
 const h=harness();h.setSafe(false);await h.reminder.refresh();assert.equal(h.opened.length,0);assert.equal(h.reminder.pending,true);
 h.setAmount(5000);h.setSafe(true);await h.reminder.drain();assert.equal(h.opened.length,0);assert.equal(h.reminder.pending,false);
});
test('tabs sharing storage serialize automatic opening for the same account',async t=>{
 const values=new Map(),locks=new Map();
 const storageDescriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 const navigatorDescriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,
  value:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{
  request(key,options,callback){
   const task=(locks.get(key)??Promise.resolve()).then(()=>callback());
   locks.set(key,task.catch(()=>{}));
   return task;
  },
 }}});
 t.after(()=>{
  if(storageDescriptor)Object.defineProperty(globalThis,'localStorage',storageDescriptor);else delete globalThis.localStorage;
  if(navigatorDescriptor)Object.defineProperty(globalThis,'navigator',navigatorDescriptor);else delete globalThis.navigator;
 });
 const options={accountKey:()=> 'shared-account',today:()=> '2026-11-07'};
 const first=harness(options),second=harness(options);
 await Promise.all([first.reminder.refresh(),second.reminder.refresh()]);
 assert.equal(first.opened.length+second.opened.length,1);
});
test('coalesces reads and prevents late old-account data or a failure from opening',async()=>{
 let resolve;const h=harness({loadReport:()=>new Promise(r=>resolve=r)});
 const one=h.reminder.refresh(),two=h.reminder.refresh();await tick();h.reminder.reset();resolve({cards:[{balanceCents:1}]});await Promise.all([one,two]);assert.equal(h.opened.length,0);
 const bad=harness({loadReport:async()=>{throw Error('source unavailable');}});await bad.reminder.refresh();assert.equal(bad.opened.length,0);assert.equal(bad.reminder.pending,false);
});
test('manual opening handles the current foreground and cancels any automatic request',async()=>{
 let resolve;const h=harness({loadReport:()=>new Promise(r=>resolve=r)});const request=h.reminder.refresh();await tick();
 h.reminder.handled();resolve({cards:[{balanceCents:1}]});await request;h.reminder.dismiss();await h.reminder.drain();assert.equal(h.opened.length,0);
});
