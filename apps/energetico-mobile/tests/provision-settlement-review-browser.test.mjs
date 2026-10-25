import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('tabela de revisão mantém totais e botões acessíveis no celular e Windows', { timeout: 180_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome']
    .find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome/Edge unavailable');
  const server = await createServer({ root: resolve(fileURLToPath(new URL('..', import.meta.url))),
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const sample of ['basic', 'long', 'pending']) {
      for (const [width, height] of [[320, 740], [390, 844], [1024, 768], [1365, 900]]) {
        const result = await runBrowserLayout(browser, { width, height,
          colorScheme: width === 320 ? 'dark' : 'light',
          url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/provision-settlement-review.html?test=1&sample=${sample}` });
        const dom = new JSDOM(result.stdout);
        const layout = JSON.parse(dom.window.document.documentElement.dataset.layout);
        dom.window.close();
        t.diagnostic(JSON.stringify(layout));
        assert.equal(layout.missing, false);
        assert.equal(layout.rowCount, 4);
        assert.equal(layout.pageOverflow, false, 'a rolagem horizontal pertence somente à tabela');
        assert.ok(layout.minFontSize >= 12, 'não reduzir as letras para espremer colunas');
        assert.equal(layout.totalFullyVisible, true, 'a coluna do produto não pode encobrir os totais');
        assert.equal(layout.controlsReachable, true, 'ambos os botões devem estar alcançáveis acima do compositor');
        assert.equal(layout.editDisabled, false);
        assert.equal(layout.submitDisabled, sample === 'pending');
        assert.deepEqual(layout.replies, sample === 'pending' ? ['description_review_edit'] : ['description_review_submit', 'description_review_edit']);
        assert.equal(layout.busyDisabled, true);
        assert.deepEqual(layout.rowBackgrounds, ['rgb(255, 255, 255)', 'rgb(232, 243, 255)', 'rgb(255, 255, 255)', 'rgb(232, 243, 255)']);
        if (width < 680 && layout.horizontalOverflow) assert.equal(layout.scrollHintVisible, true);
      }
    }
  } finally { await server.close(); }
});
