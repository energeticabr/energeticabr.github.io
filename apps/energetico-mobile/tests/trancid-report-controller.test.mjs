import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createAppController} from '../src/app-controller.js';
import {createConversationStore} from '../src/chat/conversation-store.js';
import {renderChatMarkup,commandFromTarget} from '../src/ui/chat-view.js';
import {createTrancidReportView} from '../src/ui/trancid-report-view.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(t,options={}) {
 const handlers=new Map(),opens=[],factories=[],tokens=[],renders=[];let sequence=0;
 const store=createConversationStore({randomUUID:()=>String(++sequence)});
 const view={render(state){renders.push(state);},on(type,fn){handlers.set(type,fn);return()=>handlers.delete(type);},emit(type,command={}){return handlers.get(type)?.({type,...command});},focusComposer(){},destroy(){}};
 const account={homeAccountId:'trancid-user',name:'Fornecedor Exemplo'};
 const report={month:'2026-11',months:['2026-11'],cards:[{card:'06850000000001',supplier:'Fornecedor Exemplo',balanceCents:500,low:true,history:[]}],lowCount:1,totalCents:500};
 const controller=createAppController({store,view,auth:{initialize:async()=>account,getToken:async scopes=>{tokens.push(scopes);return 'token';},signOut:async()=>{}},
  native:{importSharedItems:async()=>[]},client:{sendText:async()=>({status:'processed',messages:[]})},
  pendingProvisionAttachmentsDataFactory:async()=>({loadUpcomingPayments:async()=>[]}),pendingConstructionDiaryDataFactory:async()=>({loadPending:async()=>[]}),
  trancidReportDataFactory:async({tokenProvider})=>({loadSnapshot:async()=>{await tokenProvider(['Sites.Read.All']);return report;}}),
  trancidReportBuilder:async value=>value,
  trancidReportFactory:async input=>{factories.push(input);return {async open(value={}){opens.push(value);if(!value.initialSnapshot)await input.loadReport({});return true;},close(){input.onClose?.();},destroy(){}};},...options});
 t.after(()=>controller.stop());return {controller,store,view,opens,factories,tokens,report,renders};
}
test('bus shortcut is immediately below the supplier payroll mascot and dispatches its report',()=>{
 const dom=new JSDOM(renderChatMarkup({sessionStatus:'authenticated',account:{name:'Teste'},pendingFiles:[],messages:[{id:'home',role:'assistant',type:'poll',question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',options:[{id:'group_pending',label:'PENDÊNCIAS'},{id:'group_supplies',label:'SUPRIMENTOS'}]}]}));
 const payroll=dom.window.document.querySelector('[data-action="open-supplier-payroll-report"]');
 assert.equal(payroll.nextElementSibling?.dataset.action,'open-trancid-report');assert.equal(commandFromTarget(payroll.nextElementSibling).type,'open-trancid-report');dom.window.close();
});
test('manual report loads with Microsoft token and old report loader rejects after logout',async t=>{
 const h=harness(t);await h.controller.start();assert.equal(await h.view.emit('open-trancid-report'),true);assert.equal(h.tokens.length,1);
 await h.view.emit('sign-out');await assert.rejects(h.factories[0].loadReport({}),/sessão|session|encerrad/i);
});
test('automatic Trancid limit survives restart, is scoped by account and resets at Brasília midnight',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-08T02:30:00Z')});
 const previousStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),values=new Map();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,
  value:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}});
 t.after(()=>{if(previousStorage)Object.defineProperty(globalThis,'localStorage',previousStorage);else delete globalThis.localStorage;});
 const h=harness(t,{enableTrancidReminders:true});await h.controller.start();for(let n=0;n<12;n++)await tick();assert.equal(h.opens.length,1);assert.equal(h.opens[0].automatic,true);
 h.factories[0].onClose();for(let n=0;n<4;n++)await tick();assert.equal(h.opens.length,1);
 await h.controller.handleForeground();for(let n=0;n<12;n++)await tick();assert.equal(h.opens.length,1);
 h.controller.stop();

 const other=harness(t,{enableTrancidReminders:true,auth:{initialize:async()=>({homeAccountId:'trancid-other'}),getToken:async()=> 'token'}});
 await other.controller.start();for(let n=0;n<12;n++)await tick();assert.equal(other.opens.length,1);
 other.controller.stop();

 t.mock.timers.setTime(Date.parse('2026-11-08T02:59:59Z'));
 const restarted=harness(t,{enableTrancidReminders:true});
 await restarted.controller.start();for(let n=0;n<12;n++)await tick();assert.equal(restarted.opens.length,0);
 assert.equal(await restarted.view.emit('open-trancid-report'),true);
 assert.equal(restarted.opens[0].automatic,undefined);
 restarted.factories[0].onClose();
 t.mock.timers.setTime(Date.parse('2026-11-08T03:00:00Z'));
 await restarted.controller.handleForeground();for(let n=0;n<12;n++)await tick();
 assert.equal(restarted.opens.length,2);assert.equal(restarted.opens[1].automatic,true);
});
test('automatic balance report waits behind an active draft',async t=>{
 const h=harness(t,{enableTrancidReminders:true});h.store.setDraft('Edição em andamento');await h.controller.start();for(let n=0;n<8;n++)await tick();assert.equal(h.opens.length,0);
 await h.view.emit('draft-changed',{value:''});for(let n=0;n<12;n++)await tick();assert.equal(h.opens.length,1);
});
test('closing the visible Trancid dialog before opening settles still counts that day',async t=>{
 const old=globalThis.document,dom=new JSDOM('<body><main id="app"></main></body>');
 globalThis.document=dom.window.document;
 t.after(()=>{globalThis.document=old;dom.window.close();});
 let visible=0;
 const h=harness(t,{enableTrancidReminders:true,trancidReportFactory:input=>{
  const panel=createTrancidReportView(input);
  return {...panel,open(options){
   const opening=panel.open(options);
   if(!panel.element.hidden){visible++;panel.close();}
   return opening;
  }};
 }});
 await h.controller.start();for(let n=0;n<12;n++)await tick();
 assert.equal(visible,1);
 await h.controller.handleForeground();for(let n=0;n<12;n++)await tick();
 assert.equal(visible,1);
});
test('late report factory cannot display after sign out',async t=>{
 let resolve,destroyed=0;const h=harness(t,{trancidReportFactory:()=>new Promise(r=>resolve=r)});await h.controller.start();const request=h.view.emit('open-trancid-report');await tick();await h.view.emit('sign-out');
 resolve({open(){h.opens.push('stale');},destroy(){destroyed++;}});assert.equal(await request,false);await tick();assert.equal(h.opens.length,0);assert.equal(destroyed,1);
});
test('typing while the automatic source is loading defers rather than loses the low balance warning',async t=>{
 let resolve,reads=0;const h=harness(t,{enableTrancidReminders:true,trancidReportDataFactory:async()=>({loadSnapshot:async()=>{reads++;if(reads===1)return new Promise(r=>resolve=r);return h.report;}})});
 await h.controller.start();await tick();await h.view.emit('draft-changed',{value:'Editando'});resolve(h.report);for(let n=0;n<8;n++)await tick();assert.equal(h.opens.length,0);
 await h.view.emit('draft-changed',{value:''});for(let n=0;n<12;n++)await tick();assert.equal(h.opens.length,1);
});
test('opening another report cancels late mascot navigation into Trancid',async t=>{
 let resolve,destroyed=0;const h=harness(t,{trancidReportFactory:()=>new Promise(r=>resolve=r),supplierPayrollReportFactory:async()=>({open(){},close(){},destroy(){}}),stageProgressFactory:async()=>({open(){},close(){},destroy(){}})});
 await h.controller.start();await h.view.emit('open-supplier-payroll-report');
 const first=h.view.emit('navigate-mascot-report',{from:'open-supplier-payroll-report',direction:'next'});await tick();
 await h.view.emit('open-cargos-table');assert.equal(await first,false);resolve({open(){h.opens.push('late');},destroy(){destroyed++;}});await first;await tick();assert.equal(h.opens.length,0);assert.equal(destroyed,1);
});
test('manual Trancid authorizes AUTH_REQUIRED using its resumable action while automatic reads stay silent',async t=>{
 for(const automatic of [false,true]){
  let allowed=false,authorized=0;
  const h=harness(t,{enableTrancidReminders:automatic,auth:{initialize:async()=>({homeAccountId:'reauth'}),getToken:async()=>{if(!allowed)throw Object.assign(new Error('Entre novamente'),{code:'AUTH_REQUIRED'});return 'token';},authorize:async(scopes,options)=>{authorized++;assert.deepEqual(scopes,['Sites.Read.All']);assert.equal(options.resumeAction,'home-trancid-card-report');allowed=true;}}});
  await h.controller.start();if(!automatic)await h.view.emit('open-trancid-report');for(let n=0;n<8;n++)await tick();assert.equal(authorized,automatic?0:1);assert.equal(h.opens.length,automatic?0:1);
 }
});
test('manual double tap coalesces one report factory and opening',async t=>{
 let resolve,created=0;const h=harness(t,{trancidReportFactory:input=>{created++;return new Promise(r=>resolve=()=>r({open(){h.opens.push('manual');},destroy(){}}));}});await h.controller.start();
 const one=h.view.emit('open-trancid-report');await tick();const two=h.view.emit('open-trancid-report');await tick();resolve();await Promise.all([one,two]);assert.equal(created,1);assert.equal(h.opens.length,1);
});
test('closing another dialog resumes a deferred automatic report without a chat event',async t=>{
 const old=globalThis.document,dom=new JSDOM('<body><main id="app"></main><section role="dialog" id="other"></section></body>');globalThis.document=dom.window.document;
 t.after(()=>{globalThis.document=old;dom.window.close();});const other=dom.window.document.querySelector('#other');other.getClientRects=()=>other.hidden?[]:[{}];
 const h=harness(t,{enableTrancidReminders:true});await h.controller.start();for(let n=0;n<8;n++)await tick();assert.equal(h.opens.length,0);
 other.hidden=true;for(let n=0;n<12;n++)await tick();assert.equal(h.opens.length,1);
});
test('automatic Trancid warning waits until a manually opened provisions report is dismissed',async t=>{
 let resolve,provisionReads=0;const h=harness(t,{enableTrancidReminders:true,client:{sendText:async()=>({status:'processed',messages:[]}),getPendingProvisionSnapshot:async()=>({sourceKind:'provision-description',rows:++provisionReads>1?[{id:'sample',supplier:'FORNECEDOR EXEMPLO',total:700}]:[]})},trancidReportDataFactory:async()=>({loadSnapshot:async()=>new Promise(r=>resolve=r)})});
 await h.controller.start();await tick();assert.equal(await h.view.emit('open-pending-provisions'),true);assert.ok(h.renders.at(-1).pendingProvisions);
 resolve(h.report);for(let n=0;n<8;n++)await tick();assert.equal(h.opens.length,0);
 await h.view.emit('dismiss-pending-provisions');await tick();resolve(h.report);for(let n=0;n<8;n++)await tick();assert.equal(h.opens.length,1);
});

