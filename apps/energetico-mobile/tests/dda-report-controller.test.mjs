import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createAppController} from '../src/app-controller.js';
import {createConversationStore} from '../src/chat/conversation-store.js';
import {renderChatMarkup,commandFromTarget} from '../src/ui/chat-view.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(t,options={}){
 const handlers=new Map(),calls=[],opened=[],factories=[],renders=[],account={homeAccountId:'dda-test',name:'Teste'};let sequence=0;
 const store=createConversationStore({randomUUID:()=>String(++sequence)}),view={render(state){renders.push(state);},on(type,handler){handlers.set(type,handler);return()=>handlers.delete(type);},emit(type,command={}){return handlers.get(type)?.({type,...command});},focusComposer(){},destroy(){}};
 const auth={initialize:async()=>account,getToken:async()=> 'test-token',signOut:async()=>{},...options.auth};
 const panel=()=>({async open(){opened.push('report');},close(){},destroy(){calls.push('destroy');}});
 const controller=createAppController({enableDdaReminders:true,store,view,auth,native:{importSharedItems:async()=>[],previewMediaCollection:async(items)=>calls.push(items)},client:{sendText:async()=>({status:'processed',messages:[]})},
  pendingProvisionAttachmentsDataFactory:async()=>({loadUpcomingPayments:async()=>[]}),pendingConstructionDiaryDataFactory:async()=>({loadPending:async()=>[]}),diaryFieldVisitDataFactory:async()=>({load:async()=>[]}),
  registrationGalleryDataFactory:async options=>{assert.equal(options.kind,'dda');return {};},
  registrationGalleryFactory:async()=>({open(){opened.push('gallery');},close(){},destroy(){}}),
  ddaReportFactory:async options=>{factories.push(options);return panel();},...options,auth});
 t.after(()=>controller.stop());return {controller,view,store,auth,calls,opened,factories,renders};
}
test('DDA shortcut is immediately below the first left mascot and dispatches its own report',()=>{
 const markup=renderChatMarkup({sessionStatus:'authenticated',account:{name:'Teste'},messages:[{role:'assistant',type:'poll',question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',options:[{id:'group_pending',label:'PENDÊNCIAS'},{id:'group_supplies',label:'SUPRIMENTOS'},{id:'group_financial',label:'FINANCEIRO'},{id:'group_hr',label:'RECURSOS HUMANOS'}]}],attachments:[],draft:'',busy:false});
 const dom=new JSDOM(markup),first=dom.window.document.querySelector('[data-action="open-pending-provisions"]'),dda=first?.nextElementSibling;
 assert.equal(dda?.dataset.action,'open-dda-report');assert.equal(commandFromTarget(dda)?.type,'open-dda-report');assert.match(dda.textContent,/DDA/);dom.window.close();
});
test('gallery receives the authenticated bank refresh callback and it expires with logout',async t=>{
 let options,called=0;
 const h=setup(t,{client:{sendText:async()=>({status:'processed',messages:[]}),
 refreshDda:async()=>{called++;return {status:'succeeded',requestId:'a'.repeat(32)};},
 getDdaRefreshStatus:async()=>{throw Error('unexpected polling');}},
 registrationGalleryFactory:async input=>{options=input;return {open(){},close(){},destroy(){}};}});
 await h.controller.start();
 await h.view.emit('select-reply',{replyId:'action_dda_gallery',label:'GALERIA DDA'});
 assert.equal(typeof options.refreshBank,'function');
 await options.refreshBank({});assert.equal(called,1);
 await h.view.emit('sign-out');
 await assert.rejects(options.refreshBank({}));assert.equal(called,1);
});
test('report and gallery use separate instances, share read-only source and media, and expire at logout',async t=>{
 const h=setup(t);await h.controller.start();await h.view.emit('open-dda-report');assert.deepEqual(h.opened,['report']);assert.equal(h.factories[0].onCreate,undefined);
 await h.view.emit('select-reply',{replyId:'action_dda_gallery',label:'GALERIA DDA'});assert.deepEqual(h.opened,['report','gallery']);
 await h.factories[0].openMediaCollection([{fileName:'espelho.pdf',source:new Blob(['pdf'])}]);assert.equal(h.calls.at(-1)[0].fileName,'espelho.pdf');
 await h.view.emit('sign-out');assert.ok(h.calls.includes('destroy'));assert.throws(()=>h.factories[0].openMediaCollection([]));
});
test('DDA report resumes after authentication and late factories cannot open after logout',async t=>{
 const h=setup(t,{auth:{consumePendingAction:()=> 'action_dda_report'}});await h.controller.start();assert.deepEqual(h.opened,['report']);
 let resolve,destroyed=0,opens=0;const late=setup(t,{ddaReportFactory:()=>new Promise(r=>resolve=r)});await late.controller.start();const request=late.view.emit('open-dda-report');await tick();await late.view.emit('sign-out');resolve({open(){opens++;},destroy(){destroyed++;}});await request;assert.equal(opens,0);assert.equal(destroyed,1);
});

const autoRow={id:'1',fields:{SITUACAO:'Em aberto',VENCIMENTO:'2020-01-01',VALOR:12}};
test('automatic DDA waits for the real provision dismiss command and does not repeat',async t=>{
 const h=setup(t,{client:{sendText:async()=>({status:'processed',messages:[]}),getPendingProvisionSnapshot:async()=>({sourceKind:'provision-description',rows:[{id:'9',dueDate:'2020-01-01',total:10}]})},registrationGalleryDataFactory:async()=>({loadSnapshot:async()=>({rows:[autoRow]})})});
 await h.controller.start();await tick();assert.deepEqual(h.opened,[]);
 await h.view.emit('dismiss-pending-provisions');for(let i=0;i<8;i++)await tick();assert.deepEqual(h.opened,['report']);
 await h.view.emit('dismiss-pending-provisions');await tick();assert.deepEqual(h.opened,['report']);
});
test('automatic DDA opens without provision rows and ignores paid/future titles',async t=>{
 const h=setup(t,{registrationGalleryDataFactory:async()=>({loadSnapshot:async()=>({rows:[autoRow]})})});await h.controller.start();for(let i=0;i<8;i++)await tick();assert.deepEqual(h.opened,['report']);
 const paid=setup(t,{registrationGalleryDataFactory:async()=>({loadSnapshot:async()=>({rows:[{...autoRow,fields:{...autoRow.fields,SITUACAO:'Pago'}}]})})});await paid.controller.start();for(let i=0;i<8;i++)await tick();assert.deepEqual(paid.opened,[]);
});

test('an automatic DDA never interrupts a draft and opens after clearing it',async t=>{
 const h=setup(t,{registrationGalleryDataFactory:async()=>({loadSnapshot:async()=>({rows:[autoRow]})})});h.store.setDraft('Lançamento em edição');await h.controller.start();for(let i=0;i<8;i++)await tick();assert.deepEqual(h.opened,[]);
 await h.view.emit('draft-changed',{value:''});for(let i=0;i<8;i++)await tick();assert.deepEqual(h.opened,['report']);
});
test('a late automatic report factory is cancelled by user navigation',async t=>{
 let resolve,opens=0;const h=setup(t,{registrationGalleryDataFactory:async()=>({loadSnapshot:async()=>({rows:[autoRow]})}),ddaReportFactory:()=>new Promise(r=>resolve=r)});
 await h.controller.start();for(let i=0;i<8;i++)await tick();assert.equal(typeof resolve,'function');await h.view.emit('draft-changed',{value:'nova tarefa'});
 resolve({open(){opens++;},destroy(){},close(){}});for(let i=0;i<8;i++)await tick();assert.equal(opens,0);
});

test('manual DDA intent survives an automatic factory already loading',async t=>{
 let resolve;const h=setup(t,{registrationGalleryDataFactory:async()=>({loadSnapshot:async()=>({rows:[autoRow]})}),ddaReportFactory:()=>new Promise(r=>resolve=r)});
 await h.controller.start();for(let i=0;i<8;i++)await tick();const manual=h.view.emit('open-dda-report');resolve({open(options){h.opened.push(options.automatic?'automatic':'manual');},destroy(){},close(){}});
 assert.equal(await manual,true);assert.deepEqual(h.opened,['manual']);
});

test('manual DDA retry cannot revive intent after later navigation',async t=>{
 let resolve;const h=setup(t,{registrationGalleryDataFactory:async()=>({loadSnapshot:async()=>({rows:[autoRow]})}),ddaReportFactory:()=>new Promise(r=>resolve=r)});
 await h.controller.start();for(let i=0;i<8;i++)await tick();const manual=h.view.emit('open-dda-report');await h.view.emit('draft-changed',{value:'outra tarefa'});
 resolve({open(){h.opened.push('stale');},destroy(){},close(){}});assert.equal(await manual,false);assert.deepEqual(h.opened,[]);
});

test('queued DDA takes priority over other automatic notices without deleting them',async t=>{
 const h=setup(t,{client:{sendText:async()=>({status:'processed',messages:[]}),getPendingProvisionSnapshot:async()=>({sourceKind:'provision-description',rows:[{id:'9',dueDate:'2020-01-01'}]}),getPendingNotesSnapshot:async()=>({rows:[{id:'10',supplier:'Exemplo'}]})},registrationGalleryDataFactory:async()=>({loadSnapshot:async()=>({rows:[autoRow]})})});
 await h.controller.start();for(let i=0;i<8;i++)await tick();assert.equal(h.renders.at(-1).pendingNotes,null);
 await h.view.emit('dismiss-pending-provisions');for(let i=0;i<8;i++)await tick();assert.deepEqual(h.opened,['report']);assert.equal(h.renders.at(-1).pendingNotes,null);h.factories[0].onClose();assert.equal(h.renders.at(-1).pendingNotes.rows[0].id,'10');
});
