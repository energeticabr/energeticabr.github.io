import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createIsolatedViteServer} from './helpers/isolated-vite-server.mjs';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('DDA link review follows landscape and keeps cancel and submit usable',{timeout:120000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
 if(!browser)return t.skip('Chrome unavailable');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 const server=await createIsolatedViteServer({root,logLevel:'silent',optimizeDeps:{noDiscovery:true,include:['decimal.js','pdf-lib','pako','@capacitor/core']},server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[resolve(root,'../..')]}}});
 try{await server.listen();for(const [width,height,safeAreaInsets,nameFallback,alignDue] of [[320,740],[390,844],[844,390],[1365,900],[390,844,{top:59,bottom:34,left:11,right:23}],[390,844,undefined,true],[1365,900,undefined,true],[320,740,undefined,false,true],[844,390,undefined,false,true]]){
  const capture=process.env.DDA_REVIEW_CAPTURE_DIR,duplicate=!nameFallback&&!alignDue;
  const query=alignDue?'?alignDue=1':nameFallback?'?fallback=1':'?duplicate=1';
  const result=await runBrowserLayout(browser,{width,height,safeAreaInsets,captureScreenshot:Boolean(capture),url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/dda-provision-review.html${query}`});
  const dom=new JSDOM(result.stdout);
  try{const state=JSON.parse(dom.window.document.documentElement.dataset.layout);
   for(const key of ['pickerMatch','pickerFits','fits','hit','focusInside','cancelled','confirmed'])assert.equal(state[key],true,JSON.stringify({width,key,state}));
   assert.equal(state.pickerOverflows,false,`${width}px`);
   const orange=['rgb(255, 237, 213)','rgb(215, 121, 41)'],green=['rgb(234, 248, 238)','rgb(83, 167, 118)'];
   assert.deepEqual(state.chipColors,nameFallback?[orange,orange]:[orange,orange,green,green]);
   assert.equal(state.writesBefore,0);
   assert.deepEqual(state.beforePencil,{inColumn:true,below:true,background:'rgb(181, 31, 51)'});
   assert.deepEqual(state.afterPencil,{inColumn:true,below:true,background:'rgb(255, 182, 96)'});
   if(duplicate){
    assert.equal(state.duplicateFits,true);
    assert.equal(state.duplicateNo,true);
    assert.equal(state.duplicateTransform.split(",").slice(0,4).join(","),state.transform.split(",").slice(0,4).join(","));
   }
   if(alignDue){
    assert.match(state.dueReview.title,/vencimento do DDA \(04\/11\/2026\)/);
    assert.deepEqual(state.dueReview.labels,['Não','Sim']);
    assert.equal(state.dueReview.fits,true);
    assert.equal(state.dueReview.hit,true);
    assert.deepEqual(state.dueReview.before,{writes:1,dateWrites:0});
    assert.deepEqual(state.dueReview.after,{writes:1,dateWrites:1});
   }
   if(safeAreaInsets){assert.ok(state.bounds.top>=59&&state.bounds.bottom<=810&&state.bounds.left>=11&&state.bounds.right<=367,'review must avoid the phone safe areas: '+JSON.stringify(state));}
   if(height>width){const matrix=state.transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(',').map(Number);
    assert.ok(matrix&&Math.abs(matrix[1]-1)<.001&&Math.abs(matrix[2]+1)<.001,'confirmation must share the report rotation: '+JSON.stringify({width,state}));
   }else assert.equal(state.transform,'none');
   if(capture){mkdirSync(capture,{recursive:true});writeFileSync(join(capture,`dda-review-${width}${safeAreaInsets?'-safearea':''}${nameFallback?'-name':''}.png`),result.screenshot);}
  }finally{dom.window.close();}
 }}finally{await server.close();}
});
