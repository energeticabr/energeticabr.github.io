import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';
test('report bank refresh and global result work at phone and desktop widths',{timeout:90000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));if(!browser)return t.skip('Chrome unavailable');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url))),server=await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
 try{await server.listen();for(const [width,height] of [[320,740],[390,844],[1365,900]])for(const mode of ['running','complete']){
  const capture=process.env.DDA_REPORT_SYNC_CAPTURE_DIR;
  const result=await runBrowserLayout(browser,{width,height,captureScreenshot:Boolean(capture),url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/dda-report.html?report=1&layout=1&sync=${mode}`});
  const dom=new JSDOM(result.stdout);try{const state=JSON.parse(dom.window.document.documentElement.dataset.sync);
   assert.equal(state.starts,1);assert.equal(state.disabledWhileRunning,true);assert.equal(state.progressVisible,true);assert.equal(state.reportOpen,true);assert.equal(state.loads,mode==='running'?1:2);assert.equal(state.disabledAfter,mode==='running');if(mode==='complete')assert.equal(state.globalVisible,true);
   if(capture){mkdirSync(capture,{recursive:true});writeFileSync(join(capture,`dda-report-sync-${mode}-${width}.png`),result.screenshot);}
  }finally{dom.window.close();}
 }}finally{await server.close();}
});
