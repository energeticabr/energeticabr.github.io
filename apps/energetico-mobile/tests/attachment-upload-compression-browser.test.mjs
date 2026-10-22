import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('accepted heavy upload keeps the VM compression prompt without a false error on phone and PC', { timeout: 180000 }, async t => {
  const browser = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..')] } }, logLevel: 'silent' });
  await server.listen();
  try {
    for (const [width, height] of [[390, 844], [1365, 900]]) {
      for (const receipt of [false, true]) for (const keep of [false, true]) {
        const query = new URLSearchParams({ ...(receipt ? { receipt: '1' } : {}), ...(keep ? { keep: '1' } : {}) });
        const result = await runBrowserLayout(browser, { width, height,
          url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attachment-upload-compression.html?${query}` });
        const dom = new JSDOM(result.stdout);
        const state = JSON.parse(dom.window.document.documentElement.dataset.layout);
        dom.window.close();
        assert.equal(state.error, '');
        assert.equal(state.compressionCalls, 0);
        assert.equal(state.uploads, 1);
        assert.equal(state.prompt, !keep);
        assert.equal(state.continued, keep);
        assert.deepEqual(state.requests, keep ? [{ text: '📎 MANTER ORIGINAL', replyId: 'compress_attachments_no' }] : []);
        assert.equal(state.attachmentCount, 3);
        assert.equal(state.size, 12_800_000);
        assert.equal(state.flow, 'qa-supplies');
        assert.equal(state.overflow, false);
      }
    }
  } finally { await server.close(); }
});
