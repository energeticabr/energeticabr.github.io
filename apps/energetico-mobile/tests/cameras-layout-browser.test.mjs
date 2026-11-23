import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';
test('lista e três vídeos cabem no telefone vertical', { timeout: 120000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const cacheDir = await mkdtemp(join(tmpdir(), 'cameras-layout-'));
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), cacheDir, logLevel: 'silent', server: { host:'127.0.0.1',port:0 } });
  await server.listen(); t.after(async () => { await server.close(); await rm(cacheDir, { recursive:true,force:true }); });
  for (const width of [320, 390, 1365]) for (const mode of ['list', 'player']) {
    const height = width > 700 ? 768 : 844;
    const { stdout } = await runBrowserLayout(browser, { width,height,mobile:width < 700,
      url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/cameras-layout.html?${mode}` });
    const dom=new JSDOM(stdout), layout=JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
    if (mode === 'list') {
      assert.equal(layout.cards.length,4);
      assert.ok(layout.cards.every(card => card.left >= 0 && card.right <= width));
    } else {
      assert.equal(layout.portrait,String(height > width));
      assert.equal(layout.tiles.length,3);
      assert.ok(layout.player.width <= width + 1 && layout.player.height <= height + 1);
      assert.ok(layout.tiles.every(tile => tile.width > 100 && tile.height > 100));
    }
  }
});
