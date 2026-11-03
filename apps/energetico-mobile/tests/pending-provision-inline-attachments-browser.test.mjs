import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('inline attachment tray keeps report position and fits phones and Windows', {timeout:180000}, async t=>{
  const chrome=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(p=>p&&existsSync(p));
  if(!chrome)return t.skip('Chrome unavailable');
  const cache=await mkdtemp(join(tmpdir(),'provision-inline-vite-'));
  const server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),cacheDir:join(cache,'cache'),
    optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:0,hmr:false,watch:null},logLevel:'silent'});
  try{
    await server.listen();
    for(const width of [320,390,1365]){
      const result=await runBrowserLayout(chrome,{width,height:844,
        url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/pending-provision-inline-attachments.html`,
        captureScreenshot:Boolean(process.env.PROVISION_INLINE_SCREENSHOT_DIR)});
      const dom=new JSDOM(result.stdout),e=JSON.parse(dom.window.document.documentElement.dataset.layout);dom.window.close();
      assert.ok(e.before>0);assert.equal(e.after,e.before,JSON.stringify(e));assert.ok(Math.abs(e.arrowShift)<1);
      for(const key of ['trayAfterFiles','sourceClickable','queueVisible','cancelVisible','submitVisible','emptyHasOnlyTray'])assert.equal(e[key],true,`${width}: ${key}`);
      assert.equal(e.horizontalOverflow,false,`${width}: overflow`);
      assert.equal(e.orange,'rgb(197, 97, 8)');
      if(result.screenshot){await mkdir(process.env.PROVISION_INLINE_SCREENSHOT_DIR,{recursive:true});await writeFile(join(process.env.PROVISION_INLINE_SCREENSHOT_DIR,`tray-${width}.png`),result.screenshot);}
    }
  }finally{await server.close();await rm(cache,{recursive:true,force:true,maxRetries:5,retryDelay:250});}
});