test('automatic balance alert waits while the full-screen Trancid gallery is open', async t => {
  const previousDocument = globalThis.document;
  const { window } = new JSDOM('<main id="app"></main>');
  globalThis.document = window.document;
  t.after(() => { globalThis.document = previousDocument; window.close(); });
  let finishReport;
  const h = harness(t, {
    enableTrancidReminders: true,
    client: { sendText: async () => ({ status: 'processed', messages: [] }),
      trancidRechargeRequest: async () => ({ page: 1, hasMore: false, orders: [] }) },
    trancidReportDataFactory: async () => ({ loadSnapshot: async () => new Promise(resolve => { finishReport = resolve; }) }),
  });
  await h.controller.start();
  await tick();
  assert.equal(await h.view.emit('select-reply', { replyId: 'action_hr_trancid_gallery' }), true);
  finishReport(h.report);
  for (let n = 0; n < 8; n++) await tick();
  const gallery = window.document.querySelector('main.trancid-gallery-page');
  assert.ok(gallery);
  assert.equal(h.opens.length, 0);
  gallery.querySelector('header button:last-child').click();
  for (let n = 0; n < 8; n++) await tick();
  finishReport(h.report);
  for (let n = 0; n < 8; n++) await tick();
  assert.equal(h.opens.length, 1);
});
