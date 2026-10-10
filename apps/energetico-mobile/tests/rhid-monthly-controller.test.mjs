import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppController} from '../src/app-controller.js';
import {createConversationStore} from '../src/chat/conversation-store.js';
import {PDFDocument,PDFSignature} from 'pdf-lib';
import {buildRhidMonthlyReport} from '../src/chat/rhid-monthly-model.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(t,extra={}){
 const handlers=new Map(),panels=[],calls=[];let n=0;
 const view={render(){},on(type,fn){handlers.set(type,fn);return()=>handlers.delete(type);},emit(type,value={}){return handlers.get(type)?.({type,...value});},destroy(){},focusComposer(){}};
 const account={homeAccountId:'monthly-user',name:'Tester'},auth={initialize:async()=>account,signIn:async()=>account,signOut:async()=>{},getToken:async scopes=>{assert.deepEqual(scopes,['Sites.Read.All']);return 'token';}};
 const store=createConversationStore({randomUUID:()=>`monthly-${++n}`});
 const client={sendText:async payload=>{calls.push(payload);return {status:'processed',messages:[]};},getRhidAttendanceMonth:async month=>({month,rows:[],presentDates:[]})};
 const controller=createAppController({view,store,auth,client,native:{importSharedItems:async()=>[]},pendingProvisionAttachmentsDataFactory:async()=>({loadUpcomingPayments:async()=>[]}),rhidMonthlyDataFactory:async()=>({loadSuppliers:async()=>[{id:'1',name:'TESTER'}]}),rhidMonthlyFactory:async({data,onClose,onReport})=>{
  const panel={data,onClose,onReport,opens:[],destroyed:0,open(options){this.opens.push(options);},destroy(){this.destroyed++;}};panels.push(panel);return panel;
 },...extra});t.after(()=>controller.stop());return {controller,view,store,auth,client,panels,calls};
}
test('monthly controller opens a read-only local report using the selected calendar month',async t=>{
 const h=setup(t,{rhidMonthlyDataFactory:async({tokenProvider})=>({loadSuppliers:async()=>{await tokenProvider(['Sites.Read.All']);return [{id:'1',name:'TESTER'}];}})});
 await h.controller.start();const before=h.calls.length;
 assert.equal(await h.view.emit('open-rhid-monthly-report',{value:'2026-09'}),true);
 const panel=h.panels[0];assert.deepEqual(panel.opens,[{month:'2026-09'}]);assert.deepEqual(await panel.data.loadSuppliers(),[{id:'1',name:'TESTER'}]);
 assert.deepEqual(await panel.data.loadMonth('2026-09'),{month:'2026-09',rows:[],presentDates:[]});assert.equal(h.calls.length,before);assert.equal(h.store.getState().activeFlow,null);
});
test('monthly report supplies a PDF opener invalidated by closing the panel',async t=>{
 const h=setup(t);await h.controller.start();await h.view.emit('open-rhid-monthly-report');
 const panel=h.panels[0];assert.equal(typeof panel.onReport,'function');panel.onClose();
 await assert.rejects(panel.onReport({}, {signal:new AbortController().signal}),{name:'AbortError'});
});
test('monthly controller opens the actual unsigned PDF without posting documents or changing the flow',async t=>{
 const previews=[];const h=setup(t,{native:{importSharedItems:async()=>[],previewMedia:async(blob,name,options)=>previews.push({blob:await blob,name,options})}});
 await h.controller.start();await h.view.emit('open-rhid-monthly-report');const before=h.calls.length;
 const report=buildRhidMonthlyReport({month:'2026-10',supplier:{id:'1',name:'FUNCIONÁRIO EXEMPLO'},snapshot:{month:'2026-10',rows:[],presentDates:[]}});
 const resolveReturnFocus=()=> 'report-control';
 await h.panels[0].onReport(report,{signal:new AbortController().signal,resolveReturnFocus});
 assert.equal(previews.length,1);assert.equal(previews[0].blob.type,'application/pdf');assert.equal(previews[0].options.layout,'report-pdf');
 assert.equal(previews[0].name,'presencas-rhid-2026-10-fornecedor-1.pdf');
 assert.equal(previews[0].options.resolveReturnFocus,resolveReturnFocus);
 const pdf=await PDFDocument.load(await previews[0].blob.arrayBuffer());assert.equal(pdf.getForm().getFields().filter(f=>f instanceof PDFSignature).length,2);
 assert.equal(h.calls.length,before);assert.equal(h.store.getState().activeFlow,null);
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
test('controller monthly transport receives the per-query cancellation signal',async t=>{
 let signal,resolve;const pending=new Promise(r=>resolve=r);
 const h=setup(t,{client:{sendText:async()=>({status:'processed',messages:[]}),getRhidAttendanceMonth:async(month,options)=>{signal=options?.signal;await pending;return {month,presentDates:[],rows:[]};}}});
 await h.controller.start();await h.view.emit('open-rhid-monthly-report');const request=h.panels[0].data.loadMonth('2026-10');const rejected=assert.rejects(request,{name:'AbortError'});await tick();assert.ok(signal);h.panels[0].onClose();await rejected;assert.equal(signal.aborted,true);resolve();
});
