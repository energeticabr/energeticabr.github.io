import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createIsolatedViteServer} from './helpers/isolated-vite-server.mjs';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('real controller swaps ready reports without HOME or blank frames on phone and PC',{timeout:90000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
 if(!browser)return t.skip('Chrome unavailable');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 const server=await createIsolatedViteServer({root,optimizeDeps:{noDiscovery:true,include:['decimal.js','pdf-lib','pako','@capacitor/core']},server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
 try{
  await server.listen();
  for(const mode of ['', '?cargos'])for(const [width,height] of [[390,844],[844,390],[1365,1000]]){
   const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/report-transition.html${mode}`});
   const dom=new JSDOM(stdout);
   try{
    const result=JSON.parse(dom.window.document.documentElement.dataset.layout);
    assert.equal(result.error,undefined,JSON.stringify(result));
    assert.ok(result.sameBounds&&result.removed&&result.ready&&result.visible,JSON.stringify(result));
    assert.equal(result.background,'rgba(0, 0, 0, 0)');
    assert.ok(result.expectedScroll>0);
    assert.ok(result.frames.every(frame=>frame.retained&&!frame.sourceVisible&&frame.topmost&&frame.scroll===result.expectedScroll&&frame.background==='rgba(0, 0, 0, 0)'),JSON.stringify(result));
   }finally{dom.window.close();}
  }
 }finally{await server.close();}
});
