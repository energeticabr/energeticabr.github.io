import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createAppController} from '../src/app-controller.js';
import {createConversationStore} from '../src/chat/conversation-store.js';
import {createSefazSyncSession} from '../src/ui/sefaz-sync-session.js';
import {createSefazSyncReceipt} from '../src/ui/sefaz-sync-receipt.js';
import {createDdaSyncSession} from '../src/ui/dda-sync-session.js';
const id='a'.repeat(32),tick=()=>new Promise(r=>setImmediate(r));
const result={requestId:id,status:'succeeded',startedUtc:'2026-10-29T10:00:00Z',completedUtc:'2026-10-29T10:01:00Z',sources:{NFE:{status:'succeeded',documents:0},CTE:{status:'succeeded',documents:0},NFSE:{status:'succeeded',documents:0}}};

test('each fiscal result cluster identifies only its added rows beside its source summary',async t=>{
 const dom=new JSDOM('<body/>',{pretendToBeVisual:true});t.after(()=>dom.window.close());
 let acknowledged=0;
 const view=createSefazSyncReceipt({document:dom.window.document,onAcknowledge:async()=>{acknowledged++;return true;}});
 t.after(()=>view.destroy());
 view.show({...result,sources:{NFE:{status:'succeeded',documents:4,createdItemIds:[71,72]},
  CTE:{status:'succeeded',documents:2,createdItemIds:[8]},NFSE:{status:'succeeded',documents:1,createdItemIds:[]}}});
 const rows=[...dom.window.document.querySelectorAll('[data-sefaz-source]')];
 assert.deepEqual(rows.map(row=>row.dataset.sefazSource),['NFE','CTE','NFSE']);
 assert.deepEqual(rows.map(row=>[...row.querySelectorAll('[data-sefaz-created-id]')].map(node=>node.textContent)),[['#71','#72'],['#8'],[]]);
 for(const row of rows) assert.ok(row.firstElementChild.classList.contains('sefaz-sync-created-ids'));
 assert.match(rows[0].querySelector('.sefaz-sync-source-content').textContent,/NF-e.*4 documento/);
 assert.match(rows[2].querySelector('.sefaz-sync-created-ids').getAttribute('aria-label'),/Sem linhas adicionadas/);
 assert.equal(acknowledged,0);
 dom.window.document.querySelector('.sefaz-sync-ack').click();await tick();
 assert.equal(acknowledged,1);assert.equal(dom.window.document.querySelector('[data-sefaz-sync-result]'),null);
});

test('legacy fiscal counts are never converted into row IDs or claimed as zero additions',t=>{
 const dom=new JSDOM('<body/>',{pretendToBeVisual:true});t.after(()=>dom.window.close());
 const view=createSefazSyncReceipt({document:dom.window.document});t.after(()=>view.destroy());
 view.show({...result,sources:{...result.sources,NFE:{status:'succeeded',documents:19}}});
 assert.equal(dom.window.document.querySelectorAll('[data-sefaz-created-id]').length,0);
 assert.match(dom.window.document.querySelector('.sefaz-sync-created-ids').getAttribute('aria-label'),/IDs não informados/);
 assert.match(dom.window.document.querySelector('.sefaz-sync-created-ids').textContent,/Não informados/);
 assert.match(dom.window.document.querySelector('[data-sefaz-source="NFE"]').textContent,/19 documento/);
});
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
test('a later failed DDA update waits until the visible fiscal result is acknowledged',async t=>{
 const dom=new JSDOM('<body><main><button>Menu</button></main></body>',{url:'https://fixture.test',pretendToBeVisual:true});
 const doc=dom.window.document,acknowledged=[];let retry;
 const fiscal=createSefazSyncSession({document:doc,storage:dom.window.localStorage,accountKey:'a',client:{
  getSefazRefreshPending:async()=>({status:'pending',requests:[result]}),
  acknowledgeSefazRefresh:async requestId=>{acknowledged.push('fiscal');return {status:'acknowledged',requestId};}
 }});
 const dda=createDdaSyncSession({document:doc,storage:dom.window.localStorage,accountKey:'a',
  schedule:callback=>{retry=callback;return 0;},cancel(){},client:{
  getDdaRefreshPending:async()=>({status:'pending',requests:[{requestId:'b'.repeat(32),status:'failed'}]}),
  acknowledgeDdaRefresh:async requestId=>{acknowledged.push('dda');return {status:'acknowledged',requestId};}
 }});
 t.after(()=>{fiscal.destroy();dda.destroy();dom.window.close();});
 await fiscal.resume();
 const fiscalPopup=doc.querySelector('[data-sefaz-sync-result]');
 await dda.resume();await tick();
 assert.ok(fiscalPopup.isConnected);
 assert.equal(doc.querySelector('[data-dda-sync-result]'),null);
 assert.deepEqual(acknowledged,[]);

 fiscalPopup.querySelector('button').click();await tick();retry();await tick();
 const ddaPopup=doc.querySelector('[data-dda-sync-result="failed"]');
 assert.ok(ddaPopup);
 assert.match(ddaPopup.textContent,/Atualização não confirmada/);
 assert.deepEqual(acknowledged,['fiscal']);
 ddaPopup.querySelector('button').click();await tick();
 assert.equal(ddaPopup.isConnected,false);
 assert.deepEqual(acknowledged,['fiscal','dda']);
});

test('returning from the background keeps the already visible bank receipt ahead of fiscal results',async t=>{
 const dom=new JSDOM('<body><main><button>Menu</button></main></body>',{url:'https://fixture.test',pretendToBeVisual:true});
 const doc=dom.window.document;let visibility='visible',detailsRead=0;
 Object.defineProperty(doc,'visibilityState',{get:()=>visibility});
 const setVisibility=value=>{visibility=value;doc.dispatchEvent(new dom.window.Event('visibilitychange'));};
 const dda=createDdaSyncSession({document:doc,storage:dom.window.localStorage,accountKey:'a',loadRows:async()=>{
  if(++detailsRead>1)throw Error('Offline');return [];
 },client:{getDdaRefreshPending:async()=>({status:'pending',requests:[{requestId:'b'.repeat(32),status:'succeeded',created:1,createdItemIds:[42]}]})}});
 const fiscal=createSefazSyncSession({document:doc,storage:dom.window.localStorage,accountKey:'a',
  client:{getSefazRefreshPending:async()=>({status:'pending',requests:[result]})}});
 t.after(()=>{fiscal.destroy();dda.destroy();dom.window.close();});
 await dda.resume();await fiscal.resume();
 const bankPopup=doc.querySelector('[data-dda-sync-result]');
 assert.ok(bankPopup);
 setVisibility('hidden');setVisibility('visible');
 await tick();
 assert.ok(bankPopup.isConnected,'the previously open result is still on screen');
 assert.equal(doc.querySelector('[data-sefaz-sync-result]'),null);
 assert.equal(detailsRead,1);
});
