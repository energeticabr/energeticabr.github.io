import test from 'node:test';
import assert from 'node:assert/strict';
import {signatureLayoutGeometry} from '../src/web/signature-document-layout.js';
import {createAppController} from '../src/app-controller.js';
import {createConversationStore} from '../src/chat/conversation-store.js';
import {PDFDocument,PDFSignature,PDFName} from 'pdf-lib';
import {readFileSync} from 'node:fs';
import {buildRhidMonthlyReport} from '../src/chat/rhid-monthly-model.js';
import {signPdfAttachment} from '../src/web/pdf-signing.js';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {JSDOM} from 'jsdom';
import {createChatView} from '../src/ui/chat-view.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const companyLogo=readFileSync(new URL('../../../assets/logo-energetica-oficial.png',import.meta.url));
function setup(t,extra={}){
 const handlers=new Map(),panels=[],calls=[];let n=0;
 const renders=[],pads=[];
 const view={render(state){renders.push(state);},openSignaturePad(id){pads.push(id);return true;},on(type,fn){handlers.set(type,fn);return()=>handlers.delete(type);},emit(type,value={}){return handlers.get(type)?.({type,...value});},destroy(){},focusComposer(){}};
 const account={homeAccountId:'monthly-user',name:'Tester'},auth={initialize:async()=>account,signIn:async()=>account,signOut:async()=>{},getToken:async scopes=>{assert.deepEqual(scopes,['Sites.Read.All']);return 'token';}};
 const store=createConversationStore({randomUUID:()=>`monthly-${++n}`});
 const client={sendText:async payload=>{calls.push(payload);return {status:'processed',messages:[]};},getRhidAttendanceMonth:async month=>({month,rows:[],presentDates:[]})};
 const controller=createAppController({view,store,auth,client,native:{importSharedItems:async()=>[]},rhidReportLogoLoader:async()=>companyLogo,pendingProvisionAttachmentsDataFactory:async()=>({loadUpcomingPayments:async()=>[]}),rhidMonthlyDataFactory:async()=>({loadSuppliers:async()=>[{id:'1',name:'TESTER'}]}),rhidMonthlyFactory:async({data,onClose,onReport})=>{
  const panel={data,onClose,onReport,opens:[],destroyed:0,suspended:false,suspend(){this.suspended=true;},resume(){this.suspended=false;},open(options){this.opens.push(options);},destroy(){this.destroyed++;}};panels.push(panel);return panel;
 },...extra});t.after(()=>controller.stop());return {controller,view,store,auth,client,panels,calls,renders,pads};
}
test('monthly controller opens a read-only local report using the selected calendar month',async t=>{
 const h=setup(t,{rhidMonthlyDataFactory:async({tokenProvider})=>({loadSuppliers:async()=>{await tokenProvider(['Sites.Read.All']);return [{id:'1',name:'TESTER'}];}})});
 await h.controller.start();const before=h.calls.length;
 assert.equal(await h.view.emit('open-rhid-monthly-report',{value:'2026-09'}),true);
 const panel=h.panels[0];assert.deepEqual(panel.opens,[{month:'2026-09'}]);assert.deepEqual(await panel.data.loadSuppliers(),[{id:'1',name:'TESTER'}]);
 assert.deepEqual(await panel.data.loadMonth('2026-09'),{month:'2026-09',rows:[],presentDates:[]});assert.equal(h.calls.length,before);assert.equal(h.store.getState().activeFlow,null);
});
test('monthly report supplies a PDF opener invalidated by closing the panel',async t=>{
 const h=setup(t);await h.controller.start();await h.view.emit('open-rhid-monthly-report');
 const panel=h.panels[0];assert.equal(typeof panel.onReport,'function');panel.onClose();
 await assert.rejects(panel.onReport({}, {signal:new AbortController().signal}),{name:'AbortError'});
});
test('monthly controller opens the actual unsigned PDF without posting documents or changing the flow',async t=>{
 const previews=[];const h=setup(t,{native:{importSharedItems:async()=>[],previewMedia:async(blob,name,options)=>previews.push({blob:await blob,name,options})}});
 await h.controller.start();await h.view.emit('open-rhid-monthly-report');const before=h.calls.length;
 const report=buildRhidMonthlyReport({month:'2026-10',supplier:{id:'1',name:'FUNCIONÁRIO EXEMPLO'},snapshot:{month:'2026-10',rows:[],presentDates:[]}});
 const resolveReturnFocus=()=> 'report-control';
 await h.panels[0].onReport(report,{signal:new AbortController().signal,resolveReturnFocus});
 assert.equal(previews.length,1);assert.equal(previews[0].blob.type,'application/pdf');assert.equal(previews[0].options.layout,'report-pdf');
 assert.equal(previews[0].name,'presencas-rhid-2026-10-fornecedor-1.pdf');
 assert.equal(previews[0].options.resolveReturnFocus,resolveReturnFocus);
 const pdf=await PDFDocument.load(await previews[0].blob.arrayBuffer());assert.equal(pdf.getForm().getFields().filter(f=>f instanceof PDFSignature).length,2);
 assert.equal(h.calls.length,before);assert.equal(h.store.getState().activeFlow,null);
});

