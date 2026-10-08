import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { JSDOM } from 'jsdom';
import { createHrPayrollGalleryData } from '../src/chat/orders-gallery-data.js';
import { createGalleryRecordActions } from '../src/ui/gallery-record-actions.js';

const receipt = (name='recibo.pdf') => new File(['signed receipt fixture'],name,{type:'application/pdf'});
function fixture({status='ATIVO',statusName='STATUS',hiddenStatus=false,existing=[]}={}) {
  const events=[],files=[...existing],uploaded=[];
  let fields={Title:'',MESREFERENCIA:'09/2026',FORNECEDOR:'FORNECEDOR TESTE',[statusName]:status},revision=1,active=true;
  const columns=[{name:'Title',text:{}},{name:'MESREFERENCIA',text:{}},{name:'FORNECEDOR',text:{}},{name:'OBS',text:{}},
    {name:statusName,displayName:'STATUS',text:{},hidden:hiddenStatus}];
  const repository={
    async resolveList(_site,aliases){return {status:'resolved',id:aliases[0]};},
    async getColumns(){return columns;},
    async getItemsPage(){return {items:[],hasMore:false};},
    async getItem(_site,_list,id){events.push('read item');return {id,eTag:'"v'+revision+'"',fields:{...fields}};},
    async listAttachments(site,list,id){assert.deepEqual([site,list,id],['personal','IDFOLHA','4']);events.push('list');return [...files];},
    async uploadAttachment(site,list,id,file,name){assert.deepEqual([site,list,id],['personal','IDFOLHA','4']);events.push('upload '+name);uploaded.push(file);files.push({name,size:file.size});revision++;},
    async downloadAttachment(){return new ArrayBuffer(1);},
    async updateItem(_site,_list,id,patch,options){events.push({patch,options});assert.equal(options.eTag,'"v'+revision+'"');fields={...fields,...patch};revision++;return {id,eTag:'"v'+revision+'"',fields};},
  };
  const data=createHrPayrollGalleryData({repository,assertSession:()=>{if(!active)throw new Error('Sessão encerrada');}});
  return {data,repository,events,files,uploaded,fields:()=>fields,change:patch=>{fields={...fields,...patch};revision++;},cancel:()=>{active=false;}};
}
const updates=f=>f.events.filter(e=>typeof e==='object');

for (const statusName of ['STATUS','field_7']) {
  test('hidden persisted INATIVO still requires a receipt: '+statusName,async()=>{
    const f=fixture({status:'INATIVO',statusName,hiddenStatus:true}),ctx=await f.data.loadEditor('IDFOLHA','4');
    await assert.rejects(f.data.saveEditor(ctx,{OBS:'EDITADO'}),/recibo de pagamento/i);
    assert.deepEqual(updates(f),[]);
  });
}

test('editor cancellation signal reaches attachment upload and item update',async()=>{
  const f=fixture(),ctx=await f.data.loadEditor('IDFOLHA','4'),abort=new AbortController();
  const upload=f.repository.uploadAttachment;
  f.repository.uploadAttachment=async(...args)=>{assert.equal(args[5]?.signal,abort.signal);return upload(...args);};
  await f.data.saveEditor(ctx,{STATUS:'INATIVO'},{attachments:[receipt()],signal:abort.signal});
  assert.equal(updates(f)[0].options.signal,abort.signal);
});

test('production payroll factory configures SharePoint attachment reads and receipt upload',async()=>{
  const listId='11111111-1111-4111-8111-111111111111',files=[],requests=[];
  let revision=1,status='ATIVO';
  const fetchImpl=async(url,init={})=>{
    const path=new URL(url).pathname;requests.push({path,method:init.method||'GET'});
    if(path.includes('/_api/')){
      if(path.endsWith("/add(FileName='recibo.pdf')")){files.push({FileName:'recibo.pdf',Length:29});revision++;return Response.json({FileName:'recibo.pdf'});}
      if(path.endsWith('/AttachmentFiles'))return Response.json({value:files});
    }
    if(path.includes('/sites/energeticaltda-my.sharepoint.com:'))return Response.json({id:'site-personal'});
    if(path.endsWith('/lists'))return Response.json({value:[{id:listId,displayName:'IDFOLHA',list:{template:'genericList'}}]});
    if(path.endsWith('/columns'))return Response.json({value:[{name:'Title',text:{}},{name:'MESREFERENCIA',text:{}},{name:'FORNECEDOR',text:{}},{name:'STATUS',text:{}}]});
    if(path.endsWith('/items/4/fields')){status=JSON.parse(init.body).STATUS;revision++;return Response.json({STATUS:status});}
    if(path.endsWith('/items/4'))return Response.json({id:'4',eTag:'"v'+revision+'"',fields:{Title:'',MESREFERENCIA:'09/2026',FORNECEDOR:'FORNECEDOR TESTE',STATUS:status}});
    throw new Error('Unexpected fixture URL: '+path);
  };
  const data=createHrPayrollGalleryData({tokenProvider:async()=> 'fixture-token',fetchImpl});
  const ctx=await data.loadEditor('IDFOLHA','4');
  assert.deepEqual(await ctx.sheetAttachments.list(),[]);
  await data.saveEditor(ctx,{STATUS:'INATIVO'},{attachments:[receipt()]});
  assert.equal(status,'INATIVO');
  assert.ok(requests.some(r=>r.path.includes('/AttachmentFiles/add')&&r.method==='POST'));
});

