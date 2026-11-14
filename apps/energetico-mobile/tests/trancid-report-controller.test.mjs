import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createAppController} from '../src/app-controller.js';
import {createConversationStore} from '../src/chat/conversation-store.js';
import {renderChatMarkup,commandFromTarget} from '../src/ui/chat-view.js';
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
  trancidReportFactory:async input=>{factories.push(input);return {async open(){opens.push(true);await input.loadReport({});return true;},close(){input.onClose?.();},destroy(){}};},...options});
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
test('low balances only open Trancid on request, including after dismissal, foreground, and restart', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-08T02:59:59Z') });
  const h = harness(t, { enableTrancidReminders: true });
  await h.controller.start();
  await tick();
  assert.equal(h.opens.length, 0);
  assert.equal(h.tokens.length, 0);

  assert.equal(await h.view.emit('open-trancid-report'), true);
  h.factories[0].onClose();
  t.mock.timers.setTime(Date.parse('2026-11-08T03:00:00Z'));
  await h.controller.handleForeground();
  await tick();
  assert.equal(h.opens.length, 1);
  assert.equal(h.tokens.length, 1);
  h.controller.stop();

  const restarted = harness(t, { enableTrancidReminders: true });
  await restarted.controller.start();
  await tick();
  assert.equal(restarted.opens.length, 0);
  assert.equal(restarted.tokens.length, 0);
});

test('a pending Microsoft redirect action does not open Trancid on startup', async t => {
  const h = harness(t, { auth: {
    initialize: async () => ({ homeAccountId: 'reauth' }),
    consumePendingAction: () => 'home-trancid-card-report',
    getToken: async () => 'token',
  } });
  await h.controller.start();
  assert.equal(h.opens.length, 0);
  assert.equal(await h.view.emit('open-trancid-report'), true);
});

test('late report factory cannot display after sign out',async t=>{
 let resolve,destroyed=0;const h=harness(t,{trancidReportFactory:()=>new Promise(r=>resolve=r)});await h.controller.start();const request=h.view.emit('open-trancid-report');await tick();await h.view.emit('sign-out');
 resolve({open(){h.opens.push('stale');},destroy(){destroyed++;}});assert.equal(await request,false);await tick();assert.equal(h.opens.length,0);assert.equal(destroyed,1);
});
test('opening another report cancels late mascot navigation into Trancid',async t=>{
 let resolve,destroyed=0;const h=harness(t,{trancidReportFactory:()=>new Promise(r=>resolve=r),supplierPayrollReportFactory:async()=>({open(){},close(){},destroy(){}}),stageProgressFactory:async()=>({open(){},close(){},destroy(){}})});
 await h.controller.start();await h.view.emit('open-supplier-payroll-report');
 const first=h.view.emit('navigate-mascot-report',{from:'open-supplier-payroll-report',direction:'next'});await tick();
 await h.view.emit('open-cargos-table');assert.equal(await first,false);resolve({open(){h.opens.push('late');},destroy(){destroyed++;}});await first;await tick();assert.equal(h.opens.length,0);assert.equal(destroyed,1);
});
test('manual Trancid can request Microsoft authorization without scheduling a reopen', async t => {
  let allowed = false;
  const h = harness(t, { auth: {
    initialize: async () => ({ homeAccountId: 'reauth' }),
    getToken: async () => {
      if (!allowed) throw Object.assign(new Error('Entre novamente'), { code: 'AUTH_REQUIRED' });
      return 'token';
    },
    authorize: async (scopes, options) => {
      assert.deepEqual(scopes, ['Sites.Read.All']);
      assert.equal(options?.resumeAction, undefined);
      allowed = true;
    },
  } });
  await h.controller.start();
  assert.equal(await h.view.emit('open-trancid-report'), true);
  assert.equal(allowed, true);
  assert.equal(h.opens.length, 1);
});
test('manual double tap coalesces one report factory and opening',async t=>{
 let resolve,created=0;const h=harness(t,{trancidReportFactory:input=>{created++;return new Promise(r=>resolve=()=>r({open(){h.opens.push('manual');},destroy(){}}));}});await h.controller.start();
 const one=h.view.emit('open-trancid-report');await tick();const two=h.view.emit('open-trancid-report');await tick();resolve();await Promise.all([one,two]);assert.equal(created,1);assert.equal(h.opens.length,1);
});
