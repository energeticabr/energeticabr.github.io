import test from 'node:test';
import assert from 'node:assert/strict';
import { createNfeProposalAttachmentStore } from '../src/chat/nfe-proposal-attachment-store.js';

test('proposal file storage preserves bytes and native ownership while isolating accounts and invoices',async()=>{
  const store=createNfeProposalAttachmentStore({indexedDB:null});
  const file=new File(['camera bytes'],'foto.jpg',{type:'image/jpeg'});Object.defineProperty(file,'sourceId',{value:'share-1'});
  await store.save('account-a','invoice-a',[file]);
  assert.deepEqual(await store.load('account-b','invoice-a'),[]);
  assert.deepEqual(await store.load('account-a','invoice-b'),[]);
  const [saved]=await store.load('account-a','invoice-a');assert.equal(await saved.text(),'camera bytes');assert.equal(saved.sourceId,'share-1');
  assert.equal((await store.list())[0].files[0].sourceId,'share-1');
  await store.save('account-a','invoice-a',[]);assert.deepEqual(await store.list(),[]);
});