for(const [status,statusName] of [['ATIVO','STATUS'],['INATIVO','STATUS'],['ATIVO','field_7']]) {
  test('INATIVO requires receipt at persistence boundary: '+status+'/'+statusName,async()=>{
    const f=fixture({status,statusName}),ctx=await f.data.loadEditor('IDFOLHA','4');
    await assert.rejects(f.data.saveEditor(ctx,{[statusName]:'INATIVO'}),/recibo de pagamento de salário da contabilidade assinado/i);
    assert.deepEqual(updates(f),[]);
  });
}
test('a saved attachment on this sheet satisfies INATIVO',async()=>{
  const f=fixture({existing:[{name:'recibo-antigo.pdf'}]}),ctx=await f.data.loadEditor('IDFOLHA','4');
  await f.data.saveEditor(ctx,{STATUS:'INATIVO'});
  assert.deepEqual(updates(f),[{patch:{STATUS:'INATIVO'},options:{eTag:'"v1"'}}]);
});
test('ATIVO can submit with no receipt',async()=>{
  const f=fixture({status:''}),ctx=await f.data.loadEditor('IDFOLHA','4');
  await f.data.saveEditor(ctx,{STATUS:'ATIVO'});
  assert.equal(updates(f).length,1);
});
test('new receipt is uploaded and confirmed before INATIVO with upload-generated ETag',async()=>{
  const f=fixture(),ctx=await f.data.loadEditor('IDFOLHA','4'),file=receipt();
  await f.data.saveEditor(ctx,{STATUS:'INATIVO'},{attachments:[file]});
  assert.deepEqual(f.uploaded,[file]);
  assert.deepEqual(updates(f),[{patch:{STATUS:'INATIVO'},options:{eTag:'"v2"'}}]);
  const upload=f.events.indexOf('upload recibo.pdf'),write=f.events.findIndex(e=>typeof e==='object');
  assert.ok(upload>=0 && upload<write && f.events.slice(upload+1,write).includes('list'));
});
test('attachments-only submit persists files without a status patch',async()=>{
  const f=fixture(),ctx=await f.data.loadEditor('IDFOLHA','4'),file=receipt();
  await f.data.saveEditor(ctx,{STATUS:'ATIVO'},{attachments:[file]});
  assert.deepEqual(f.uploaded,[file]);assert.deepEqual(updates(f),[]);
});
for(const failure of ['upload','confirmation','query']) {
  test('no financial update after '+failure+' failure',async()=>{
    const f=fixture(),ctx=await f.data.loadEditor('IDFOLHA','4');
    if(failure==='upload')f.repository.uploadAttachment=async()=>{throw new Error('Upload falhou');};
    if(failure==='confirmation')f.repository.uploadAttachment=async()=>undefined;
    if(failure==='query')f.repository.listAttachments=async()=>undefined;
    await assert.rejects(f.data.saveEditor(ctx,{STATUS:'INATIVO'},{attachments:[receipt()]}));
    assert.deepEqual(updates(f),[]);
  });
}
test('successful partial uploads are not repeated on retry',async()=>{
  const f=fixture(),ctx=await f.data.loadEditor('IDFOLHA','4'),a=receipt('a.pdf'),b=receipt('b.pdf'),upload=f.repository.uploadAttachment;
  let failed=false;f.repository.uploadAttachment=async(...args)=>{if(args[4]==='b.pdf'&&!failed){failed=true;throw new Error('Offline');}return upload(...args);};
  await assert.rejects(f.data.saveEditor(ctx,{STATUS:'INATIVO'},{attachments:[a,b]}),/Offline/);
  assert.deepEqual(updates(f),[]);
  await f.data.saveEditor(ctx,{STATUS:'INATIVO'},{attachments:[a,b]});
  assert.deepEqual(f.uploaded,[a,b]);assert.equal(updates(f).length,1);
});
test('field changes during upload cannot be overwritten using fresh ETag',async()=>{
  const f=fixture(),ctx=await f.data.loadEditor('IDFOLHA','4'),upload=f.repository.uploadAttachment;
  f.repository.uploadAttachment=async(...args)=>{await upload(...args);f.change({FORNECEDOR:'OUTRO'});};
  await assert.rejects(f.data.saveEditor(ctx,{STATUS:'INATIVO'},{attachments:[receipt()]}),/alterad|reabra|conflito/i);
  assert.deepEqual(updates(f),[]);assert.equal(f.fields().FORNECEDOR,'OUTRO');
});
test('pre-existing ETag conflict prevents upload',async()=>{
  const f=fixture(),ctx=await f.data.loadEditor('IDFOLHA','4');f.change({Title:'Alterado'});
  await assert.rejects(f.data.saveEditor(ctx,{STATUS:'INATIVO'},{attachments:[receipt()]}),/alterad|reabra|conflito/i);
  assert.deepEqual(f.uploaded,[]);assert.deepEqual(updates(f),[]);
});
test('invalid and case-insensitive duplicate files fail before any upload',async()=>{
  for(const files of [[receipt(),receipt('RECIBO.pdf')],[receipt(),receipt('../bad.pdf')],[receipt(),new File([],'zero.pdf',{type:'application/pdf'})]]) {
    const f=fixture(),ctx=await f.data.loadEditor('IDFOLHA','4');
    await assert.rejects(f.data.saveEditor(ctx,{STATUS:'INATIVO'},{attachments:files}));
    assert.deepEqual(f.uploaded,[]);assert.deepEqual(updates(f),[]);
  }
});
test('cancelled session between upload and update cannot inactivate',async()=>{
  const f=fixture(),ctx=await f.data.loadEditor('IDFOLHA','4'),upload=f.repository.uploadAttachment;
  f.repository.uploadAttachment=async(...args)=>{await upload(...args);f.cancel();};
  await assert.rejects(f.data.saveEditor(ctx,{STATUS:'INATIVO'},{attachments:[receipt()]}),/sessão/i);
  assert.deepEqual(updates(f),[]);
});
test('last attachment confirmation cannot adopt a later removal ETag',async()=>{
  const f=fixture(),ctx=await f.data.loadEditor('IDFOLHA','4'),get=f.repository.getItem;
  let sawUpload=false,postUploadReads=0;
  f.repository.getItem=async(...args)=>{
    if(f.uploaded.length){sawUpload=true;postUploadReads++;}
    if(sawUpload&&postUploadReads===2){f.files.splice(0);f.change({});}
    return get(...args);
  };
  await assert.rejects(f.data.saveEditor(ctx,{STATUS:'INATIVO'},{attachments:[receipt()]}),/anexo|recibo|alterad/i);
  assert.deepEqual(updates(f),[]);
});

