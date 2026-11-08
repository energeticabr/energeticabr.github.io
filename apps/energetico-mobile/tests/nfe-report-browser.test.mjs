import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('NFE opens a responsive fiscal report from the new blue position', { timeout:90000 }, async t => {
  const browser = [process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium']
    .find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root:fileURLToPath(new URL('..', import.meta.url)),
    server:{ host:'127.0.0.1', port:0 }, logLevel:'silent' });
  const capture = process.env.NFE_CAPTURE_DIR;
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/nfe-report.html`;
    for (const width of [320,390,1365]) {
      const result = await runBrowserLayout(browser, { width, height:844, url, captureScreenshot:Boolean(capture) });
      const dom = new JSDOM(result.stdout);
      try {
        const { provisions, orange, nfe, dda, open, cardIds, overflow, mei, pdfOnLeft, pdfIconWidth, pdfTargetHeight } = JSON.parse(dom.window.document.documentElement.dataset.layout);
        assert.equal(provisions.y, orange.y);
        assert.equal(orange.x - provisions.x, 56);
        assert.equal(nfe.x, provisions.x);
        assert.equal(nfe.y - provisions.y, 68);
        assert.equal(dda.y - nfe.y, 56);
        assert.deepEqual({ open, cardIds, overflow, mei }, { open:true, cardIds:['2','3'], overflow:false, mei:true });
        assert.equal(pdfOnLeft, true);
        assert.equal(pdfIconWidth, 34);
        assert.ok(pdfTargetHeight >= 44);
        if (capture) {
          mkdirSync(capture, {recursive:true});
          writeFileSync(join(capture, `nfe-${width}.png`), result.screenshot);
        }
      } finally { dom.window.close(); }
    }
    if (capture) {
      const { screenshot } = await runBrowserLayout(browser, {width:390,height:844,url:`${url}?home`,captureScreenshot:true});
      writeFileSync(join(capture,'home-390.png'), screenshot);
    }
  } finally { await server.close(); }
});
