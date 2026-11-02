import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('attendance selectors retain wrapping labels and usable native hit areas at phone and Windows widths',{timeout:120000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));if(!browser)return t.skip('Chrome unavailable');
 const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
 try{await server.listen();for(const width of [320,390,1280]){
  const result=await runBrowserLayout(browser,{width,height:1100,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attendance-inline-selects.html`,captureScreenshot:Boolean(process.env.ATTENDANCE_CAPTURE_DIR)});
  const dom=new JSDOM(result.stdout);try{const layout=JSON.parse(dom.window.document.documentElement.dataset.layout);
   assert.equal(layout.selectors.length,6);assert.ok(layout.scrollWidth<=width);assert.equal(layout.selectors.filter(s=>s.blank).length,1);
   for(const s of layout.selectors){assert.ok(s.left>=0&&s.right<=width);assert.ok(s.height>=36);assert.ok(s.hitWidth>50);assert.ok(s.scroll<=s.width+1);assert.equal(s.disabled,false);}
   assert.equal(layout.colors[0],layout.colors[1]);assert.notEqual(layout.colors[0],layout.colors[2]);
   if(process.env.ATTENDANCE_CAPTURE_DIR){mkdirSync(process.env.ATTENDANCE_CAPTURE_DIR,{recursive:true});writeFileSync(`${process.env.ATTENDANCE_CAPTURE_DIR}/attendance-${width}.png`,result.screenshot);}
  }finally{dom.window.close();}
 }}finally{await server.close();}
});
