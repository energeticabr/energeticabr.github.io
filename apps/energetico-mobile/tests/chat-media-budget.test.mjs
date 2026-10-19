import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatClient } from '../src/chat/chat-client.js';

const descriptor={mediaUrl:'/api/portal-media/photo'};
const makeClient=fetchImpl=>createChatClient({apiBaseUrl:'https://energetico.test',tokenProvider:async()=>'test',fetchImpl});

test('optional preview budget rejects a known large original before reading its body',async()=>{
  let bodyReads=0,cancelled=0;
  const client=makeClient(async()=>({ok:true,headers:new Headers({'Content-Length':'18000000'}),
    body:{cancel:async()=>{cancelled++;}},blob:async()=>{bodyReads++;return new Blob(['original']);}}));
  await assert.rejects(client.fetchMedia(descriptor,{maxBytes:5_242_880}),error=>error.code==='MEDIA_PREVIEW_TOO_LARGE');
  assert.equal(bodyReads,0);assert.equal(cancelled,1);
});

test('unknown-length preview stops reading as soon as its byte budget is exceeded',async()=>{
  let chunks=0,cancelled=0;
  const stream=new ReadableStream({pull(controller){if(chunks===4){controller.close();return;}chunks++;controller.enqueue(new Uint8Array([1,2,3,4]));},cancel(){cancelled++;}},{highWaterMark:0});
  const client=makeClient(async()=>new Response(stream,{headers:{'Content-Type':'image/png'}}));
  await assert.rejects(client.fetchMedia(descriptor,{maxBytes:8}),error=>error.code==='MEDIA_PREVIEW_TOO_LARGE');
  assert.equal(chunks,3);assert.equal(cancelled,1);
});

test('the exact preview byte budget is accepted without changing original bytes or MIME',async()=>{
  const client=makeClient(async()=>new Response(new Uint8Array([1,2,3,4]),{headers:{'Content-Type':'image/png'}}));
  const blob=await client.fetchMedia(descriptor,{maxBytes:4});
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())],[1,2,3,4]);assert.equal(blob.type,'image/png');
});

test('explicit original opening has no optional-preview size restriction',async()=>{
  const original=new Blob(['original document'],{type:'application/pdf'});
  const client=makeClient(async()=>new Response(original,{headers:{'Content-Length':'18000000'}}));
  assert.equal(await(await client.fetchMedia(descriptor)).text(),'original document');
});
