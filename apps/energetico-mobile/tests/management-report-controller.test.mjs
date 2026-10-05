import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
function harness(options={}) {
  let sequence=0;const handlers=new Map(),calls=[];
  const view={render(){},on(type,handler){handlers.set(type,handler);return ()=>handlers.delete(type);},emit(type){return handlers.get(type)?.({type});},focusComposer(){},destroy(){}};
  const store=createConversationStore({randomUUID:()=>`gm-${++sequence}`});
  const auth={initialize:async()=>({homeAccountId:'gm-user',name:'Usuário'}),signIn:async()=>({homeAccountId:'gm-next',name:'Usuário novo'}),getToken:async()=> 'gm-token',signOut:async()=>{},...options.auth};
  const client={async sendText(payload){calls.push(payload);return {status:'processed',messages:[]};}};
  const native={importSharedItems:async()=>[]};
  const controller=createAppController({store,view,auth,client,native,pendingProvisionAttachmentsDataFactory:async()=>({loadUpcomingPayments:async()=>[]}),...options,auth});
  return {controller,view,auth,calls};
}
test('home management shortcut uses report9 with authenticated data, coalesces clicks and disposes on logout',async t=>{
  let opens=0,destroys=0,token,request;
  const h=harness({paymentLedgerDataFactory:async({tokenProvider})=>({async loadSnapshot(options){request=options;token=await tokenProvider(['Sites.Read.All']);return {launches:[],productTypes:[]};}}),managementReportFactory:async({data})=>({async open(){opens++;await data.loadSnapshot({reportNumber:9});},destroy(){destroys++;}})});
  t.after(()=>h.controller.stop());await h.controller.start();const before=h.calls.length;
  await Promise.all([h.view.emit('open-management-report'),h.view.emit('open-management-report')]);
  assert.equal(opens,1);assert.equal(request.reportNumber,9);assert.equal(token,'gm-token');assert.equal(h.calls.length,before);
  await h.view.emit('sign-out');assert.equal(destroys,1);
});
test('management factory response after stop is destroyed, never resurrects overlay',async t=>{
  let finish,opens=0,destroys=0;const h=harness({paymentLedgerDataFactory:async()=>({}),managementReportFactory:()=>new Promise(r=>finish=r)});
  t.after(()=>h.controller.stop());await h.controller.start();const pending=h.view.emit('open-management-report');await new Promise(r=>setImmediate(r));
  h.controller.stop();assert.equal(typeof finish,'function');finish({open(){opens++;},destroy(){destroys++;}});await pending;assert.equal(opens,0);assert.equal(destroys,1);
});

test('logout then login permits a new opening while old token acquisition stays pending',async t=>{
  let resolveOld,resolveNew,calls=0,opens=0;
  const h=harness({paymentLedgerDataFactory:async({tokenProvider})=>({loadSnapshot:()=>tokenProvider(['Sites.Read.All'])}),managementReportFactory:async({data})=>({async open(){opens++;await data.loadSnapshot();},destroy(){}})});
  t.after(()=>h.controller.stop());await h.controller.start();
  h.auth.getToken=()=>{calls++;return new Promise(r=>{if(calls===1)resolveOld=r;else resolveNew=r;});};
  const old=h.view.emit('open-management-report');await new Promise(r=>setImmediate(r));
  await h.view.emit('sign-out');await h.view.emit('sign-in');
  const fresh=h.view.emit('open-management-report');await new Promise(r=>setImmediate(r));
  assert.equal(opens,2,'new session must not join previous pending report');
  resolveOld('old-token');await old;
  const duplicate=h.view.emit('open-management-report');await new Promise(r=>setImmediate(r));
  assert.equal(opens,2,'old cleanup cannot erase the new in-progress opening');
  resolveNew('new-token');await Promise.all([fresh,duplicate]);
});
test('management report resumes after consent and suppresses stale authorization after logout',async t=>{
  let opens=0,resume;
  const resumed=harness({auth:{consumePendingAction:()=> 'action_management_report'},paymentLedgerDataFactory:async()=>({}),managementReportFactory:async()=>({open(){opens++;},destroy(){}})});
  t.after(()=>resumed.controller.stop());await resumed.controller.start();assert.equal(opens,1);
  let rejectToken,authorizations=0;
  const h=harness({paymentLedgerDataFactory:async({tokenProvider})=>({loadSnapshot:()=>tokenProvider(['Sites.Read.All'])}),managementReportFactory:async({data})=>({open:()=>data.loadSnapshot(),destroy(){}})});
  t.after(()=>h.controller.stop());await h.controller.start();
  h.auth.getToken=()=>new Promise((_,reject)=>rejectToken=reject);h.auth.authorize=async(_,{resumeAction})=>{resume=resumeAction;authorizations++;};
  const pending=h.view.emit('open-management-report');await new Promise(r=>setImmediate(r));await h.view.emit('sign-out');
  assert.equal(typeof rejectToken,'function');rejectToken(Object.assign(new Error('Expired'),{code:'AUTH_REQUIRED'}));await pending;assert.equal(authorizations,0);assert.equal(resume,undefined);
});
