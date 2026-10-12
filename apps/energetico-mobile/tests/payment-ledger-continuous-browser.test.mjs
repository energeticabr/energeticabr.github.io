import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('payments scroll in batches of 200, reset after filtering, keep PDF complete and use a blue logo background',{timeout:120000},async t=>{
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));
  if(!browser)return t.skip('Chrome unavailable');
  const server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),optimizeDeps:{noDiscovery:true,include:['decimal.js']},server:{host:'127.0.0.1',port:0,hmr:false,watch:null},logLevel:'silent'});
  try{
    await server.listen();
    for(const [width,height,safeAreaInsets] of [[844,390],[844,390,{left:47,right:47,bottom:21}],[1280,589]]){
      const {stdout}=await runBrowserLayout(browser,{width,height,safeAreaInsets,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/payment-ledger-continuous.html`});
      const dom=new JSDOM(stdout);let result;try{result=JSON.parse(dom.window.document.documentElement.dataset.layout);}finally{dom.window.close();}
      assert.equal(result.error,undefined,result.error);
      assert.deepEqual(result.counts,[200,400,451,451]);assert.equal(result.anchored,true);
      assert.deepEqual(result.printer,{rows:452,visible:200,top:70});
      assert.equal(result.filteredInitial,200);assert.equal(result.filteredEnd,201);assert.equal(result.filterScroll,0);
      assert.equal(new Set(result.ids).size,201);assert.ok(result.ids.every(id=>Number(id)>=251));
      assert.equal(result.printRows,202);assert.equal(result.restoredScroll,true);assert.equal(result.pager,false);
      assert.equal(result.logoBackground,'rgb(230, 240, 255)');assert.equal(result.logoLoaded,true);
      assert.equal(result.documentOverflow,0);assert.ok(result.overflow<=1);assert.ok(result.tableHeight>150);
    }
  }finally{await server.close();}
});
