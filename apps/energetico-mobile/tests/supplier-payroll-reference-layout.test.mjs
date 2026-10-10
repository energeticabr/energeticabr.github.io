import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {createServer} from 'vite';import {JSDOM} from 'jsdom';import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';
const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
test('reference payroll layout fits horizontal phone tablet desktop with blue white stripes and shared midpoint arrows',{timeout:120000},async t=>{
 if(!browser)return t.skip('Chromium indisponível');const app=fileURLToPath(new URL('..',import.meta.url)),repo=fileURLToPath(new URL('../../..',import.meta.url)),cache=mkdtempSync(join(tmpdir(),'payroll-reference-vite-'));const server=await createServer({root:app,cacheDir:cache,server:{host:'127.0.0.1',port:0,fs:{allow:[repo]}},logLevel:'silent'});
 try{await server.listen();for(const [width,height] of [[844,390],[568,320],[1024,768],[1280,800],[1440,900],[1920,1080]]){
  const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/supplier-payroll-reference-layout.html`});const dom=new JSDOM(stdout);const layout=JSON.parse(dom.window.document.documentElement.dataset.layout);layout.content=JSON.parse(dom.window.document.documentElement.dataset.contentBounds);layout.metricValues=JSON.parse(dom.window.document.documentElement.dataset.metricValues);dom.window.close();t.diagnostic(JSON.stringify(layout));
  assert.equal(layout.width,width);assert.ok(layout.overflow<=1);assert.ok(layout.contentOverflow<=1);assert.equal(layout.filterCount,3);assert.equal(layout.logoLoaded,true);assert.ok(layout.logo.bottom<=layout.toolbar.bottom+1);
  const pickerDom=new JSDOM(stdout),pickerArrows=JSON.parse(pickerDom.window.document.documentElement.dataset.pickerArrows);pickerDom.window.close();
  assert.equal(pickerArrows.length,3,'all three visible payroll filter arrows are checked');
  for(const {field,arrow,fill,color,inputFill} of pickerArrows){
   assert.ok(arrow.left>=field.left-1&&arrow.right<=field.right+1&&arrow.top>=field.top-1&&arrow.bottom<=field.bottom+1,'picker arrow remains inside its field');
   assert.equal(fill,'rgb(18, 62, 99)','every payroll filter arrow has the report blue fill');
   assert.equal(color,'rgb(255, 255, 255)','the arrow stays visible with white contrast on blue');
   assert.equal(inputFill,'rgb(255, 255, 255)','the selected value field remains white');
  }
  assert.deepEqual(layout.summaryColors,['rgb(210, 228, 242)','rgb(255, 255, 255)','rgb(210, 228, 242)','rgb(255, 255, 255)']);assert.deepEqual(layout.paymentColors,['rgb(228, 247, 236)','rgb(255, 240, 226)','rgb(230, 240, 252)']);
  assert.equal(layout.arrows.length,2);for(const arrow of layout.arrows)assert.ok(Math.abs(arrow.center-height/2)<=1,'arrow uses shared viewport midpoint');
  assert.ok(layout.summaryBounds.every(summary=>summary.left-layout.content.left<=9&&layout.content.right-summary.right<=26),'supplier rows use the entire white content area instead of reserving arrow gutters');
  assert.ok(layout.summaryBounds.every(summary=>summary.width>=layout.content.width-35),'report must not be squeezed into the middle');
  for(const control of layout.controlBounds)assert.ok(control.left>=0&&control.right<=width+1&&control.bottom<=layout.toolbar.bottom+1);
  assert.ok(layout.headerMetricWidths.every(metric=>metric.scroll<=metric.width+1),'financial metrics fit');assert.ok(layout.paymentTable.width<=width);
  for(const value of layout.metricValues){
   assert.ok(value.scroll<=value.width+1,'money and quantity must not be cropped');
   assert.equal(value.lines,1,'a financial amount must stay on one line, not split into digits');
   assert.ok(value.bounds.right<=layout.content.right-1,'payment count stays inside the white report');
  }
  assert.match(layout.headerTexts[0],/1\.581,00/);assert.equal(layout.headerTexts[1],'3');
  for(const rubric of layout.rubricLayouts){
   assert.ok(rubric.rubrics.left>=rubric.total.right-1,'rubrics are to the right of total paid');
   assert.ok(rubric.count.left>=rubric.rubrics.right-1,'payment count stays after rubric totals');
   assert.ok(rubric.border>=1,'a vertical rule separates total paid and rubrics');
   assert.ok(rubric.font<rubric.totalFont,'rubric figures use smaller type than the total');
   for(const row of rubric.rows){assert.ok(row.scroll<=row.width+1,'long rubric labels and values are never clipped');assert.ok(row.bounds.bottom<=rubric.rubrics.bottom+1,'every rubric row fits its summary');}
  }
  assert.deepEqual(layout.rubricLayouts.map(r=>r.rows.length),[3,8,3,3]);
  assert.match(layout.rubricLayouts[0].rows.map(r=>r.text).join(' '),/SALÁRIO:.*527,00/);
 }}finally{await server.close();rmSync(cache,{recursive:true,force:true,maxRetries:5,retryDelay:250});}
});

test('dashboard with eight types and edit actions fits phones tablets desktop without clipped total clusters',{timeout:120000},async t=>{
 if(!browser)return t.skip('Chromium indisponível');const app=fileURLToPath(new URL('..',import.meta.url)),repo=fileURLToPath(new URL('../../..',import.meta.url)),cache=mkdtempSync(join(tmpdir(),'payroll-dashboard-vite-'));const server=await createServer({root:app,cacheDir:cache,server:{host:'127.0.0.1',port:0,fs:{allow:[repo]}},logLevel:'silent'});
 try{await server.listen();for(const [width,height] of [[844,390],[568,320],[1024,768],[1440,900]]){
  const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/payroll-dashboard.html`});const dom=new JSDOM(stdout);const layout=JSON.parse(dom.window.document.documentElement.dataset.dashboard);dom.window.close();
  assert.equal(layout.types,8);assert.equal(layout.rows,10);assert.equal(layout.actions,20);assert.ok(layout.content.scroll<=layout.content.width+1);assert.ok(layout.table.right<=layout.content.right);
  for(const cluster of layout.clusters)assert.ok(cluster.scroll<=cluster.width+1,'each full type total stays inside its cluster');
  if(width===844)assert.ok(layout.summaryHeight<190,'eight standard types keep the phone header compact');
 }}finally{await server.close();rmSync(cache,{recursive:true,force:true,maxRetries:5,retryDelay:250});}
});
