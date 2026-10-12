import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('portrait rotation maps asymmetric physical safe areas to the report and expanded picker',{timeout:90000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
 if(!browser)return t.skip('Chrome unavailable');
 const server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
 try {
  await server.listen();
  const insets={top:59,bottom:34,left:11,right:23};
  const {stdout}=await runBrowserLayout(browser,{width:390,height:844,safeAreaInsets:insets,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/report-landscape.html?safearea`});
  const dom=new JSDOM(stdout);
  try {
   const layout=JSON.parse(dom.window.document.documentElement.dataset.layout);
   assert.ok(layout.controls.length>=10,'measure the actual visible report controls');
   for(const bounds of [layout.dialog,layout.popup,...layout.controls]) {
    assert.ok(bounds.left>=insets.left-1&&bounds.right<=390-insets.right+1,JSON.stringify({bounds,layout}));
    assert.ok(bounds.top>=insets.top-1&&bounds.bottom<=844-insets.bottom+1,JSON.stringify({bounds,layout}));
   }
   assert.equal(layout.reads,1);
  }finally{dom.window.close();}
 }finally{await server.close();}
});
