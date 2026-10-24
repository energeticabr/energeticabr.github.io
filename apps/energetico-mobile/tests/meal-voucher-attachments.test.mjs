import test from 'node:test';
import assert from 'node:assert/strict';
import { createMealVoucherAttachments } from '../src/chat/meal-voucher-attachments.js';

function fixture() {
  const files = new Map(), uploaded = [];
  const target = {listId:'orders',id:'1'}, last = {listId:'launches',id:'2'};
  const repository = {
    listAttachments:async (_site,list,id) => [...files].filter(([k])=>k.startsWith(`${list}:${id}:`)).map(([k,b])=>({name:k.slice(`${list}:${id}:`.length),size:b.byteLength})),
    downloadAttachment:async (_site,list,id,name) => files.get(`${list}:${id}:${name}`).slice().buffer,
    uploadAttachment:async (_site,list,id,file) => { files.set(`${list}:${id}:${file.name}`,new Uint8Array(await file.arrayBuffer())); uploaded.push(`${list}:${id}:${file.name}`); },
  };
  return {files,uploaded,repository,target,last};
}
const file = (value='abc',name='nota.pdf') => new File([value],name,{type:'application/pdf',lastModified:0});
test('anexos usam bytes e nome canônico e entregam uma vez em cada destino explícito',async()=>{
  const f=fixture(),service=createMealVoucherAttachments(f),entries=await service.prepare([file()]);
  await service.submit([f.target,f.last],entries); await service.submit([f.target,f.last],entries);
  assert.deepEqual(f.uploaded,['orders:1:nota.pdf','launches:2:nota.pdf']);
  assert.deepEqual(entries[0].manifest,{name:'nota.pdf',size:3,sha256:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'});
});
test('conteúdo diferente com mesmo nome não é sobrescrito nem causa entrega parcial',async()=>{
  const f=fixture();f.files.set('launches:2:nota.pdf',new TextEncoder().encode('xyz'));
  const service=createMealVoucherAttachments(f),entries=await service.prepare([file()]);
  await assert.rejects(service.submit([f.target,f.last],entries),/conteúdo diferente/);assert.deepEqual(f.uploaded,[]);
});
test('resposta perdida após gravação é sucesso somente com releitura e conteúdo correto',async()=>{
  const f=fixture(),upload=f.repository.uploadAttachment;f.repository.uploadAttachment=async(...args)=>{await upload(...args);throw new Error('timeout');};
  const service=createMealVoucherAttachments(f);await service.submit([f.target],await service.prepare([file()]));assert.equal(f.uploaded.length,1);
});
test('falha antes da gravação não recebe confirmação falsa',async()=>{
  const f=fixture();f.repository.uploadAttachment=async()=>{throw new Error('rede caiu');};
  const service=createMealVoucherAttachments(f);await assert.rejects(service.submit([f.target],await service.prepare([file()])),/rede caiu/);
});
test('manifesto de retomada recusa mesmos metadados com bytes alterados',async()=>{
  const f=fixture(),service=createMealVoucherAttachments(f),entries=await service.prepare([file()]);
  await assert.rejects(service.prepare([file('xyz')],entries.map(e=>e.manifest)),/mesmo conteúdo/);assert.deepEqual(f.uploaded,[]);
});
test('nomes duplicados com diferença apenas de caixa são recusados antes de enviar',async()=>{
  const f=fixture();await assert.rejects(createMealVoucherAttachments(f).prepare([file(),file('abc','NOTA.PDF')]),/mesmo nome/);assert.deepEqual(f.uploaded,[]);
});
test('sessão encerrada durante download impede o upload em outro destino',async()=>{
  const f=fixture();f.files.set('orders:1:nota.pdf',new TextEncoder().encode('abc'));
  let active=true;const download=f.repository.downloadAttachment;f.repository.downloadAttachment=async(...args)=>{const b=await download(...args);active=false;return b;};
  const service=createMealVoucherAttachments({...f,assertSession:()=>{if(!active)throw new Error('sessão encerrada');}});
  await assert.rejects(service.submit([f.target,f.last],await service.prepare([file()])),/sessão/);assert.equal(f.uploaded.length,0);
});
