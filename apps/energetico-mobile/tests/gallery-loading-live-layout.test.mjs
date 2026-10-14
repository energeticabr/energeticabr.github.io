import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';
import { galleryCases } from './helpers/gallery-create-cases.mjs';

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
      assert.equal(results.length, galleryCases.length);
      for (const result of results) {
        for (const state of ['initial', 'refreshing']) {
          const layout = result[state], message = `${width}x${height} ${result.name} ${state}: ${JSON.stringify(layout)}`;
          assert.equal(layout.missing, undefined, message);
          assert.ok(layout.covered && layout.headerVisible && layout.loaderVisible && layout.opaque && layout.centeredHit && layout.keyboardSafe, message);
          assert.match(layout.indicatorBackdrop, /^rgba\([^)]*, 0\.[5-9][0-9]*\)$/, `mascot loader must keep a translucent card: ${message}`);
          assert.ok(Math.abs(layout.imageCenterX - width / 2) <= 2, message);
          assert.ok(Math.abs(layout.indicatorCenterY - layout.desiredCenterY) <= 2, message);
          assert.ok(layout.fits && !layout.overflow, message);
        }
        assert.equal(result.restored, true, `${result.name} content stays usable after loading`);
      }
    }
  } finally { await server.close(); }
});

test('mascot loading cards use a translucent dark backdrop in dark mode', { timeout: 45_000 }, async t => {
  if (!browser) return t.skip('Chrome/Edge unavailable');
  const server = await createServer({ root: appRoot, server: { host: '127.0.0.1', port: 0,
    fs: { allow: [resolve(appRoot, '../..')] } }, logLevel: 'silent' });
  try {
    await server.listen();
    const { stdout } = await runBrowserLayout(browser, { width: 390, height: 844, colorScheme: 'dark',
      url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/gallery-loading-responsive.html` });
    const dom = new JSDOM(stdout), results = JSON.parse(dom.window.document.documentElement.dataset.layout);
    dom.window.close();
    for (const result of results) {
      assert.equal(result.initial.indicatorBackdrop, 'rgba(23, 56, 68, 0.88)', result.name);
      assert.equal(result.refreshing.indicatorBackdrop, 'rgba(23, 56, 68, 0.88)', result.name);
      assert.equal(result.initial.indicatorTextColor, 'rgb(237, 247, 249)', result.name);
    }
  } finally { await server.close(); }
});
