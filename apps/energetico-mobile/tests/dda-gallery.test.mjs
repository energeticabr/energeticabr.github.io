import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRegistrationGalleryData } from '../src/chat/registration-gallery-data.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';

const sample = { id:'7', fields:{Title:'Fornecedor fictício',VENCIMENTO:'2026-10-30T12:00:00Z',VALOR:123.45,VALOR_PAGAMENTO:123.45,SITUACAO:'Em aberto',CNPJ_FORNECEDOR:'11111111111111',LINHA_DIGITAVEL:'1'.repeat(47),CODIGO_BARRAS:'2'.repeat(44),ULTIMA_CONSULTA:'2026-10-27T20:00:00Z',Attachments:true} };

test('DDA Em aberto includes scheduled rows while paid and unconfirmed rows are hidden',async t=>{
 const dom=new JSDOM('<body/>'),doc=dom.window.document;
 const gallery=createRegistrationGallery({document:doc,kind:'dda',data:{loadSnapshot:async()=>({rows:[sample,
  {id:'8',fields:{...sample.fields,Title:'Pago no banco',SITUACAO:'Pago'}},
  {id:'9',fields:{...sample.fields,Title:'Pago manualmente',SITUACAO:'Agendado',PGTO_CONFIRMADO:true}},
  {id:'10',fields:{...sample.fields,Title:'Fornecedor agendado',SITUACAO:'Agendado'}},
  {id:'11',fields:{...sample.fields,Title:'Consulta incerta',SITUACAO:'Não confirmado'}},
  {id:'12',fields:{...sample.fields,Title:'Pagamento agendado confirmado',SITUACAO:'Agendado',DDA_CICLO_AGENDAMENTO:'PAGO_AGENDADO'}}]})}});
 t.after(()=>{gallery.destroy();dom.window.close();});
 await gallery.open();
 const status=doc.querySelector('[data-filter-field="SITUACAO"]');
 assert.equal(status.value,'Em aberto');
 assert.equal(doc.querySelectorAll('.rg-row--dda').length,2);
 assert.match(doc.querySelector('.rg-list').textContent,/Fornecedor fictício/);
 assert.match(doc.querySelector('.rg-list').textContent,/Fornecedor agendado/);
 assert.doesNotMatch(doc.querySelector('.rg-list').textContent,/Pago no banco|Pago manualmente|Consulta incerta|Pagamento agendado confirmado/);
 status.value='Agendado';status.dispatchEvent(new dom.window.Event('change'));
 assert.deepEqual([...doc.querySelectorAll('.rg-row--dda')].map(row=>row.dataset.registrationRow),['10']);
 status.value='Pago';status.dispatchEvent(new dom.window.Event('change'));
 assert.deepEqual([...doc.querySelectorAll('.rg-row--dda')].map(row=>row.dataset.registrationRow),['8','9','12']);
});

for(const rows of [[],[{id:'8',fields:{...sample.fields,SITUACAO:'Pago'}}]])
test('DDA keeps Em aberto selected without matching open records: '+rows.length,async t=>{
 const dom=new JSDOM('<body/>'),doc=dom.window.document;
 const gallery=createRegistrationGallery({document:doc,kind:'dda',data:{loadSnapshot:async()=>({rows})}});
 t.after(()=>{gallery.destroy();dom.window.close();});await gallery.open();
 assert.equal(doc.querySelector('[data-filter-field="SITUACAO"]').value,'Em aberto');
 assert.equal(doc.querySelectorAll('.rg-row--dda').length,0);
});

