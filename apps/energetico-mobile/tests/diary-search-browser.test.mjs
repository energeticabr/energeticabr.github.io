import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('search stays usable and photos retain small thumbnails on phones and Windows', { timeout:120_000 }, async t => {
  const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
  if(!browser)return t.skip('Chrome unavailable');
  const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'silent',server:{host:'127.0.0.1',port:0}});
  await server.listen();t.after(()=>server.close());
  for(const width of [320,390,1365]){
    const {stdout}=await runBrowserLayout(browser,{width,height:900,mobile:width<700,
      url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/diary-search-performance.html`});
    const dom=new JSDOM(stdout),layout=JSON.parse(dom.window.document.documentElement.dataset.layout);dom.window.close();
    assert.equal(layout.during.focused,true);assert.equal(layout.during.loaderHidden,true);assert.equal(layout.during.interactive,true);
    assert.equal(layout.during.cards,2);assert.deepEqual(layout.during.caret,[2,4]);assert.match(layout.during.status,/2 lançamento/);
    assert.equal(layout.staleIgnored,true);assert.deepEqual(layout.finalIds,['901']);assert.equal(layout.search,'Mauro central');
    assert.deepEqual(layout.thumbnail,[520,347]);assert.equal(layout.overflow,false);
    t.diagnostic(`${width}px ${JSON.stringify(layout)}`);
  }
});
