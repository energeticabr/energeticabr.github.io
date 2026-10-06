import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createPaymentLedgerView} from '../src/ui/payment-ledger-view.js';
import {createCargosView} from '../src/ui/cargos-view.js';
import {createQuotationReportView} from '../src/ui/quotation-report-view.js';
import {createAttachmentPreview} from '../src/web/attachment-preview.js';
import {renderChatMarkup,commandFromTarget,createChatView} from '../src/ui/chat-view.js';
const api=await import('../src/ui/report-print.js').catch(()=>({}));
import {buildFilteredReportPdf} from '../src/chat/filtered-report-pdf.js';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('pending provisions, the sixteenth report, exposes a printer command distinct from payment/reminder writes',()=>{
 const dom=new JSDOM(renderChatMarkup({sessionStatus:'authenticated',account:{name:'Bernardo'},messages:[],pendingFiles:[],pendingProvisions:{due:true,rows:[]}}));
 const button=dom.window.document.querySelector('[data-action="print-pending-provisions"]');assert.ok(button);assert.deepEqual(commandFromTarget(button.querySelector('path')),{type:'print-pending-provisions'});dom.window.close();
});
const row={id:'3503',order:'360',branch:'004 - EDIFÍCIO XAVANTE',supplier:'Alfa',account:'CAIXA',product:'TARIFA',paymentDate:'2026-10-02',unit:100,quantity:1,freight:0,total:100};
function fixture(t,rows=[row]){
 const dom=new JSDOM('<main id="app"><button id="mascot">Mascote</button></main>');
 dom.window.matchMedia=()=>({matches:false});
 const original=createPaymentLedgerView({document:dom.window.document,data:{loadPaymentsSnapshot:async()=>({launches:rows})}});
 t.after(()=>{original.destroy();dom.window.close();});return {dom,original};
}
function text(snapshot){return snapshot.pages.flatMap(page=>page.blocks).flatMap(block=>block.type==='table'?block.rows.flatMap(row=>row.cells.flatMap(cell=>cell.runs.map(run=>run.text))):block.runs.map(run=>run.text)).join(' ');}

