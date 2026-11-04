import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('PDF payment line is selectable and aligned at every rotation before and after pinch zoom', { timeout: 120000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const [width, height] of [[320, 740], [390, 844], [1365, 900]]) {
      const capture = process.env.PDF_TEXT_CAPTURE_DIR;
      const result = await runBrowserLayout(browser, { width, height, captureScreenshot: Boolean(capture), url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/pdf-text-selection.html` });
      const dom = new JSDOM(result.stdout);
      try {
        const state = JSON.parse(dom.window.document.documentElement.dataset.result);
        assert.equal(state.error, undefined, JSON.stringify({ width, state }));
        assert.equal(state.checks.length, 8);
        for (const check of state.checks) {
          assert.equal(check.copied, '00000.00000 00000.000000 00000.000000 0 00000000000000');
          for (const property of ['aligned', 'inside', 'selectable']) assert.equal(check[property], true, JSON.stringify({ width, property, check }));
          assert.ok(check.fontSize > 0 && check.width > 0 && check.height > 0);
        }
        assert.equal(state.zoomed, true);
        assert.equal(state.hitText, true);
        assert.equal(state.singleTouchAllowed, true);
        assert.equal(state.overflow, false);
        if (capture) { mkdirSync(capture, { recursive: true }); writeFileSync(join(capture, `pdf-selection-${width}.png`), result.screenshot); }
      } finally { dom.window.close(); }
    }
  } finally { await server.close(); }
});
