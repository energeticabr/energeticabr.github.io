import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('supplier counts stay below names without overflow on narrow phones, landscape and desktop',{timeout:90000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
 if(!browser)return t.skip('Chrome unavailable');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 const server=await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
 try{
  await server.listen();
  for(const [width,height] of [[320,740],[390,844],[844,390],[1365,900]]){
   const capture=process.env.DDA_COUNT_CAPTURE_DIR;
   const result=await runBrowserLayout(browser,{width,height,captureScreenshot:Boolean(capture),url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/dda-report.html?report=1&layout=1`});
   const dom=new JSDOM(result.stdout);
   try{
    const layout=JSON.parse(dom.window.document.documentElement.dataset.layout);
    assert.equal(layout.pageOverflow,false,JSON.stringify({width,layout}));assert.equal(layout.tableFits,true);
    assert.equal(layout.clusters.length,3);assert.match(layout.clusters[0].label,/2 DDAs registrados/);
    for(const cluster of layout.clusters){assert.ok(cluster.below&&cluster.fits,JSON.stringify({width,cluster}));assert.ok(cluster.fontSize>=12);assert.equal(cluster.background,'rgb(234, 242, 255)');}
    if(capture){mkdirSync(capture,{recursive:true});writeFileSync(join(capture,`dda-count-preview-${width}.png`),result.screenshot);}
   }finally{dom.window.close();}
  }
 }finally{await server.close();}
});
