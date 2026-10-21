import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('compression restores usable flow buttons on phone and PC without submitting until clicked', { timeout: 180000 }, async t => {
  const browser = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..')] } }, logLevel: 'silent' });
  await server.listen();
  try {
    for (const [width, height] of [[390, 844], [1365, 900]]) {
      for (const mode of ['original-level', 'original-preview', 'compressed']) {
        for (const advance of [false, true]) {
          const result = await runBrowserLayout(browser, { width, height,
            url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attachment-compression-return.html?mode=${mode}${advance ? '&advance=1' : ''}` });
          const dom = new JSDOM(result.stdout);
          const state = JSON.parse(dom.window.document.documentElement.dataset.layout);
          dom.window.close();
          assert.equal(state.restored, !advance);
          assert.equal(state.advanced, advance);
          assert.equal(state.pendingCompression, false);
          assert.deepEqual(state.requests, advance ? [{ text: '✅ FINALIZAR ANEXOS', replyId: 'input_continue' }] : []);
          assert.equal(state.attachmentCount, 1);
          assert.equal(state.size, mode === 'compressed' ? 800_000 : 6_400_000);
          assert.equal(state.flow, 'qa-order');
          assert.equal(state.overflow, false);
        }
      }
    }
  } finally { await server.close(); }
});
