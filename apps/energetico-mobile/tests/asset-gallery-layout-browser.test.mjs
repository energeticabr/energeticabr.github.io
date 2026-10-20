import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { build, createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('asset gallery clusters fit phones, tablet, Windows and delivered PWA CSS without overlapping actions', { timeout: 120_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const built = await build({ configFile: false, root: join(root, 'pwa'), base: '/energetico/', logLevel: 'silent', build: { write: false } });
  const css = built.output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => item.source).join('\n');
  const server = await createServer({ root, logLevel: 'silent',
    plugins: [{ name: 'serve-built-asset-css', configureServer(devServer) {
      // Register before Vite's SPA fallback, which otherwise serves HTML for this URL.
      devServer.middlewares.use('/__asset-built.css', (_req, res) => { res.setHeader('Content-Type', 'text/css'); res.end(css); });
    } }], server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..')] } } });
  await server.listen(); t.after(() => server.close());
  for (const [width, pwa, tallControls] of [[320, false], [390, false], [768, false], [1365, false], [390, true], [1365, true], [1365, false, true]]) {
    const { stdout, screenshot } = await runBrowserLayout(browser, { width, height: 950, mobile: width < 700,
      url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/asset-gallery-responsive.html?${pwa ? 'pwa' : ''}${tallControls ? 'tall-controls' : ''}`,
      captureScreenshot: width === 390 && !pwa && Boolean(process.env.ASSET_GALLERY_SCREENSHOT) });
    const dom = new JSDOM(stdout), layout = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
    assert.equal(layout.overflow, false); assert.equal(layout.cards.length, 3);
    for (const card of layout.cards) {
      assert.ok(card.ordered && card.actionsClear && card.railClear, `${width}/${pwa} ${JSON.stringify(card)}`);
      assert.deepEqual(card.overflow, [], `${width}/${pwa} ${JSON.stringify(card)}`);
      assert.ok(card.moneySingleLine, `${width}/${pwa}: money must not split digits`);
      assert.ok(Math.abs(card.main.width - card.main.values) < 1, 'values use the full content width');
      assert.deepEqual(card.actions.map(action => action.action), ['edit', 'delete']);
      assert.ok(card.actions.every(action => action.width >= 44 && action.height >= 44));
    }
    assert.deepEqual(layout.cards[0].flags.map(flag => flag.fill), ['rgb(229, 245, 233)', 'rgb(229, 245, 233)']);
    assert.deepEqual(layout.cards[1].flags.map(flag => flag.fill), ['rgb(253, 235, 237)', 'rgb(253, 235, 237)']);
    assert.deepEqual(layout.cards[2].flags.map(flag => flag.fill), ['rgb(240, 244, 246)', 'rgb(240, 244, 246)']);
    if (screenshot) writeFileSync(process.env.ASSET_GALLERY_SCREENSHOT, screenshot);
    t.diagnostic(`${width}px${pwa ? ' PWA' : ''}: ordered groups, readable money and clear action buttons`);
  }
});
