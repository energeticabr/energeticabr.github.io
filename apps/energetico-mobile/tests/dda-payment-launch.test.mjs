import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createDdaPaymentConfirmation } from '../src/ui/dda-payment-confirmation.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';
import { createDdaReportView } from '../src/ui/dda-report-view.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
const key = 'a'.repeat(64);
const receipt = { status:'confirmed',itemId:31,key,confirmedAt:'2026-10-30T12:00:00Z',confirmedBy:'test@example.test' };
const row = { id:'31',fields:{Title:'FORNECEDOR FICTÍCIO',CHAVE_DDA:key,SITUACAO:'Em aberto',VALOR:58.21,VENCIMENTO:'2026-11-20'} };

async function fixture(t, options = {}) {
  const dom = new JSDOM('<body><main></main></body>');
  const doc = dom.window.document;
  let payments = 0, launches = 0;
  const dialog = createDdaPaymentConfirmation({ document:doc,host:doc.querySelector('main'),
    confirmPayment:async () => { payments++; return receipt; },onConfirmed:()=>{},
    onStartLaunch:async request => { launches++; assert.equal(request.itemId,31); assert.equal(request.key,key); assert.ok(request.signal); return true; },...options });
  t.after(()=>{dialog.destroy();dom.window.close();});
  dialog.show({itemId:'31',key,supplier:'FORNECEDOR FICTÍCIO',amount:'R$ 58,21',due:'20/11/2026'});
  return {doc,dialog,counts:()=>({payments,launches}),confirm:async()=>{doc.querySelector('[data-dda-payment-yes]').click();await tick();}};
}

test('only a confirmed payment offers starting launch; declining never starts it',async t=>{
  const h = await fixture(t);
  assert.equal(h.doc.querySelector('[data-dda-launch-yes]'),null);
  await h.confirm();
  assert.match(h.doc.querySelector('[data-dda-payment-dialog]').textContent,/Deseja iniciar um lançamento usando os anexos deste DDA/);
  assert.deepEqual(h.counts(),{payments:1,launches:0});
  assert.match(h.doc.querySelector('[data-dda-payment-cancel]').textContent,/Não/);
  h.doc.querySelector('[data-dda-payment-cancel]').click();
  assert.equal(h.dialog.isOpen,false); assert.deepEqual(h.counts(),{payments:1,launches:0});
});

test('accepting sends the paid row identity once and closes after successful handoff',async t=>{
  const h = await fixture(t); await h.confirm();
  const yes=h.doc.querySelector('[data-dda-launch-yes]');assert.ok(yes);
  yes.click();yes.click();await tick();
  assert.deepEqual(h.counts(),{payments:1,launches:1}); assert.equal(h.dialog.isOpen,false);
});

test('a handoff failure retries only launch, never repeats payment confirmation',async t=>{
  let attempts=0;
  const h=await fixture(t,{onStartLaunch:async()=>{if(++attempts===1)throw Error('private');return true;}});
  await h.confirm();h.doc.querySelector('[data-dda-launch-yes]').click();await tick();
  assert.match(h.doc.querySelector('[role=alert]').textContent,/pagamento.*confirmado.*anexos/i);
  assert.doesNotMatch(h.doc.body.textContent,/private/);
  h.doc.querySelector('[data-dda-launch-yes]').click();await tick();
  assert.equal(attempts,2);assert.equal(h.counts().payments,1);assert.equal(h.dialog.isOpen,false);
});

test('closing during launch aborts transfer and ignores late success',async t=>{
  let resolve,signal;
  const h=await fixture(t,{onStartLaunch:request=>{signal=request.signal;return new Promise(r=>resolve=r);}});
  await h.confirm();h.doc.querySelector('[data-dda-launch-yes]').click();await tick();
  h.dialog.close();assert.equal(signal.aborted,true);resolve(true);await tick();
  assert.equal(h.dialog.isOpen,false);assert.equal(h.doc.querySelector('[data-dda-payment-dialog]'),null);
});

for(const mode of ['gallery','report'])test(mode+' passes the post-payment launch callback',async t=>{
  const dom=new JSDOM('<body/>'),doc=dom.window.document;let launched;
  const options={document:doc,data:{loadSnapshot:async()=>({rows:[row]})},confirmPayment:async()=>receipt,
    onStartLaunch:async request=>{launched=request;return true;}};
  const panel=mode==='gallery'?createRegistrationGallery({...options,kind:'dda'}):createDdaReportView(options);
  t.after(()=>{panel.destroy();dom.window.close();});await panel.open();
  doc.querySelector('[data-dda-confirm-payment]').click();doc.querySelector('[data-dda-payment-yes]').click();await tick();
  const yes=doc.querySelector('[data-dda-launch-yes]');assert.ok(yes);
  yes.click();await tick();assert.equal(launched.itemId,31);assert.equal(launched.key,key);
  assert.equal(doc.querySelector(mode==='gallery'?'.rg-overlay':'.ddr-overlay').hidden,true,'the source panel must reveal the launch flow');
});
