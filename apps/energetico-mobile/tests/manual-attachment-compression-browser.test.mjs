import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('uploaded originals stay in the flow until the compression icon is clicked on phone and PC', { timeout: 180000 }, async t => {
  const browser = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..')] } }, logLevel: 'silent' });
  await server.listen();
  try {
    for (const [width, height] of [[390, 844], [1365, 900]]) {
      for (const query of ['', 'batch=1', 'small=1', 'receipt=1', 'receipt-only=1', 'mode=original-level', 'mode=original-preview&receipt=1', 'mode=compressed&receipt-only=1', 'mode=compressed&batch=1']) {
        const params = new URLSearchParams(query), mode = params.get('mode');
        const result = await runBrowserLayout(browser, { width, height,
          url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/manual-attachment-compression.html?${query}` });
        const dom = new JSDOM(result.stdout);
        const state = JSON.parse(dom.window.document.documentElement.dataset.layout);
        dom.window.close();
        assert.deepEqual(state.beforeManual, { compressionCalls: 0, choices: [], requests: [], pendingCompression: false });
        assert.equal(state.error, '');
        assert.equal(state.compressionCalls, mode ? 1 : 0);
        assert.equal(state.uploads, params.has('batch') ? 3 : 1);
        assert.equal(state.attachmentCount, state.uploads);
        assert.equal(state.restored, true);
        assert.equal(state.pendingCompression, false);
        assert.deepEqual(state.requests, [], 'compressing never answers or submits the original form');
        assert.deepEqual(state.choices, !mode ? [] : mode === 'original-level' ? ['attachment_compression_use_original']
          : ['attachment_compression_level_high', `attachment_compression_use_${mode === 'compressed' ? 'compressed' : 'original'}`]);
        assert.deepEqual(state.sizes, Array.from({ length: state.uploads }, (_, i) => mode === 'compressed' && !i ? 400_000 : params.has('small') ? 1_200_000 : 12_800_000));
        assert.equal(state.flow, 'qa-manual-only');
        assert.equal(state.overflow, false);
      }
    }
  } finally { await server.close(); }
});
