import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('Retomar click restores the real blocked app at phone and Windows widths', {timeout:180000}, async t=>{
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(value=>value&&existsSync(value));
  if(!browser)return t.skip('Chrome unavailable');
  const cache=await mkdtemp(join(tmpdir(),'session-reconnection-vite-'));
  const server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),cacheDir:join(cache,'cache'),
    optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:0,hmr:false,watch:null},logLevel:'silent'});
  try{
    await server.listen();
    for(const width of [320,390,1365]){
      const result=await runBrowserLayout(browser,{width,height:844,
        url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/session-reconnection.html`,
        captureScreenshot:Boolean(process.env.SESSION_RECONNECTION_SCREENSHOT_DIR)});
      const dom=new JSDOM(result.stdout), evidence=JSON.parse(dom.window.document.documentElement.dataset.layout);dom.window.close();
      for(const key of ['initialError','initialBlocked','busy','oldErrorHidden','reconnectingVisible','restored','composerEnabled','draftPreserved','filesPreserved','onlyResumeCommands']) {
        assert.equal(evidence[key],true,`${width}: ${key}: ${JSON.stringify(evidence)}`);
      }
      assert.equal(evidence.overflow,false,`${width}: overflow`);
      if(result.screenshot){await mkdir(process.env.SESSION_RECONNECTION_SCREENSHOT_DIR,{recursive:true});await writeFile(join(process.env.SESSION_RECONNECTION_SCREENSHOT_DIR,`resume-${width}.png`),result.screenshot);}
    }
  }finally{await server.close();await rm(cache,{recursive:true,force:true,maxRetries:5,retryDelay:250});}
});