// Omitting logo loading in the real report callback produces an unbranded PDF.
test('monthly controller embeds the official logo in every generated employee page', async t => {
 const previews=[];
 const h=setup(t,{native:{importSharedItems:async()=>[],previewMedia:async blob=>previews.push(await blob)}});
 await h.controller.start();await h.view.emit('open-rhid-monthly-report');
 const reports=[['1','PRIMEIRO EXEMPLO'],['2','SEGUNDO EXEMPLO']].map(([id,name])=>buildRhidMonthlyReport({month:'2026-10',supplier:{id,name},snapshot:{month:'2026-10',rows:[],presentDates:[]}}));
 await h.panels[0].onReport(reports);
 const pdf=await PDFDocument.load(await previews[0].arrayBuffer());
 for(const page of pdf.getPages()){
  const objects=page.node.Resources()?.lookup(PDFName.of('XObject'));
  assert.ok(objects?.entries().some(([,ref])=>pdf.context.lookup(ref).dict.get(PDFName.of('Subtype'))?.toString()==='/Image'),'logo oficial incorporada em cada página');
 }
});

test('default monthly logo loader uses the bundled official PNG and embeds it in the output', async t => {
 t.mock.method(globalThis,'fetch',async url=>String(url).endsWith('/assets/logo-energetica-oficial.png')?new Response(companyLogo):new Response('missing',{status:404}));
 const previews=[],h=setup(t,{rhidReportLogoLoader:undefined,native:{importSharedItems:async()=>[],previewMedia:async blob=>previews.push(await blob)}});
 await h.controller.start();await h.view.emit('open-rhid-monthly-report');
 await h.panels[0].onReport(buildRhidMonthlyReport({month:'2026-10',supplier:{id:'1',name:'EXEMPLO'},snapshot:{month:'2026-10',rows:[],presentDates:[]}}));
 const pdf=await PDFDocument.load(await previews[0].arrayBuffer());
 const objects=pdf.getPage(0).node.Resources().lookup(PDFName.of('XObject'));
 assert.ok(objects.entries().some(([,ref])=>pdf.context.lookup(ref).dict.get(PDFName.of('Subtype'))?.toString()==='/Image'));
});

test('closing the monthly report while its logo loads cannot open a stale employee PDF',async t=>{
 let resolveLogo;const previews=[];
 const h=setup(t,{rhidReportLogoLoader:()=>new Promise(resolve=>{resolveLogo=resolve;}),native:{importSharedItems:async()=>[],previewMedia:async blob=>previews.push(await blob)}});
 await h.controller.start();await h.view.emit('open-rhid-monthly-report');
 const panel=h.panels[0],pending=panel.onReport(buildRhidMonthlyReport({month:'2026-10',supplier:{id:'1',name:'EXEMPLO'},snapshot:{month:'2026-10',rows:[],presentDates:[]}}));
 const rejected=assert.rejects(pending,{name:'AbortError'});await tick();panel.onClose();resolveLogo(companyLogo);await rejected;
 assert.equal(previews.length,0);assert.equal(h.store.getState().attachments.length,0);
});

