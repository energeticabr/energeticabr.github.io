import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('report chevrons are centered inside their circles and are matching mirror images on phone and desktop',{timeout:150000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(value=>value&&existsSync(value));
 if(!browser)return t.skip('Chrome unavailable');
 const server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
 try {
  await server.listen();
  for(const [width,height,diameter]of [[844,390,46],[1280,800,56]]) {
   const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/report-arrow-centering.html`});
   const dom=new JSDOM(stdout);let result;try{result=JSON.parse(dom.window.document.documentElement.dataset.layout);}finally{dom.window.close();}
   assert.equal(result.error,undefined,result.error);assert.equal(result.arrows.length,2);
   const [left,right]=result.arrows;assert.equal(left.direction,'previous');assert.equal(right.direction,'next');
   for(const arrow of result.arrows){
    assert.ok(arrow.bounds[2]>arrow.bounds[0],'chevron must render');
    assert.ok(Math.abs(arrow.offsetX)<.3,`${width}px ${arrow.direction}: horizontal offset ${arrow.offsetX}`);
    assert.ok(Math.abs(arrow.offsetY)<.3,`${width}px ${arrow.direction}: vertical offset ${arrow.offsetY}`);
    assert.equal(arrow.diameter,diameter);assert.equal(arrow.height,diameter);assert.equal(arrow.border,'3px');
    assert.equal(arrow.stroke,'5px');assert.equal(arrow.cap,'square');assert.equal(arrow.join,'miter');assert.equal(arrow.color,'rgb(176, 0, 0)');
   }
   let mismatches=0,ink=0;const size=result.size;
   for(let y=0;y<size;y++)for(let x=0;x<size;x++){const a=left.mask[y*size+x],b=right.mask[y*size+size-1-x];ink+=a;if(a!==b)mismatches++;}
   assert.ok(mismatches/ink<.01,`${width}px arrows differ after mirroring: ${mismatches}/${ink}`);
  }
 }finally{await server.close();}
});
