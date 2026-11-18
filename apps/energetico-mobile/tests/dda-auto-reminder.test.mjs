import test from 'node:test';
import assert from 'node:assert/strict';
import {createDdaAutoReminder} from '../src/chat/dda-auto-reminder.js';
const row=(id,status='Em aberto',due='2026-10-28')=>({id:String(id),fields:{SITUACAO:status,VENCIMENTO:due,VALOR:10}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(options={}){
 let safe=true,time=Date.parse('2026-10-28T12:00:00Z'),rows=[row(1)],reads=0;const opened=[];
 const {loadSnapshot=async()=>{reads++;return {rows};},loadSettledDdaIds,...rest}=options;
 const reminder=createDdaAutoReminder({loadData:async input=>({snapshot:await loadSnapshot(input),provisionLink:{loadSettledDdaIds}}),canOpen:()=>safe,open:async opts=>{opened.push(opts);return true;},now:()=>time,...rest});
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

test('a pending paid DDA repeats at each check from 15h Brasília, even within the morning interval',async()=>{
 const paid=row(2,'Pago','2026-11-02');
 paid.fields.DESCRITIVOPROVIS_x00c3_O='56';
 let time=Date.parse('2026-10-28T17:59:00Z'),settled=false;
 const h=setup({
  now:()=>time,
  loadSnapshot:async()=>({rows:[paid]}),
  loadSettledDdaIds:async rows=>{assert.deepEqual(rows.map(row=>[row.id,row.provisionId,row.due]),[['2','56','2026-11-02']]);return new Set(settled?['2']:[]);},
 });
 assert.equal(await h.reminder.refresh(),true);
 h.reminder.dismiss();
 assert.equal(await h.reminder.refresh(),false);
 time+=60_000;
 assert.equal(await h.reminder.refresh(),true);
 assert.equal(await h.reminder.refresh(),false);
 h.reminder.dismiss();
 assert.equal(await h.reminder.refresh(),true);
 h.reminder.dismiss();
 settled=true;
 assert.equal(await h.reminder.refresh(),false);
 assert.equal(h.opened.length,3);
});

test('reviewed unlinked DDAs never trigger automatically, including overdue and scheduled payments',async()=>{
 for(const [status,due,lifecycle] of [
  ['Em aberto','2026-11-18',''],
  ['Em aberto','2026-11-17',''],
  ['Agendado','2026-11-18',''],
  ['Pago','2026-11-18','PAGO_AGENDADO'],
 ]){
  const unlinked=row(49,status,due);
  Object.assign(unlinked.fields,{DDA_x0020_sem_x0020_vincula_x00e:true,DDA_CICLO_AGENDAMENTO:lifecycle});
  const h=setup({now:()=>Date.parse('2026-11-18T19:18:00Z')});
  h.setRows([unlinked,row(50,'Em aberto','2026-11-19')]);
  for(let i=0;i<3;i++){
   assert.equal(await h.reminder.refresh(),false);
   assert.equal(h.reminder.pending,false);
   h.reminder.dismiss();
  }
  h.reminder.reset();
  assert.equal(await h.reminder.refresh(),false);
  assert.deepEqual(h.opened,[]);
 }
});

test('regularizing a deferred unlinked DDA cancels its queued automatic report',async()=>{
 const h=setup({now:()=>Date.parse('2026-11-18T19:18:00Z')});
 const unlinked=row(49,'Em aberto','2026-11-18');
 h.setRows([unlinked]);h.setSafe(false);
 await h.reminder.refresh();assert.equal(h.reminder.pending,true);
 h.setRows([{...unlinked,fields:{...unlinked.fields,DDA_x0020_sem_x0020_vincula_x00e:true}}]);
 h.setSafe(true);
 assert.equal(await h.reminder.drain(),false);
 assert.equal(h.reminder.pending,false);
 assert.deepEqual(h.opened,[]);
});

test('linked and unreviewed DDAs still trigger even alongside reviewed unlinked titles',async()=>{
 const unlinked=row(49,'Em aberto','2026-11-18');
 unlinked.fields.DDA_x0020_sem_x0020_vincula_x00e=true;
 for(const fields of [{},{DESCRITIVOPROVIS_x00c3_O:'56',DDA_x0020_sem_x0020_vincula_x00e:true}]){
  const payable=row(51,'Em aberto','2026-11-18');Object.assign(payable.fields,fields);
  const h=setup({now:()=>Date.parse('2026-11-18T19:18:00Z')});h.setRows([unlinked,payable]);
  assert.equal(await h.reminder.refresh(),true);
  assert.deepEqual(h.opened[0].initialSnapshot.rows.map(row=>row.id),['49','51']);
 }
});

test('a newer visit replaces a stale settlement check without opening the old snapshot',async()=>{
 const paid=row(2,'Pago');
 paid.fields.DESCRITIVOPROVIS_x00c3_O='56';
 let interaction=0,rejectOld,oldSignal;
 const h=setup({
  interaction:()=>interaction,
  loadSnapshot:async()=>({rows:[paid]}),
  loadSettledDdaIds:async (rows,{signal})=>{
   if(interaction)return new Set(rows.map(row=>row.id));
   oldSignal=signal;
   return new Promise((_,reject)=>{rejectOld=reject;});
  },
 });
 const stale=h.reminder.refresh();await tick();
 interaction++;
 assert.equal(await h.reminder.refresh(),false);
 assert.equal(oldSignal.aborted,true);
 rejectOld(new Error('DDA_SESSION_ENDED'));
 assert.equal(await stale,false);
 assert.deepEqual(h.opened,[]);
});
