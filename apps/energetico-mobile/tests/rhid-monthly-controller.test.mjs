import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppController} from '../src/app-controller.js';
import {createConversationStore} from '../src/chat/conversation-store.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(t,extra={}){
 const handlers=new Map(),panels=[],calls=[];let n=0;
 const view={render(){},on(type,fn){handlers.set(type,fn);return()=>handlers.delete(type);},emit(type,value={}){return handlers.get(type)?.({type,...value});},destroy(){},focusComposer(){}};
 const account={homeAccountId:'monthly-user',name:'Tester'},auth={initialize:async()=>account,signIn:async()=>account,signOut:async()=>{},getToken:async scopes=>{assert.deepEqual(scopes,['Sites.Read.All']);return 'token';}};
 const store=createConversationStore({randomUUID:()=>`monthly-${++n}`});
 const client={sendText:async payload=>{calls.push(payload);return {status:'processed',messages:[]};},getRhidAttendanceMonth:async month=>({month,rows:[],presentDates:[]})};
 const controller=createAppController({view,store,auth,client,native:{importSharedItems:async()=>[]},pendingProvisionAttachmentsDataFactory:async()=>({loadUpcomingPayments:async()=>[]}),rhidMonthlyDataFactory:async()=>({loadSuppliers:async()=>[{id:'1',name:'TESTER'}]}),rhidMonthlyFactory:async({data,onClose})=>{
  const panel={data,onClose,opens:[],destroyed:0,open(options){this.opens.push(options);},destroy(){this.destroyed++;}};panels.push(panel);return panel;
 },...extra});t.after(()=>controller.stop());return {controller,view,store,auth,client,panels,calls};
}
test('monthly controller opens a read-only local report using the selected calendar month',async t=>{
 const h=setup(t,{rhidMonthlyDataFactory:async({tokenProvider})=>({loadSuppliers:async()=>{await tokenProvider(['Sites.Read.All']);return [{id:'1',name:'TESTER'}];}})});
 await h.controller.start();const before=h.calls.length;
 assert.equal(await h.view.emit('open-rhid-monthly-report',{value:'2026-09'}),true);
 const panel=h.panels[0];assert.deepEqual(panel.opens,[{month:'2026-09'}]);assert.deepEqual(await panel.data.loadSuppliers(),[{id:'1',name:'TESTER'}]);
 assert.deepEqual(await panel.data.loadMonth('2026-09'),{month:'2026-09',rows:[],presentDates:[]});assert.equal(h.calls.length,before);assert.equal(h.store.getState().activeFlow,null);
});
test('monthly controller cancels pending data on sign-out, and cannot borrow new credentials',async t=>{
 let resolve;const pending=new Promise(r=>resolve=r);
 const h=setup(t,{rhidMonthlyDataFactory:async()=>({loadSuppliers:()=>pending})});await h.controller.start();await h.view.emit('open-rhid-monthly-report');
 const data=h.panels[0].data,request=data.loadSuppliers(),rejected=assert.rejects(request,{name:'AbortError'});await tick();await h.view.emit('sign-out');await rejected;
 resolve([{id:'1',name:'TESTER'}]);assert.equal(h.panels[0].destroyed,1);await assert.rejects(data.loadMonth('2026-09'),{name:'AbortError'});
});
test('monthly panel from a late factory is discarded after controller stop',async t=>{
 let resolve;const pending=new Promise(r=>resolve=r);const h=setup(t,{rhidMonthlyFactory:()=>pending});await h.controller.start();
 const opening=h.view.emit('open-rhid-monthly-report');await tick();h.controller.stop();let opens=0,destroys=0;resolve({open(){opens++;},destroy(){destroys++;}});
 assert.equal(await opening,false);await tick();assert.equal(opens,0);assert.equal(destroys,1);
});
test('closing monthly report invalidates its data source',async t=>{
 const h=setup(t);await h.controller.start();await h.view.emit('open-rhid-monthly-report');const panel=h.panels[0];panel.onClose();await assert.rejects(panel.data.loadMonth('2026-09'),{name:'AbortError'});assert.equal(panel.destroyed,1);
});
