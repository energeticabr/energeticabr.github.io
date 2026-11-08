import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('NFE opens the horizontal fiscal table from the blue mascot in portrait and landscape', { timeout:90000 }, async t => {
  const browser = [process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium']
    .find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root:fileURLToPath(new URL('..', import.meta.url)),
    server:{ host:'127.0.0.1', port:0 }, logLevel:'silent' });
  const capture = process.env.NFE_CAPTURE_DIR;
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/nfe-report.html`;
    for (const [width,height] of [[320,568],[390,844],[844,390],[1365,900]]) {
      const result = await runBrowserLayout(browser, { width, height, url, captureScreenshot:Boolean(capture) });
      const dom = new JSDOM(result.stdout);
      try {
        const { provisions, orange, nfe, dda, open, rowIds, overflow, tableScrolls, rotated, mei, pdfOnLeft, metricsAbove,
          headerControls, amountFits, pdfIconWidth, pdfTargetHeight, reportBodyWidth, availableReportWidth, overlayArrows
        } = JSON.parse(dom.window.document.documentElement.dataset.layout);
        assert.equal(provisions.y, orange.y);
        assert.equal(orange.x - provisions.x, 56);
        assert.equal(nfe.x, provisions.x);
        assert.equal(nfe.y - provisions.y, 68);
        assert.equal(dda.y - nfe.y, 56);
        assert.deepEqual({ open, rowIds, overflow, mei }, { open:true, rowIds:['2','3'], overflow:false, mei:true });
        assert.equal(rotated, height > width);
        assert.equal(reportBodyWidth, availableReportWidth, 'the report uses the width behind the navigation arrows');
        assert.equal(overlayArrows, 2);
        assert.equal(tableScrolls, width === 320);
        assert.equal(pdfOnLeft, true);
        assert.equal(metricsAbove, true);
        assert.equal(headerControls, true);
        assert.equal(amountFits, true, 'a long amount stays inside its column');
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