test('DDA preserves explicit Todos during refresh and restores Em aberto when reopened',async t=>{
 const dom=new JSDOM('<body/>'),doc=dom.window.document;
 let refreshes=0;
 const gallery=createRegistrationGallery({document:doc,kind:'dda',refreshBank:async()=>({status:'succeeded',created:0}),data:{loadSnapshot:async()=>{
  refreshes++;return {rows:[sample,{id:'8',fields:{...sample.fields,SITUACAO:'Pago'}}]};
 }}});
 t.after(()=>{gallery.destroy();dom.window.close();});await gallery.open();
 const status=doc.querySelector('[data-filter-field="SITUACAO"]');
 status.value='';status.dispatchEvent(new dom.window.Event('change'));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(doc.querySelectorAll('.rg-row--dda').length,2);
 doc.querySelector('[data-action="registration-refresh"]').click();
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(refreshes>=2);assert.equal(status.value,'');
 assert.equal(doc.querySelectorAll('.rg-row--dda').length,2);
 gallery.close();await gallery.open();
 assert.equal(status.value,'Em aberto');assert.equal(doc.querySelectorAll('.rg-row--dda').length,1);
});
test('DDA gallery shows refused boletos exclusively under Recusados after a bank status update',async t=>{
 const dom=new JSDOM('<body/>'),doc=dom.window.document;
 const refused={id:'8',fields:{...sample.fields,Title:'Boleto recusado',SITUACAO:'Pago',
  DDA_RECUSADO:true,DDA_CICLO_AGENDAMENTO:'PAGO_AGENDADO',PGTO_CONFIRMADO:true}};
 const gallery=createRegistrationGallery({document:doc,kind:'dda',
  data:{loadSnapshot:async()=>({rows:[sample,refused]})}});
 t.after(()=>{gallery.destroy();dom.window.close();});await gallery.open();
 const status=doc.querySelector('[data-filter-field="SITUACAO"]');
 const select=value=>{status.value=value;status.dispatchEvent(new dom.window.Event('change'));};
 select('');assert.equal(doc.querySelector('[data-registration-row="8"]'),null);
 const option=[...status.options].find(item=>item.textContent==='Recusados');
 assert.ok(option);select(option.value);
 const card=doc.querySelector('[data-registration-row="8"]');
 assert.equal(card.querySelector('[data-field="SITUACAO"] dd').textContent,'Recusado');
 assert.equal(card.querySelector('[data-dda-confirm-payment]'),null);
 assert.equal(card.querySelector('.rg-dda-payment-audit'),null);
 assert.equal(doc.querySelector('[data-registration-row="7"]'),null);
});
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
test('DDA shows supplier, due date, value and opens DDA plus fiscal PDF on the same item',async()=>{
 const dom=new JSDOM('<!doctype html><body></body>');const opened=[];
 const gallery=createRegistrationGallery({document:dom.window.document,kind:'dda',data:{
  async loadSnapshot(){return {rows:[sample]};},
  async listAttachments(){return [{fileName:'Espelho_DDA_abcd.pdf'},{fileName:'FISCAL-DANFE-3126.pdf'}];},
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
 assert.deepEqual(opened[0].map(item=>item.fileName),['Espelho_DDA_abcd.pdf','FISCAL-DANFE-3126.pdf']);
 assert.equal((await opened[0][0].source({})).type,'application/pdf');
 assert.equal((await opened[0][1].source({})).type,'application/pdf');
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
   else if(String(url).includes('/items?')) {
    const query=new URL(String(url)).searchParams;
    // Personal SharePoint lists reject the expanded system-field query with 502.
    if(query.has('$expand')) return new Response('{"error":{"code":"BadGateway"}}',{status:502,headers:{'Content-Type':'application/json'}});
    assert.ok(query.get('$select').split(',').includes('Title'));
    assert.ok(query.get('$select').split(',').includes('VENCIMENTO'));
    assert.ok(query.get('$select').split(',').includes('Created'));
    assert.ok(query.get('$select').split(',').includes('STATUS_DDA'));
    assert.ok(query.get('$select').split(',').includes('STATUS_CONSULTADO_EM'));
    assert.equal(query.get('$select').includes('*'),false);
    value=[{Id:7,...sample.fields,STATUS_DDA:'Agendado',STATUS_CONSULTADO_EM:'2026-10-27T16:00:00Z',Created:'2026-11-27T12:00:00Z'}];
   }
   else if(String(url).includes('/items(7)?')) {
    const query=new URL(String(url)).searchParams;
    assert.equal(query.has('$expand'),false);
    const fields=query.get('$select').split(',');
    for(const name of ['CHAVE_DDA','SITUACAO','PGTO_CONFIRMADO','DESCRITIVOPROVIS_x00c3_O','IDPEDIDO'])assert.ok(fields.includes(name));
    return Response.json({Id:7,...sample.fields,SITUACAO:'Pago',IDPEDIDO:'56'});
   }
   else if(String(url).includes('/_api/web/lists?')) value=[{Id:'11111111-2222-3333-4444-555555555555',Title:'DDAS SICOOB',BaseTemplate:100,Hidden:false}];
   else throw new Error('Unexpected test request '+url);
   return new Response(JSON.stringify({value}),{status:200,headers:{'Content-Type':'application/json'}});
  },
 });
 const [row]=(await data.loadSnapshot()).rows;
 assert.equal(row.id,'7');
 assert.equal(row.fields.STATUS_DDA,'Agendado');
 assert.equal(row.fields.Created,'2026-11-27T12:00:00Z');
 assert.equal(row.fields.STATUS_CONSULTADO_EM,'2026-10-27T16:00:00Z');
 const current=await data.loadItem('7');
 assert.equal(current.id,'7');
 assert.equal(current.fields.SITUACAO,'Pago');
 assert.equal(current.fields.IDPEDIDO,'56');
 assert.ok(calls.every(url=>url.startsWith('https://tenant.sharepoint.com/sites/test/_api/')));
 assert.ok(scopes.every(scope=>scope==='https://tenant.sharepoint.com/AllSites.Read'));
});

