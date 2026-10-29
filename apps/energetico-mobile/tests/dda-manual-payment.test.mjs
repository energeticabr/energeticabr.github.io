import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createRegistrationGallery} from '../src/ui/registration-gallery-view.js';
import {createChatClient} from '../src/chat/chat-client.js';
import {normalizeDdaReportRows,buildDdaReport} from '../src/chat/dda-report-model.js';
import {buildDdaGalleryMetrics} from '../src/chat/dda-gallery-metrics.js';
import {createDdaPaymentConfirmation} from '../src/ui/dda-payment-confirmation.js';
const key='a'.repeat(64), tick=()=>new Promise(r=>setImmediate(r));
const row=()=>({id:'31',fields:{Title:'FORNECEDOR FICTÍCIO',CHAVE_DDA:key,SITUACAO:'Em aberto',VALOR:58.21,VALOR_PAGAMENTO:58.21,VENCIMENTO:'2026-10-28'}});
const receipt={status:'confirmed',itemId:31,key,confirmedAt:'2026-10-28T18:00:00Z',confirmedBy:'teste@example.test'};

test('manual confirmation stays paid after bank refresh and is excluded from pending report and amounts',()=>{
 const snapshot={rows:[{...row(),fields:{...row().fields,PGTO_CONFIRMADO:true,PGTO_CONFIRMADO_EM:receipt.confirmedAt}}]};
 const rows=normalizeDdaReportRows(snapshot);assert.equal(rows[0].status,'Pago');
 assert.equal(buildDdaReport(rows,{status:'Não pagos'}).rows.length,0);
 assert.equal(buildDdaGalleryMetrics(snapshot,new Date('2026-10-28T18:00:00Z')).total,'0.00');
 for(const value of [false,'false',0,null])assert.equal(normalizeDdaReportRows({rows:[{...row(),fields:{...row().fields,PGTO_CONFIRMADO:value}}]})[0].status,'Em aberto');
});

test('check asks confirmation; Cancel never writes; Yes writes once and shows paid',async t=>{
 const dom=new JSDOM('<body/>'),doc=dom.window.document;let calls=0,resolve;
 const panel=createRegistrationGallery({document:doc,kind:'dda',data:{loadSnapshot:async()=>({rows:[row()]})},
  confirmPayment:async request=>{calls++;assert.equal(request.itemId,31);assert.equal(request.key,key);return new Promise(r=>resolve=r);}});
 t.after(()=>{panel.destroy();dom.window.close();});await panel.open();
 doc.querySelector('[data-dda-confirm-payment]').click();assert.equal(calls,0);
 assert.match(doc.querySelector('[data-dda-payment-dialog]').textContent,/Confirma.*pagamento/i);
 doc.querySelector('[data-dda-payment-cancel]').click();assert.equal(calls,0);
 doc.querySelector('[data-dda-confirm-payment]').click();
 const yes=doc.querySelector('[data-dda-payment-yes]');yes.click();yes.click();await tick();assert.equal(calls,1);
 resolve(receipt);await tick();await tick();
 assert.match(doc.querySelector('[data-dda-payment-dialog]').textContent,/Pagamento confirmado/);
 assert.equal(doc.querySelector('[data-filter-field="SITUACAO"]').value,'Em aberto');
 assert.equal(doc.querySelector('.rg-row--dda'),null);
 doc.querySelector('[data-dda-payment-cancel]').click();
 const status=doc.querySelector('[data-filter-field="SITUACAO"]');
 status.value='';status.dispatchEvent(new dom.window.Event('change'));await tick();
 assert.match(doc.querySelector('.rg-dda-status').textContent,/Pago/);
 assert.equal(doc.querySelector('[data-dda-confirm-payment]').disabled,true);
 assert.match(doc.querySelector('.rg-row--dda').textContent,/Confirmado pelo usuário/);
 assert.equal(doc.activeElement,doc.querySelector('.rg-overlay'));
});

for(const mode of ['failed','invalid'])test('payment '+mode+' never changes the card and allows retry',async t=>{
 const dom=new JSDOM('<body/>'),doc=dom.window.document;
 const panel=createRegistrationGallery({document:doc,kind:'dda',data:{loadSnapshot:async()=>({rows:[row()]})},
  confirmPayment:async()=>{if(mode==='failed')throw Error('offline');return {...receipt,itemId:99};}});
 t.after(()=>{panel.destroy();dom.window.close();});await panel.open();
 doc.querySelector('[data-dda-confirm-payment]').click();doc.querySelector('[data-dda-payment-yes]').click();await tick();await tick();
 assert.match(doc.querySelector('.rg-dda-status').textContent,/Em aberto/);
 assert.match(doc.querySelector('[data-dda-payment-dialog]').textContent,/Não foi possível confirmar/);
 assert.equal(doc.querySelector('[data-dda-payment-yes]').disabled,false);
});

test('authenticated manual confirmation validates identity and receipt and sends no actor supplied by UI',async()=>{
 const bodies=[];
 const client=createChatClient({apiBaseUrl:'https://example.test',tokenProvider:async()=> 'test-only',
 fetchImpl:async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer test-only');bodies.push(JSON.parse(options.body));return new Response(JSON.stringify({status:'processed',messages:[],ddaPaymentConfirmation:receipt}),{status:200});}});
 assert.deepEqual(await client.confirmDdaPayment({itemId:31,key}),receipt);
 assert.deepEqual(bodies,[{action:'dda_payment_confirm',itemId:31,key}]);
 await assert.rejects(client.confirmDdaPayment({itemId:-1,key}));
 await assert.rejects(client.confirmDdaPayment({itemId:31,key:'wrong'}));
});

test('an unresponsive confirmation stops on deadline without showing payment success',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const dom=new JSDOM('<body><main></main></body>'),doc=dom.window.document;let confirmed=0;
 const dialog=createDdaPaymentConfirmation({document:doc,host:doc.querySelector('main'),confirmPayment:()=>new Promise(()=>{}),onConfirmed:()=>confirmed++,timeoutMs:100});
 t.after(()=>{dialog.destroy();dom.window.close();});
 dialog.show({itemId:31,key,supplier:'FICTÍCIO',amount:'R$ 58,21',due:'28/10/2026'});
 doc.querySelector('[data-dda-payment-yes]').click();t.mock.timers.tick(101);await tick();
 assert.equal(confirmed,0);assert.match(doc.querySelector('[data-dda-payment-dialog]').textContent,/Não foi possível confirmar/);
 assert.equal(doc.querySelector('[data-dda-payment-yes]').disabled,false);
});

test('closing the gallery suppresses late confirmation and restores focus/background',async t=>{
 const dom=new JSDOM('<body/>'),doc=dom.window.document;let resolve;
 const panel=createRegistrationGallery({document:doc,kind:'dda',data:{loadSnapshot:async()=>({rows:[row()]})},confirmPayment:()=>new Promise(r=>resolve=r)});
 t.after(()=>{panel.destroy();dom.window.close();});await panel.open();
 doc.querySelector('[data-dda-confirm-payment]').click();doc.querySelector('[data-dda-payment-yes]').click();await tick();
 panel.close();resolve(receipt);await tick();assert.equal(doc.querySelector('[data-dda-payment-dialog]'),null);
 await panel.open();assert.match(doc.querySelector('.rg-dda-status').textContent,/Em aberto/);
 assert.equal(doc.querySelector('.rg-header').inert,false);
});
