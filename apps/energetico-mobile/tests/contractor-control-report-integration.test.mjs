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

const action='open-contractor-control-report',reply='home-contractor-control-report';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const home={sessionStatus:'authenticated',account:{name:'Bernardo'},pendingFiles:[],draft:'',messages:[{id:'home',role:'assistant',type:'poll',question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',options:[{id:'group_pending',label:'PENDÊNCIAS'},{id:'group_supplies',label:'SUPRIMENTOS'}]}]};
function harness(t,options={}) {
 const handlers=new Map(),panels=[],calls=[],account={homeAccountId:'contract-user'};
 const view={render(){},on(type,handler){handlers.set(type,handler);return ()=>handlers.delete(type);},emit(type,value={}){return handlers.get(type)?.({type,...value});},focusComposer(){},destroy(){}};
 const auth={initialize:async()=>account,signIn:async()=>account,signOut:async()=>{},getToken:async()=> 'token',...options.auth};
 const store=createConversationStore();
 const controller=createAppController({store,view,auth,client:{sendText:async payload=>{calls.push(payload);return {status:'processed',messages:[]};}},native:{importSharedItems:async()=>[]},pendingProvisionAttachmentsDataFactory:async()=>({loadUpcomingPayments:async()=>[]}),contractorControlReportViewFactory:async({data,onClose})=>{const panel={data,opens:0,destroys:0,open(){this.opens++;},close(){onClose?.();},destroy(){this.destroys++;}};panels.push(panel);return panel;},contractorControlReportDataFactory:async()=>({loadOverview:async()=>({rows:[]}),loadDetails:async()=>({launches:[],measurements:[]})}),...options,auth});
 t.after(()=>controller.stop());return {controller,view,store,auth,panels,calls};
}
test('new pink wheelbarrow mascot sits immediately below workforce and launches local contract report',t=>{
 const dom=new JSDOM('<main id="app"></main>');dom.window.HTMLCanvasElement.prototype.getContext=()=>null;
 const view=createChatView(dom.window.document.querySelector('#app'));t.after(()=>{view.destroy();dom.window.close();});
 let opens=0;view.on(action,()=>opens++);view.render(home);const mascot=dom.window.document.querySelector(`[data-action="${action}"]`);
 assert.ok(mascot,'new report shortcut missing');assert.equal(mascot.previousElementSibling.dataset.action,'open-supplier-workforce-report');assert.equal(mascot.nextElementSibling.dataset.action,'open-pending-supplier-payments-report');
 assert.match(mascot.querySelector('img').src,/contractor-control\.png$/);mascot.querySelector('img').click();assert.equal(opens,1);
 view.render({...home,activeText:{id:'busy'}});const busy=dom.window.document.querySelector(`[data-action="${action}"]`);assert.equal(busy.disabled,true);busy.click();assert.equal(opens,1);
 assert.doesNotMatch(renderChatMarkup({...home,activeFlow:'flow'}),/data-action="open-contractor-control-report"/);
});
test('new entry navigates strictly between pink workforce and pink pending payments',()=>{
 assert.deepEqual(getReportNeighbors(action),{previous:'open-supplier-workforce-report',next:'open-pending-supplier-payments-report'});
 assert.deepEqual(getReportNeighbors('open-supplier-workforce-report'),{previous:'open-supplier-payroll-report',next:action});
 assert.deepEqual(getReportNeighbors('open-pending-supplier-payments-report'),{previous:action,next:'open-pending-work-diaries-report'});
 assert.equal(REPORT_PDF_TITLES[action],'Controle de empreiteiros');assert.equal(getReportNeighbors('open-commercial-receipts').previous,null);
});
test('pink rail preserves uniform fill and even spacing below the separate orange row',t=>{
 const dom=new JSDOM(renderChatMarkup(home),{url:'https://example.test/'});t.after(()=>dom.window.close());const style=dom.window.document.createElement('style');style.textContent=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');dom.window.document.head.append(style);
 const actions=['open-cargos-table','open-attendance-summary','open-stage-progress','open-supplier-payroll-report','open-supplier-workforce-report',action,'open-pending-supplier-payments-report','open-pending-work-diaries-report'];
 let bottom=0;for(const name of actions){const node=dom.window.document.querySelector(`[data-action="${name}"]`);assert.ok(node,name);const css=dom.window.getComputedStyle(node);assert.ok(parseFloat(css.marginTop)>=bottom+4,name);bottom=parseFloat(css.marginTop)+parseFloat(css.height);}
 const css=dom.window.getComputedStyle(dom.window.document.querySelector(`[data-action="${action}"]`));assert.equal(css.backgroundColor,'rgb(207, 117, 122)');
 const row=dom.window.document.querySelector('nav[aria-label="Relatórios comerciais"]');assert.ok(row);assert.equal(row.querySelectorAll('button').length,4);assert.equal(dom.window.getComputedStyle(row).display,'flex');
 assert.ok([...row.querySelectorAll('button')].every(b=>dom.window.getComputedStyle(b).backgroundColor==='rgb(173, 62, 8)'));
});
test('HOME and resume double tap open once without sending workflow business commands',async t=>{
 const pending=deferred(),h=harness(t,{contractorControlReportViewFactory:()=>pending.promise});await h.controller.start();const before=h.calls.length;
 const first=h.view.emit(action),second=h.view.emit('select-reply',{replyId:reply});await tick();let opens=0;pending.resolve({open(){opens++;},destroy(){}});
 assert.deepEqual(await Promise.all([first,second]),[true,true]);assert.equal(opens,1);assert.equal(h.calls.length,before);
});
test('overview and linked details request readonly scopes and correct ID, with isolated resume action',async t=>{
 let tokens=0;const grants=[],ids=[];const h=harness(t,{auth:{getToken:async scopes=>{assert.deepEqual(scopes,['Sites.Read.All']);if(!tokens++)throw Object.assign(Error('consent'),{code:'AUTH_REQUIRED'});return 'read';},authorize:async(scopes,options)=>grants.push({scopes,options})},contractorControlReportDataFactory:async({tokenProvider})=>({loadOverview:()=>tokenProvider(['Sites.ReadWrite.All']),loadDetails:async id=>{ids.push(id);return tokenProvider(['Sites.ReadWrite.All']);}})});
 await h.controller.start();assert.equal(await h.view.emit(action),true);assert.equal(await h.panels[0].data.loadOverview(),'read');assert.equal(await h.panels[0].data.loadDetails('237'),'read');assert.deepEqual(ids,['237']);assert.deepEqual(grants,[{scopes:['Sites.Read.All'],options:{resumeAction:reply}}]);
});
for(const method of ['loadOverview','loadDetails'])for(const end of ['sign-out','stop','account-change','active-flow','busy','close','other-report'])test(`${method} cancels on ${end}, rejecting old callbacks`,async t=>{
 const pending=deferred();let signal;const h=harness(t,{contractorControlReportDataFactory:async()=>({loadOverview:options=>{signal=options.signal;return pending.promise;},loadDetails:(id,options)=>{signal=options.signal;return pending.promise;}}),pendingSupplierPaymentsReportViewFactory:async()=>({open(){},destroy(){}})});
 await h.controller.start();await h.view.emit(action);assert.equal(h.panels.length,1);const data=h.panels[0].data;const task=method==='loadOverview'?data.loadOverview():data.loadDetails('237'),rejected=assert.rejects(task,{name:'AbortError'});await tick();
 if(end==='stop')h.controller.stop();else if(end==='account-change')await h.view.emit('sign-in');else if(end==='active-flow')h.store.restoreSnapshot({messages:[],activeFlow:{id:'flow'}});else if(end==='busy')h.store.beginText('busy');else if(end==='close')h.panels[0].close();else if(end==='other-report')await h.view.emit('open-pending-supplier-payments-report');else await h.view.emit('sign-out');
 await rejected;assert.equal(signal.aborted,true);assert.equal(h.panels[0].destroys,1);pending.resolve({rows:[]});await assert.rejects(data.loadOverview(),{name:'AbortError'});
});
test('superseded overview token cannot prompt late consent',async t=>{
 const token=deferred();let tokens=0,grants=0;const h=harness(t,{auth:{getToken:()=>++tokens===1?token.promise:Promise.resolve('fresh'),authorize:async()=>grants++},contractorControlReportDataFactory:async({tokenProvider})=>({loadOverview:()=>tokenProvider()})});
 await h.controller.start();await h.view.emit(action);const data=h.panels[0].data,old=data.loadOverview(),rejected=assert.rejects(old,{name:'AbortError'});await tick();assert.equal(await data.loadOverview(),'fresh');await rejected;token.reject(Object.assign(Error('late'),{code:'AUTH_REQUIRED'}));await tick();assert.equal(grants,0);
});
test('late view factory after logout is destroyed without opening',async t=>{
 const pending=deferred();let opens=0,destroys=0;const h=harness(t,{contractorControlReportViewFactory:()=>pending.promise});await h.controller.start();const task=h.view.emit(action);await tick();await h.view.emit('sign-out');pending.resolve({open(){opens++;},destroy(){destroys++;}});assert.equal(await task,false);await tick();assert.equal(opens,0);assert.equal(destroys,1);
});
for(const guard of ['signed-out','active-flow','busy'])test(`contract report cannot open during ${guard}`,async t=>{
 const h=harness(t,guard==='signed-out'?{auth:{initialize:async()=>null}}:{});await h.controller.start();if(guard==='active-flow')h.store.restoreSnapshot({messages:[],activeFlow:{id:'flow'}});if(guard==='busy')h.store.beginText('busy');
 assert.equal(await h.view.emit(action),false);assert.equal(await h.view.emit('select-reply',{replyId:reply}),false);assert.equal(h.panels.length,0);
});
test('authorization redirect restores the new report locally exactly once',async t=>{
 const h=harness(t,{auth:{consumePendingAction:()=>reply}});await h.controller.start();assert.equal(h.panels.length,1);assert.equal(h.panels[0].opens,1);
});
for(const [name,redirect,expected] of [['readonly',{accessToken:'read',scopes:['Sites.Read.All']},reply],['write-only',{accessToken:'write',scopes:['Sites.ReadWrite.All']},null],['without-token',{scopes:['Sites.Read.All']},null]])test(`browser auth resumes contractor report only on valid read grant: ${name}`,async()=>{
 const account={homeAccountId:'contract-user'},values=new Map(),key='energetico:msal-pending-action:v1';
 const make=(result)=>createBrowserAuth({storage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},config:{scopes:['User.Read'],webRedirectUri:'https://www.energeticabr.com/energetico/'},client:{async initialize(){},async handleRedirectPromise(){return result;},getAllAccounts(){return [account];},async acquireTokenRedirect(){},async logoutRedirect(){}}});
 const auth=make(null);await auth.initialize();await auth.authorize(['Sites.Read.All'],{resumeAction:reply});assert.equal(JSON.parse(values.get(key)).action,reply);
 const resumed=make({...redirect,account});await resumed.initialize();assert.equal(resumed.consumePendingAction(),expected);assert.equal(resumed.consumePendingAction(),null);assert.equal(values.has(key),false);
});
