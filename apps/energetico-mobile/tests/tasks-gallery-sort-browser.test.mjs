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

test('task sort icon shares one toolbar row and popup fits portrait, landscape, tablet and Windows', { timeout: 120_000 }, async t => {
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root: appRoot, server: { host: '127.0.0.1', port: 0,
    fs: { allow: [resolve(appRoot, '../..')] } }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const [width, height, wide = false] of [[320, 740], [320, 740, true], [390, 844], [768, 1024], [1365, 768], [844, 390]]) {
      const { stdout } = await runBrowserLayout(browser, { width, height,
        url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/tasks-gallery-sort.html${wide ? '?wide=1' : ''}` });
      const dom = new JSDOM(stdout), result = JSON.parse(dom.window.document.documentElement.dataset.layout);
      dom.window.close();
      const diagnostic = `${width}x${height}: ${JSON.stringify(result)}`;
      const [search, sort, filter, add] = result.bar;
      assert.ok(search.width >= 90 && sort.width >= 44 && sort.height >= 44, diagnostic);
      assert.ok(search.right <= sort.x && sort.right <= filter.x && filter.right <= add.x, diagnostic);
      assert.ok(result.bar.every(rect => Math.abs(rect.bottom - search.bottom) < 1), diagnostic);
      assert.ok(add.right <= width && !result.overflow && result.toolbarTextFits, diagnostic);
      assert.ok(result.modalFits && result.textFits && result.focusInside && result.inert && result.closed, diagnostic);
      assert.deepEqual(result.ids, ['33', '22', '11'], diagnostic);
      assert.equal(result.loads, 1, diagnostic);
      t.diagnostic(`${width}x${height}: toolbar and popup fit; sort applied without reload`);
    }
  } finally { await server.close(); }
});
