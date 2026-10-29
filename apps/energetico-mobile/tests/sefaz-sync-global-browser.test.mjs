import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('fiscal success, partial and failure receipts fit 320/390px and desktop with explicit acknowledgement',{timeout:90000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
 if(!browser)return t.skip('Chrome unavailable');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url))),server=await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
 try{
  await server.listen();for(const [width,height]of [[320,740],[390,844],[1365,900]])for(const status of ['succeeded','partial','failed']){
   const capture=process.env.SEFAZ_SYNC_CAPTURE_DIR;
   const result=await runBrowserLayout(browser,{width,height,captureScreenshot:Boolean(capture),url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/sefaz-sync-global.html?status=${status}`});
   const dom=new JSDOM(result.stdout);try{
    const state=JSON.parse(dom.window.document.documentElement.dataset.layout);
    for(const key of ['global','focused','fits','buttonVisible','nativeModal'])assert.equal(state[key],true,JSON.stringify({width,status,state}));
    assert.equal(state.overflow,false);assert.equal(state.acknowledged,false);assert.match(state.text,/NF-e/);assert.match(state.text,/CT-e/);assert.match(state.text,/NFS-e nacional/);assert.doesNotMatch(state.text,/nova/i);
    if(capture){mkdirSync(capture,{recursive:true});writeFileSync(join(capture,`sefaz-sync-${status}-${width}.png`),result.screenshot);}
   }finally{dom.window.close();}
  }
 }finally{await server.close();}
});
