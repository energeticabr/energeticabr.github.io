import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('portrait phone reports fill physical height sideways and keep lateral dismissal',{timeout:90000},async t=>{
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
     const lateralTarget=Math.max(24,width*.065)-1;
     assert.ok(result.gaps.left>=lateralTarget&&result.gaps.right>=lateralTarget,JSON.stringify(result));
     assert.ok(Math.abs(result.gaps.top)<1&&Math.abs(result.gaps.bottom)<1,'portrait report must fill the physical Y axis: '+JSON.stringify(result));
     const matrix=result.transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(',').map(Number);
     assert.ok(matrix&&Math.abs(matrix[1]-1)<.001&&Math.abs(matrix[2]+1)<.001,'portrait report must be sideways: '+JSON.stringify(result));
     assert.equal(result.outsideIsBackdrop,true);
     assert.equal(result.closedOutside,true);
    }
   }finally{dom.window.close();}
  }
 }finally{await server.close();}
});

test('contractor filters keep their landscape row on a portrait phone',{timeout:90000},async t=>{
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

test('sideways portrait keeps controls and expanded picker within physical safe areas',{timeout:90000},async t=>{
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
   assert.ok(Math.abs(layout.dialog.top)<1&&Math.abs(layout.dialog.bottom-844)<1,'portrait report fills physical Y');
   assert.ok(layout.dialog.left>=insets.left-1&&layout.dialog.right<=390-insets.right+1);
   for(const bounds of [layout.popup,...layout.controls]) {
    assert.ok(bounds.left>=insets.left-1&&bounds.right<=390-insets.right+1,JSON.stringify({bounds,layout}));
    assert.ok(bounds.top>=insets.top-1&&bounds.bottom<=844-insets.bottom+1,JSON.stringify({bounds,layout}));
   }
   assert.equal(layout.reads,1);
  }finally{dom.window.close();}
 }finally{await server.close();}
});

test('attendance summary fills portrait height sideways and dismisses from both side borders',{timeout:90000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
 if(!browser)return t.skip('Chrome unavailable');
 const server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
 try {
  await server.listen();
  for(const [width,height] of [[390,844],[844,390]]) {
   const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/report-landscape.html?attendance`});
   const dom=new JSDOM(stdout);
   try {
    const layout=JSON.parse(dom.window.document.documentElement.dataset.layout);
    assert.equal(layout.hasSummary,true,JSON.stringify(layout));
    if(layout.portrait) {
     assert.ok(layout.bounds.left>=24&&layout.bounds.right<=width-24,JSON.stringify(layout));
     assert.ok(Math.abs(layout.bounds.top)<1&&Math.abs(layout.bounds.bottom-height)<1,JSON.stringify(layout));
     assert.equal(layout.leftIsBackdrop,true);
     assert.equal(layout.rightIsBackdrop,true);
     assert.equal(layout.closedLeft,true);
     assert.equal(layout.closedRight,true);
    } else {
     assert.ok(layout.bounds.left>0&&layout.bounds.right<width,JSON.stringify(layout));
    }
   }finally{dom.window.close();}
  }
 }finally{await server.close();}
});
