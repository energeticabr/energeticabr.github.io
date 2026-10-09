import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('botão de selecionar todas cabe e marca os lançamentos no celular, tablet e PC', { timeout: 120000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  await server.listen();
  try {
    for (const width of [320, 390, 768, 1365]) {
      const { stdout } = await runBrowserLayout(browser, {
        width, height: 844,
        url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/launch-payroll-select-all.html`,
      });
      const dom = new JSDOM(stdout);
      const layout = JSON.parse(dom.window.document.documentElement.dataset.layout);
      dom.window.close();
      assert.ok(layout.width >= 44 && layout.height >= 44 && layout.above && layout.fits && layout.hittable && !layout.overflow, JSON.stringify({ width, ...layout }));
      assert.deepEqual(layout.selected, ['3542', '3543', '3544', '3545']);
      assert.equal(layout.sentOnSelection, 0);
      assert.deepEqual(layout.replies, ['launch_payroll_selected:3542,3544,3545']);
    }
  } finally { await server.close(); }
});
