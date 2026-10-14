import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('attendance day is bold red and question fits phones and desktop',{timeout:90000},async t=>{
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
  if(!browser)return t.skip('Chrome unavailable');
  const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
  try{
    await server.listen();
    for(const width of [320,390,1280]){
      const {stdout}=await runBrowserLayout(browser,{width,height:844,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attendance-day-question.html`});
      const dom=new JSDOM(stdout);
      try{
        const layout=JSON.parse(dom.window.document.documentElement.dataset.layout);
        assert.equal(layout.text,'QUAL PRESENÇA DESEJA VALIDAR DO DIA 12/10/2026 (segunda)?');
        assert.equal(layout.date,'12/10/2026');
        assert.equal(layout.color,'rgb(180, 35, 24)');
        assert.ok(Number(layout.weight)>=700);
        assert.ok(layout.left>=0&&layout.right<=layout.viewport);
        assert.equal(layout.hours?.label,'HORÁRIO');
        assert.ok(layout.hours.centers<1 && layout.hours.authorRight<layout.hours.left);
        assert.ok(layout.hours.right<=layout.viewport && layout.hours.bottom<=layout.hours.questionTop);
      }finally{dom.window.close();}
    }
  }finally{await server.close();}
});
