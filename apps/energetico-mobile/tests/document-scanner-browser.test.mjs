import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
test('scanner edits corners, reviews and exports real JPEG without sending the original; layouts fit', {timeout:120_000},async t=>{
  if(!browser)return t.skip('Chrome unavailable');
  const server=await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
  try{
    await server.listen();
    for(const [width,height] of [[320,740],[390,844],[844,390],[1365,768]]){
      const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/document-scanner.html`});
      const dom=new JSDOM(stdout),result=JSON.parse(dom.window.document.documentElement.dataset.layout||'{}');dom.window.close();
      assert.equal(result.error,undefined,JSON.stringify(result));
      assert.equal(result.type,'image/jpeg');assert.ok(result.size>1000);
      assert.ok(result.width>=380&&result.width<=430&&result.height>=620&&result.height<=680,JSON.stringify(result));
      assert.equal(result.cancelled,true);assert.equal(result.adjusted,true);assert.equal(result.returned,true);
      assert.equal(result.fits,true,JSON.stringify(result));assert.equal(result.networkWrites,0);
    }
  }finally{await server.close();}
});