test('DDA reads NOTASPENDENTES and writes only the confirmed link using its SharePoint REST ETag',async()=>{
 const ddaList='11111111-2222-3333-4444-555555555555',orderList='11111111-2222-3333-4444-666666666666';
 const launchList='11111111-2222-3333-4444-777777777777';
 const version='"v1"',requests=[];
 let launchUnavailable=false;
 let orderPostingComplete=false;
 const dda={ID:7,'odata.etag':version,DESCRITIVOPROVIS_x00c3_O:'56',IDPEDIDO:null};
 const order={ID:56,FORNECEDOR:'Fornecedor fictício',FILIAL:'Matriz',VALORTOTAL:'123,45',DATAPEDIDO:'2026-11-04'};
 const data=createRegistrationGalleryData({kind:'dda',siteConfig:{personal:{host:'tenant.sharepoint.com',path:'/sites/test'}},
  tokenProvider:async()=> 'fictitious-token',
  fetchImpl:async(rawUrl,options)=>{
   const url=new URL(rawUrl),path=decodeURIComponent(url.pathname);
   assert.equal(url.origin,'https://tenant.sharepoint.com');
   if(path.endsWith('/_api/web/lists'))return Response.json({value:[
    {Id:ddaList,Title:'DDAS SICOOB',BaseTemplate:100,Hidden:false},
    {Id:orderList,Title:'NOTASPENDENTES',BaseTemplate:100,Hidden:false},
    {Id:launchList,Title:'LANCAMENTOS',BaseTemplate:100,Hidden:false},
   ]});
   assert.equal(url.searchParams.has('$expand'),false);
   if(path.endsWith(`lists(guid'${orderList}')/items`)){
    assert.equal(url.searchParams.get('$select'),'ID,FORNECEDOR,VALORTOTAL,FILIAL,DATAPEDIDO');
    return Response.json({value:[order,{...order,ID:57,VALORTOTAL:'123,46'}]});
   }
   if(path.endsWith(`lists(guid'${launchList}')/fields`))return Response.json({value:[]});
   if(path.endsWith(`lists(guid'${launchList}')/items`)){
    assert.equal(url.searchParams.get('$filter'),"AGRUPAR eq '56'");
    assert.ok(url.searchParams.get('$select').split(',').includes('field_3'));
    assert.ok(url.searchParams.get('$select').split(',').includes('field_4'));
    if(launchUnavailable)return new Response(null,{status:403});
    return Response.json({value:[
     {ID:100,AGRUPAR:'56',field_2:'2026-11-05',field_3:'2026-11-02',field_4:'2026-11-05'},
     {ID:101,AGRUPAR:'56',field_2:'2026-11-05',field_3:'2026-11-06',field_4:'2026-11-05'},
     {ID:102,AGRUPAR:'56',field_3:'2026-11-02',field_4:orderPostingComplete?'2026-11-05':null},
    ]});
   }
   if(path.endsWith(`lists(guid'${orderList}')/items(56)`))return Response.json({ID:56,FORNECEDOR:order.FORNECEDOR});
   assert.ok(path.endsWith(`lists(guid'${ddaList}')/items(7)`),path);
   if(options.method==='GET')return Response.json(dda);
   assert.equal(options.method,'POST');
   assert.equal(options.headers['X-HTTP-Method'],'MERGE');
   assert.equal(options.headers['IF-MATCH'],version);
   const payload=JSON.parse(options.body);
   requests.push(payload);
   Object.assign(dda,payload);
   return new Response(null,{status:204});
  },
 });
 const [option,other]=await data.provisionLink.loadOrderOptions({amount:'123.45',due:'2026-11-05'});
 assert.equal(option.label,'#56 · Fornecedor fictício · Matriz');
 assert.equal(option.date,'2026-11-04');
 assert.deepEqual(option.dueDates,['2026-11-02','2026-11-06']);
 assert.equal(other.dueDates,undefined);
 launchUnavailable=true;
 const fallback=await data.provisionLink.loadOrderOptions({amount:'123.45',due:'2026-11-05'});
 assert.deepEqual(fallback.map(({id})=>id),['56','57']);
 assert.equal(fallback[0].dueLookupIncomplete,true);
 assert.equal(fallback[0].dueDates,undefined);
 const newPaidDda={id:'7',orderId:'56',status:'Pago',requiresSettledLink:true};
 launchUnavailable=false;
 assert.deepEqual([...await data.provisionLink.loadSettledDdaIds([newPaidDda])],[]);
 orderPostingComplete=true;
 assert.deepEqual([...await data.provisionLink.loadSettledDdaIds([newPaidDda])],['7']);
 assert.deepEqual(await data.provisionLink.saveOrder({ddaId:'7',orderId:option.id,
  expectedLink:{provisionId:'56',orderId:''}}),{ddaId:'7',orderId:'56'});
 assert.deepEqual(requests,[{DESCRITIVOPROVIS_x00c3_O:null,IDPEDIDO:'56'}]);
});