test('monthly batch opens one PDF and signs the employee and representative of the displayed second page',async t=>{
 const previews=[];const signature=new Blob(['signature'],{type:'image/png'});
 const h=setup(t,{native:{importSharedItems:async()=>[],closePreview(){},previewMedia:async(blob,name,options)=>previews.push({blob:await blob,name,options})},loadBernardoSignature:async()=>signature});
 h.client.prepareSignatureEvidence=async()=>({id:'abcdef0123456789abcdef0123456789',signedAt:'2026-10-10T09:00:00Z'});
 await h.controller.start();await h.view.emit('open-rhid-monthly-report');const before=h.calls.length;
 const reports=[['1','FUNCIONÁRIO PRIMEIRO'],['7','FUNCIONÁRIO SEGUNDO']].map(([id,name])=>buildRhidMonthlyReport({month:'2026-10',supplier:{id,name},snapshot:{month:'2026-10',rows:[],presentDates:[]}}));
 await h.panels[0].onReport(reports);const preview=previews[0],pdf=await PDFDocument.load(await preview.blob.arrayBuffer());
 assert.equal(previews.length,1);assert.equal(pdf.getPageCount(),2);assert.match(preview.name,/fornecedores/);
 await preview.options.onSign({page:2});await h.view.emit('signature-captured',{fileId:'rhid-monthly-report',file:signature});
 for(let i=0;i<12;i++)await tick();
 let placement=h.renders.at(-1).signaturePlacement;assert.equal(placement.status,'ready');assert.equal(placement.selection.page,2);assert.equal(placement.signerName,'FUNCIONÁRIO SEGUNDO');
 await h.view.emit('signature-placement-close');
 assert.equal(previews.at(-1).options.initialPage,2,'return to the same employee instead of signing someone else');
 await previews.at(-1).options.onStamp({page:2});for(let i=0;i<12;i++)await tick();
 placement=h.renders.at(-1).signaturePlacement;assert.equal(placement.status,'ready');assert.equal(placement.selection.page,2);assert.equal(placement.signerName,'BERNARDO NOTINI');
 assert.equal(h.calls.length,before);assert.equal(h.store.getState().attachments.length,0);
});

test('monthly callback accepts singleton arrays and large batches keep a bounded PDF filename',async t=>{
 const previews=[],h=setup(t,{native:{importSharedItems:async()=>[],previewMedia:async(blob,name)=>previews.push({blob:await blob,name})}});
 await h.controller.start();await h.view.emit('open-rhid-monthly-report');
 const reports=Array.from({length:30},(_,index)=>buildRhidMonthlyReport({month:'2026-10',supplier:{id:String(1000+index),name:`FUNCIONÁRIO EXEMPLO ${index}`},snapshot:{month:'2026-10',rows:[],presentDates:[]}}));
 await h.panels[0].onReport(reports);assert.ok(previews[0].name.length<=128);assert.match(previews[0].name,/\.pdf$/);assert.equal((await PDFDocument.load(await previews[0].blob.arrayBuffer())).getPageCount(),30);
 await h.panels[0].onReport([reports[0]]);assert.equal(previews[1].name,'presencas-rhid-2026-10-fornecedor-1000.pdf');
});

test('monthly PDF drawing cancels back to the unchanged preview and does not post a document',async t=>{
 const previews=[];let closes=0;
 const h=setup(t,{native:{importSharedItems:async()=>[],closePreview(){closes++;},previewMedia:async(blob,name,options)=>previews.push({blob:await blob,name,options})}});
 await h.controller.start();await h.view.emit('open-rhid-monthly-report');
 const panel=h.panels[0],report=buildRhidMonthlyReport({month:'2026-10',supplier:{id:'1',name:'FUNCIONÁRIO EXEMPLO'},snapshot:{month:'2026-10',rows:[],presentDates:[]}});
 await panel.onReport(report);const original=previews[0],before=h.calls.length;
 assert.equal(typeof original.options.onSign,'function');
 assert.equal(typeof original.options.onStamp,'function');
 await original.options.onSign({blob:original.blob,fileName:original.name});
 assert.equal(closes,1);assert.equal(panel.suspended,true);assert.deepEqual(h.pads,['rhid-monthly-report']);
 await h.view.emit('signature-cancelled',{fileId:'rhid-monthly-report'});
 assert.equal(panel.suspended,false);assert.equal(previews.at(-1).blob,original.blob);
 assert.equal(h.calls.length,before);assert.equal(h.store.getState().activeFlow,null);
 panel.onClose();assert.equal(await original.options.onSign({blob:original.blob,fileName:original.name}),false);
 assert.equal(h.pads.length,1,'prévia antiga não abre desenho após fechar relatório');
});

