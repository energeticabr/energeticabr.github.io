import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('Fechar ocupa o rodapé inteiro e centraliza o texto no popup de diários', { timeout: 180000 }, async t => {
  const browser = [process.env.CHROME_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({
    root: resolve(fileURLToPath(new URL('..', import.meta.url))),
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent',
  });
  try {
    await server.listen();
    for (const [width, height] of [[320, 640], [390, 844], [844, 390], [1366, 900]]) {
      const { stdout } = await runBrowserLayout(browser, {
        width, height,
        url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/pending-construction-diary-reminder-browser.html`,
      });
      const dom = new JSDOM(stdout);
      try {
        const layout = JSON.parse(dom.window.document.documentElement.dataset.layout);
        const evidence = `${width}x${height}: ${JSON.stringify(layout)}`;
        assert.ok(Math.abs(layout.button.width - layout.footer.width) <= 1, 'Botão deve ocupar todo o rodapé: ' + evidence);
        assert.ok(Math.abs(layout.button.left - layout.footer.left) <= 1, evidence);
        assert.ok(Math.abs(layout.button.right - layout.footer.right) <= 1, evidence);
        assert.ok(Math.abs(layout.label.left + layout.label.width / 2 - (layout.footer.left + layout.footer.width / 2)) <= 1, 'Texto deve ficar centralizado no cluster: ' + evidence);
        assert.ok(Math.abs(layout.label.top + layout.label.height / 2 - (layout.button.top + layout.button.height / 2)) <= 2, evidence);
        assert.ok(layout.button.height >= 44, evidence);
        assert.ok(layout.button.bottom <= layout.dialog.bottom, evidence);
        assert.ok(layout.documentOverflow <= 1, evidence);
        assert.equal(layout.dismissAction, 'dismiss-pending-construction-diaries');
        assert.equal(layout.fillButtons, 2);
      } finally { dom.window.close(); }
    }
  } finally { await server.close(); }
});
