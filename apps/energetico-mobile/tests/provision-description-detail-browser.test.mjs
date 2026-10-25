import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('cluster e detalhe completo cabem no celular e PC, com cartões alternados e fechamento sempre visível', { timeout: 180000 }, async t => {
  const browser = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..')] } }, logLevel: 'silent' });
  await server.listen();
  try {
    for (const [width, height] of [[320, 740], [390, 844], [1365, 900]]) {
      for (const detail of [false, true]) {
        const result = await runBrowserLayout(browser, { width, height,
          url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/provision-description-detail.html${detail ? '?detail=1' : ''}` });
        const dom = new JSDOM(result.stdout);
        const layout = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
        assert.equal(layout.cluster, true);
        assert.equal(layout.overflow, false, `${width}px, detail=${detail}`);
        assert.equal(layout.count, detail ? 3 : 0);
        assert.equal(layout.wrongGroup, false);
        if (detail) {
          assert.match(layout.total.replace(/\s/g, ''), /R\$125,00/);
          assert.deepEqual(layout.colors, ['rgb(255, 255, 255)', 'rgb(220, 238, 249)']);
          assert.equal(layout.stickyClose, true);
        }
      }
    }
  } finally { await server.close(); }
});