test('monthly signature uses the employee field, preserves the original on cancel and returns the confirmed PDF',async t=>{
 const previews=[],evidenceCalls=[],signedInputs=[],confirmations=[];
 const evidence={id:'abcdef0123456789abcdef0123456789',signedAt:'2026-10-10T09:00:00Z'};
 const h=setup(t,{native:{importSharedItems:async()=>[],closePreview(){},previewMedia:async(blob,name,options)=>previews.push({blob:await blob,name,options})},
 signPdfAttachment:async input=>{signedInputs.push(input);return new Blob([await input.documentBlob.arrayBuffer()],{type:'application/pdf'});}});
 h.client.prepareSignatureEvidence=async input=>{evidenceCalls.push(input);return evidence;};
 h.client.confirmSignatureEvidence=async input=>{confirmations.push(input);return {mediaUrl:'/signed-preview'};};
 await h.controller.start();await h.view.emit('open-rhid-monthly-report');
 const report=buildRhidMonthlyReport({month:'2026-10',supplier:{id:'1',name:'FUNCIONÁRIO EXEMPLO'},snapshot:{month:'2026-10',rows:[],presentDates:[]}});
 await h.panels[0].onReport(report);const original=previews[0];
 assert.equal(typeof original.options.onSign,'function');
 await original.options.onSign({blob:original.blob,fileName:original.name});
 const signature=new Blob(['signature'],{type:'image/png'});
 await h.view.emit('signature-captured',{fileId:'rhid-monthly-report',file:signature});
 for(let n=0;n<12;n++)await tick();
 const placement=h.renders.at(-1).signaturePlacement;
 assert.equal(placement.status,'ready');assert.equal(placement.signerName,'FUNCIONÁRIO EXEMPLO');
 const pdf=await PDFDocument.load(await original.blob.arrayBuffer());
 const box=pdf.getForm().getField('rhid_employee').acroField.getWidgets()[0].getRectangle();
 const [width,height]=[pdf.getPage(0).getWidth(),pdf.getPage(0).getHeight()];
 assert.equal(placement.selection.page,1);assert.ok(Math.abs(placement.selection.x-(box.x+box.width/2)/width)<.001);
 assert.ok(Math.abs(placement.selection.y-(box.y+box.height/2)/height)<.001);
 const employeeGeometry=signatureLayoutGeometry('',{pageWidth:width,pageHeight:height,scale:placement.selection.scale,integrity:true});
 assert.ok(employeeGeometry.width<=box.width+.01&&employeeGeometry.height<=box.height+.01,'cartão completo cabe no campo do funcionário');
 assert.equal(await h.view.emit('signature-placement-position',{point:placement.selection}),true);
 assert.equal(signedInputs[0].signatureBlob,signature);assert.equal(signedInputs[0].integrityId,evidence.id);
 assert.equal(evidenceCalls[0].documentBlob,original.blob);assert.equal(confirmations.length,1);
 assert.equal(previews.at(-1).blob,confirmations[0].documentBlob);
 assert.equal(previews.at(-1).name,'presencas-rhid-2026-10-fornecedor-1-assinado.pdf');
 assert.equal(h.panels[0].suspended,false);assert.equal(h.store.getState().attachments.length,0);
 assert.equal(h.store.getState().activeFlow,null,'assinar não cria um fluxo de postagem');
});

