import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('all report printers and refresh controls are larger, side by side, and fit before the filters', {timeout:150000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(value=>value&&existsSync(value));
 if(!browser)return t.skip('Chrome unavailable');
 const server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
 try{
  await server.listen();
  for(const [width,height]of [[740,360],[844,390],[1280,800]]){
   const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/home-provisions-mascot.html?print=1&toolbar=1`});
   const dom=new JSDOM(stdout);
   try{
    const {results}=JSON.parse(dom.window.document.documentElement.dataset.layout);
    assert.equal(results.length,16);
    for(const report of results){
     const label=`${report.action} at ${width}: ${JSON.stringify(report)}`;
     assert.equal(report.buttons.length,2,label);
     const [printer,refresh]=report.buttons;
     assert.ok(Math.abs(printer.y-refresh.y)<=1&&refresh.x>=printer.right,label);
     assert.ok(printer.width>=40&&refresh.width>=40&&printer.height>=44&&refresh.height>=44,label);
     assert.ok(report.printer.width>=32&&report.printer.height>=32&&report.refresh>=36,label);
     assert.ok(report.refreshIcon,'refresh must have font-independent geometry: '+label);
     assert.equal(report.refreshIcon.width,report.printer.width,label);
     assert.equal(report.refreshIcon.height,report.printer.height,label);
     for(const axis of ['width','height'])assert.ok(Math.abs(report.drawings[0][axis]-report.drawings[1][axis])<=1,label);
     assert.ok(report.hostOverflow<=1&&report.hostRight<=width+1,label);
     assert.ok(!report.filterRows.length||Math.max(...report.filterRows)-Math.min(...report.filterRows)<=1,label);
     assert.equal(report.legacyPrinters,0,label);
    }
   }finally{dom.window.close();}
  }
 }finally{await server.close();}
});

test('standalone commercial report keeps all five filters on the same row', {timeout:60000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(value=>value&&existsSync(value));
 if(!browser)return t.skip('Chrome unavailable');
 const server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
 try{
  await server.listen();
  const {stdout}=await runBrowserLayout(browser,{width:740,height:360,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/home-provisions-mascot.html?standalone-toolbar=1`});
  const dom=new JSDOM(stdout);
  try{
   const {filterRows}=JSON.parse(dom.window.document.documentElement.dataset.layout);
   assert.equal(filterRows.length,5);
   assert.ok(Math.max(...filterRows)-Math.min(...filterRows)<=1,JSON.stringify(filterRows));
  }finally{dom.window.close();}
 }finally{await server.close();}
});

test('supplier payroll fills the white area while shared midpoint arrows may overlay the rows', {timeout:60000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(value=>value&&existsSync(value));
 if(!browser)return t.skip('Chrome unavailable');
 const server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
 try{
  await server.listen();
  for(const [width,height]of [[740,360],[844,390],[1280,800]]){
   const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/home-provisions-mascot.html?payroll-navigation=1`});
   const dom=new JSDOM(stdout);
   try{
    const result=JSON.parse(dom.window.document.documentElement.dataset.layout);
    assert.equal(result.rows.length,12);assert.equal(result.namesLeft.length,12);
    assert.ok(result.rows.every(row=>row.left-result.content.left<=9&&result.content.right-row.right<=26),JSON.stringify(result));
    assert.ok(result.rows.every(row=>row.width>=result.content.width-35),'no reserved arrow gutters');
    assert.ok(result.rows[0].left<result.arrowRight,'the previous arrow may overlay the full-width rows');
    assert.ok(Math.abs(result.arrowCenter-height/2)<=1,'shared arrow stays at the viewport midpoint');
    assert.ok(result.namesLeft.every((left,i)=>left>=result.rows[i].left&&left<result.rows[i].right),'names stay inside their full-width rows');
    assert.ok(result.overflow<=1,JSON.stringify(result));
   }finally{dom.window.close();}
  }
 }finally{await server.close();}
});
