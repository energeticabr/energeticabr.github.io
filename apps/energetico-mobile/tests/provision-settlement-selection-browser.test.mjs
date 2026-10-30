import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('partial provision review uses local selection and a bounded horizontal table with unbroken quantities', { timeout: 180_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root: resolve(fileURLToPath(new URL('..', import.meta.url))),
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  const capture = process.env.PROVISION_SETTLEMENT_SELECTION_CAPTURE_DIR;
  if (capture) mkdirSync(capture, { recursive: true });
  try {
    await server.listen();
    for (const [width, height] of [[320, 740], [390, 844], [1365, 900]]) for (const sample of ['basic', 'long', 'invalid']) {
      await t.test(`${sample} at ${width}px`, async () => {
        const result = await runBrowserLayout(browser, { width, height, captureScreenshot: Boolean(capture),
          url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/provision-settlement-selection.html?sample=${sample}` });
        if (capture) writeFileSync(join(capture, `provision-selection-${sample}-${width}.png`), result.screenshot);
        const dom = new JSDOM(result.stdout);
        try {
          const state = JSON.parse(dom.window.document.documentElement.dataset.layout), detail = JSON.stringify({ width, sample, state });
          assert.equal(state.error, undefined, detail);
          for (const field of ['quantityNoWrap', 'quantityTextFits', 'columnsReachable', 'checkboxesLeft', 'checkboxReachable',
            'selectAllBelow', 'controlsReachable', 'allIndeterminate', 'localOnly', 'draftPreserved', 'restoredAfterEdit', 'paidDisabled', 'emptyBlocked']) {
            assert.equal(state[field], true, `${field}: ${detail}`);
          }
          assert.equal(state.pageHorizontalOverflow, false, detail);
          assert.equal(state.regionFits, true, detail);
          if (width <= 390) assert.equal(state.horizontalRegion, true, detail);
          assert.equal(state.minFontSize >= 12, true, detail);
          assert.deepEqual(state.replies, sample === 'invalid'
            ? ['description_review_edit:11,13'] : ['description_review_submit:11,13', 'description_review_edit:11,13'], detail);
          assert.equal(state.submitDisabled, sample === 'invalid', detail);
          assert.equal(state.editDisabled, false, detail);
          if (sample === 'invalid') {
            assert.equal(state.invalidInitiallyBlocked, true, detail);
            assert.equal(state.validSubsetAllowed, true, detail);
            assert.equal(state.validSubsetReply, 'description_review_submit:13', detail);
            assert.equal(state.invalidReselectedBlocked, true, detail);
          }
          assert.deepEqual(state.checkedIds, ['11', '13'], detail);
          assert.equal(state.busyDisabled, true, detail);
        } finally { dom.window.close(); }
      });
    }
  } finally { await server.close(); }
});