test('mixed inline summary text stays separated in the actual PDF',async()=>{
 const dom=new JSDOM('<section><p><b>VALOR TOTAL</b><span>R$ 100,00</span></p><table><tr><td><strong>ALFA</strong> fornecedor <span>ATIVO</span></td></tr></table></section>');
 try{
  const snapshot=api.captureFilteredReport(dom.window.document.querySelector('section'),{title:'Resumo'});
  assert.equal(snapshot.pages[0].blocks[0].runs.map(run=>run.text).join('').trim(),'VALOR TOTAL R$ 100,00');
  const blob=await buildFilteredReportPdf(snapshot),task=getDocument({data:new Uint8Array(await blob.arrayBuffer()),disableFontFace:true,useSystemFonts:true}),pdf=await task.promise;
  try{const content=await(await pdf.getPage(1)).getTextContent(),value=content.items.map(item=>item.str).join(' ');assert.match(value,/VALOR TOTAL\s+R\$ 100,00/);assert.match(value,/ALFA\s+fornecedor\s+ATIVO/);}finally{await task.destroy();}
 }finally{dom.window.close();}
});
test('printer exports all matching pages and restores the selected page, filters and scroll',async t=>{
 assert.equal(typeof api.captureFilteredReport,'function');
 const rows=Array.from({length:34},(_,i)=>({...row,id:String(8000+i),supplier:`Fornecedor ${i}`,product:`PRODUTO ${i}`}));
 const {dom,original}=fixture(t,[...rows,{...row,id:'EXCLUDED',branch:'Outra filial',product:'NÃO INCLUIR'}]);await original.open();
 const select=original.element.querySelector('[name=branch]');select.value=row.branch;select.dispatchEvent(new dom.window.Event('change'));
 original.element.querySelector('.pl-pager button:last-child').click();
 const before=original.element.querySelector('.pl-pager span').textContent,scroll=original.element.querySelector('.pl-table-scroll');scroll.scrollTop=123;
 const snapshot=api.captureFilteredReport(original.element,{title:'Pagamentos'});
 assert.equal(snapshot.pages.length,3);assert.match(text(snapshot),/PRODUTO 33/);assert.doesNotMatch(text(snapshot),/NÃO INCLUIR|EXCLUDED/);
 assert.equal(original.element.querySelector('.pl-pager span').textContent,before);assert.equal(select.value,row.branch);assert.equal(scroll.scrollTop,123);
 assert.ok(snapshot.filters.some(filter=>filter.label==='FILIAL'&&filter.value===row.branch));
 assert.ok(snapshot.filters.some(filter=>filter.value==='Desde o início'));assert.ok(snapshot.filters.some(filter=>filter.value==='Até o fim'));
});
test('capture preserves literal text, bold, red values, merged cells and excludes popup options/buttons',()=>{
 assert.equal(typeof api.captureFilteredReport,'function');
 const dom=new JSDOM(`<section role="dialog" aria-label="Relatório"><div class="pl-filters"><label>Fornecedor<select name="supplier" hidden><option>Todos</option><option selected>ALFA</option><option>EXCLUDED OPTION</option></select></label><div class="sfs-popup">EXCLUDED POPUP</div></div><h2>RESUMO</h2><table><thead><tr><th>FILIAL</th><th>VALOR</th></tr></thead><tbody><tr><td rowspan="2">XAVANTE</td><td style="color:rgb(255,0,0)"><strong>R$ 100,00</strong></td></tr><tr><td>&lt;script&gt;cliente&lt;/script&gt;</td></tr></tbody></table><button>EXCLUDED BUTTON</button></section>`);
 const snapshot=api.captureFilteredReport(dom.window.document.querySelector('section'),{title:'Relatório'}),table=snapshot.pages[0].blocks.find(block=>block.type==='table');
 assert.equal(table.rows[2].cells[0].runs[0].text,'XAVANTE');
 const red=table.rows[1].cells[1].runs.find(run=>run.text.includes('100,00'));assert.equal(red.bold,true);assert.deepEqual(red.color,[1,0,0]);
 assert.match(text(snapshot),/<script>cliente<\/script>/);assert.doesNotMatch(text(snapshot),/EXCLUDED/);dom.window.close();
});
test('print opens the existing PDF viewer, shares only on click, and close returns to the same filtered report',async t=>{
 assert.equal(typeof api.decorateReportPrint,'function');
 const {dom,original}=fixture(t,[row,{...row,id:'3504',supplier:'Beta'}]);let captured,shared=0;
 const preview=createAttachmentPreview({documentRef:dom.window.document,exportMedia:async()=>shared++,loadPdfPreview:async()=>({createPdfPreview:()=>({element:dom.window.document.createElement('canvas'),render:async()=>{},destroy(){}})})});
 const view=api.decorateReportPrint(original,{action:'open-payment-ledger',previewMedia:preview.open,closePreview:preview.close,buildPdf:async snapshot=>{captured=snapshot;return new Blob(['%PDF-test'],{type:'application/pdf'});},loadLogo:async()=>undefined});
 t.after(()=>{view.destroy();preview.destroy();});await view.open();
 const filter=view.element.querySelector('[name=supplier]');filter.value='Alfa';filter.dispatchEvent(new dom.window.Event('change'));
 view.element.querySelector('[data-action=print-report-pdf]').click();await tick();await tick();
 assert.equal(dom.window.document.querySelector('.attachment-preview-dialog').open,true);assert.equal(shared,0);assert.match(text(captured),/Alfa/);assert.doesNotMatch(text(captured),/Beta/);
 dom.window.document.querySelector('.attachment-preview-export').click();await tick();assert.equal(shared,1);
 assert.equal(dom.window.document.querySelector('.attachment-preview-back').textContent,'Voltar ao relatório');
 dom.window.document.querySelector('.attachment-preview-close').click();assert.equal(view.element.hidden,false);assert.equal(filter.value,'Alfa');assert.equal(view.element.querySelectorAll('tbody tr').length,1);
 assert.equal(dom.window.document.activeElement,view.element.querySelector('[data-action=print-report-pdf]'));
});
test('a busy or closed report cannot export and destroying it closes a still-loading PDF',async t=>{
 assert.equal(typeof api.decorateReportPrint,'function');const {original}=fixture(t);let calls=0,closes=0,done;
 const view=api.decorateReportPrint(original,{action:'open-payment-ledger',previewMedia:async promise=>{calls++;await promise;},closePreview:()=>closes++,buildPdf:()=>new Promise(resolve=>done=resolve),loadLogo:async()=>undefined});
 await view.open();const button=view.element.querySelector('[data-action=print-report-pdf]');view.element.setAttribute('aria-busy','true');button.click();await tick();assert.equal(calls,0);
 view.element.setAttribute('aria-busy','false');await tick();button.click();await tick();assert.equal(calls,1);view.destroy();assert.equal(closes,1);done(new Blob(['%PDF-test']));await tick();button.click();assert.equal(calls,1);
});

