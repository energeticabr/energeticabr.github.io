import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('DDA report opens PDFs for the chosen row and closes only the horizontal viewer', { timeout: 120_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..')] } }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const [width, height] of [[320, 740], [390, 844], [844, 390], [1365, 900]]) {
      const capture = process.env.DDA_REPORT_PDF_CAPTURE_DIR;
      const { stdout, screenshot } = await runBrowserLayout(browser, {
        width, height, deviceScaleFactor: width < 900 ? 3 : 1, captureScreenshot: Boolean(capture),
        safeAreaInsets: width === 390 ? { top: 59, bottom: 34, left: 0, right: 0 } : undefined,
        url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/dda-report-pdf.html${capture ? '?capture=report' : ''}`,
      });
      const { window } = new JSDOM(stdout);
      try {
        const state = JSON.parse(window.document.documentElement.dataset.layout);
        assert.equal(state.error, undefined, JSON.stringify({ width, state }));
        assert.ok(state.initialWidthRatio >= .95 && state.initialWidthRatio <= 1, JSON.stringify({ width, state }));
        for (const field of ['idAboveIcon', 'blueLargerIcon', 'fixedSideArrows', 'stripesFillWidth', 'tableFits', 'viewerFits', 'horizontal', 'leftClose', 'sideGaps', 'xCloses', 'leftCloses', 'rightCloses', 'escapeCloses', 'reportPreserved', 'singleNoArrows', 'emptyNotice', 'copyAvailable', 'portraitScrolls', 'multiPageNavigation', 'reopenedAtTop']) {
          assert.equal(state[field], true, JSON.stringify({ width, field, state }));
        }
        assert.ok(state.canvasPixels <= 2_000_000, JSON.stringify({ width, state }));
        if (width < 900) {
          assert.ok(state.rasterDensity >= 1.45, JSON.stringify({ width, state }));
        }
        assert.deepEqual(state.files, ['espelho.pdf', 'outro.PDF', 'espelho.pdf']);
        assert.deepEqual(state.downloads, [['2', 'espelho.pdf'], ['2', 'outro.PDF'], ['2', 'espelho.pdf'], ['2', 'espelho.pdf'], ['2', 'espelho.pdf'], ['1', 'unico.pdf'], ['2', 'espelho.pdf']]);
        if (capture) {
          mkdirSync(capture, { recursive: true });
          writeFileSync(join(capture, `dda-report-pdf-${width}.png`), screenshot);
        }
      } finally { window.close(); }
    }
  } finally { await server.close(); }
});
