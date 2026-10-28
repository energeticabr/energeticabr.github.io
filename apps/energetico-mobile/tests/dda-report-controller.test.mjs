import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createAppController} from '../src/app-controller.js';
import {createConversationStore} from '../src/chat/conversation-store.js';
import {renderChatMarkup,commandFromTarget} from '../src/ui/chat-view.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(t,options={}){
 const handlers=new Map(),calls=[],opened=[],factories=[],account={homeAccountId:'dda-test',name:'Teste'};let sequence=0;
 const store=createConversationStore({randomUUID:()=>String(++sequence)}),view={render(){},on(type,handler){handlers.set(type,handler);return()=>handlers.delete(type);},emit(type,command={}){return handlers.get(type)?.({type,...command});},focusComposer(){},destroy(){}};
 const auth={initialize:async()=>account,getToken:async()=> 'test-token',signOut:async()=>{},...options.auth};
 const panel=()=>({async open(){opened.push('report');},close(){},destroy(){calls.push('destroy');}});
 const controller=createAppController({store,view,auth,native:{importSharedItems:async()=>[],previewMediaCollection:async(items)=>calls.push(items)},client:{sendText:async()=>({status:'processed',messages:[]})},
  pendingProvisionAttachmentsDataFactory:async()=>({loadUpcomingPayments:async()=>[]}),pendingConstructionDiaryDataFactory:async()=>({loadPending:async()=>[]}),diaryFieldVisitDataFactory:async()=>({load:async()=>[]}),
  registrationGalleryDataFactory:async options=>{assert.equal(options.kind,'dda');return {};},
  registrationGalleryFactory:async()=>({open(){opened.push('gallery');},close(){},destroy(){}}),
  ddaReportFactory:async options=>{factories.push(options);return panel();},...options,auth});
 t.after(()=>controller.stop());return {controller,view,store,auth,calls,opened,factories};
}
test('DDA shortcut is immediately below the first left mascot and dispatches its own report',()=>{
 const markup=renderChatMarkup({sessionStatus:'authenticated',account:{name:'Teste'},messages:[{role:'assistant',type:'poll',question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',options:[{id:'group_pending',label:'PENDÊNCIAS'},{id:'group_supplies',label:'SUPRIMENTOS'},{id:'group_financial',label:'FINANCEIRO'},{id:'group_hr',label:'RECURSOS HUMANOS'}]}],attachments:[],draft:'',busy:false});
 const dom=new JSDOM(markup),first=dom.window.document.querySelector('[data-action="open-pending-provisions"]'),dda=first?.nextElementSibling;
 assert.equal(dda?.dataset.action,'open-dda-report');assert.equal(commandFromTarget(dda)?.type,'open-dda-report');assert.match(dda.textContent,/DDA/);dom.window.close();
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
