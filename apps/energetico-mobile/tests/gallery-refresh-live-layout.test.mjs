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
import { galleryCases } from './helpers/gallery-create-cases.mjs';

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(path => path && existsSync(path));

test('gallery titles remain centered and sync stays in the header with 44px targets at 320px and desktop', { timeout: 180_000 }, async t => {
  if (!browser) return t.skip('Chrome/Edge unavailable');
  const cache = await mkdtemp(join(tmpdir(), 'gallery-refresh-vite-'));
  const server = await createServer({ root: appRoot, cacheDir: cache,
    server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(appRoot, '../..')] } }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const [width, height] of [[200, 740], [240, 740], [320, 740], [390, 844], [1024, 768], [1365, 768]]) {
      const { stdout } = await runBrowserLayout(browser, { width, height,
        url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/gallery-refresh-responsive.html` });
      const dom = new JSDOM(stdout), results = JSON.parse(dom.window.document.documentElement.dataset.layout);
      dom.window.close();
      assert.ok(Array.isArray(results), JSON.stringify(results)); assert.equal(results.length, galleryCases.length);
      for (const result of results) {
        assert.equal(result.missing, undefined, `${width}px ${result.name}: refresh missing`);
        for (const state of ['collapsed', 'expanded']) {
          const layout = result[state], message = `${width}px ${result.name} ${state}: ${JSON.stringify(layout)}`;
          assert.ok(layout.visible && layout.fits && layout.hittable && !layout.headerOverflow, message);
          if (width >= 320) assert.ok(!layout.overflow, message);
          assert.ok(layout.width >= 44 && layout.height >= 44, message);
          assert.ok(layout.controlsTogether, message);
          assert.ok(layout.inHeader && layout.centered && layout.syncAtRight, message);
        }
      }
    }
  } finally { await server.close(); await rm(cache, { recursive: true, force: true }); }
});
