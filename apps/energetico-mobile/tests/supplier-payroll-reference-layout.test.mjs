import test from 'node:test';import assert from 'node:assert/strict';import {existsSync} from 'node:fs';import {fileURLToPath} from 'node:url';import {createServer} from 'vite';import {JSDOM} from 'jsdom';import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';
const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
test('reference payroll layout fits horizontal phone tablet desktop with blue white stripes and shared midpoint arrows',{timeout:120000},async t=>{
 if(!browser)return t.skip('Chromium indisponível');const app=fileURLToPath(new URL('..',import.meta.url)),repo=fileURLToPath(new URL('../../..',import.meta.url));const server=await createServer({root:app,server:{host:'127.0.0.1',port:0,fs:{allow:[repo]}},logLevel:'silent'});
 try{await server.listen();for(const [width,height] of [[844,390],[568,320],[1024,768],[1440,900]]){
  const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/supplier-payroll-reference-layout.html`});const dom=new JSDOM(stdout);const layout=JSON.parse(dom.window.document.documentElement.dataset.layout);dom.window.close();t.diagnostic(JSON.stringify(layout));
  assert.equal(layout.width,width);assert.ok(layout.overflow<=1);assert.ok(layout.contentOverflow<=1);assert.equal(layout.filterCount,3);assert.equal(layout.logoLoaded,true);assert.ok(layout.logo.bottom<=layout.toolbar.bottom+1);
  const pickerDom=new JSDOM(stdout),pickerArrows=JSON.parse(pickerDom.window.document.documentElement.dataset.pickerArrows);pickerDom.window.close();
  for(const {field,arrow} of pickerArrows)assert.ok(arrow.left>=field.left-1&&arrow.right<=field.right+1&&arrow.top>=field.top-1&&arrow.bottom<=field.bottom+1,'picker arrow remains inside its field');
  assert.deepEqual(layout.summaryColors,['rgb(210, 228, 242)','rgb(255, 255, 255)','rgb(210, 228, 242)']);assert.deepEqual(layout.paymentColors,['rgb(210, 228, 242)','rgb(255, 255, 255)','rgb(210, 228, 242)']);
  assert.equal(layout.arrows.length,2);for(const arrow of layout.arrows)assert.ok(Math.abs(arrow.center-height/2)<=1,'arrow uses shared viewport midpoint');
  assert.ok(layout.summaryBounds.every(summary=>summary.left>=layout.arrows[0].right-1&&summary.right<=layout.arrows[1].left+1),'both arrows have symmetric reserved space');
  for(const control of layout.controlBounds)assert.ok(control.left>=0&&control.right<=width+1&&control.bottom<=layout.toolbar.bottom+1);
  assert.ok(layout.headerMetricWidths.every(metric=>metric.scroll<=metric.width+1),'financial metrics fit');assert.ok(layout.paymentTable.width<=width);
  assert.match(layout.headerTexts[0],/1\.581,00/);assert.equal(layout.headerTexts[1],'3');
 }}finally{await server.close();}
});
