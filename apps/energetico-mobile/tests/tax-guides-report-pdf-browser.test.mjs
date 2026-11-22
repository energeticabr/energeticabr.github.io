import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('INSS and FGTS PDFs use the compact horizontal viewer from the report', { timeout: 120_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
    .find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..')] } }, logLevel: 'silent' });
  const capture = process.env.TAX_GUIDES_PDF_CAPTURE_DIR;
  try {
    await server.listen();
    for (const [width, height] of [[844, 390], [390, 844], [320, 700], [568, 320], [390, 220], [1365, 900]]) {
      const { stdout, screenshot } = await runBrowserLayout(browser, {
        width, height, safeAreaInsets: width === 390 && height === 844 ? { top: 59, bottom: 34, left: 0, right: 0 } : undefined,
        captureScreenshot: Boolean(capture),
        url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/tax-guides-report-pdf.html${capture ? '?capture' : ''}`,
      });
      const { window } = new JSDOM(stdout);
      try {
        const state = JSON.parse(window.document.documentElement.dataset.layout);
        const detail = `${width}×${height}: ${JSON.stringify(state)}`;
        assert.equal(state.error, undefined, detail);
        for (const flag of ['singleNoNav', 'inssReturns', 'first', 'second', 'longTitle', 'pageTwoVisible', 'fgtsReturns', 'cancelReturns']) assert.equal(state[flag], true, `${flag}: ${detail}`);
        for (const result of [state.inss, state.fgts, state.attachment]) {
          assert.ok(result.closeLeft && result.horizontal && result.fits, detail);
          assert.ok(result.compactFooter && result.actionsVisible && result.scrolls, detail);
          assert.ok(result.fullWidth >= .95 && result.fullWidth <= 1, detail);
          assert.ok(result.visiblePdf >= (height === 220 ? .28 : .50), detail);
        }
        const inss = ['7', 'INSS_102026_ENERGETICA.pdf'], fgts = ['8', 'FGTS_102026_ENERGETICA.pdf'];
        assert.deepEqual(state.downloads, [inss, fgts, ['8', `Anexo_${'FGTS_'.repeat(26)}.pdf`], fgts, inss, ...(capture ? [fgts] : [])]);
        if (capture) {
          mkdirSync(capture, { recursive: true });
          writeFileSync(join(capture, `guias-${width}x${height}.png`), screenshot);
        }
      } finally { window.close(); }
    }
  } finally { await server.close(); }
});
