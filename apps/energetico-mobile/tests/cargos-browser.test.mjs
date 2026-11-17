import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('Tabela de Cargos abre na horizontal com as seis colunas visíveis', { timeout: 120_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'silent',
  });
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/cargos.html`;
    for (const { width, height, mobile, safeAreaInsets } of [
      { width: 320, height: 568, mobile: true },
      { width: 393, height: 852, mobile: true, safeAreaInsets: { top: 59, bottom: 34, left: 0, right: 0 } },
      { width: 568, height: 320, mobile: true },
      { width: 852, height: 393, mobile: true, safeAreaInsets: { top: 0, bottom: 21, left: 59, right: 59 } },
      { width: 1365, height: 900, mobile: false },
    ]) {
      await t.test(`${width}x${height}`, async () => {
        const result = await runBrowserLayout(browser, { url, width, height, mobile, safeAreaInsets });
        const { window } = new JSDOM(result.stdout);
        try {
          const layout = JSON.parse(window.document.documentElement.dataset.layout);
          const detail = JSON.stringify(layout);
          assert.equal(layout.error, undefined, detail);
          assert.equal(layout.rotated, height > width, detail);
          assert.equal(layout.insideSafeArea, true, detail);
          assert.equal(layout.columns, 6, detail);
          assert.equal(layout.noHorizontalScroll, true, detail);
          assert.equal(layout.cellsFit, true, detail);
          assert.equal(layout.arrowClearOfTable, true, detail);
          assert.equal(layout.pdfHasAllColumns, true, detail);
          assert.equal(layout.controlsWork, true, detail);
        } finally { window.close(); }
      });
    }
  } finally { await server.close(); }
});
