import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('vale-alimentação reabre pedido vazio, edita campos e confirma uma única vez no celular e PC', { timeout:120000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome indisponível');
  const app = resolve(fileURLToPath(new URL('..', import.meta.url))), cache = mkdtempSync(join(tmpdir(),'meal-recovery-vite-'));
  const server = await createServer({ root:app, cacheDir:cache, server:{ host:'127.0.0.1', port:0, fs:{ allow:[resolve(app,'../..')] } }, logLevel:'silent' });
  try {
    await server.listen();
    for (const width of [320,390,768,1365]) {
      const { stdout } = await runBrowserLayout(browser, { width, height:844, url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/meal-voucher-recovery.html` });
      const dom = new JSDOM(stdout), result = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
      assert.deepEqual(result, { enabled:true, pickers:true, persists:true, noEarlyWrites:true, noOverflow:true, webLock:true, orders:1, launches:1, payroll:1,
        orderDate:'2026-11-02T12:00:00Z', orderAccount:'BANCO', paid:'2026-11-03T12:00:00Z', stage:'ALVENARIA', sheet:12 }, `${width}px`);
    }
  } finally { await server.close(); await rm(cache, { recursive:true, force:true, maxRetries:5, retryDelay:250 }); }
});
