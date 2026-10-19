import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('casinha fica à direita da data sem quebrar ou ultrapassar o botão no celular e desktop', {timeout:90000}, async t => {
  const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
  if(!browser)return t.skip('Chrome unavailable');
  const appRoot=fileURLToPath(new URL('..',import.meta.url));
  const server=await createServer({root:appRoot,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(appRoot,'../..')]}},logLevel:'silent'});
  try {
    await server.listen();
    for(const [width,height] of [[320,740],[390,844],[1365,768],[844,390]]) {
      const {stdout,screenshot}=await runBrowserLayout(browser,{width,height,captureScreenshot:width===390&&Boolean(process.env.DIARY_VISIT_SCREENSHOT),
        url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/diary-field-visit.html`});
      const dom=new JSDOM(stdout);
      try {
        const value=JSON.parse(dom.window.document.documentElement.dataset.layout);
        assert.equal(value.icons,1);
        assert.ok(value.icon.left>=value.date.right+3,JSON.stringify({width,value}));
        assert.ok(Math.abs((value.icon.top+value.icon.bottom)-(value.date.top+value.date.bottom))<10,JSON.stringify({width,value}));
        assert.ok(value.icon.right<=value.button.right&&value.date.left>=value.button.left&&!value.button.overflow&&!value.pageOverflow,JSON.stringify({width,value}));
        assert.ok(value.button.height>=44);
        assert.deepEqual(value.selected,{replyId:'choice:diario_obra_pendente:219',label:'219 - 004 - EDIFÍCIO XAVANTE - (16/10/2026)'});
        if(screenshot&&process.env.DIARY_VISIT_SCREENSHOT)writeFileSync(process.env.DIARY_VISIT_SCREENSHOT,screenshot);
      } finally {dom.window.close();}
    }
  } finally {await server.close();}
});
