import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';
test('DDA printer finishes the real PDF preview instead of remaining at 99%',{timeout:90000},async t=>{
 const browser=['C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome'].find(existsSync);if(!browser)return t.skip('Chrome unavailable');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url))),server=await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
 try{await server.listen();for(const [width,height,count] of [[390,844,23],[844,390,23],[1365,900,23],[390,844,150]]){
  const result=await runBrowserLayout(browser,{width,height,readyTimeoutMs:20000,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/dda-report-print.html?close=1&count=${count}`});
  const dom=new JSDOM(result.stdout);try{const state=JSON.parse(dom.window.document.documentElement.dataset.layout);assert.equal(state.loading,false,JSON.stringify({width,count,...state}));assert.equal(state.canvas,true,JSON.stringify({width,...state}));assert.equal(state.returned,true);assert.match(state.status,/100%/);}finally{dom.window.close();}
 }}finally{await server.close();}
});
