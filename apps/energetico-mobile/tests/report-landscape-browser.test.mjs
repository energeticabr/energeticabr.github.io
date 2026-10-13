import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('rotated phone reports fill physical height, retain lateral dismissal and both navigation arrows',{timeout:90000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
 if(!browser)return t.skip('Chrome unavailable');
 const server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
 try {
  await server.listen();
  for(const [width,height] of [[390,844],[844,390]]) {
   const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/report-landscape.html?controls`});
   const dom=new JSDOM(stdout);
   try {
    const result=JSON.parse(dom.window.document.documentElement.dataset.layout);
    assert.equal(result.arrows.length,2);
    assert.ok(result.arrows.every(arrow=>arrow.visible&&arrow.hit&&arrow.width>=44&&arrow.height>=44),JSON.stringify(result));
    assert.deepEqual(result.navigated,['open-provision-report','open-management-report']);
    assert.equal(result.closedByX,true);
    if(result.portrait) {
     assert.ok(result.gaps.left>=16&&result.gaps.right>=16,JSON.stringify(result));
     assert.ok(Math.abs(result.gaps.top)<1&&Math.abs(result.gaps.bottom)<1,'only the physical sides may expose the backdrop: '+JSON.stringify(result));
     assert.equal(result.outsideIsBackdrop,true);
     assert.equal(result.closedOutside,true);
    }
   }finally{dom.window.close();}
  }
 }finally{await server.close();}
});

test('contractor filters use the same single landscape row on a portrait phone',{timeout:90000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
 if(!browser)return t.skip('Chrome unavailable');
 const server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
 try {
  await server.listen();
  for(const [width,height]of [[390,844],[844,390]]) {
   const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/report-landscape.html?contractor`});
   const dom=new JSDOM(stdout);
   try {
    const layout=JSON.parse(dom.window.document.documentElement.dataset.layout);
    assert.equal(layout.columns,7,JSON.stringify(layout));
    assert.equal(layout.sameRow,true,JSON.stringify(layout));
    assert.equal(layout.reads,1);
    assert.equal(layout.closeCount,1);
   }finally{dom.window.close();}
  }
 }finally{await server.close();}
});

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
   assert.ok(Math.abs(layout.dialog.top)<1&&Math.abs(layout.dialog.bottom-844)<1,'opaque report fills height even with safe areas');
   assert.ok(layout.dialog.left>=insets.left-1&&layout.dialog.right<=390-insets.right+1);
   for(const bounds of [layout.popup,...layout.controls]) {
    assert.ok(bounds.left>=insets.left-1&&bounds.right<=390-insets.right+1,JSON.stringify({bounds,layout}));
    assert.ok(bounds.top>=insets.top-1&&bounds.bottom<=844-insets.bottom+1,JSON.stringify({bounds,layout}));
   }
   assert.equal(layout.reads,1);
  }finally{dom.window.close();}
 }finally{await server.close();}
});
