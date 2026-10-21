import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const endpoint=await import('./helpers/devtools-endpoint.mjs').catch(()=>({}));
const path='/devtools/browser/11111111-2222-4333-8444-555555555555';
test('endpoint parser rejects a partially written port file and invalid URLs',()=>{
  assert.equal(typeof endpoint.parseDevToolsEndpoint,'function');
  for(const value of ['', '43210\n','43210\n/devtools/brow','0\n'+path,'65536\n'+path,'43210\nhttp://foreign.test','word\n'+path])assert.equal(endpoint.parseDevToolsEndpoint(value),null);
  assert.equal(endpoint.parseDevToolsEndpoint('43210\n'+path+'\n'),'ws://127.0.0.1:43210'+path);
});
test('waiter reads a real port-only file again until Chrome completes both lines',async t=>{
  assert.equal(typeof endpoint.waitForDevToolsEndpoint,'function');
  const root=await mkdtemp(join(tmpdir(),'endpoint-readiness-')),file=join(root,'port');
  let timer,writing;
  t.after(async()=>{clearTimeout(timer);await writing;await rm(root,{recursive:true,force:true});});
  await writeFile(file,'43210\n');
  timer=setTimeout(()=>{writing=writeFile(file,'43210\n'+path+'\n');},40);
  const result=await endpoint.waitForDevToolsEndpoint({read:()=>readFile(file,'utf8'),attempts:200,intervalMs:5});
  assert.equal(result,'ws://127.0.0.1:43210'+path);
});
test('waiter is bounded and reports a terminated browser without opening a WebSocket',async()=>{
  assert.equal(typeof endpoint.waitForDevToolsEndpoint,'function');
  await assert.rejects(endpoint.waitForDevToolsEndpoint({read:async()=>'',attempts:2,intervalMs:1}),/endpoint completo/i);
  await assert.rejects(endpoint.waitForDevToolsEndpoint({read:async()=>'',isExited:()=>true,attempts:200,intervalMs:1}),/encerrou/i);
});
