import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('DANFE → carta de correção → DANFE funciona em 320/390px e Windows com PDFs renderizados', { timeout: 120000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = await createServer({ root, logLevel: 'silent', server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..')] } } });
  await server.listen(); t.after(() => server.close());
  for (const width of [320, 390, 1365]) {
    const { stdout, screenshot } = await runBrowserLayout(browser, { width, height: 1000, mobile: width < 700,
      url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/sefaz-correction-navigation.html`,
      captureScreenshot: Boolean(process.env.SEFAZ_NAV_SCREENSHOTS) });
    const dom = new JSDOM(stdout), layout = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
    assert.equal(layout.error, undefined, layout.error);
    assert.deepEqual(layout.listed, [{ id: '4', refresh: true }]);
    assert.equal(layout.first.position, '1 de 2'); assert.equal(layout.first.nextDisabled, false); assert.equal(layout.first.previousDisabled, true);
    assert.equal(layout.next.position, '2 de 2'); assert.equal(layout.next.nextDisabled, true); assert.equal(layout.next.previousDisabled, false);
    assert.match(layout.next.text, /CARTA DE CORRECAO FICTICIA/);
    assert.equal(layout.back.position, '1 de 2'); assert.match(layout.back.text, /DANFE FICTICIO/);
    assert.deepEqual(layout.downloads, ['danfe', '4:CCe-NOTA-FISCAL-FICTICIA-110110-01.pdf', 'danfe', '4:CCe-NOTA-FISCAL-FICTICIA-110110-01.pdf']);
    assert.equal(layout.overflow, false); assert.equal(layout.navOverflow, false); assert.ok(layout.dialogWidth <= width);
    if (screenshot) writeFileSync(join(process.env.SEFAZ_NAV_SCREENSHOTS, `correction-${width}.png`), screenshot);
  }
});
