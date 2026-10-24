import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('retorno com aviso e anexo restaura mascotes e abre relatório real em320/390/1365px', { timeout: 90000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
    .find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const width of [320, 390, 1365]) {
      const { stdout, screenshot } = await runBrowserLayout(browser, { width, height: 844,
        captureScreenshot: Boolean(process.env.HOME_RETURN_SCREENSHOT_PREFIX),
        url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/home-return-shortcuts.html?probe` });
      const dom = new JSDOM(stdout);
      try {
        const layout = JSON.parse(dom.window.document.documentElement.dataset.layout);
        assert.equal(layout.submenuIcons, 0);
        assert.equal(layout.count, 22);
        assert.equal(new Set(layout.actions).size, 22, 'sem mascotes duplicados');
        assert.ok(layout.buttons.every(button => button.external && button.loaded && button.width >= 44 && button.height >= 44
          && button.left >= 0 && button.right <= width + 1), JSON.stringify({ width, layout }));
        assert.equal(layout.overflow, false);
        assert.match(layout.notice, /OS DADOS DO FLUXO FORAM ELIMINADOS[\s\S]*OS ANEXOS FORAM TRANSFERIDOS/);
        assert.match(layout.attachment, /Documento transferido\.pdf/);
        assert.equal(layout.reportReady, true, 'o clique precisa abrir e preencher o relatório, não só emitir evento');
        assert.deepEqual(layout.opened, ['payments']);
        assert.deepEqual(layout.reads, ['payments']);
        assert.deepEqual(layout.selected, [], 'abrir o relatório não muda o fluxo da conversa');
        if (screenshot) writeFileSync(`${process.env.HOME_RETURN_SCREENSHOT_PREFIX}-${width}.png`, screenshot);
      } finally { dom.window.close(); }
    }
  } finally { await server.close(); }
});
