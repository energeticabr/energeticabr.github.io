import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createChatView,renderChatMarkup} from '../src/ui/chat-view.js';
import {getReportNeighbors} from '../src/ui/report-navigation.js';
import {REPORT_PDF_TITLES} from '../src/ui/report-print.js';
import {createAppController} from '../src/app-controller.js';
import {createConversationStore} from '../src/chat/conversation-store.js';
import {createBrowserAuth} from '../src/web/browser-auth.js';

const home={sessionStatus:'authenticated',account:{name:'Bernardo'},pendingFiles:[],draft:'',messages:[{id:'home',role:'assistant',type:'poll',question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',options:[{id:'group_pending',label:'PENDÊNCIAS'},{id:'group_supplies',label:'SUPRIMENTOS'}]}]};
const action='open-supplier-workforce-report',reply='home-supplier-workforce-report';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function harness(t,options={}) {
 const handlers=new Map(),panels=[],calls=[];
 const account={homeAccountId:'diary-user'};
 const view={render(){},on(type,handler){handlers.set(type,handler);return ()=>handlers.delete(type);},emit(type,value={}){return handlers.get(type)?.({type,...value});},focusComposer(){},destroy(){}};
 const auth={initialize:async()=>account,signIn:async()=>account,signOut:async()=>{},getToken:async()=> 'token',...options.auth};
 const store=createConversationStore();
 const controller=createAppController({store,view,auth,client:{sendText:async payload=>{calls.push(payload);return {status:'processed',messages:[]};}},native:{importSharedItems:async()=>[]},pendingProvisionAttachmentsDataFactory:async()=>({loadUpcomingPayments:async()=>[]}),supplierWorkforceReportViewFactory:async({data,onClose})=>{const panel={data,opens:0,destroys:0,open(){this.opens++;},close(){onClose?.();},destroy(){this.destroys++;}};panels.push(panel);return panel;},supplierWorkforceReportDataFactory:async()=>({loadSnapshot:async()=>({rows:[],count:0})}),...options,auth});
 t.after(()=>controller.stop());return {controller,view,store,auth,panels,calls};
}
test('fifth right workforce mascot follows payroll, before orange, and dispatches its own local report',t=>{
 const dom=new JSDOM('<main id="app"></main>');dom.window.HTMLCanvasElement.prototype.getContext=()=>null;
 const view=createChatView(dom.window.document.querySelector('#app'));t.after(()=>{view.destroy();dom.window.close();});
 let opened=0;view.on(action,()=>opened++);view.render(home);
 const mascot=dom.window.document.querySelector(`[data-action="${action}"]`);assert.ok(mascot);
 assert.equal(mascot.previousElementSibling.dataset.action,'open-supplier-payroll-report');assert.equal(mascot.nextElementSibling.dataset.action,'open-pending-supplier-payments-report');
 assert.equal(mascot.closest('.chat-bubble'),null);assert.match(mascot.querySelector('img').src,/supplier-workforce\.png$/);
 mascot.querySelector('img').click();assert.equal(opened,1);
 view.render({...home,activeText:{id:'busy'}});const busy=dom.window.document.querySelector(`[data-action="${action}"]`);assert.equal(busy.disabled,true);busy.click();assert.equal(opened,1);
 assert.doesNotMatch(renderChatMarkup({...home,activeFlow:'busy'}),/data-action="open-supplier-workforce-report"/);
});
test('last pink has only previous to payroll and payroll gains next, without reaching orange',()=>{
 assert.deepEqual(getReportNeighbors(action),{previous:'open-supplier-payroll-report',next:'open-pending-supplier-payments-report'});
 assert.deepEqual(getReportNeighbors('open-supplier-payroll-report'),{previous:'open-stage-progress',next:action});
 assert.equal(getReportNeighbors('open-commercial-receipts').previous,null);
 assert.equal(REPORT_PDF_TITLES[action],'Fornecedores por filial, imóvel e profissão');
});
test('right rail keeps pink fill and an even gap before the shifted orange mascots',t=>{
 const dom=new JSDOM(renderChatMarkup(home));t.after(()=>dom.window.close());const css=dom.window.document.createElement('style');css.textContent=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');dom.window.document.head.append(css);
 const actions=['open-cargos-table','open-attendance-summary','open-stage-progress','open-supplier-payroll-report',action,'open-pending-supplier-payments-report','open-commercial-receipts','open-commercial-milestones','open-commercial-documents','open-sac-pathologies'];
 let previousBottom=0;for(const name of actions){const node=dom.window.document.querySelector(`[data-action="${name}"]`),style=dom.window.getComputedStyle(node);const top=parseFloat(style.marginTop),height=parseFloat(style.height);assert.ok(top>=previousBottom+4,name);previousBottom=top+height;}
 const style=dom.window.getComputedStyle(dom.window.document.querySelector(`[data-action="${action}"]`));assert.equal(style.backgroundColor,'rgb(207, 117, 122)');assert.equal(style.gridColumn,'3');
});
test('HOME/reply double tap opens once and never sends a business command',async t=>{
 const pending=deferred();const h=harness(t,{supplierWorkforceReportViewFactory:()=>pending.promise});await h.controller.start();const before=h.calls.length;
 const first=h.view.emit(action),second=h.view.emit('select-reply',{replyId:reply});await tick();let opens=0;pending.resolve({open(){opens++;},destroy(){}});
 assert.deepEqual(await Promise.all([first,second]),[true,true]);assert.equal(opens,1);assert.equal(h.calls.length,before);
});
test('report requests only read scopes even when source asks for write, with separate consent resume id',async t=>{
 let tokens=0;const grants=[];const h=harness(t,{auth:{getToken:async scopes=>{assert.deepEqual(scopes,['Sites.Read.All']);if(!tokens++)throw Object.assign(Error('consent'),{code:'AUTH_REQUIRED'});return 'read-token';},authorize:async(scopes,options)=>grants.push({scopes,options})},supplierWorkforceReportDataFactory:async({tokenProvider})=>({loadSnapshot:()=>tokenProvider(['Sites.ReadWrite.All'])})});
 await h.controller.start();assert.equal(await h.view.emit(action),true);assert.equal(await h.panels[0].data.loadSnapshot(),'read-token');assert.deepEqual(grants,[{scopes:['Sites.Read.All'],options:{resumeAction:reply}}]);
});
for(const end of ['sign-out','stop','account-change','active-flow','busy','close'])test(`supplier workforce data is cancelled on ${end}`,async t=>{
 const pending=deferred();let signal;const h=harness(t,{supplierWorkforceReportDataFactory:async()=>({loadSnapshot:({signal:s})=>{signal=s;return pending.promise;}})});
 await h.controller.start();await h.view.emit(action);assert.equal(h.panels.length,1);const data=h.panels[0].data,task=data.loadSnapshot(),rejected=assert.rejects(task,{name:'AbortError'});await tick();
 if(end==='stop')h.controller.stop();else if(end==='account-change')await h.view.emit('sign-in');else if(end==='active-flow')h.store.restoreSnapshot({messages:[],activeFlow:{id:'flow'}});else if(end==='busy')h.store.beginText('busy');else if(end==='close')h.panels[0].close();else await h.view.emit('sign-out');
 await rejected;assert.equal(signal.aborted,true);assert.equal(h.panels[0].destroys,1);pending.resolve({rows:[],count:0});await assert.rejects(data.loadSnapshot(),{name:'AbortError'});
});
test('late factory after logout cannot open stale supplier workforce',async t=>{
 const pending=deferred();let opens=0,destroys=0;const h=harness(t,{supplierWorkforceReportViewFactory:()=>pending.promise});await h.controller.start();const request=h.view.emit(action);await tick();await h.view.emit('sign-out');pending.resolve({open(){opens++;},destroy(){destroys++;}});assert.equal(await request,false);await tick();assert.equal(opens,0);assert.equal(destroys,1);
});
test('pending redirect resumes report locally without posting workflow commands',async t=>{
 const h=harness(t,{auth:{consumePendingAction:()=>reply}});await h.controller.start();assert.equal(h.panels.length,1);assert.equal(h.panels[0].opens,1);
});
for(const guard of ['signed-out','active-flow','busy'])test(`supplier workforce report cannot open during ${guard}`,async t=>{
 const h=harness(t,guard==='signed-out'?{auth:{initialize:async()=>null}}:{});await h.controller.start();if(guard==='active-flow')h.store.restoreSnapshot({messages:[],activeFlow:{id:'flow'}});if(guard==='busy')h.store.beginText('busy');
 assert.equal(await h.view.emit(action),false);assert.equal(await h.view.emit('select-reply',{replyId:reply}),false);assert.equal(h.panels.length,0);
});
for(const moment of ['before','after'])test(`report rejects auth account drift ${moment} token acquisition`,async t=>{
 const original={homeAccountId:'diary-user'},other={homeAccountId:'other'};let current=moment==='before'?other:original,calls=0;
 const h=harness(t,{auth:{getAccount:()=>current,getToken:async()=>{calls++;current=other;return 'wrong-account-token';}},supplierWorkforceReportDataFactory:async({tokenProvider})=>({loadSnapshot:()=>tokenProvider()})});await h.controller.start();await h.view.emit(action);
 if(moment==='before'){assert.equal(h.panels.length,0);assert.equal(calls,0);}else{await assert.rejects(h.panels[0].data.loadSnapshot(),{name:'AbortError'});assert.equal(calls,1);}
});
test('refresh cancels the old token query so a late consent error cannot prompt',async t=>{
 const token=deferred();let tokens=0,grants=0;const h=harness(t,{auth:{getToken:()=>++tokens===1?token.promise:Promise.resolve('fresh'),authorize:async()=>{grants++;}},supplierWorkforceReportDataFactory:async({tokenProvider})=>({loadSnapshot:()=>tokenProvider()})});await h.controller.start();await h.view.emit(action);const data=h.panels[0].data,old=data.loadSnapshot(),rejected=assert.rejects(old,{name:'AbortError'});await tick();assert.equal(await data.loadSnapshot(),'fresh');await rejected;token.reject(Object.assign(Error('old consent'),{code:'AUTH_REQUIRED'}));await tick();assert.equal(grants,0);
});
test('new pink navigates to both payroll and diaries and rejects forged direction',async t=>{
 let payroll=0,diaries=0;const h=harness(t,{supplierPayrollReportFactory:async()=>({open(){payroll++;},close(){},destroy(){}}),supplierPayrollReportDataFactory:async()=>({loadSnapshot:async()=>({complete:true,sheets:[]}),loadPaymentsForPayrollIds:async()=>[]}),pendingSupplierPaymentsReportViewFactory:async()=>({open(){diaries++;},close(){},destroy(){}})});
 await h.controller.start();await h.view.emit(action);
 assert.equal(await h.view.emit('navigate-mascot-report',{from:action,direction:'orange'}),false);
 assert.equal(await h.view.emit('navigate-mascot-report',{from:action,direction:'next'}),true);assert.equal(diaries,1);
 await h.view.emit(action);assert.equal(await h.view.emit('navigate-mascot-report',{from:action,direction:'previous'}),true);assert.equal(payroll,1);
});
const browserAccount={homeAccountId:'diary-user',username:'person@example.invalid'},pendingKey='energetico:msal-pending-action:v1';
test('default production financial factory reaches readonly source without a replaced data factory',async t=>{
 let reads=0;const h=harness(t,{supplierWorkforceReportDataFactory:undefined,auth:{getToken:async scopes=>{assert.deepEqual(scopes,['Sites.Read.All']);reads++;throw Error('source blocked');}}});
 await h.controller.start();await h.view.emit(action);
 await assert.rejects(h.panels[0].data.loadSnapshot(),{message:'source blocked'});assert.ok(reads>0);
});
function browserHarness(redirect,values=new Map()){
 const requests=[];const auth=createBrowserAuth({storage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},config:{scopes:['User.Read'],webRedirectUri:'https://www.energeticabr.com/energetico/'},client:{async initialize(){},async handleRedirectPromise(){return redirect;},getAllAccounts(){return [browserAccount];},async acquireTokenRedirect(r){requests.push(r);},async logoutRedirect(){}}});return {auth,values,requests};
}
for(const [name,redirect,expected] of [
 ['read scope',{account:browserAccount,accessToken:'read',scopes:['Sites.Read.All']},reply],
 ['other account',{account:{...browserAccount,homeAccountId:'other'},accessToken:'read',scopes:['Sites.Read.All']},null],
 ['write instead of read',{account:browserAccount,accessToken:'write',scopes:['Sites.ReadWrite.All']},null],
 ['no token',{account:browserAccount,scopes:['Sites.Read.All']},null],
 ['cached account',null,null],
])test(`browser redirect resumes supplier workforce once only: ${name}`,async()=>{
 const first=browserHarness(null);await first.auth.initialize();await first.auth.authorize(['Sites.Read.All'],{resumeAction:reply});assert.equal(JSON.parse(first.values.get(pendingKey)).action,reply);
 const resumed=browserHarness(redirect,first.values);await resumed.auth.initialize();assert.equal(resumed.auth.consumePendingAction(),expected);assert.equal(resumed.auth.consumePendingAction(),null);assert.equal(first.values.has(pendingKey),false);
});
