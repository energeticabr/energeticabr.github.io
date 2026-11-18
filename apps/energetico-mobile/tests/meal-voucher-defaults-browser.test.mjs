import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createIsolatedViteServer } from './helpers/isolated-vite-server.mjs';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('alimentação preenche e edita todos os fornecedores sem transbordar no celular e PC', { timeout:120000 }, async t => {
  const browser = [process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome indisponível');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = await createIsolatedViteServer({ root, server:{ host:'127.0.0.1', port:0, fs:{ allow:[resolve(root,'../..')] } }, logLevel:'silent' });
  try {
    await server.listen();
    for (const width of [320,390,768,1365]) {
      const { stdout } = await runBrowserLayout(browser, { width, height:844, url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/meal-voucher-defaults.html` });
      const dom = new JSDOM(stdout);
      const result = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
      assert.deepEqual(result, { initial:true, allRows:true, total:true, filter:true, individual:true, noOverflow:true, noEarlyWrites:true }, `largura ${width}`);
    }
  } finally { await server.close(); }
});
