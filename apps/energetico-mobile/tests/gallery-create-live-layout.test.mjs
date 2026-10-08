import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(path => path && existsSync(path));

test('all gallery shortcuts keep Tasks sizing beside Filters, collapsed and expanded, on mobile and desktop', { timeout: 180_000 }, async t => {
  if (!browser) return t.skip('Chrome/Edge unavailable');
  const cache = await mkdtemp(join(tmpdir(), 'gallery-create-vite-'));
  const server = await createServer({ root: appRoot, cacheDir: cache, server: { host: '127.0.0.1', port: 0,
    fs: { allow: [resolve(appRoot, '../..')] } }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const [width, height] of [[320, 740], [390, 844], [844, 390], [1365, 768]]) {
      const { stdout } = await runBrowserLayout(browser, { width, height,
        url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/gallery-create-responsive.html` });
      const dom = new JSDOM(stdout);
      const results = JSON.parse(dom.window.document.documentElement.dataset.layout);
      dom.window.close();
      assert.ok(Array.isArray(results), JSON.stringify(results));
      assert.equal(results.length, 27);
      for (const result of results) {
        assert.equal(result.missing, undefined, `${width}px ${result.name}: shortcut missing`);
        for (const state of ['collapsed', 'expanded']) {
          const layout = result[state], message = `${width}px ${result.name} ${state}: ${JSON.stringify(layout)}`;
          assert.ok(layout.visible && layout.ordered && layout.fits && layout.hittable && !layout.overflow, message);
          assert.equal(layout.width, 46, message); assert.equal(layout.height, 46, message);
          assert.equal(layout.color, 'rgb(33, 132, 67)', message);
          assert.equal(layout.background, 'rgb(255, 255, 255)', message);
          assert.equal(layout.border, 'rgb(33, 132, 67)', message);
        }
        assert.equal(result.creates, 1);
        assert.equal(result.closedFirst, true);
        const failure = result.failure, message = `${width}px ${result.name} failure: ${JSON.stringify(failure)}`;
        assert.ok(failure.present && failure.closed && failure.visible && failure.fits
          && failure.hittable && failure.dismissed && !failure.overflow, message);
        assert.equal(failure.role, 'alert', message);
        assert.ok(failure.dismissLabel, message);
        assert.equal(result.unhandledRejections, 0, message);
      }
    }
  } finally { await server.close(); await rm(cache, { recursive: true, force: true }); }
});
