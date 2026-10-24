import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createIsolatedViteServer } from './helpers/isolated-vite-server.mjs';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('bandeja do vale inclui PDFs, mantém falha parcial e retoma só destinos pendentes no celular e PC',{timeout:120000},async t=>{
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
  if(!browser)return t.skip('Chrome indisponível');
  const app=fileURLToPath(new URL('..',import.meta.url)),server=await createIsolatedViteServer({root:app,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(app,'../..')]}},logLevel:'silent'});
  try{await server.listen();for(const width of [320,390,1365]){
    const {stdout}=await runBrowserLayout(browser,{width,height:844,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/meal-voucher-tray.html`});
    const dom=new JSDOM(stdout),result=JSON.parse(dom.window.document.documentElement.dataset.layout);dom.window.close();
    assert.deepEqual(result,{noPicker:true,trayFiles:2,previews:1,noEarlyWrites:true,noOverflow:true,recovered:true,orders:1,launches:3,payroll:3,cleanObs:true,
      targets:['NOTASPENDENTES:1','LANCAMENTOS:3'],uploads:4,remaining:0},`${width}px`);
  }}finally{await server.close();}
});
