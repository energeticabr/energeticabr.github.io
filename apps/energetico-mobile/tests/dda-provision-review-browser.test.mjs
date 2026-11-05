import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('DDA link review follows landscape and keeps cancel and submit usable',{timeout:120000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
 if(!browser)return t.skip('Chrome unavailable');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 const server=await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
 try{await server.listen();for(const [width,height,safeAreaInsets] of [[320,740],[390,844],[844,390],[1365,900],[390,844,{top:59,bottom:34,left:11,right:23}]]){
  const capture=process.env.DDA_REVIEW_CAPTURE_DIR;
  const result=await runBrowserLayout(browser,{width,height,safeAreaInsets,captureScreenshot:Boolean(capture),url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/dda-provision-review.html`});
  const dom=new JSDOM(result.stdout);
  try{const state=JSON.parse(dom.window.document.documentElement.dataset.layout);
   for(const key of ['fits','hit','focusInside','cancelled','confirmed'])assert.equal(state[key],true,JSON.stringify({width,key,state}));
   assert.equal(state.writesBefore,0);
   if(safeAreaInsets){assert.ok(state.bounds.top>=59&&state.bounds.bottom<=810&&state.bounds.left>=11&&state.bounds.right<=367,'review must avoid the phone safe areas: '+JSON.stringify(state));}
   if(height>width){const matrix=state.transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(',').map(Number);
    assert.ok(matrix&&Math.abs(matrix[1]-1)<.001&&Math.abs(matrix[2]+1)<.001,'confirmation must share the report rotation: '+JSON.stringify({width,state}));
   }else assert.equal(state.transform,'none');
   if(capture){mkdirSync(capture,{recursive:true});writeFileSync(join(capture,`dda-review-${width}${safeAreaInsets?'-safearea':''}.png`),result.screenshot);}
  }finally{dom.window.close();}
 }}finally{await server.close();}
});
