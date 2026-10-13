import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';
test('red today shortcut fits one line above diary on phones and desktop',{timeout:90000},async t=>{
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
  if(!browser)return t.skip('Chrome unavailable');
  const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
  try{
    await server.listen();
    for(const width of [320,390,1280]){
      const {stdout}=await runBrowserLayout(browser,{width,height:844,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/home-today-attendance.html`});
      const dom=new JSDOM(stdout);
      try{
        const l=JSON.parse(dom.window.document.documentElement.dataset.layout);
        assert.equal(l.text,'👷 PRESENÇAS (10)');
        assert.equal(l.background,'rgb(165, 39, 39)');
        assert.ok(l.height>=44);
        assert.ok(l.bottom<=l.diaryTop);
        assert.equal(new Set(l.lines.map(r=>Math.round(r.top))).size,1,JSON.stringify({width,l}));
        assert.ok(l.lines.every(r=>r.left>=l.left&&r.right<=l.right),JSON.stringify({width,l}));
      }finally{dom.window.close();}
    }
  }finally{await server.close();}
});
