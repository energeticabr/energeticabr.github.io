import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRegistrationGalleryData } from '../src/chat/registration-gallery-data.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';

const sample = { id:'7', fields:{Title:'Fornecedor fictício',VENCIMENTO:'2026-10-30T12:00:00Z',VALOR:123.45,VALOR_PAGAMENTO:123.45,SITUACAO:'Em aberto',CNPJ_FORNECEDOR:'11111111111111',LINHA_DIGITAVEL:'1'.repeat(47),CODIGO_BARRAS:'2'.repeat(44),ULTIMA_CONSULTA:'2026-10-27T20:00:00Z',Attachments:true} };
test('DDA reads its list and PDFs without exposing mutations',async()=>{
 const calls=[];
 const data=createRegistrationGalleryData({kind:'dda',repository:{
  async resolveList(site,aliases){calls.push([site,aliases]);return {status:'resolved',id:'dda-list'};},
  async getColumns(){return [{name:'Title',displayName:'Fornecedor',text:{}},{name:'VALOR',displayName:'Valor nominal',currency:{}}];},
  async getItemsPage(){return {items:[sample],hasMore:false};},
  async listAttachments(){return [{FileName:'espelho.pdf'}];},
  async downloadAttachment(){return new Blob(['%PDF-test'],{type:'application/pdf'});}
 }});
 const snapshot=await data.loadSnapshot();
 assert.equal(calls[0][0],'personal');assert.deepEqual(calls[0][1],['DDAS SICOOB']);
 assert.equal(snapshot.rows[0].fields.VALOR,123.45);
 for(const method of ['saveEditor','deleteItem','addAttachments','removeAttachment'])assert.equal(data[method],undefined);
 assert.equal((await data.listAttachments('7'))[0].fileName,'espelho.pdf');
 assert.equal((await data.downloadAttachment('7','espelho.pdf')).type,'application/pdf');
});
test('DDA shows supplier, due date, value and opens the mirror without editing',async()=>{
 const dom=new JSDOM('<!doctype html><body></body>');const opened=[];
 const gallery=createRegistrationGallery({document:dom.window.document,kind:'dda',data:{
  async loadSnapshot(){return {rows:[sample]};},
  async listAttachments(){return [{fileName:'espelho.pdf'}];},
  async downloadAttachment(){return new Blob(['%PDF-test'],{type:'application/pdf'});}
 },openMediaCollection:items=>opened.push(items)});
 await gallery.open();const root=dom.window.document;
 assert.match(root.body.textContent,/GALERIA DDA/);
 assert.match(root.body.textContent,/Fornecedor fictício/);
 assert.match(root.body.textContent,/30\/10\/2026/);
 assert.match(root.body.textContent,/123,45/);
 assert.match(root.body.textContent,/27\/10\/2026,? 17:00/);
 assert.equal(root.querySelector('[data-gallery-action="edit"]'),null);
 assert.equal(root.querySelector('[data-gallery-action="delete"]'),null);
 assert.equal(root.querySelector('[data-action="create-registration"]'),null);
 root.querySelector('[data-action="registration-attachments"]').click();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(opened[0][0].fileName,'espelho.pdf');
 assert.equal((await opened[0][0].source({})).type,'application/pdf');
 gallery.destroy();dom.window.close();
});
test('DDA uses authenticated SharePoint REST with read-only scope for private list discovery',async()=>{
 const calls=[],scopes=[];
 const data=createRegistrationGalleryData({kind:'dda',siteConfig:{personal:{host:'tenant.sharepoint.com',path:'/sites/test',readTransport:'graph'}},
  tokenProvider:async requested=>{scopes.push(...requested);return 'fictitious-token';},
  fetchImpl:async(url,options)=>{
   calls.push(String(url));assert.equal(options.method,'GET');
   let value;
   if(String(url).includes('/fields?')) value=[{InternalName:'Title',Title:'Fornecedor',TypeAsString:'Text'},{InternalName:'VALOR',Title:'Valor nominal',TypeAsString:'Currency'}];
   else if(String(url).includes('/items?')) value=[{Id:7,...sample.fields}];
   else if(String(url).includes('/_api/web/lists?')) value=[{Id:'11111111-2222-3333-4444-555555555555',Title:'DDAS SICOOB',BaseTemplate:100,Hidden:false}];
   else throw new Error('Unexpected test request '+url);
   return new Response(JSON.stringify({value}),{status:200,headers:{'Content-Type':'application/json'}});
  },
 });
 assert.equal((await data.loadSnapshot()).rows[0].id,'7');
 assert.ok(calls.every(url=>url.startsWith('https://tenant.sharepoint.com/sites/test/_api/')));
 assert.ok(scopes.every(scope=>scope==='https://tenant.sharepoint.com/AllSites.Read'));
});
