import test from 'node:test';
import assert from 'node:assert/strict';
import {createDdaAutoReminder} from '../src/chat/dda-auto-reminder.js';
const row=(id,status='Em aberto',due='2026-10-28')=>({id:String(id),fields:{SITUACAO:status,VENCIMENTO:due,VALOR:10}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(options={}){
 let safe=true,time=Date.parse('2026-10-28T12:00:00Z'),rows=[row(1)],reads=0;const opened=[];
 const reminder=createDdaAutoReminder({loadSnapshot:async()=>{reads++;return {rows};},canOpen:()=>safe,open:async opts=>{opened.push(opts);return true;},now:()=>time,...options});
 return {reminder,opened,setSafe:v=>safe=v,setRows:v=>rows=v,advance:v=>time+=v,get reads(){return reads;}};
}
test('waits behind provisions, opens once, and repeats only after the reminder interval',async()=>{
 const h=setup();h.setSafe(false);await h.reminder.refresh();assert.equal(h.opened.length,0);
 h.setSafe(true);await h.reminder.drain();assert.equal(h.opened.length,1);assert.equal(h.opened[0].automatic,true);
 await h.reminder.drain();await h.reminder.refresh();assert.equal(h.opened.length,1);
 h.advance(30*60*1000);await h.reminder.refresh();assert.equal(h.opened.length,1);
 h.reminder.dismiss();await h.reminder.refresh();assert.equal(h.opened.length,2);
});
test('only confirmed unpaid overdue or today triggers, using Brasilia date',async()=>{
 for(const rows of [[row(1,'Pago')],[row(1,'Baixado')],[row(1,'Não confirmado')],[row(1,'Em aberto','2026-10-29')],[row(1,'Em aberto','invalid')]]){
  const h=setup();h.setRows(rows);await h.reminder.refresh();assert.equal(h.opened.length,0);
 }
 const h=setup({now:()=>Date.parse('2026-10-29T01:00:00Z')});h.setRows([row(2,'Agendado','2026-10-28')]);await h.reminder.refresh();assert.equal(h.opened.length,1);
});
test('late reads after reset, failures and malformed snapshots never open',async()=>{
 let resolve;const h=setup({loadSnapshot:()=>new Promise(r=>resolve=r)});const request=h.reminder.refresh();await tick();h.reminder.reset();resolve({rows:[row(1)]});await request;assert.equal(h.opened.length,0);
 for(const loadSnapshot of [async()=>{throw Error('private');},async()=>({rows:[row(1)],hasMore:true})]){const h=setup({loadSnapshot});await h.reminder.refresh();assert.equal(h.opened.length,0);}
});
test('coalesces reads and rechecks eligibility after a deferred reminder',async()=>{
 const h=setup();h.setSafe(false);await Promise.all([h.reminder.refresh(),h.reminder.refresh()]);assert.equal(h.reads,1);
 h.setRows([row(1,'Pago')]);h.setSafe(true);await h.reminder.drain();assert.equal(h.opened.length,0);
});
