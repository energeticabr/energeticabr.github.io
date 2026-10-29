import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createDdaReportView} from '../src/ui/dda-report-view.js';
const key='a'.repeat(64), tick=()=>new Promise(r=>setImmediate(r));
const receipt={status:'confirmed',itemId:31,key,confirmedAt:'2026-10-28T18:00:00Z',confirmedBy:'test@example.test'};
const row=(id=31,status='Em aberto')=>({id:String(id),fields:{Title:'FORNECEDOR FICTÍCIO',CHAVE_DDA:id===31?key:'b'.repeat(64),SITUACAO:status,VALOR:58.21,VENCIMENTO:'2026-10-28',BANCO:'BANCO TESTE'}});
async function setup(t,{confirmPayment=async()=>receipt,rows=[row(),row(32)],...options}={}){
 const dom=new JSDOM('<body><main id="app"><button>Início</button></main></body>'),doc=dom.window.document;
 const view=createDdaReportView({document:doc,data:{loadSnapshot:async()=>({rows})},confirmPayment,now:()=>new Date('2026-10-28T12:00:00Z'),...options});
 t.after(()=>{view.destroy();dom.window.close();});await view.open();
 const filter=value=>{doc.querySelector('[name=status]').value=value;doc.querySelector('[name=status]').dispatchEvent(new dom.window.Event('change'));};
 return {doc,dom,view,filter};
}
test('report check opens a nested confirmation; cancel and Escape keep the report open without writing',async t=>{
 let calls=0;const h=await setup(t,{confirmPayment:async()=>{calls++;return receipt;}});
 const check=h.doc.querySelector('[data-dda-confirm-payment="31"]');assert.ok(check);check.click();
 assert.equal(h.view.element.hidden,false);assert.equal(h.doc.querySelector('.ddr-dialog').inert,true);assert.equal(calls,0);
 h.doc.querySelector('[data-dda-payment-cancel]').click();assert.equal(calls,0);assert.equal(h.doc.activeElement,check);
 check.click();h.doc.querySelector('[data-dda-payment-dialog]').dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(h.view.element.hidden,false);assert.equal(h.doc.querySelector('[data-dda-payment-dialog]'),null);assert.equal(h.doc.querySelector('.ddr-dialog').inert,false);
});
test('confirmed payment updates only that row in All, keeps report and filters, and prevents double submission',async t=>{
 let resolve,calls=0;const h=await setup(t,{confirmPayment:async args=>{calls++;assert.equal(args.itemId,31);assert.equal(args.key,key);return new Promise(r=>resolve=r);}});h.filter('');
 h.doc.querySelector('[data-dda-confirm-payment="31"]').click();const yes=h.doc.querySelector('[data-dda-payment-yes]');yes.click();yes.click();await tick();assert.equal(calls,1);
 resolve(receipt);await tick();await tick();
 assert.equal(h.view.element.hidden,false);assert.equal(h.doc.querySelector('[name=status]').value,'');
 assert.match(h.doc.querySelector('[data-dda-id="31"] .ddr-status').textContent,/Pago.*Confirmado pelo usuário/s);
 assert.match(h.doc.querySelector('[data-dda-id="32"] .ddr-status').textContent,/Em aberto/);
 assert.equal(h.doc.querySelector('[data-dda-confirm-payment="31"]').disabled,true);
 assert.match(h.doc.querySelector('[data-dda-payment-dialog]').textContent,/Pagamento confirmado/);
 h.doc.querySelector('[data-dda-payment-cancel]').click();assert.equal(h.doc.querySelector('.ddr-dialog').inert,false);
 h.filter('Em aberto');assert.equal(h.doc.querySelectorAll('tbody tr').length,1);assert.match(h.doc.querySelector('[data-dda-summary]').textContent,/58,21/);
});
test('open filter removes confirmed row and updates totals below the still-open popup',async t=>{
 const h=await setup(t);h.doc.querySelector('[data-dda-confirm-payment="31"]').click();h.doc.querySelector('[data-dda-payment-yes]').click();await tick();await tick();
 assert.equal(h.doc.querySelector('[data-dda-id="31"]'),null);assert.equal(h.doc.querySelectorAll('tbody tr').length,1);assert.equal(h.view.element.hidden,false);
 assert.match(h.doc.querySelector('[data-dda-summary]').textContent,/58,21/);assert.ok(h.doc.querySelector('[data-dda-payment-dialog]'));
});
for(const mode of ['failed','invalid'])test('report payment '+mode+' preserves unpaid data and allows retry',async t=>{
 const h=await setup(t,{confirmPayment:async()=>{if(mode==='failed')throw Error('private');return {...receipt,key:'c'.repeat(64)};}});
 h.doc.querySelector('[data-dda-confirm-payment="31"]').click();h.doc.querySelector('[data-dda-payment-yes]').click();await tick();await tick();
 assert.match(h.doc.querySelector('[data-dda-id="31"] .ddr-status').textContent,/Em aberto/);assert.equal(h.doc.querySelector('[data-dda-payment-yes]').disabled,false);assert.doesNotMatch(h.doc.body.textContent,/private/);
});
test('paid rows and missing identity cannot submit; closing ignores a late payment response',async t=>{
 const missing=row(33);delete missing.fields.CHAVE_DDA;let resolve;
 const h=await setup(t,{rows:[row(),row(32,'Pago'),missing],confirmPayment:()=>new Promise(r=>resolve=r)});h.filter('');
 for(const id of [32,33])assert.equal(h.doc.querySelector(`[data-dda-confirm-payment="${id}"]`).disabled,true);
 h.doc.querySelector('[data-dda-confirm-payment="31"]').click();h.doc.querySelector('[data-dda-payment-yes]').click();await tick();h.view.close();resolve(receipt);await tick();
 assert.equal(h.doc.querySelector('[data-dda-payment-dialog]'),null);await h.view.open();assert.match(h.doc.querySelector('[data-dda-id="31"] .ddr-status').textContent,/Em aberto/);
});
