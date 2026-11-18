import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createNfeProposalView } from '../src/ui/nfe-proposal-view.js';

function fixture(t, overrides = {}) {
  const dom = new JSDOM('<main></main>');
  const doc = dom.window.document, host = doc.querySelector('main');
  const writes = [], discarded = [], picked = [];
  const fiscal = { total:'10',issueDate:'2026-11-18',dueDate:'2026-11-19',lines:[{number:'1',description:'Teste',unit:'UN',quantity:'1',unitPrice:'10',discount:'0',adjustment:'0'}] };
  const draft = {supplierId:'1',branchId:'2',accountId:'3',date:fiscal.issueDate,paymentDate:'2026-11-18',lines:[{...fiscal.lines[0],productId:'4',stageId:'5',date:fiscal.issueDate,dueDate:fiscal.dueDate}]};
  const catalog = {suppliers:[{id:'1',label:'Fornecedor'}],branches:[{id:'2',label:'Obra'}],accounts:[{id:'3',label:'Conta'}],products:[{id:'4',label:'Produto',unit:'UN',expenseType:'MATERIAL'}],stages:[{id:'5',label:'Etapa',branch:'Obra'}]};
  const view = createNfeProposalView({ document:doc,host,onPosted:()=>{},
    attachments:{async pick(source) { picked.push(source); return [new File([source], `${source}.jpg`)]; },async discard(sourceId) {discarded.push(sourceId);}},
    service:{async load(){return {fiscal,catalog,draft:structuredClone(draft)};},async submit(_row,_draft,options){writes.push(options.additionalAttachments);return {orderId:'40'};},async appendAttachments(row,files){return this.submit(row,null,{additionalAttachments:files});},...overrides},
  });
  t.after(()=>{view.close();dom.window.close();});
  return {view,doc,host,writes,discarded,picked,dom};
}
const tick = () => new Promise(resolve=>setImmediate(resolve));

test('internal tray follows all lines, accepts each source and submits its files', async t => {
  const h = fixture(t); await h.view.show({id:'7',pdfName:'nota.pdf'});
  const tray=h.host.querySelector('.nfe-proposal-attachments');
  assert.equal(tray?.previousElementSibling?.className,'nfe-proposal-lines');
  for (const source of ['camera','photos','scan','files']) {
    tray.querySelector('[data-add-proposal-attachment]').click();
    tray.querySelector(`[data-proposal-source="${source}"]`).click(); await tick();
  }
  assert.deepEqual(h.picked,['camera','photos','scan','files']);
  assert.equal(tray.querySelectorAll('[data-proposal-file]').length,4);
  h.host.querySelector('[data-nfe-proposal-submit]').click(); await tick();
  assert.deepEqual(h.writes[0].map(file=>file.name),['camera.jpg','photos.jpg','scan.jpg','files.jpg']);
});

test('captured shares stay with their invoice across loading, close and reopen, and deduplicate inbox ids', async t => {
  const h=fixture(t);
  await h.view.show({id:'7',pdfName:'nota.pdf'});
  const receiver=h.view.captureAttachmentReceiver();
  const file = new File(['photo'],'encaminhado.jpg'); Object.defineProperty(file,'sourceId',{value:'share-1'});
  await receiver([file]); await receiver([file]);
  h.view.close();
  await h.view.show({id:'8',pdfName:'outra.pdf'});
  await receiver([new File(['old invoice'],'antigo.jpg')]);
  assert.equal(h.host.querySelectorAll('[data-proposal-file]').length,0);
  h.view.close(); await h.view.show({id:'7',pdfName:'nota.pdf'});
  assert.equal(h.host.querySelectorAll('[data-proposal-file]').length,2);
  h.host.querySelector('[data-nfe-proposal-submit]').click(); await tick();
  assert.equal(h.writes[0].length,2);
  assert.deepEqual(h.discarded,['share-1']);
});

test('shares received during posting are included before the proposal closes', async t => {
  let release; const pending=new Promise(resolve=>{release=resolve;}); const sent=[];
  const h=fixture(t,{async submit(_row,_draft,options){sent.push(options.additionalAttachments);if(sent.length===1)await pending;return {orderId:'40'};}});
  await h.view.show({id:'7',pdfName:'nota.pdf'});
  h.host.querySelector('[data-nfe-proposal-submit]').click(); await tick();
  const receiver=h.view.captureAttachmentReceiver();
  await receiver([new File(['late'],'late.jpg')]); release(); await tick();await tick();
  assert.equal(sent.length,2); assert.equal(sent[1][0].name,'late.jpg'); assert.equal(h.view.isOpen,false);
});

test('posting waits for an in-flight native inbox read before closing the proposal', async t => {
  const h=fixture(t); await h.view.show({id:'7',pdfName:'nota.pdf'});
  const receiver=h.view.captureAttachmentReceiver();
  h.host.querySelector('[data-nfe-proposal-submit]').click();await tick();
  assert.equal(h.view.isOpen,true);
  receiver([new File(['slow import'],'slow.jpg')]);await tick();await tick();
  assert.equal(h.writes.at(-1)[0].name,'slow.jpg');assert.equal(h.view.isOpen,false);
});

test('reopening the same invoice waits for its previous native reader and displays the delivered file', async t=>{
  const h=fixture(t);await h.view.show({id:'7'});
  const receive=h.view.captureAttachmentReceiver();h.view.close();await h.view.show({id:'7'});
  h.host.querySelector('[data-nfe-proposal-submit]').click();await tick();assert.equal(h.view.isOpen,true);
  await receive([new File(['reopened'],'reopened.jpg')]);await tick();await tick();
  assert.equal(h.writes[0][0].name,'reopened.jpg');assert.equal(h.view.isOpen,false);
});

test('a linked order resumes only attachment delivery without rebuilding or submitting financial rows', async t=>{
  let creates=0,appends=0;
  const h=fixture(t,{async load(){throw new Error('must not reload financial proposal');},async submit(){creates++;},async appendAttachments(_row,files){appends++;assert.equal(files[0].name,'pending.jpg');return {orderId:'40'};}});
  await h.view.show({id:'7',orderId:'40'});
  await h.view.captureAttachmentReceiver()([new File(['pending'],'pending.jpg')]);
  h.host.querySelector('[data-nfe-proposal-submit]').click();await tick();
  assert.equal(creates,0);assert.equal(appends,1);assert.equal(h.view.isOpen,false);
});
