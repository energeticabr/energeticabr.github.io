import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('manual best-effort compression remains previewable, optional and returns to the unanswered form', { timeout: 180000 }, async t => {
  const browser = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..')] } }, logLevel: 'silent' });
  await server.listen();
  try {
    for (const [width, height] of [[390, 844], [1365, 900]]) {
      for (const mode of ['preview', 'compressed', 'original-preview', 'unchanged']) {
        const result = await runBrowserLayout(browser, { width, height,
          url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/manual-attachment-compression.html?best-effort=1&receipt-only=1&mode=${mode}` });
        const dom = new JSDOM(result.stdout);
        const state = JSON.parse(dom.window.document.documentElement.dataset.layout);
        dom.window.close();
        assert.equal(state.error, '');
        assert.equal(state.compressionCalls, 1);
        assert.deepEqual(state.beforeManual, { compressionCalls: 0, choices: [], requests: [], pendingCompression: false });
        assert.equal(state.attachmentCount, 1);
        assert.equal(state.overflow, false);
        assert.deepEqual(state.requests, [], 'compression cannot submit or answer the underlying form');
        assert.equal(state.goalMissVisible, mode === 'preview');
        assert.equal(state.originalChoice, mode === 'preview');
        assert.equal(state.compressedChoice, mode === 'preview');
        assert.equal(state.restored, mode !== 'preview');
        assert.equal(state.pendingCompression, mode === 'preview');
        assert.deepEqual(state.sizes, [mode === 'compressed' ? 1_600_000 : 12_800_000], 'original stays until explicit acceptance, even when the target was missed');
        assert.deepEqual(state.choices, ['attachment_compression_level_high', ...(mode === 'preview' || mode === 'unchanged'
          ? [] : [mode === 'compressed' ? 'attachment_compression_use_compressed' : 'attachment_compression_use_original'])]);
      }
    }
  } finally { await server.close(); }
});