async function settle(){for(let n=0;n<60;n++)await new Promise(setImmediate);}
async function open(t,f,extras={}) {
  const dom=new JSDOM('<main></main>',{url:'https://example.test'}),doc=dom.window.document,old=globalThis.FormData;
  globalThis.FormData=dom.window.FormData;
  const actions=createGalleryRecordActions({document:doc,host:doc.querySelector('main'),
    loadEditor:id=>f.data.loadEditor('IDFOLHA',id),saveEditor:f.data.saveEditor,...extras});
  doc.querySelector('main').append(actions.render({id:'4',fields:f.fields()}));
  t.after(()=>{actions.destroy();dom.window.close();globalThis.FormData=old;});
  doc.querySelector('[data-gallery-action=edit]').click();await settle();
  return {dom,doc,actions};
}
const submit=async(doc,dom)=>{doc.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await settle();};
test('editor shows tray before submit and visible signed-receipt error without disabling SUBMETER',async t=>{
  const f=fixture({status:'INATIVO'}),{dom,doc}=await open(t,f);
  const tray=doc.querySelector('[data-sheet-attachments]');assert.ok(tray);
  const save=doc.querySelector('[data-form-save]');assert.equal(save.disabled,false);
  assert.ok(tray.compareDocumentPosition(save)&dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  await submit(doc,dom);
  assert.match(doc.querySelector('.gallery-record-dialog-error').textContent,/recibo de pagamento de salário da contabilidade assinado/i);
  assert.equal(doc.querySelector('.gallery-record-dialog-error').hidden,false);assert.deepEqual(updates(f),[]);
  assert.equal(save.disabled,false);
});
test('device-selected file is staged locally, removable and not uploaded when cancelling',async t=>{
  const f=fixture(),{dom,doc}=await open(t,f),input=doc.querySelector('[data-sheet-attachment-input]');assert.ok(input);
  Object.defineProperty(input,'files',{configurable:true,value:[receipt()]});
  input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await settle();
  assert.match(doc.querySelector('[data-sheet-attachment-list]').textContent,/recibo.pdf/);assert.deepEqual(f.uploaded,[]);
  doc.querySelector('[data-sheet-attachment-remove]').click();assert.doesNotMatch(doc.querySelector('[data-sheet-attachment-list]').textContent,/recibo.pdf/);
  input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  doc.querySelector('[data-form-cancel]').click();await settle();
  assert.equal(doc.querySelector('[data-gallery-record-screen]'),null);assert.deepEqual(f.uploaded,[]);
});
test('device-selected file reaches sheet save and permits INATIVO',async t=>{
  const f=fixture({status:'INATIVO'}),{dom,doc}=await open(t,f),input=doc.querySelector('[data-sheet-attachment-input]');assert.ok(input);
  Object.defineProperty(input,'files',{value:[receipt()]});input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  await submit(doc,dom);assert.equal(f.uploaded.length,1);assert.equal(doc.querySelector('[data-gallery-record-screen]'),null);
});
test('app tray selection stages a receipt without consuming the source tray',async t=>{
  const f=fixture(),file=receipt(),source=[{id:'pending:1',fileName:file.name,source:file}];
  const {doc}=await open(t,f,{getReceiptAttachments:()=>source,readReceiptAttachment:async()=>file});
  const select=doc.querySelector('[data-sheet-attachment-tray]');assert.ok(select);select.click();
  doc.querySelector('[data-receipt-picker] input').checked=true;doc.querySelector('[data-receipt-confirm]').click();await settle();
  assert.match(doc.querySelector('[data-sheet-attachment-list]').textContent,/recibo.pdf/);
  assert.deepEqual(f.uploaded,[]);assert.equal(source.length,1);
});
test('closing editor during upload cancels the following status update',async t=>{
  const f=fixture({status:'INATIVO'}),{dom,doc,actions}=await open(t,f),input=doc.querySelector('[data-sheet-attachment-input]');
  Object.defineProperty(input,'files',{value:[receipt()]});input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  let finish;const original=f.repository.uploadAttachment;
  f.repository.uploadAttachment=(...args)=>new Promise(resolve=>{finish=async()=>{await original(...args);resolve();};});
  doc.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await settle();assert.equal(typeof finish,'function');actions.close();await finish();await settle();
  assert.deepEqual(updates(f),[]);
});
test('existing attachments remain visible and cannot be deleted in this adding tray',async t=>{
  const f=fixture({existing:[{name:'recibo-salvo.pdf'}]}),{doc}=await open(t,f);
  const tray=doc.querySelector('[data-sheet-attachments]');
  assert.match(tray.textContent,/recibo-salvo.pdf/);
  assert.match(tray.textContent,/Salvo nesta folha/);
  assert.equal(tray.querySelector('[data-sheet-attachment-remove]'),null);
});
test('late attachment listing during a failed save restores removable staged files',async t=>{
  const f=fixture();let resolveList,failUpload;const originalList=f.repository.listAttachments;let first=true;
  f.repository.listAttachments=(...args)=>{if(first){first=false;return new Promise(resolve=>{resolveList=resolve;});}return originalList(...args);};
  f.repository.uploadAttachment=()=>new Promise((_resolve,reject)=>{failUpload=()=>reject(new Error('Offline'));});
  const {dom,doc}=await open(t,f),input=doc.querySelector('[data-sheet-attachment-input]');
  Object.defineProperty(input,'files',{value:[receipt()]});input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  doc.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await settle();
  assert.equal(typeof failUpload,'function');resolveList([]);await settle();failUpload();await settle();
  assert.equal(doc.querySelector('[data-sheet-attachment-remove]').disabled,false);
});
