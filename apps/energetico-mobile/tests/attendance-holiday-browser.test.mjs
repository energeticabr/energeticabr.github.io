import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('holiday absence review remains readable at phone and Windows widths', {timeout:120000}, async t => {
  const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
  if(!browser)return t.skip('Chrome unavailable');
  const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
  try {
    await server.listen();
    for(const width of [320,390,1280]) {
      const result=await runBrowserLayout(browser,{width,height:1000,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attendance-holiday-submit.html`,captureScreenshot:Boolean(process.env.HOLIDAY_CAPTURE_DIR)});
      const dom=new JSDOM(result.stdout);
      try {
        const layout=JSON.parse(dom.window.document.documentElement.dataset.layout);
        assert.ok(layout.scrollWidth<=width);assert.ok(layout.left>=0&&layout.right<=width);assert.ok(layout.submit>=44);
        assert.ok(layout.rows.some(row=>/Presença.*PENDENTE.*AUSENTE/s.test(row)));
        if(process.env.HOLIDAY_CAPTURE_DIR){mkdirSync(process.env.HOLIDAY_CAPTURE_DIR,{recursive:true});writeFileSync(`${process.env.HOLIDAY_CAPTURE_DIR}/holiday-${width}.png`,result.screenshot);}
      } finally {dom.window.close();}
    }
  } finally {await server.close();}
});
