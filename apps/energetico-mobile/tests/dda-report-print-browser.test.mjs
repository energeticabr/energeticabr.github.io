import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';
test('DDA printer finishes the real PDF preview instead of remaining at 99%',{timeout:90000},async t=>{
 const browser=['C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome'].find(existsSync);if(!browser)return t.skip('Chrome unavailable');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url))),server=await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
 try{await server.listen();for(const [width,height,count] of [[320,568,23],[390,844,23],[844,390,23],[1365,900,23],[390,844,150]]){
  const sample=process.env.DDA_PDF_SAMPLE&&count===23&&width===844;
  const result=await runBrowserLayout(browser,{width,height,readyTimeoutMs:20000,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/dda-report-print.html?close=1&count=${count}&sample=${Boolean(sample)}`});
  const dom=new JSDOM(result.stdout);try{const state=JSON.parse(dom.window.document.documentElement.dataset.layout);assert.equal(state.loading,false,JSON.stringify({width,count,...state}));assert.equal(state.canvas,true,JSON.stringify({width,...state}));assert.equal(state.returned,true);assert.match(state.status,/100%/);
   assert.equal(state.pdfError,undefined,state.pdfError);
   const {cards,fonts,fills,actions,pages}=state.pdfLayout;
   assert.ok(cards.every(Boolean),JSON.stringify(cards));
   assert.equal(new Set(cards.slice(0,4).map(([,y])=>y)).size,1,'first four measures share a row');
   assert.equal(new Set(cards.slice(4).map(([,y])=>y)).size,1,'last three measures share a row');
   assert.equal(new Set(cards.slice(0,4).map(([x])=>x)).size,4,'each measure has its own card');
   assert.ok(cards[4][1]<cards[0][1]);
   if(count===23)assert.ok(fonts.filter(size=>size>=13).length>=2,`metric values retain their visual emphasis: ${fonts}`);
   for(const fill of ['#eaf4f7','#e6f0ff','#eaf2ff','#edf6f2','#edf1f4','#eef2f5','#fff0db'])assert.ok(fills.includes(fill),`missing card or badge fill: ${fill}`);
   assert.equal(actions,false,'screen-only buttons must not reserve a PDF column');
   assert.ok(pages>1);
   if(sample)writeFileSync(process.env.DDA_PDF_SAMPLE,Buffer.from(dom.window.document.querySelector('#pdf-sample').innerHTML,'base64'));
  }finally{dom.window.close();}
 }}finally{await server.close();}
});
