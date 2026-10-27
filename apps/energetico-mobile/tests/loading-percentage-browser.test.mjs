import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createIsolatedViteServer as createServer } from './helpers/isolated-vite-server.mjs';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find(path => path && existsSync(path));

test('every loader keeps its percentage visibly to the spinner right in intermediate screens', { timeout: 120000 }, async t => {
  if (!browser) return t.skip('Chrome/Edge unavailable');
  const server = await createServer({ root: appRoot, logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(appRoot, '../..')] } } });
  await server.listen(); t.after(() => server.close());
  for (const colorScheme of ['light', 'dark']) for (const [width, height] of [[320,740], [390,844], [1365,768]]) {
    const { stdout } = await runBrowserLayout(browser, { width, height, colorScheme,
      url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/loading-percentage.html` });
    const dom = new JSDOM(stdout), results = JSON.parse(dom.window.document.documentElement.dataset.layout);
    dom.window.close();
    assert.ok(Array.isArray(results), JSON.stringify(results));
    assert.equal(results.length, 8);
    for (const result of results) {
      const message = `${colorScheme} ${width}: ${JSON.stringify(result)}`;
      assert.equal(result.badgeCount, 1, message);
      assert.equal(result.text, '0%', message);
      assert.equal(result.value, '0', message);
      assert.ok(result.right && result.aligned && result.visible && result.fits && !result.overflow, message);
    }
  }
});
