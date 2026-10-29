import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createDdaReportView} from '../src/ui/dda-report-view.js';
import {captureFilteredReport} from '../src/ui/report-print.js';
const code='01234567890123456789012345678901234567890123',tick=()=>new Promise(r=>setImmediate(r));
async function setup(t,{copyText=async()=>{},barcode=code}={}){
 const dom=new JSDOM('<body><main id="app"></main></body>'),doc=dom.window.document;
 const view=createDdaReportView({document:doc,copyText,data:{loadSnapshot:async()=>({rows:[1,2].map(id=>({id:String(id),fields:{Title:'EXEMPLO '+id,SITUACAO:'Em aberto',VALOR:10,VENCIMENTO:'2026-11-20',CODIGO_BARRAS:barcode}}))})}});
 t.after(()=>{view.destroy();dom.window.close();});await view.open();return {dom,doc,view};
}
test('each arrow toggles only its own barcode panel; opening never copies',async t=>{
 let copied=0;const h=await setup(t,{copyText:async()=>copied++});const arrows=h.doc.querySelectorAll('[data-dda-toggle-barcode]');assert.equal(arrows.length,2);assert.equal(arrows[0].getAttribute('aria-expanded'),'false');
 arrows[0].click();assert.equal(arrows[0].getAttribute('aria-expanded'),'true');assert.match(h.doc.querySelector('[data-dda-barcode-panel="1"]').textContent,new RegExp(code));assert.equal(copied,0);
 arrows[1].click();arrows[0].click();assert.equal(h.doc.querySelector('[data-dda-barcode-panel="1"]'),null);assert.ok(h.doc.querySelector('[data-dda-barcode-panel="2"]'));assert.equal(copied,0);
});
test('copy writes only the 44 digits once and confirms success',async t=>{
 const calls=[];let finish;const h=await setup(t,{barcode:' '+code+' ',copyText:text=>{calls.push(text);return new Promise(r=>finish=r);}});h.doc.querySelector('[data-dda-toggle-barcode]').click();const copy=h.doc.querySelector('[data-dda-copy-barcode]');copy.click();copy.click();assert.deepEqual(calls,[code]);finish();await tick();assert.match(h.doc.querySelector('[data-dda-barcode-panel]').textContent,/Código de barras copiado/);
});
test('copy error offers retry without claiming success; missing barcode is disabled',async t=>{
 const h=await setup(t,{copyText:async()=>{throw Error('private');}});h.doc.querySelector('[data-dda-toggle-barcode]').click();const copy=h.doc.querySelector('[data-dda-copy-barcode]');copy.click();await tick();assert.equal(copy.disabled,false);assert.match(h.doc.querySelector('[data-dda-barcode-panel]').textContent,/Não foi possível copiar/);assert.doesNotMatch(h.doc.body.textContent,/private/);
 const empty=await setup(t,{barcode:''});empty.doc.querySelector('[data-dda-toggle-barcode]').click();assert.equal(empty.doc.querySelector('[data-dda-copy-barcode]').disabled,true);
});
test('printing excludes interactive detail rows and restores expansion; closing resets it',async t=>{
 const h=await setup(t);h.doc.querySelector('[data-dda-toggle-barcode]').click();const restore=await h.view.preparePrint();const snapshot=captureFilteredReport(h.view.element);assert.doesNotMatch(JSON.stringify(snapshot),new RegExp(code));restore();assert.ok(h.doc.querySelector('[data-dda-barcode-panel="1"]'));h.view.close();await h.view.open();assert.equal(h.doc.querySelector('[data-dda-barcode-panel]'),null);
});
