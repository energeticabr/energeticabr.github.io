import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('DDA default Em aberto is selected on narrow mobile and Windows widths',{timeout:90000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
 if(!browser)return t.skip('Chrome unavailable');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url))),server=await createServer({root,server:{host:'127.0.0.1',port:0},logLevel:'silent'});
 try{
  await server.listen();
  for(const [width,height] of [[320,740],[390,844],[1365,900]]){
   const capture=process.env.DDA_DEFAULT_FILTER_CAPTURE_DIR;
   const result=await runBrowserLayout(browser,{width,height,captureScreenshot:Boolean(capture),url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/dda-default-open.html`});
   const dom=new JSDOM(result.stdout);
   try{
    const state=JSON.parse(dom.window.document.documentElement.dataset.layout);
    if(capture){mkdirSync(capture,{recursive:true});writeFileSync(join(capture,`dda-default-open-${width}.png`),result.screenshot);}
    assert.deepEqual(state,{status:'Em aberto',label:'Em aberto',cards:1,paidHidden:true,overflow:false});
   }finally{dom.window.close();}
  }
 }finally{await server.close();}
});
