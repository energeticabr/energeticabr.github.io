import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createIsolatedViteServer } from './helpers/isolated-vite-server.mjs';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('DDA date picker and bank review fit on narrow and desktop screens', { timeout: 90_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createIsolatedViteServer({ root, logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: ['decimal.js', 'pdf-lib', 'pako', '@capacitor/core'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [resolve(root, '../..')] } } });
  try {
    await server.listen();
    for (const [width, height] of [[320, 740], [390, 844], [1365, 900]]) {
      const url = 'http://127.0.0.1:' + server.httpServer.address().port + '/tests/fixtures/dda-card-preview.html?schedule=1';
      const { stdout } = await runBrowserLayout(browser, { width, height, url });
      const dom = new JSDOM(stdout);
      try {
        const { layout } = dom.window.document.documentElement.dataset;
        assert.ok(layout, 'missing browser measurements');
        assert.deepEqual(JSON.parse(layout), {
          buttonFits: true, dateFits: true, dateFocused: true, reviewFits: true,
          reviewText: true, confirmationVisible: true,
        }, 'viewport ' + width);
      } finally {
        dom.window.close();
      }
    }
  } finally {
    await server.close();
  }
});
