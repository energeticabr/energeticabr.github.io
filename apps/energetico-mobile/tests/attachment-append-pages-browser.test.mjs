import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));

test('tray + menu fits 320/390 px and desktop; files, photo-to-PDF and scan append without loose attachments or chat replies',{timeout:120000},async t=>{
  if(!browser)return t.skip('Chrome unavailable');
  const server=await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
  try{
    await server.listen();
    for(const [width,height,base,mode,pages] of [[320,740,'pdf','menu',2],[390,844,'pdf','files',4],[390,844,'image','files',3],[1365,768,'pdf','camera',4]]){
      const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attachment-append-pages.html?base=${base}&mode=${mode}`});
      const dom=new JSDOM(stdout),result=JSON.parse(dom.window.document.documentElement.dataset.layout||'{}');dom.window.close();
      assert.equal(result.error,undefined,JSON.stringify(result));
      assert.equal(result.pages,pages); assert.equal(result.tray,1);
      assert.equal(result.type,'application/pdf');assert.equal(result.replacements,mode==='menu'?0:1);
      assert.equal(result.sentFile,0);assert.equal(result.networkWrites,0);
      assert.equal(result.unchangedQuestion,true);assert.equal(result.unchangedDraft,true);assert.equal(result.noReply,true);
      assert.equal(result.overflow,false);assert.equal(result.menuOverflow,false);
      assert.ok(result.controls.every(control=>control.width>=44&&control.height>=44),JSON.stringify(result.controls));
    }
  }finally{await server.close();}
});
