import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createAppController} from '../src/app-controller.js';
import {createConversationStore} from '../src/chat/conversation-store.js';
import {createSefazSyncSession} from '../src/ui/sefaz-sync-session.js';
const id='a'.repeat(32),tick=()=>new Promise(r=>setImmediate(r));
const result={requestId:id,status:'succeeded',startedUtc:'2026-10-29T10:00:00Z',completedUtc:'2026-10-29T10:01:00Z',sources:{NFE:{status:'succeeded',documents:0},CTE:{status:'succeeded',documents:0},NFSE:{status:'succeeded',documents:0}}};
test('global empty result survives navigation, Escape, app close/reopen; only Entendi acknowledges',async t=>{
 assert.equal(typeof createSefazSyncSession,'function');const dom=new JSDOM('<body><main>OUTRA TELA</main></body>',{url:'https://fixture.test',pretendToBeVisual:true});t.after(()=>dom.window.close());const doc=dom.window.document;let acks=0;
 const client={getSefazRefreshPending:async()=>({status:'pending',requests:acks?[]:[result]}),acknowledgeSefazRefresh:async()=>{acks++;return {status:'acknowledged',requestId:id};}};
 const make=()=>createSefazSyncSession({document:doc,storage:dom.window.localStorage,accountKey:'a',client});
 const first=make();await first.resume();let popup=doc.querySelector('[data-sefaz-sync-result]');assert.ok(popup);assert.match(popup.textContent,/0 documento/);assert.doesNotMatch(popup.textContent,/nova/i);
 popup.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.ok(doc.querySelector('[data-sefaz-sync-result]'));
 doc.querySelector('main').textContent='MAIS UMA TELA';first.suspend();assert.equal(acks,0);await first.resume();assert.ok(doc.querySelector('[data-sefaz-sync-result]'));first.destroy();assert.equal(acks,0);
 const second=make();t.after(()=>second.destroy());await second.resume();doc.querySelector('[data-sefaz-sync-result] button').click();await tick();await second.resume();assert.equal(acks,1);assert.equal(doc.querySelector('[data-sefaz-sync-result]'),null);
});
test('partial outcome describes sources faithfully and failed local ACK remains visible',async t=>{
 assert.equal(typeof createSefazSyncSession,'function');const dom=new JSDOM('<body/>',{url:'https://fixture.test',pretendToBeVisual:true});t.after(()=>dom.window.close());
 const partial={...result,status:'partial',sources:{...result.sources,NFSE:{status:'failed',code:'DELIVERY_PENDING'}}};
 const session=createSefazSyncSession({document:dom.window.document,accountKey:'a',storage:{getItem:()=>null,setItem:()=>{throw Error('quota');}},client:{getSefazRefreshPending:async()=>({status:'pending',requests:[partial]})}});t.after(()=>session.destroy());
 await session.resume();const popup=dom.window.document.querySelector('[data-sefaz-sync-result]');assert.equal(popup.dataset.sefazSyncResult,'partial');assert.match(popup.textContent,/entrega ao SharePoint ainda não confirmada/);
 popup.querySelector('button').click();await tick();assert.ok(popup.isConnected);assert.match(popup.textContent,/Não foi possível salvar/);
});
test('controller owns fiscal monitor before opening gallery and cancels it on logout',async t=>{
 const handlers=new Map(),account={homeAccountId:'fiscal-owner'},store=createConversationStore();let factoryOptions,galleryOptions,resumes=0,destroyed=0,suspended=0;
 const monitor={resume:async()=>{resumes++;},suspend(){suspended++;},destroy(){destroyed++;}};
 const view={render(){},on(type,handler){handlers.set(type,handler);return()=>handlers.delete(type);},focusComposer(){},destroy(){}};
 const controller=createAppController({store,view,auth:{initialize:async()=>account,getToken:async()=> 'fake',signOut:async()=>{}},native:{importSharedItems:async()=>[]},
 client:{sendText:async()=>({status:'processed',messages:[]}),refreshSefaz:async()=>{},getSefazRefreshStatus:async()=>{},getSefazRefreshPending:async()=>{},acknowledgeSefazRefresh:async()=>{}},
 sefazSyncSessionFactory:options=>{factoryOptions=options;return monitor;},
 pendingProvisionAttachmentsDataFactory:async()=>({loadUpcomingPayments:async()=>[]}),pendingConstructionDiaryDataFactory:async()=>({loadPending:async()=>[]}),diaryFieldVisitDataFactory:async()=>({load:async()=>[]}),
 registrationGalleryDataFactory:async()=>({}),registrationGalleryFactory:async options=>{galleryOptions=options;return {open(){},close(){},destroy(){}};}});t.after(()=>controller.stop());
 await controller.start();assert.equal(resumes,1);assert.equal(factoryOptions.accountKey,'fiscal-owner');controller.handleBackground();assert.equal(suspended,1);await controller.handleForeground();assert.equal(resumes,2);
 await handlers.get('select-reply')({type:'select-reply',replyId:'action_notas_fiscais_sefaz_gallery',label:'NOTAS FISCAIS SEFAZ'});assert.equal(galleryOptions.syncMonitor,monitor);
 await handlers.get('sign-out')({type:'sign-out'});assert.equal(destroyed,1);assert.equal(factoryOptions.isCurrent(),false);
});
import {createDdaSyncReceipt} from '../src/ui/dda-sync-receipt.js';
test('fiscal receipt yields to a later DDA completion and returns without consuming either result',async t=>{
 const dom=new JSDOM('<body><main><button>Menu</button></main></body>',{url:'https://fixture.test',pretendToBeVisual:true});t.after(()=>dom.window.close());
 const doc=dom.window.document,session=createSefazSyncSession({document:doc,storage:dom.window.localStorage,accountKey:'a',client:{getSefazRefreshPending:async()=>({status:'pending',requests:[result]})}});t.after(()=>session.destroy());await session.resume();
 const dda=createDdaSyncReceipt({document:doc,host:doc.body,format:()=>'',global:true,requireAcknowledgement:true});t.after(()=>dda.destroy());
 dda.show({status:'succeeded',created:0},[],doc.activeElement);await tick();assert.equal(doc.querySelector('[data-sefaz-sync-result]'),null);
 assert.ok(doc.querySelector('[data-dda-sync-result]'));dda.close();await session.resume();assert.ok(doc.querySelector('[data-sefaz-sync-result]'));
});
