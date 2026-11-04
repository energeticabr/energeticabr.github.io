import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('menu e histórico de imobilizados cabem a 320, 390, 768 e 1365 pixels', { timeout: 120_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const cacheDir = await mkdtemp(join(tmpdir(), 'asset-launches-vite-'));
  const server = await createServer({ root, cacheDir, logLevel: 'silent', server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..'), cacheDir] } } });
  await server.listen(); t.after(async () => { await server.close(); await rm(cacheDir, { recursive: true, force: true }); });
  for (const width of [320, 390, 768, 1365]) for (const mode of ['menu', 'gallery']) {
    const { stdout, screenshot } = await runBrowserLayout(browser, { width, height: 950, mobile: width < 700,
      url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/asset-launches-responsive.html?mode=${mode}`,
      captureScreenshot: width === 390 && Boolean(process.env.ASSET_LAUNCHES_SCREENSHOT_PREFIX) });
    const dom = new JSDOM(stdout), layout = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
    assert.equal(layout.overflow, false, `${width}/${mode}`);
    if (mode === 'menu') {
      assert.deepEqual(layout.buttons.map(button => button.label), ['CADASTROS IMOBILIZADOS', 'LANÇAMENTOS IMOBILIZADOS']);
      assert.ok(layout.buttons[0].bottom < layout.buttons[1].top);
      assert.ok(layout.buttons.every(button => button.width >= 250 && button.height >= 64));
    } else {
      assert.equal(layout.cards.length, 2); assert.ok(layout.cards.every(card => !card.overflow));
      const current = layout.cards.find(card => card.id === '1'), legacy = layout.cards.find(card => card.id === '2');
      assert.match(current.text, /86,76/); assert.match(current.text, /2%/);
      assert.match(current.text, /ID LANÇAMENTO4\.321/);
      assert.doesNotMatch(legacy.text, /ID LANÇAMENTO/);
      assert.match(legacy.text, /ID Imobilizado:94/); assert.equal(layout.actions, 0);
    }
    if (screenshot) writeFileSync(`${process.env.ASSET_LAUNCHES_SCREENSHOT_PREFIX}-${mode}.png`, screenshot);
  }
});
