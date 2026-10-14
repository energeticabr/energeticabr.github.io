import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('attendance supplier arrow stays right of the left-aligned name and expands inside phone width', { timeout: 120000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const [width, plain] of [[320, false], [390, false], [1280, false], [320, true], [390, true]]) {
      const { stdout } = await runBrowserLayout(browser, { width, height: 844, url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attendance-supplier-details.html${plain ? '?plain' : ''}` });
      const dom = new JSDOM(stdout);
      try {
        const layout = JSON.parse(dom.window.document.documentElement.dataset.layout);
        assert.equal(layout.before.nameAlign, 'left', JSON.stringify(layout));
        assert.ok(layout.before.arrow.left >= layout.before.name.left, JSON.stringify(layout));
        assert.ok(layout.before.arrow.right <= layout.before.card.right + 1, JSON.stringify(layout));
        assert.ok(layout.before.textRects.every(rect => rect.right <= layout.before.arrow.left + 1
          || rect.bottom <= layout.before.arrow.top || rect.top >= layout.before.arrow.bottom), JSON.stringify(layout));
        assert.ok(layout.detail.right <= layout.viewport + 1, JSON.stringify(layout));
        assert.equal(layout.shown, true);
        assert.equal(layout.checkbox, false);
        assert.deepEqual(layout.values, ['13/10/2026', '384', 'PINTURA EXTERNA']);
      } finally { dom.window.close(); }
    }
  } finally { await server.close(); }
});