test('failed queries cannot export but a successful empty response can',async t=>{
 const dom=new JSDOM('<main id="app"></main>');let failed=true;
 const original=createCargosView({document:dom.window.document,data:{loadSnapshot:async()=>{if(failed)throw new Error('offline');return {rows:[]};}}});
 const view=api.decorateReportPrint(original,{action:'open-cargos-table',previewMedia:async()=>{}});t.after(()=>{view.destroy();dom.window.close();});await view.open();await tick();
 assert.equal(view.element.querySelector('[data-action=print-report-pdf]').disabled,true);assert.throws(()=>api.captureFilteredReport(view.element),/carregar|Atualizar/);
 failed=false;view.element.querySelector('[aria-label="Atualizar tabela de cargos"]').click();await tick();await tick();assert.doesNotThrow(()=>api.captureFilteredReport(view.element));assert.equal(view.element.querySelector('[data-action=print-report-pdf]').disabled,false);
});

test('quotation printer is inside the focus-trapped dialog',async t=>{
 const dom=new JSDOM('<main id="app"></main>');dom.window.matchMedia=()=>({matches:false});
 const original=createQuotationReportView({document:dom.window.document,data:{loadSnapshot:async()=>({quotes:[],budgets:[]})}}),view=api.decorateReportPrint(original,{action:'open-quotation-report',previewMedia:async()=>{}});t.after(()=>{view.destroy();dom.window.close();});await view.open();
 assert.equal(view.element.querySelector('[data-action=print-report-pdf]').closest('[role=dialog]'),view.element.querySelector('.qr-dialog'));
});

test('closing an old report cannot close a later unrelated preview',async t=>{
 const {dom,original}=fixture(t);let releases=0;
 const preview=createAttachmentPreview({documentRef:dom.window.document,readText:async blob=>blob.text(),exportMedia:async()=>{},loadPdfPreview:async()=>({createPdfPreview:()=>({element:dom.window.document.createElement('canvas'),render:async()=>{},destroy(){}})})});
 const view=api.decorateReportPrint(original,{action:'open-payment-ledger',previewMedia:preview.open,closePreview:preview.close,loadLogo:async()=>undefined,buildPdf:async()=>new Blob(['%PDF-test'],{type:'application/pdf'})});t.after(()=>{view.destroy();preview.destroy();});await view.open();view.element.querySelector('[data-action=print-report-pdf]').click();await tick();await tick();
 dom.window.document.querySelector('.attachment-preview-close').click();original.close();await preview.open(new Blob(['later'],{type:'text/plain'}),'later.txt',{onClose:()=>releases++});view.close();
 assert.equal(dom.window.document.querySelector('.attachment-preview-dialog').open,true);preview.close();assert.equal(releases,1);preview.close();assert.equal(releases,1);
});

test('text blocks preserve dark background for light headings',()=>{
 const dom=new JSDOM('<section><header style="background-color:rgb(31,41,55);color:white"><h3>COTAÇÃO Nº 5</h3></header></section>');try{
  const block=api.captureFilteredReport(dom.window.document.querySelector('section')).pages[0].blocks[0];assert.deepEqual(block.background,[31/255,41/255,55/255]);assert.deepEqual(block.runs[0].color,[1,1,1]);
 }finally{dom.window.close();}
});

test('PDF return restores the current pending popup after the real chat rerenders',()=>{
 const dom=new JSDOM('<main id="app"></main>'),view=createChatView(dom.window.document.querySelector('#app'));
 const state={sessionStatus:'authenticated',account:{name:'Bernardo'},messages:[],pendingFiles:[],pendingProvisions:{due:true,rows:[]}};
 try{view.render(state);const root=dom.window.document.querySelector('.chat-pending-provisions--payments'),list=root.querySelector('.chat-pending-provisions__list');list.scrollTop=123;
  const restore=api.preserveReportPdfReturn(root,{resolveRoot:()=>dom.window.document.querySelector('.chat-pending-provisions--payments')});view.render({...state,pendingProvisionAttachmentRevision:1});assert.equal(list.isConnected,false);restore();assert.equal(dom.window.document.querySelector('.chat-pending-provisions__list').scrollTop,123);
 }finally{view.destroy();dom.window.close();}
});
