import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('completion receipt closes automatically and manually on phone and Windows widths', { timeout: 120000 }, async t => {
  const browser = [process.env.CHROME_BIN, '/usr/bin/google-chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = await createServer({ root, cacheDir: resolve(root, 'node_modules/.vite-completion-dismiss'), server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..')] } }, logLevel: 'silent' });
  await server.listen();
  try {
    for (const width of [320, 390, 1365]) {
      const result = await runBrowserLayout(browser, { width, height: 844, url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/completion-receipt-dismiss.html` });
      const dom = new JSDOM(result.stdout);
      const layout = JSON.parse(dom.window.document.querySelector('#layout-result').textContent);
      dom.window.close();
      assert.match(layout.title, /REGISTRO EXCLUÍDO/);
      assert.ok(layout.left >= 0 && layout.right <= width, JSON.stringify(layout));
      assert.equal(layout.autoClosed, true, JSON.stringify(layout));
      assert.equal(layout.manualClosed, true, JSON.stringify(layout));
      assert.equal(layout.nextConfirmationPreserved, true, JSON.stringify(layout));
      assert.equal(layout.writes, 2);
    }
  } finally { await server.close(); }
});
