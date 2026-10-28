import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';
test('restored manual DDA result is visible over another screen on phone and desktop',{timeout:90000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
 if(!browser)return t.skip('Chrome unavailable');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 const server=await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
 try{
  await server.listen();for(const [width,height]of [[320,740],[390,844],[1365,900]]){
   const capture=process.env.DDA_SYNC_CAPTURE_DIR;
   const result=await runBrowserLayout(browser,{width,height,captureScreenshot:Boolean(capture),url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/dda-sync-global.html`});
   const dom=new JSDOM(result.stdout);try{
    const state=JSON.parse(dom.window.document.documentElement.dataset.layout);
    for(const key of ['global','backgroundBlocked','focused','fits','buttonVisible','mainRestored','concurrentPopupUsable','nativeModal'])assert.equal(state[key],true,JSON.stringify({width,state}));
    assert.equal(state.overflow,false);assert.equal(state.acknowledged,false);assert.match(state.text,/FORNECEDOR FICTÍCIO/);assert.match(state.text,/ID 42/);
    if(capture){mkdirSync(capture,{recursive:true});writeFileSync(join(capture,`dda-sync-global-${width}.png`),result.screenshot);}
   }finally{dom.window.close();}
  }
 }finally{await server.close();}
});
