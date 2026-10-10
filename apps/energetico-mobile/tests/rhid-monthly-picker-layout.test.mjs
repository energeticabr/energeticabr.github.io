import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';
test('RHID supplier picker displays at least seven full supplier options on phone, tablet and PC',{timeout:180000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(path=>path&&existsSync(path));if(!browser)return t.skip('Chrome unavailable');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url))),server=await createServer({root,server:{host:'127.0.0.1',port:0},logLevel:'silent'});await server.listen();
 try{for(const [width,height] of [[320,568],[390,844],[430,932],[1024,768],[1365,900]]){
  const result=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/rhid-monthly-picker-options.html`});
  const dom=new JSDOM(result.stdout),layout=JSON.parse(dom.window.document.querySelector('#layout-result').textContent);dom.window.close();
  assert.equal(layout.placement,'expanded');assert.equal(layout.readOnly,true);assert.ok(layout.visibleOptions>=7,JSON.stringify(layout));
  assert.ok(layout.popup.left>=0&&layout.popup.right<=width&&layout.popup.bottom<=height,JSON.stringify(layout));
 }}finally{await server.close();}
});
