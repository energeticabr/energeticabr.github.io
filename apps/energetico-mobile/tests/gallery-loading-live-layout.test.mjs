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
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(path => path && existsSync(path));

test('all gallery loaders are centered below navigation without leaking content on phones, tablets and Windows', { timeout: 180_000 }, async t => {
  if (!browser) return t.skip('Chrome/Edge unavailable');
  const server = await createServer({ root: appRoot, server: { host: '127.0.0.1', port: 0,
    fs: { allow: [resolve(appRoot, '../..')] } }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const [width, height] of [[320, 740], [390, 844], [844, 390], [1024, 768], [1365, 768]]) {
      const { stdout } = await runBrowserLayout(browser, { width, height,
        url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/gallery-loading-responsive.html` });
      const dom = new JSDOM(stdout), results = JSON.parse(dom.window.document.documentElement.dataset.layout);
      dom.window.close();
      assert.ok(Array.isArray(results), JSON.stringify(results));
      assert.equal(results.length, 27);
      for (const result of results) {
        for (const state of ['initial', 'refreshing']) {
          const layout = result[state], message = `${width}x${height} ${result.name} ${state}: ${JSON.stringify(layout)}`;
          assert.equal(layout.missing, undefined, message);
          assert.ok(layout.covered && layout.headerVisible && layout.loaderVisible && layout.opaque && layout.centeredHit && layout.keyboardSafe, message);
          assert.ok(Math.abs(layout.imageCenterX - width / 2) <= 2, message);
          assert.ok(Math.abs(layout.indicatorCenterY - layout.desiredCenterY) <= 2, message);
          assert.ok(layout.fits && !layout.overflow, message);
        }
        assert.equal(result.restored, true, `${result.name} content stays usable after loading`);
      }
    }
  } finally { await server.close(); }
});
