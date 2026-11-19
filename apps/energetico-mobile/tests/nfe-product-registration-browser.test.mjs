import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createIsolatedViteServer as createServer} from './helpers/isolated-vite-server.mjs';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('product registration cluster and form fit phones and Windows',{timeout:120000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
 if(!browser)return t.skip('Chrome unavailable');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 const server=await createServer({root,server:{host:'127.0.0.1',port:0,hmr:false,watch:null,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
 try{await server.listen();
  for(const [width,height]of [[320,568],[390,844],[844,390],[1365,900]]){
   for(const registration of [false,true]){
    const result=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/nfe-product-registration.html${registration?'?registration':''}`,captureScreenshot:Boolean(process.env.NFE_CAPTURE_DIR)});
    const dom=new JSDOM(result.stdout);let state;
    try{state=JSON.parse(dom.window.document.documentElement.dataset.layout);}finally{dom.window.close();}
    assert.equal(state.error,undefined);
    for(const key of ['rightOfProduct','buttonFits','formFits','footerVisible','nameSuggested','proposalHidden'])assert.equal(state[key],true,`${key} at ${width}: ${JSON.stringify(state)}`);
    if(result.screenshot){mkdirSync(process.env.NFE_CAPTURE_DIR,{recursive:true});writeFileSync(join(process.env.NFE_CAPTURE_DIR,`product-${registration?'form':'cluster'}-${width}.png`),result.screenshot);}
   }
  }
 }finally{await server.close();}
});
