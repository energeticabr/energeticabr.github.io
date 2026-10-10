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

test('RHID supplier search stays below the status bar without losing seven visible suppliers',{timeout:180000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(path=>path&&existsSync(path));if(!browser)return t.skip('Chrome unavailable');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url))),server=await createServer({root,server:{host:'127.0.0.1',port:0},logLevel:'silent'});await server.listen();
 const cases=[
  {name:'iPhone portrait with notch',width:390,height:844,safeAreaInsets:{top:59,bottom:34,left:0,right:0}},
  {name:'small iPhone portrait',width:320,height:568,safeAreaInsets:{top:44,bottom:34,left:0,right:0}},
  {name:'large iPhone portrait',width:430,height:932,safeAreaInsets:{top:59,bottom:34,left:0,right:0}},
  {name:'iPhone landscape',width:844,height:390,safeAreaInsets:{top:0,bottom:21,left:59,right:59}},
  {name:'tablet status bar',width:1024,height:768,safeAreaInsets:{top:24,bottom:20,left:0,right:0}},
 ];
 try{for(const scenario of cases)await t.test(scenario.name,async()=>{
  const {width,height,safeAreaInsets}=scenario;
  const result=await runBrowserLayout(browser,{width,height,safeAreaInsets,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/rhid-monthly-picker-options.html`});
  const dom=new JSDOM(result.stdout),layout=JSON.parse(dom.window.document.querySelector('#layout-result').textContent);dom.window.close();
  assert.ok(layout.search.top>=safeAreaInsets.top+12,`search overlaps status bar: ${JSON.stringify(layout)}`);
  assert.ok(layout.dismiss.top>=safeAreaInsets.top+12,'dismiss button must also be reachable below the status bar');
  assert.ok(layout.popup.left>=safeAreaInsets.left+12&&layout.popup.right<=width-safeAreaInsets.right-12,JSON.stringify(layout));
  assert.ok(layout.popup.bottom<=height-safeAreaInsets.bottom-12,JSON.stringify(layout));
  assert.ok(layout.visibleOptions>=7,JSON.stringify(layout));
 });}finally{await server.close();}
});
