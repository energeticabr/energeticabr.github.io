import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppController} from '../src/app-controller.js';
import {createConversationStore} from '../src/chat/conversation-store.js';
import {createAuthService} from '../src/auth/auth-service.js';
const tick=()=>new Promise(r=>setImmediate(r));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function harness(t,options={}){
 const handlers=new Map(),panels=[],calls=[];let seq=0;const account={homeAccountId:'payroll-user'};
 const view={render(){},on(type,handler){handlers.set(type,handler);return ()=>handlers.delete(type);},emit(type,value={}){return handlers.get(type)?.({type,...value});},focusComposer(){},destroy(){}};
 const auth={initialize:async()=>account,signIn:async()=>account,signOut:async()=>{},getToken:async()=> 'token',...options.auth};
 const store=createConversationStore({randomUUID:()=>`payroll-${++seq}`});
 const controller=createAppController({store,view,auth,client:{sendText:async payload=>{calls.push(payload);return {status:'processed',messages:[]};}},native:{importSharedItems:async()=>[]},pendingProvisionAttachmentsDataFactory:async()=>({loadUpcomingPayments:async()=>[]}),supplierPayrollReportFactory:async({data,onClose})=>{const panel={data,opens:0,destroys:0,open(){this.opens++;},close(){onClose();},destroy(){this.destroys++;}};panels.push(panel);return panel;},supplierPayrollReportDataFactory:async()=>({loadSnapshot:async()=>({complete:true,sheets:[]}),loadPaymentsForPayrollIds:async ids=>ids}),...options,auth});
 t.after(()=>controller.stop());return {controller,view,store,auth,panels,calls};
}
test('payroll HOME and reply use one cached read-only service for independent parallel suppliers',async t=>{
 let creates=0;const requests=[];const h=harness(t,{supplierPayrollReportDataFactory:async({tokenProvider})=>{creates++;return {loadSnapshot:()=>tokenProvider(['Sites.ReadWrite.All']),loadPaymentsForPayrollIds:async(ids,{signal})=>{requests.push(signal);await tick();return ids;}};},auth:{getToken:async scopes=>{assert.deepEqual(scopes,['Sites.Read.All']);return 'read';}}});
 await h.controller.start();const before=h.calls.length;assert.deepEqual(await Promise.all([h.view.emit('open-supplier-payroll-report'),h.view.emit('select-reply',{replyId:'action_supplier_payroll_report'})]),[true,true]);
 assert.equal(h.panels.length,1);const data=h.panels[0].data;assert.equal(await data.loadSnapshot(),'read');assert.deepEqual(await Promise.all([data.loadPaymentsForPayrollIds(['8']),data.loadPaymentsForPayrollIds(['9'])]),[['8'],['9']]);assert.ok(requests.every(s=>!s.aborted));assert.equal(creates,1);assert.equal(h.calls.length,before);
});
for(const end of ['sign-out','stop','account-change','active-flow','busy','close'])test(`payroll cancels outstanding data on ${end}`,async t=>{
 const pending=deferred();let signal;const h=harness(t,{supplierPayrollReportDataFactory:async()=>({loadSnapshot:({signal:s})=>{signal=s;return pending.promise;},loadPaymentsForPayrollIds:async()=>[]})});await h.controller.start();assert.equal(await h.view.emit('open-supplier-payroll-report'),true);const data=h.panels[0].data;
 const task=data.loadSnapshot(),rejected=assert.rejects(task,{name:'AbortError'});await tick();
 if(end==='stop')h.controller.stop();else if(end==='account-change')await h.view.emit('sign-in');else if(end==='active-flow')h.store.restoreSnapshot({messages:[],activeFlow:{id:'flow'}});else if(end==='busy')h.store.beginText('busy');else if(end==='close')h.panels[0].close();else await h.view.emit('sign-out');
 await rejected;assert.equal(signal.aborted,true);assert.equal(h.panels[0].destroys,1);pending.resolve({complete:true,sheets:[]});await assert.rejects(data.loadSnapshot(),{name:'AbortError'});
});
test('caller cancellation of one supplier does not abort another',async t=>{
 const pending=deferred();const signals=[];const h=harness(t,{supplierPayrollReportDataFactory:async()=>({loadSnapshot:async()=>({complete:true,sheets:[]}),loadPaymentsForPayrollIds:(ids,{signal})=>{signals.push(signal);return ids[0]==='8'?pending.promise:Promise.resolve(ids);}})});await h.controller.start();await h.view.emit('open-supplier-payroll-report');const data=h.panels[0].data,caller=new AbortController();
 const task=data.loadPaymentsForPayrollIds(['8'],{signal:caller.signal}),rejected=assert.rejects(task,{name:'AbortError'});await tick();assert.deepEqual(await data.loadPaymentsForPayrollIds(['9']),['9']);caller.abort();await rejected;assert.equal(signals[0].aborted,true);assert.equal(signals[1].aborted,false);pending.resolve([]);
});
test('read consent uses its own resume id and pending redirect opens locally',async t=>{
 let calls=0;const h=harness(t,{auth:{consumePendingAction:()=> 'action_supplier_payroll_report',getToken:async()=>{if(!calls++)throw Object.assign(Error('expired'),{code:'AUTH_REQUIRED'});return 'fresh';},authorize:async(scopes,opts)=>{assert.deepEqual(scopes,['Sites.Read.All']);assert.equal(opts.resumeAction,'action_supplier_payroll_report');}},supplierPayrollReportDataFactory:async({tokenProvider})=>({loadSnapshot:()=>tokenProvider(),loadPaymentsForPayrollIds:async()=>[]})});
 await h.controller.start();assert.equal(h.panels.length,1);assert.equal(await h.panels[0].data.loadSnapshot(),'fresh');
});
test('factory resolved after logout cannot open stale panel',async t=>{
 const pending=deferred();let opens=0,destroys=0;const h=harness(t,{supplierPayrollReportFactory:()=>pending.promise});await h.controller.start();const task=h.view.emit('open-supplier-payroll-report');await tick();await h.view.emit('sign-out');pending.resolve({open(){opens++;},destroy(){destroys++;}});assert.equal(await task,false);await tick();assert.equal(opens,0);assert.equal(destroys,1);
});
test('cancelled token request cannot authorize after a new supplier query starts',async t=>{
 const oldToken=deferred(),fresh=deferred();let tokens=0,grants=0;
 const h=harness(t,{supplierPayrollReportDataFactory:async({tokenProvider})=>({loadSnapshot:async()=>({complete:true,sheets:[]}),loadPaymentsForPayrollIds:(ids,{signal})=>ids[0]==='8'?tokenProvider([], {signal}):fresh.promise}),auth:{getToken:()=>{tokens++;return oldToken.promise;},authorize:async()=>{grants++;}}});
 await h.controller.start();await h.view.emit('open-supplier-payroll-report');const data=h.panels[0].data,caller=new AbortController();const old=data.loadPaymentsForPayrollIds(['8'],{signal:caller.signal}),rejected=assert.rejects(old,{name:'AbortError'});await tick();caller.abort();await rejected;
 const next=data.loadPaymentsForPayrollIds(['9']);await tick();oldToken.reject(Object.assign(Error('expired'),{code:'AUTH_REQUIRED'}));await tick();assert.equal(grants,0);assert.equal(tokens,1);fresh.resolve([]);await next;
});

