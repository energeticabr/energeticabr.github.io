import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('parent editor real styles/catalogs and fake writes fit phone and desktop with guarded refresh-only retry', { timeout: 180_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root: resolve(fileURLToPath(new URL('..', import.meta.url))), server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  const capture = process.env.PROVISION_PARENT_EDITOR_CAPTURE_DIR;
  if (capture) mkdirSync(capture, { recursive: true });
  try {
    await server.listen();
    for (const [width, height] of [[320, 740], [390, 844], [1365, 900]]) for (const sample of ['chooser', 'field', 'refresh-failed']) {
      await t.test(`${sample} at ${width}px`, async () => {
        const result = await runBrowserLayout(browser, { width, height, captureScreenshot: Boolean(capture),
          url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/provision-settlement-parent-editor.html?sample=${sample}` });
        if (capture) writeFileSync(join(capture, `parent-editor-${sample}-${width}.png`), result.screenshot);
        const dom = new JSDOM(result.stdout);
        try {
          const state = JSON.parse(dom.window.document.documentElement.dataset.layout), detail = JSON.stringify({ width, sample, state });
          assert.equal(state.error, undefined, detail);
          for (const key of ['parentBelowLine', 'beginIdentity', 'pendingLocksTable', 'chooserReachable', 'dialogFits', 'noNetwork']) assert.equal(state[key], true, `${key}: ${detail}`);
          assert.equal(state.pageHorizontalOverflow, false, detail); assert.equal(state.dialogHorizontalOverflow, false, detail);
          assert.deepEqual(state.realColumns, ['FILIAL', 'FORNECEDOR', 'FORMAPGTO', 'STATUS', 'OBS', 'VALORTOTAL', 'DATAPREVISTOPGTO'], detail);
          if (sample !== 'chooser') {
            assert.equal(state.oneField, true, detail); assert.equal(state.controlsReachable, true, detail);
            assert.deepEqual(state.realCatalog, ['001 — OBRA FICTÍCIA', '002 — UNIDADE DE TESTE'], detail);
          }
          if (sample === 'field') assert.ok(state.minFieldHeight >= 44, detail);
          if (sample === 'refresh-failed') {
            for (const key of ['fanoutConfirmed', 'refreshIdentity', 'noResave', 'retryReachable']) assert.equal(state[key], true, detail);
            assert.deepEqual(state.writes, [['parents', '7', ['FILIAL']], ['children', '11', ['FILIAL']], ['children', '12', ['FILIAL']]], detail);
          }
        } finally { dom.window.close(); }
      });
    }
  } finally { await server.close(); }
});
