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

test('two scanner checks become two real rendered PDFs in the tray, not five loose photos', {timeout:120_000},async t=>{
  if(!browser)return t.skip('Chrome unavailable');
  const server=await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
  try{
    await server.listen();
    for(const [width,height,shot] of [[390,844,'tray'],[844,390,'tray'],[1365,768,'preview']]){
      const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/scanner-session-pdf.html?shot=${shot}`});
      const dom=new JSDOM(stdout),result=JSON.parse(dom.window.document.documentElement.dataset.layout||'{}');dom.window.close();
      assert.equal(result.error,undefined,JSON.stringify(result));
      assert.deepEqual(result.types,['application/pdf','application/pdf']);
      assert.deepEqual(result.pageCounts,[2,3]);assert.equal(result.tray,2);
      assert.notEqual(result.names[0],result.names[1]);
      assert.deepEqual(result.painted,[1,1,1,1,1],'pintar exatamente uma imagem em cada página');
      for(const [index,color] of result.colors.entries()){
        const expected=index<2?[12,87,106]:[150,58,66];
        color.forEach((channel,i)=>assert.ok(Math.abs(channel-expected[i])<=4,'preservar as cores e a ordem das sessões'));
      }
      assert.deepEqual(result.released,['session-1','session-2']);
      assert.equal(result.photoCalls,0);assert.equal(result.networkWrites,0);assert.equal(result.overflow,false);
      if(shot==='preview')assert.equal(result.previewReady,true);
    }
  }finally{await server.close();}
});