for(const moment of ['before','after'])test(`payroll rejects auth account drift ${moment} token acquisition`,async t=>{
 const other={homeAccountId:'other'},original={homeAccountId:'payroll-user'};let current=moment==='before'?other:original,calls=0;
 const h=harness(t,{auth:{getAccount:()=>current,getToken:async()=>{calls++;current=other;return 'token-for-other';}},supplierPayrollReportDataFactory:async({tokenProvider})=>({loadSnapshot:()=>tokenProvider(),loadPaymentsForPayrollIds:async()=>[]})});
 await h.controller.start();await h.view.emit('open-supplier-payroll-report');
 if(moment==='before'){assert.equal(h.panels.length,0);assert.equal(calls,0);}
 else {await assert.rejects(h.panels[0].data.loadSnapshot(),{name:'AbortError'});assert.equal(calls,1);}
});

test('real native late consent cannot replace the new report account or deliver its old token',async t=>{
 const first={homeAccountId:'first',username:'a@energeticabr.com'},second={homeAccountId:'second',username:'b@energeticabr.com'},consent=deferred();let tokenCalls=0;
 const auth=createAuthService({initialize:async()=>({account:first}),signIn:options=>options.authorizationMode==='incremental'?consent.promise:Promise.resolve({account:second}),signOut:async()=>{},getToken:async({homeAccountId})=>{if(!tokenCalls++)throw {code:'AUTH_REQUIRED'};return {accessToken:`token-for-${homeAccountId}`};}},{clientId:'test',tenantId:'test',bundleId:'test',scopes:['User.Read']});
 const h=harness(t,{auth,supplierPayrollReportDataFactory:async({tokenProvider})=>({loadSnapshot:()=>tokenProvider(),loadPaymentsForPayrollIds:async()=>[]})});
 await h.controller.start();await h.view.emit('open-supplier-payroll-report');const old=h.panels[0].data.loadSnapshot(),rejected=assert.rejects(old,{name:'AbortError'});await tick();
 await h.view.emit('sign-out');await rejected;await h.view.emit('sign-in');consent.resolve({account:first});await tick();
 assert.equal(auth.getAccount().homeAccountId,'second');await h.view.emit('open-supplier-payroll-report');assert.equal(await h.panels.at(-1).data.loadSnapshot(),'token-for-second');
});
for(const guard of ['signed-out','active-flow','busy'])test(`payroll does not open during ${guard}`,async t=>{
 const h=harness(t,guard==='signed-out'?{auth:{initialize:async()=>null}}:{});await h.controller.start();if(guard==='active-flow')h.store.restoreSnapshot({messages:[],activeFlow:{id:'flow'}});if(guard==='busy')h.store.beginText('busy');const before=h.calls.length;
 assert.equal(await h.view.emit('open-supplier-payroll-report'),false);assert.equal(await h.view.emit('select-reply',{replyId:'action_supplier_payroll_report'}),false);assert.equal(h.panels.length,0);assert.equal(h.calls.length,before);
});
