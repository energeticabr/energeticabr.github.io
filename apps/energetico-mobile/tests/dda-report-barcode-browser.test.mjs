import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';
test('barcode disclosure fits mobile rotated report and desktop; copies only on button click',{timeout:90000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
 if(!browser)return t.skip('Chrome unavailable');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url))),server=await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
 try{await server.listen();for(const [width,height] of [[320,740],[390,844],[1365,900]]){
  const capture=process.env.DDA_REPORT_BARCODE_CAPTURE_DIR;
  const result=await runBrowserLayout(browser,{width,height,captureScreenshot:Boolean(capture),url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/dda-report.html?report=1&layout=1&barcode=1`});
  const dom=new JSDOM(result.stdout);
  try{const state=JSON.parse(dom.window.document.documentElement.dataset.barcode);
   for(const field of ['noAutoCopy','closed','feedback','fits','buttonFits','expanded'])assert.equal(state[field],true,JSON.stringify({width,field,state}));
   assert.equal(state.overflow,false);assert.deepEqual(state.copied,['01234567890123456789012345678901234567890123']);
   if(capture){mkdirSync(capture,{recursive:true});writeFileSync(join(capture,`dda-report-barcode-${width}.png`),result.screenshot);}
  }finally{dom.window.close();}
 }}finally{await server.close();}
});
