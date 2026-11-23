import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('popup do produto e detalhes dos rankings cabem no celular e PC',{timeout:150000},async t=>{
  const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
  if(!browser)return t.skip('Chrome unavailable');
  const server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),
    server:{host:'127.0.0.1',port:0},logLevel:'silent'});
  try {
    await server.listen();
    for(const [width,height] of [[320,568],[390,844],[844,390],[1365,768]]) {
      const insets=width===390?{top:59,bottom:34,left:11,right:23}:width===844?{top:0,bottom:21,left:59,right:59}:{top:0,bottom:0,left:0,right:0};
      const {stdout}=await runBrowserLayout(browser,{width,height,safeAreaInsets:insets,
        url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/management-product-detail.html`});
      const dom=new JSDOM(stdout);
      try {
        const result=JSON.parse(dom.window.document.documentElement.dataset.layout);
        assert.deepEqual(result,{rows:32,forecastOrange:true,paidOrange:false,
          subtotals:[['TOTAL DO MÊS','63','','R$ 822,50'],['TOTAL DO MÊS','2','','R$ 25,25']],
          inside:true,fillsReportHeight:true,closeHit:true,scrolls:true,overflow:false,
          backgroundInert:true,preciseUnit:true,returned:true,sameDOM:true,sameScroll:true,focus:true,
          charts:{smoothValueLine:true,monthlyValues:12,supplierBars:2,monthlyQuantities:12},
          rankings:Array.from({length:3},()=>({leftOfLabel:true,fitsWidth:true,count:30,collapsed:true}))},
          `${width}×${height}: ${dom.window.document.documentElement.dataset.geometry}`);
        const {close}=JSON.parse(dom.window.document.documentElement.dataset.geometry);
        assert.ok(close.left>=insets.left-1&&close.right<=width-insets.right+1
          &&close.top>=insets.top-1&&close.bottom<=height-insets.bottom+1,`Fechar fora da área segura: ${JSON.stringify(close)}`);
      } finally {dom.window.close();}
    }
  } finally {await server.close();}
});
