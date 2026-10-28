import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {readDdaCopyAction,positionDdaCopyButton} from '../src/web/dda-pdf-copy.js';
import {JSDOM} from 'jsdom';
import {createPdfPreview} from '../src/web/pdf-preview.js';
import {createAttachmentPreview} from '../src/web/attachment-preview.js';

test('real generated PDF exposes one inert copy action with exact validated leading-zero barcode',async()=>{
 const task=getDocument({data:new Uint8Array(await readFile(new URL('./fixtures/dda-mirror-v2.pdf',import.meta.url))),useSystemFonts:true});
 try{const pdf=await task.promise;const page=await pdf.getPage(1);const action=await readDdaCopyAction(page);
 assert.equal(action.barcode,'00197100000000123451234567890123456789012345');assert.equal(action.barcode.length,44);
 assert.equal(action.line.length,47);assert.ok(action.rect.every(Number.isFinite));
 const ann=(await page.getAnnotations())[0];assert.equal(ann.action,'EnergeticoDdaCopyBarcode');assert.equal(ann.url,undefined);
 }finally{await task.destroy();}
});
test('PDF button and footer copy 44 digits; switching documents disables detached controls',async()=>{
 const dom=new JSDOM('<body></body>',{url:'https://example.test/energetico/'}),doc=dom.window.document,copied=[];
 dom.window.HTMLCanvasElement.prototype.getContext=()=>({});
 Object.defineProperty(dom.window.navigator,'clipboard',{value:{writeText:async value=>copied.push(value)}});
 const data=new Uint8Array(await readFile(new URL('./fixtures/dda-mirror-v2.pdf',import.meta.url)));
 const task=getDocument({data:data.slice(),useSystemFonts:true});const pdf=await task.promise;
 const loadPdfJs=async()=>({getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>{
   const p=await pdf.getPage(1);return{getViewport:o=>p.getViewport(o),getAnnotations:()=>p.getAnnotations(),getTextContent:()=>p.getTextContent(),render:()=>({promise:Promise.resolve()}),cleanup(){}};
 }}),destroy(){}})});
 const preview=createAttachmentPreview({documentRef:doc,loadPdfPreview:async()=>({createPdfPreview:opts=>createPdfPreview({...opts,loadPdfJs})})});
 try{
  await preview.open(new Blob([data],{type:'application/pdf'}),'demo.pdf');
  const inside=doc.querySelector('.attachment-preview-dda-copy-overlay'),footer=doc.querySelector('[data-preview-action="copy-dda-barcode"]');
  assert.ok(inside);assert.equal(footer.hidden,false);
  inside.click();await new Promise(r=>setImmediate(r));footer.click();await new Promise(r=>setImmediate(r));
  assert.deepEqual(copied,['00197100000000123451234567890123456789012345','00197100000000123451234567890123456789012345']);
  assert.match(doc.body.textContent,/copiado \(44 dígitos\)/);
  const canvas=inside.parentElement.querySelector('canvas');canvas.style.width='600px';canvas.style.height='900px';
  positionDdaCopyButton(inside,canvas,[.7,.4,.9,.5]);assert.equal(inside.style.top,'360px');assert.ok(Math.abs(parseFloat(inside.style.width)-120)<.001);
  await preview.open(new Blob(['Texto'],{type:'text/plain'}),'outro.txt');assert.equal(footer.hidden,true);
  inside.click();footer.click();await new Promise(r=>setImmediate(r));assert.equal(copied.length,2);
 }finally{preview.destroy();dom.window.close();await task.destroy();}
});
test('ordinary PDFs and forged or divergent copy metadata never create an action',async()=>{
 assert.equal(await readDdaCopyAction({getAnnotations:async()=>[]}),null);
 const task=getDocument({data:new Uint8Array(await readFile(new URL('./fixtures/dda-mirror-v2.pdf',import.meta.url))),useSystemFonts:true});
 try{const pdf=await task.promise,page=await pdf.getPage(1),annotations=await page.getAnnotations();
 const fake={getAnnotations:async()=>annotations,getTextContent:async()=>({items:[{str:'different document'}]}),getViewport:opts=>page.getViewport(opts)};
 assert.equal(await readDdaCopyAction(fake),null);
 const hostile=structuredClone(annotations);hostile[0].contentsObj.str='{"version":2,"barcode":"javascript:alert(1)"}';
 assert.equal(await readDdaCopyAction({...fake,getAnnotations:async()=>hostile}),null);
 assert.equal(await readDdaCopyAction({...fake,getAnnotations:async()=>[...annotations,...annotations]}),null);
 }finally{await task.destroy();}
});
