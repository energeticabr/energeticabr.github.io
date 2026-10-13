import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('home diary date stays on one line within its button on narrow phones and desktop', {timeout:90000}, async t => {
  const browser = [process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
  try {
    await server.listen();
    for (const width of [360,320,390,1280]) {
      const {stdout} = await runBrowserLayout(browser,{width,height:844,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/home-diary-label.html`});
      const dom = new JSDOM(stdout);
      try {
        const layout = JSON.parse(dom.window.document.documentElement.dataset.layout);
        assert.equal(layout.text,'📔 DIÁRIO (13/10/2026)');
        assert.equal(new Set(layout.textRects.map(rect=>Math.round(rect.top))).size,1,JSON.stringify({width,layout}));
        assert.ok(layout.textRects.every(rect=>rect.left>=layout.button.left&&rect.right<=layout.button.right),JSON.stringify({width,layout}));
        assert.ok(layout.height>=44,'preserve the minimum touch target');
      } finally { dom.window.close(); }
    }
  } finally { await server.close(); }
});