test('monthly report inserts Bernardo in the company field after employee signing and preserves both in one PDF',async t=>{
 const previews=[],inputs=[],confirmations=[];
 const signature=new Blob([Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'))],{type:'image/png'});
 const h=setup(t,{native:{importSharedItems:async()=>[],closePreview(){},previewMedia:async(blob,name,options)=>previews.push({blob:await blob,name,options})},
 loadBernardoSignature:async()=>signature,signPdfAttachment:async input=>{inputs.push(input);return signPdfAttachment(input);}});
 let n=0;
 h.client.prepareSignatureEvidence=async()=>({id:String(++n).padStart(32,'a'),signedAt:'2026-10-10T09:00:00Z'});
 h.client.confirmSignatureEvidence=async input=>{confirmations.push(input);return {mediaUrl:'/signed-preview'};};
 await h.controller.start();await h.view.emit('open-rhid-monthly-report');
 const report=buildRhidMonthlyReport({month:'2026-10',supplier:{id:'1',name:'FUNCIONÁRIO EXEMPLO'},snapshot:{month:'2026-10',rows:[],presentDates:[]}});
 await h.panels[0].onReport(report);
 const original=previews[0];
 assert.equal(typeof original.options.onStamp,'function');
 await original.options.onSign();
 await h.view.emit('signature-captured',{fileId:'rhid-monthly-report',file:signature});
 for(let i=0;i<12;i++)await tick();
 let placement=h.renders.at(-1).signaturePlacement;
 assert.equal(placement.status,'ready');
 assert.equal(await h.view.emit('signature-placement-position',{point:placement.selection}),true);
 const employeeCopy=previews.at(-1);
 await employeeCopy.options.onStamp();
 for(let i=0;i<12;i++)await tick();
 placement=h.renders.at(-1).signaturePlacement;
 assert.equal(placement.status,'ready');assert.equal(placement.signerName,'BERNARDO NOTINI');
 const pdf=await PDFDocument.load(await employeeCopy.blob.arrayBuffer());
 const box=pdf.getForm().getField('rhid_representative').acroField.getWidgets()[0].getRectangle(),page=pdf.getPage(0);
 assert.ok(Math.abs(placement.selection.x-(box.x+box.width/2)/page.getWidth())<.001);
 assert.ok(Math.abs(placement.selection.y-(box.y+box.height/2)/page.getHeight())<.001);
 const companyGeometry=signatureLayoutGeometry('',{pageWidth:page.getWidth(),pageHeight:page.getHeight(),scale:placement.selection.scale,integrity:true});
 assert.ok(companyGeometry.width<=box.width+.01&&companyGeometry.height<=box.height+.01,'cartão completo cabe no campo da empresa');
 assert.equal(inputs.length,1,'inserir Bernardo ainda aguarda confirmar');
 assert.equal(await h.view.emit('signature-placement-position',{point:placement.selection}),true);
 const final=previews.at(-1);
 assert.equal(inputs[1].documentBlob,employeeCopy.blob,'segunda assinatura usa o PDF já assinado');
 assert.equal(final.blob,confirmations[1].documentBlob);
 const finalPdf=await PDFDocument.load(await final.blob.arrayBuffer());
 assert.equal(finalPdf.getPageCount(),1);assert.equal(finalPdf.getForm().getFields().length,2);
 const task=getDocument({data:new Uint8Array(await final.blob.arrayBuffer()),useSystemFonts:true});t.after(()=>task.destroy());
 const reader=await task.promise,text=(await (await reader.getPage(1)).getTextContent()).items.map(item=>item.str).join(' ');
 assert.match(text,/BERNARDO NOTINI/);assert.match(text,/FUNCIONÁRIO EXEMPLO/);assert.equal(text.match(/REGISTRO:/g)?.length,2,'ambas as assinaturas e registros permanecem');
 assert.equal(h.pads.length,1,'assinatura pronta de Bernardo não exige desenho');
 assert.equal(h.store.getState().attachments.length,0);
});

test('closing the monthly panel while signature confirmation is pending cannot reopen or replace the report',async t=>{
 const previews=[];let resolve;
 const confirmed=new Promise(r=>resolve=r);
 const h=setup(t,{native:{importSharedItems:async()=>[],closePreview(){},previewMedia:async(blob,name,options)=>previews.push({blob:await blob,name,options})},
 signPdfAttachment:async input=>new Blob([await input.documentBlob.arrayBuffer()],{type:'application/pdf'})});
 h.client.prepareSignatureEvidence=async()=>({id:'abcdef0123456789abcdef0123456789',signedAt:'2026-10-10T09:00:00Z'});
 h.client.confirmSignatureEvidence=()=>confirmed;
 await h.controller.start();await h.view.emit('open-rhid-monthly-report');
 const report=buildRhidMonthlyReport({month:'2026-10',supplier:{id:'1',name:'FUNCIONÁRIO EXEMPLO'},snapshot:{month:'2026-10',rows:[],presentDates:[]}});
 await h.panels[0].onReport(report);
 assert.equal(typeof previews[0].options.onSign,'function');
 await previews[0].options.onSign();await h.view.emit('signature-captured',{fileId:'rhid-monthly-report',file:new Blob(['signature'],{type:'image/png'})});
 for(let i=0;i<12;i++)await tick();
 const attempt=h.view.emit('signature-placement-position',{point:h.renders.at(-1).signaturePlacement.selection});
 await tick();h.panels[0].onClose();resolve({mediaUrl:'/late-signed'});
 assert.equal(await attempt,false);assert.equal(previews.length,1);
 assert.equal(h.store.getState().attachments.length,0);
});
test('monthly controller cancels pending data on sign-out, and cannot borrow new credentials',async t=>{
 let resolve;const pending=new Promise(r=>resolve=r);
 const h=setup(t,{rhidMonthlyDataFactory:async()=>({loadSuppliers:()=>pending})});await h.controller.start();await h.view.emit('open-rhid-monthly-report');
 const data=h.panels[0].data,request=data.loadSuppliers(),rejected=assert.rejects(request,{name:'AbortError'});await tick();await h.view.emit('sign-out');await rejected;
 resolve([{id:'1',name:'TESTER'}]);assert.equal(h.panels[0].destroyed,1);await assert.rejects(data.loadMonth('2026-09'),{name:'AbortError'});
});

test('monthly drawing is closed before another account signs in',async t=>{
 const dom=new JSDOM('<main id="app"></main>');t.after(()=>dom.window.close());
 dom.window.HTMLCanvasElement.prototype.getContext=()=>null;
 const root=dom.window.document.querySelector('#app'),realView=createChatView(root),handlers=new Map();
 const view={...realView,on(type,handler){handlers.set(type,handler);return realView.on(type,handler);}};
 const previews=[],h=setup(t,{view,auth:{initialize:async()=>({homeAccountId:'account-a'}),signIn:async()=>({homeAccountId:'account-b'}),signOut:async()=>{},getToken:async()=> 'test'},
 native:{importSharedItems:async()=>[],closePreview(){},previewMedia:async(blob,name,options)=>previews.push({blob:await blob,name,options})}});
 await h.controller.start();await handlers.get('open-rhid-monthly-report')({});
 await h.panels[0].onReport(buildRhidMonthlyReport({month:'2026-10',supplier:{id:'1',name:'FUNCIONÁRIO EXEMPLO'},snapshot:{month:'2026-10',rows:[],presentDates:[]}}));
 await previews[0].options.onSign();assert.ok(root.querySelector('[data-signature-pad-dialog]'));
 await handlers.get('sign-out')({});await handlers.get('sign-in')({});
 assert.equal(root.querySelector('[data-signature-pad-dialog]'),null,'desenho da conta A não reaparece na conta B');
 assert.equal(view.openSignaturePad('new-account-document'),true,'novo desenho não fica bloqueado');
 assert.equal(previews.length,1,'cancelamento do desenho no logout não reabre o PDF antigo');
});

test('editing Bernardo keeps the representative identity and company field',async t=>{
 const previews=[],h=setup(t,{loadBernardoSignature:async()=>new Blob(['stamp'],{type:'image/png'}),
 native:{importSharedItems:async()=>[],closePreview(){},previewMedia:async(blob,name,options)=>previews.push({blob:await blob,name,options})}});
 h.client.prepareSignatureEvidence=async()=>({id:'abcdef0123456789abcdef0123456789',signedAt:'2026-10-10T09:00:00Z'});
 await h.controller.start();await h.view.emit('open-rhid-monthly-report');
 await h.panels[0].onReport(buildRhidMonthlyReport({month:'2026-10',supplier:{id:'1',name:'FUNCIONÁRIO EXEMPLO'},snapshot:{month:'2026-10',rows:[],presentDates:[]}}));
 await previews[0].options.onStamp();for(let i=0;i<12;i++)await tick();
 const first=h.renders.at(-1).signaturePlacement;assert.equal(first.signerName,'BERNARDO NOTINI');
 await h.view.emit('signature-placement-edit');assert.equal(h.pads.at(-1),'rhid-monthly-report');
 await h.view.emit('signature-captured',{fileId:'rhid-monthly-report',file:new Blob(['edited'],{type:'image/png'})});
 for(let i=0;i<12;i++)await tick();
 const edited=h.renders.at(-1).signaturePlacement;
 assert.equal(edited.signerName,'BERNARDO NOTINI');assert.deepEqual(edited.selection,first.selection);
});

test('Bernardo loading keeps the PDF visible and closing the preview cancels the pending action',async t=>{
 let resolve;const pending=new Promise(r=>resolve=r),previews=[];let closes=0;
 const h=setup(t,{loadBernardoSignature:()=>pending,native:{importSharedItems:async()=>[],closePreview(){closes++;},previewMedia:async(blob,name,options)=>previews.push({blob:await blob,name,options})}});
 await h.controller.start();await h.view.emit('open-rhid-monthly-report');
 await h.panels[0].onReport(buildRhidMonthlyReport({month:'2026-10',supplier:{id:'1',name:'FUNCIONÁRIO EXEMPLO'},snapshot:{month:'2026-10',rows:[],presentDates:[]}}));
 const attempt=previews[0].options.onStamp();await tick();
 assert.equal(closes,0,'prévia permanece utilizável enquanto a imagem carrega');assert.equal(h.panels[0].suspended,false);
 assert.equal(typeof previews[0].options.onClose,'function');previews[0].options.onClose();
 resolve(new Blob(['stamp'],{type:'image/png'}));assert.equal(await attempt,false);
 assert.equal(h.panels[0].suspended,false);assert.equal(h.renders.at(-1).signaturePlacement,null);
});
test('monthly panel from a late factory is discarded after controller stop',async t=>{
 let resolve;const pending=new Promise(r=>resolve=r);const h=setup(t,{rhidMonthlyFactory:()=>pending});await h.controller.start();
 const opening=h.view.emit('open-rhid-monthly-report');await tick();h.controller.stop();let opens=0,destroys=0;resolve({open(){opens++;},destroy(){destroys++;}});
 assert.equal(await opening,false);await tick();assert.equal(opens,0);assert.equal(destroys,1);
});
test('closing monthly report invalidates its data source',async t=>{
 const h=setup(t);await h.controller.start();await h.view.emit('open-rhid-monthly-report');const panel=h.panels[0];panel.onClose();await assert.rejects(panel.data.loadMonth('2026-09'),{name:'AbortError'});assert.equal(panel.destroyed,1);
});
test('controller monthly transport receives the per-query cancellation signal',async t=>{
 let signal,resolve;const pending=new Promise(r=>resolve=r);
 const h=setup(t,{client:{sendText:async()=>({status:'processed',messages:[]}),getRhidAttendanceMonth:async(month,options)=>{signal=options?.signal;await pending;return {month,presentDates:[],rows:[]};}}});
 await h.controller.start();await h.view.emit('open-rhid-monthly-report');const request=h.panels[0].data.loadMonth('2026-10');const rejected=assert.rejects(request,{name:'AbortError'});await tick();assert.ok(signal);h.panels[0].onClose();await rejected;assert.equal(signal.aborted,true);resolve();
});
