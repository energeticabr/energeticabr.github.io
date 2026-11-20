import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {build,preview} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('compact tax report and edit dialogs fit landscape phones, rotated phones and Windows',{timeout:180000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome'].find(p=>p&&existsSync(p));if(!browser)return t.skip('Chrome unavailable');
 const root=fileURLToPath(new URL('..',import.meta.url)),outDir=resolve(root,'work/tax-report-layout');
 await build({root,configFile:false,base:'/',logLevel:'silent',build:{outDir,emptyOutDir:true,rollupOptions:{input:resolve(root,'tests/fixtures/tax-guides-report-actions.html')}}});
 const server=await preview({root,configFile:false,logLevel:'silent',build:{outDir},preview:{host:'127.0.0.1',port:0}});
 try{for(const [width,height] of [[390,844],[844,390],[1365,900]])for(const mode of ['report','attach','amount','amount-keyboard']){
   const keyboard=mode==='amount-keyboard';
   const result=await runBrowserLayout(browser,{width,height,captureScreenshot:Boolean(process.env.TAX_REPORT_SCREENSHOTS),url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/tax-guides-report-actions.html?mode=${keyboard?'amount':mode}${keyboard?'&keyboard=1':''}`});
   const dom=new JSDOM(result.stdout),layout=JSON.parse(dom.window.document.documentElement.dataset.layout);dom.window.close();
   const desc=`${width}x${height}/${mode}: ${JSON.stringify(layout)}`;
   assert.equal(layout.rootOverflow,false,desc);assert.equal(layout.panelOverflow,false,desc);
   const horizontal=width>=height?layout.panel.width:layout.panel.height;
   assert.ok(horizontal<=880+1&&horizontal<Math.max(width,height)*.96,desc);
   for(const r of [layout.panel,layout.editor,...layout.buttons,layout.input].filter(Boolean))assert.ok(r.x>=-1&&r.y>=-1&&r.right<=width+1&&r.bottom<=height+1,desc);
   if(keyboard)for(const r of [...layout.buttons,layout.input].filter(Boolean))assert.ok(r.y>=-1&&r.bottom<=layout.visibleHeight+1,desc);
   if(mode==='attach')assert.equal(layout.sources,4,desc);
   if(process.env.TAX_REPORT_SCREENSHOTS){mkdirSync(process.env.TAX_REPORT_SCREENSHOTS,{recursive:true});writeFileSync(resolve(process.env.TAX_REPORT_SCREENSHOTS,`${width}-${mode}.png`),result.screenshot);}
 }}finally{await new Promise(done=>server.httpServer.close(done));}
});
