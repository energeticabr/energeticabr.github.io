import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('order validation shows and opens the correct dark-blue PDF buttons on phones and desktop', { timeout: 120_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome']
    .find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    optimizeDeps: { noDiscovery: true, include: ['decimal.js', 'pdf-lib'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'silent',
  });
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/order-validation-attachments.html`;
    for (const [width, height, safeAreaInsets] of [[320, 568], [390, 844], [844, 390, { left: 47, right: 47 }], [1280, 589]]) {
      const { stdout } = await runBrowserLayout(browser, { width, height, safeAreaInsets, url });
      const dom = new JSDOM(stdout);
      let result;
      try { result = JSON.parse(dom.window.document.documentElement.dataset.layout); } finally { dom.window.close(); }
      assert.equal(result.error, undefined, result.error);
      assert.deepEqual(result.controls, ['1234567', '577'].map(id => ({
        id, right: true, fits: true, color: 'rgb(28, 60, 123)', visible: true,
      })), JSON.stringify({ width, height, result }));
      assert.equal(result.onlyPdf, true);
      assert.equal(result.unopenedOffscreen, true);
      assert.equal(result.foundAfterScrolling, true);
      assert.equal(result.focusRestored, true);
    }
  } finally {
    await server.close();
  }
});
