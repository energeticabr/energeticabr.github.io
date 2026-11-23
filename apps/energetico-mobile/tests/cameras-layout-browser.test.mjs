import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';
test('lista e oito vídeos cabem no telefone e no desktop', { timeout: 120000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const cacheDir = await mkdtemp(join(tmpdir(), 'cameras-layout-'));
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), cacheDir, logLevel: 'silent', server: { host:'127.0.0.1',port:0 } });
  await server.listen(); t.after(async () => { await server.close(); await rm(cacheDir, { recursive:true,force:true }); });
  for (const width of [320, 390, 1365]) for (const mode of ['list', 'player', 'single']) {
    const height = width > 700 ? 768 : 844;
    const { stdout, screenshot } = await runBrowserLayout(browser, { width,height,mobile:width < 700,
      captureScreenshot: width === 390 && mode === 'single' && Boolean(process.env.CAMERA_CONTROLS_SCREENSHOT),
      url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/cameras-layout.html?${mode}` });
    if (screenshot) writeFileSync(process.env.CAMERA_CONTROLS_SCREENSHOT, screenshot);
    const dom=new JSDOM(stdout), layout=JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
    if (mode === 'list') {
      assert.equal(layout.cards.length,9);
      assert.ok(layout.cards.every(card => card.left >= 0 && card.right <= width));
    } else {
      assert.equal(layout.portrait,String(height > width));
      assert.equal(layout.tiles.length,mode === 'single' ? 1 : 8);
      assert.ok(layout.player.width <= width + 1 && layout.player.height <= height + 1);
      assert.ok(layout.tiles.every(tile => tile.width > 100 && tile.height > 100
        && tile.left >= 0 && tile.right <= width && tile.top >= 0 && tile.bottom <= height));
      if (mode === 'single') assert.ok(layout.controls.width > 40 && layout.controls.height > 40);
    }
  }
});
