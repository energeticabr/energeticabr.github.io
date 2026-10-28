import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('resumo da baixa mantém tabela legível e confirmação acessível no celular e Windows', { timeout: 180_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome/Edge unavailable');
  const server = await createServer({ root: resolve(fileURLToPath(new URL('..', import.meta.url))),
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const sample of ['basic', 'multiple']) {
      for (const [width, height] of [[320, 740], [390, 844], [1024, 768], [1365, 900]]) {
        const result = await runBrowserLayout(browser, { width, height, colorScheme: width === 320 ? 'dark' : 'light',
          url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/provision-settlement-launch-summary.html?test=1&sample=${sample}` });
        const dom = new JSDOM(result.stdout), layout = JSON.parse(dom.window.document.documentElement.dataset.layout);
        dom.window.close();
        t.diagnostic(JSON.stringify(layout));
        assert.equal(layout.missing, false);
        assert.equal(layout.rows, sample === 'multiple' ? 4 : 1);
        assert.equal(layout.total, sample === 'multiple' ? 'R$ 2.003,86' : 'R$ 769,00');
        assert.equal(layout.pageOverflow, false);
        assert.equal(layout.tableOverflow, false, 'as três colunas devem caber sem rolagem lateral');
        assert.ok(layout.minFontSize >= 12);
        assert.equal(layout.quantityFitsOnOneLine, true, 'QTD e quantidades comuns não podem partir entre linhas');
        assert.equal(layout.controlsReachable, true);
        assert.deepEqual(layout.replies, ['choice:submeter_lancamentos:1', 'choice:submeter_lancamentos:2']);
        assert.equal(layout.busyDisabled, true);
        assert.deepEqual(layout.rowBackgrounds, sample === 'multiple'
          ? ['rgb(255, 255, 255)', 'rgb(232, 243, 255)', 'rgb(255, 255, 255)', 'rgb(232, 243, 255)'] : ['rgb(255, 255, 255)']);
      }
    }
  } finally { await server.close(); }
});
