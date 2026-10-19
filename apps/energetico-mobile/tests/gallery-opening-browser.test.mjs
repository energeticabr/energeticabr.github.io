import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(path => path && existsSync(path));

test('complete gallery records and search work before slow catalogs on phones and Windows', { timeout: 120_000 }, async t => {
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root: appRoot, server: { host: '127.0.0.1', port: 0,
    fs: { allow: [resolve(appRoot, '../..')] } }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const [width, height] of [[320, 740], [390, 844], [1365, 768]]) {
      const { stdout } = await runBrowserLayout(browser, { width, height,
        url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/gallery-opening-performance.html` });
      const dom = new JSDOM(stdout), results = JSON.parse(dom.window.document.documentElement.dataset.layout);
      dom.window.close();
      assert.equal(results.length, 5);
      for (const result of results) {
        const diagnostic = `${width}x${height} ${JSON.stringify(result)}`;
        assert.ok(result.opened && result.readyBeforeCatalog && result.cardVisible && result.searchUsable, diagnostic);
        assert.ok(result.pendingFilters > 0 && result.catalogFinished, diagnostic);
        assert.equal(result.overflow, false, diagnostic);
        t.diagnostic(diagnostic);
      }
    }
  } finally { await server.close(); }
});
